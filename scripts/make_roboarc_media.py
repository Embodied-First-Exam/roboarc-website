#!/usr/bin/env python3
"""Cut the RoboARC reference-solution videos into the puzzle wall's loops and write the wall's index.

usage: make_roboarc_media.py <review_videos dir> <release.json> <difficulty.txt> [--fold-targets DIR] [--max-seconds 20]

Inputs: the review videos of the MuJoCo reference solutions (CHECKLIST.md: one fresh replay per base that ends on the
release's expected final state, "hash OK"; oblique camera, 1920x1080, 3x), the release's list of bases (family, tier,
the old name it was ported from) and each base's difficulty from its task.toml ("<base> <difficulty>" per line). A base
is matched to its video by family and tier. Bases without a hash-OK video get a still instead (a blanket_fold base: its
target image) or none.

Writes assets/media/roboarc/<base>.{mp4,jpg} (960x540 H.264, the review label cropped away, sped up to at most --max-seconds) and
assets/data/roboarc.json (families -> bases, in the release's numbering).
"""
import json, math, re, subprocess, sys
from pathlib import Path

SRC, REL, DIFF = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
MAX_S = float(arg("--max-seconds", 20))
FOLD = Path(arg("--fold-targets")) if arg("--fold-targets") else None
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "media" / "roboarc"
OUT.mkdir(parents=True, exist_ok=True)
CROP = "crop=1688:950:116:130"   # the review videos carry a label box in their top 120 px: keep 16:9 below it
ALIAS = {("interlocked_claws", "very_hard"): "rotor"}      # the release's tier name vs the review video's


def duration(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


# hash-OK videos from the checklist: (family, tier) -> oblique video
videos = {}
for line in (SRC / "CHECKLIST.md").read_text().splitlines():
    cells = [c.strip() for c in line.split("|")]
    if len(cells) < 12 or not cells[1].isdigit() or not cells[8].startswith("OK"):
        continue
    family, tier = cells[2], cells[4].replace("-", "_")
    m = re.search(r"\(([^)]+_oblique\.mp4)\)", cells[9])
    if m: videos[(family, tier)] = (SRC / m.group(1), float(cells[6]) if cells[6] else None)

difficulty = dict(l.split() for l in DIFF.read_text().splitlines() if l.strip())
bases = json.load(open(REL))["bases"]
index = {}
for base, rec in sorted(bases.items()):
    family, tier = rec["family"], rec["tier"]
    nn = base.split("-")[-2]
    entry = {"base": f"roboarc-{base}", "nn": nn, "difficulty": difficulty[base], "video": None, "poster": None}
    src = videos.get((family, ALIAS.get((family, tier), tier)))
    stem = OUT / base
    if src and src[0].exists():
        d = duration(src[0])
        speed = max(1, math.ceil(d / MAX_S))
        if not (stem.with_suffix(".mp4")).exists():
            subprocess.run(["nice", "-n", "15", "ffmpeg", "-v", "error", "-y", "-i", str(src[0]), "-an",
                            "-vf", f"setpts=PTS/{speed},fps=24,{CROP},scale=960:540:flags=lanczos", "-c:v", "libx264", "-preset", "slow",
                            "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "4", str(stem.with_suffix(".mp4"))], check=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{0.66 * d:.2f}", "-i", str(src[0]), "-frames:v", "1",
                            "-vf", f"{CROP},scale=960:540:flags=lanczos", "-q:v", "4", str(stem.with_suffix(".jpg"))], check=True)
        entry.update(video=f"assets/media/roboarc/{base}.mp4", poster=f"assets/media/roboarc/{base}.jpg",
                     speed=speed * 3, sim_seconds=src[1])          # the review videos already run at 3x
    elif family == "blanket_fold" and FOLD and (FOLD / difficulty[base] / "target_cam_high.png").exists():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(FOLD / difficulty[base] / "target_cam_high.png"),
                        "-vf", "scale=960:-2", "-q:v", "4", str(stem.with_suffix(".jpg"))], check=True)
        entry.update(poster=f"assets/media/roboarc/{base}.jpg", still="target")
    index.setdefault(family, []).append(entry)
    print(f"{base:28s} {difficulty[base]:10s} {'video x%d' % entry['speed'] if entry['video'] else entry.get('still', 'no media')}", flush=True)

(ROOT / "assets" / "data" / "roboarc.json").write_text(json.dumps(index, indent=1) + "\n")
n = sum(len(v) for v in index.values()); nv = sum(1 for v in index.values() for e in v if e["video"])
print(f"families {len(index)}, bases {n}, with video {nv}")
