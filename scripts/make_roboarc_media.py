#!/usr/bin/env python3
"""Cut the RoboARC high-quality reference renders into the puzzle wall's loops and write the wall's index.

usage: make_roboarc_media.py <hq dir> <release.json> <difficulty.txt> [--out DIR] [--max-seconds 20]

Inputs: the high-quality renders of the release's reference solutions (<hq dir>/out/roboarc-<base>/: <name>_1080p.mp4,
poster_1080.png, meta.json; each draws the states of a fresh-process replay of the reference that ends on the release's
expected final state, path-traced, a time-lapse that slows while the puzzle moves) and <hq dir>/roboarc_teaser.mp4, the
release's list of bases (family per base) and each base's difficulty from its task.toml ("<base> <difficulty>" per line).

Writes <out>/assets/media/roboarc/<base>.{mp4,jpg} (960x540 H.264, sped up to at most --max-seconds), the teaser
(<out>/assets/media/roboarc/teaser.{mp4,jpg}, 1280x720) and <out>/assets/data/roboarc.json (families -> bases, in the
release's numbering). <out> defaults to this repository. Run it where the renders are; copy the outputs back.
"""
import json, math, subprocess, sys
from pathlib import Path

SRC, REL, DIFF = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
MAX_S = float(arg("--max-seconds", 20))
ROOT = Path(arg("--out", Path(__file__).resolve().parents[1]))
OUT = ROOT / "assets" / "media" / "roboarc"
OUT.mkdir(parents=True, exist_ok=True)
(ROOT / "assets" / "data").mkdir(parents=True, exist_ok=True)


def duration(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def run(*a):
    subprocess.run(["nice", "-n", "10", "ffmpeg", "-v", "error", "-y", *a], check=True)


difficulty = dict(l.split() for l in DIFF.read_text().splitlines() if l.strip())
bases = json.load(open(REL))["bases"]
index = {}
for base, rec in sorted(bases.items()):
    d = SRC / "out" / f"roboarc-{base}"
    entry = {"base": f"roboarc-{base}", "nn": base.split("-")[-2], "difficulty": difficulty[base], "video": None, "poster": None}
    src = d / f"roboarc-{base}_1080p.mp4"
    if src.exists():
        meta = json.load(open(d / "meta.json"))
        dur = duration(src)
        factor = max(1, math.ceil(dur / MAX_S))
        stem = OUT / base
        if not stem.with_suffix(".mp4").exists():
            run("-i", str(src), "-an", "-vf", f"setpts=PTS/{factor},fps=30,scale=960:540:flags=lanczos", "-c:v", "libx264",
                "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "8", str(stem.with_suffix(".mp4")))
            run("-i", str(d / "poster_1080.png"), "-vf", "scale=960:540:flags=lanczos", "-q:v", "3", str(stem.with_suffix(".jpg")))
        sim = meta["replay"]["sim_time_s"]
        entry.update(video=f"assets/media/roboarc/{base}.mp4", poster=f"assets/media/roboarc/{base}.jpg",
                     speed=round(sim / (dur / factor)), sim_seconds=round(sim, 1))
    index.setdefault(rec["family"], []).append(entry)
    print(f"{base:28s} {difficulty[base]:10s} {'x%d' % entry['speed'] if entry['video'] else 'no reference video'}", flush=True)

teaser = SRC / "roboarc_teaser.mp4"
if teaser.exists() and not (OUT / "teaser.mp4").exists():
    run("-i", str(teaser), "-an", "-vf", "scale=1280:720:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "8", str(OUT / "teaser.mp4"))
    run("-ss", "3", "-i", str(teaser), "-frames:v", "1", "-vf", "scale=1280:720:flags=lanczos", "-q:v", "3", str(OUT / "teaser.jpg"))
(ROOT / "assets" / "data" / "roboarc.json").write_text(json.dumps(index, indent=1) + "\n")
n = sum(len(v) for v in index.values()); nv = sum(1 for v in index.values() for e in v if e["video"])
print(f"families {len(index)}, bases {n}, with video {nv}")
