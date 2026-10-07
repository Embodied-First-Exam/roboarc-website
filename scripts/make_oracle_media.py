#!/usr/bin/env python3
"""Cut the TopoGym oracle replay videos into the puzzle wall's loops.

usage: make_oracle_media.py <oracle_videos dir> [--max-seconds 22] [--only family,family]

For every family x tier with a passing privileged replay (`<family>-<tier>-privileged-grade1.mp4`, the verifier's
fresh-process replay of the oracle trajectory): keep the main camera (the left 848 x 480; the right column holds the
wrist and side cameras), speed it up so the loop lasts at most --max-seconds, H.264 at full size, no audio,
plus a poster frame. Writes assets/media/oracle/<family>-<tier>.{mp4,jpg} and assets/data/oracle.json (speed-ups,
source durations) for the cards. --only re-cuts those families and keeps the other entries of oracle.json. The site
shows easy / medium / hard only (very_easy and easier are not final).
"""
import json, math, subprocess, sys
from pathlib import Path

SRC = Path(sys.argv[1])
MAX_S = float(sys.argv[sys.argv.index("--max-seconds") + 1]) if "--max-seconds" in sys.argv else 22.0
ONLY = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "media" / "oracle"
OUT.mkdir(parents=True, exist_ok=True)
TIERS = ["easy", "medium", "hard"]


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


INDEX = ROOT / "assets" / "data" / "oracle.json"
index = {k: v for k, v in json.loads(INDEX.read_text()).items() if k not in ONLY} if ONLY else {}
for path in sorted(SRC.glob("*-privileged-grade1.mp4")):
    family, tier = path.name.split("-")[0], path.name.split("-")[1]
    if tier not in TIERS or (ONLY and family not in ONLY):
        continue
    d = duration(path)
    speed = max(1, math.ceil(d / MAX_S))
    stem = OUT / f"{family}-{tier}"
    vf = f"crop=848:480:0:0,setpts=PTS/{speed},fps=24"
    subprocess.run(["nice", "-n", "10", "ffmpeg", "-v", "error", "-y", "-i", str(path), "-an", "-vf", vf,
                    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                    "-threads", "4", str(stem) + ".mp4"], check=True)
    # poster: two thirds of the way through, when most solutions are well under way
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{0.66 * d:.2f}", "-i", str(path), "-frames:v", "1",
                    "-vf", "crop=848:480:0:0", "-q:v", "3", str(stem) + ".jpg"], check=True)
    index.setdefault(family, {})[tier] = {"video": f"assets/media/oracle/{family}-{tier}.mp4", "poster": f"assets/media/oracle/{family}-{tier}.jpg",
                                          "source_seconds": round(d, 1), "speed": speed,
                                          "bytes": (Path(str(stem) + ".mp4")).stat().st_size}
    print(f"{family:18s} {tier:7s} {d:7.1f} s  x{speed:<3d} {index[family][tier]['bytes'] / 1e6:5.2f} MB", flush=True)

INDEX.write_text(json.dumps(dict(sorted(index.items())), indent=1) + "\n")
print("families:", len(index), "videos:", sum(len(v) for v in index.values()))
