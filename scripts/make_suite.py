#!/usr/bin/env python3
"""Write the page's task index, assets/data/suite.json: the paper's 90 tasks joined with the clips this site holds.

usage: make_suite.py <paper dir> [--ikea-meta DIR] [--release DIR]

Inputs:
- <paper dir>/arxiv/tables/task_list.tex: every task of the paper with its constraint type.
- assets/data/roboarc.json: the wall's clips and 3D replays (scripts/make_roboarc_media.py).
- --ikea-meta DIR: the meta.json files of the IKEA studio clips (ikea_<scene>.meta.json, from
  masters/roboarc/ikea_<scene>/ of the public dataset MLL-Lab/embodied-exam-data). An IKEA scene gets a clip entry
  when assets/media/roboarc/ikea-<scene>-i00.{mp4,jpg} are in this repository (copies of the dataset's
  site/roboarc/ikea_<scene>.{mp4,jpg}).

- --release DIR: a checkout of the code release. A clip or 3D replay is kept only if it was made from the release's
  current reference solution: for a puzzle, the replay's simulated time must equal the rows of
  tasks/<base>-privileged/solution/trajectory.npz at the task's control rate (within 1 s); for an IKEA scene, the rows
  in the clip's meta.json must equal the rows of the release's trajectory. The others are listed under `superseded`
  in suite.json and are not shown on the page.

The family of a task, its robot and the order of the constraint types follow the paper and the code release's README.
The script stops if the counts differ from the paper's (90 tasks: 78 puzzles in 19 families and 12 IKEA scenes).
"""
import json, re, struct, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAPER = Path(sys.argv[1])
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
IKEA_META = Path(arg("--ikea-meta")) if arg("--ikea-meta") else None
RELEASE = Path(arg("--release")) if arg("--release") else None


def reference_rows(base):
    """Rows of the release's reference trajectory of a task (the first axis of its 2-D array), from the .npy header."""
    with zipfile.ZipFile(RELEASE / "tasks" / f"{base}-privileged" / "solution" / "trajectory.npz") as z:
        for name in z.namelist():
            with z.open(name) as f:
                f.read(6); ver = f.read(2)
                n = struct.unpack("<H" if ver[0] == 1 else "<I", f.read(2 if ver[0] == 1 else 4))[0]
                shape = re.search(r"'shape': \(([^)]*)\)", f.read(n).decode("latin1")).group(1).replace(" ", "")
                dims = [int(x) for x in shape.split(",") if x]
                if len(dims) == 2:
                    return dims[0]
    raise ValueError(f"{base}: no 2-D array in the reference trajectory")


def control_rate(base):
    return int(re.search(r"at (\d+) Hz", (RELEASE / "tasks" / f"{base}-privileged" / "README.md").read_text()).group(1))


superseded = []

# constraint type -> material, families (the paper's order)
TYPES = [
    ("interlocking", "Interlocking", "rigid", ["interlocked_claws", "cast_keyhole", "cast_coil", "horseshoe_ring"]),
    ("narrow_passage", "Narrow passage", "rigid", ["hedgehog_in_cage", "buzz_wire_3d", "lock_picking"]),
    ("assembly", "Assembly", "rigid", ["bed_bolt", "clock_assembling", "battery_replacement", "caliper_sorting", "ikea"]),
    ("untangling", "Untangling", "soft", ["knot_untying", "slotted_post_ring", "orbits"]),
    ("threading", "Threading", "soft", ["rope_threading", "fiber_bundling", "wire_splicing"]),
    ("shape_control", "Shape control", "soft", ["blanket_flatten", "blanket_fold"]),
]
TYPE_OF_PAPER = {"Interlocking": "interlocking", "Narrow passage": "narrow_passage", "Assembly": "assembly",
                 "Untangling": "untangling", "Threading": "threading", "Shape control": "shape_control"}
# robots: ALOHA 2 unless listed here
ROBOT = {"hedgehog_in_cage": "franka_robotiq", "buzz_wire_3d": "franka_robotiq", "lock_picking": "franka_robotiq",
         "fiber_bundling": "franka_robotiq", "ikea": "franka_bimanual"}
ROBOT_TASK = {"roboarc-ikea-svallet-i00": "aloha2"}
IKEA_LABEL = {"burvik": "BURVIK", "eket": "EKET", "gladom": "GLADOM", "ikea365": "IKEA 365+", "kyrre": "KYRRE", "lack": "LACK",
              "stegesund": "STEGESUND", "stenerik": "STENERIK", "svallet": "SVALLET", "uppsta": "UPPSTÅ",
              "variera": "VARIERA", "vesken": "VESKEN"}

tex = (PAPER / "arxiv" / "tables" / "task_list.tex").read_text()
rows = re.findall(r"\\texttt\{([a-z0-9\-]+)\} & ([A-Za-z ]+?) & ", tex)
clips = {e["base"]: e for fam in json.loads((ROOT / "assets" / "data" / "roboarc.json").read_text()).values() for e in fam}

families = {f: {"type": tid, "robot": ROBOT.get(f, "aloha2"), "tasks": []} for tid, _, _, fams in TYPES for f in fams}
for name, ctype in rows:
    m = re.fullmatch(r"(.+)-(\d\d)", name)
    if m:
        fam, nn, base = m.group(1).replace("-", "_"), m.group(2), f"roboarc-{name}-i01"
        task = {"base": base, "nn": nn}
    else:
        scene = name.removeprefix("ikea-")
        fam, base = "ikea", f"roboarc-{name}-i00"
        task = {"base": base, "nn": scene, "label": IKEA_LABEL[scene]}
        video = ROOT / "assets" / "media" / "roboarc" / f"{name}-i00.mp4"
        if video.exists() and video.with_suffix(".jpg").exists():
            task.update(video=f"assets/media/roboarc/{video.name}", poster=f"assets/media/roboarc/{video.with_suffix('.jpg').name}")
            if IKEA_META and (IKEA_META / f"ikea_{scene}.meta.json").exists():
                meta = json.loads((IKEA_META / f"ikea_{scene}.meta.json").read_text())
                sim = re.search(r"\(([\d.]+) s of simulation", meta.get("speed", ""))
                task["speed"] = round(meta["speed_mean"])
                if sim:
                    task["sim_seconds"] = float(sim.group(1))
                if RELEASE and meta["rows"] != reference_rows(base):
                    superseded.append({"base": base, "why": f"the clip shows a reference of {meta['rows']} rows, the release's has {reference_rows(base)}"})
                    for key in ("video", "poster", "speed", "sim_seconds"):
                        task.pop(key, None)
    if families[fam]["type"] != TYPE_OF_PAPER[ctype.strip()]:
        sys.exit(f"{name}: the paper lists it under {ctype!r}, the table here under {families[fam]['type']!r}")
    if base in clips:
        clip = clips[base]
        seconds = reference_rows(base) / control_rate(base) if RELEASE and "sim_seconds" in clip else None
        if seconds is not None and abs(seconds - clip["sim_seconds"]) > 1.0:
            superseded.append({"base": base, "why": f"the clip and the 3D replay show a reference of {clip['sim_seconds']} s, the release's lasts {seconds:.1f} s"})
        else:
            task.update({k: v for k, v in clip.items() if k in ("video", "poster", "speed", "sim_seconds", "oracle", "orbit")})
    if base in ROBOT_TASK:
        task["robot"] = ROBOT_TASK[base]
    families[fam]["tasks"].append(task)

for f in families.values():
    f["tasks"].sort(key=lambda t: t["nn"])
tasks = [t for f in families.values() for t in f["tasks"]]
counts = {
    "tasks": len(tasks),
    "puzzles": sum(len(f["tasks"]) for k, f in families.items() if k != "ikea"),
    "puzzle_families": len(families) - 1,
    "ikea_scenes": len(families["ikea"]["tasks"]),
    "types": len(TYPES),
    "robots": len({t.get("robot", f["robot"]) for f in families.values() for t in f["tasks"]}),
    "with_clip": sum(1 for t in tasks if t.get("video") and not t.get("orbit")),
    "with_3d": sum(1 for t in tasks if t.get("oracle")),
}
if (counts["tasks"], counts["puzzles"], counts["puzzle_families"], counts["ikea_scenes"], counts["types"], counts["robots"]) != (90, 78, 19, 12, 6, 3):
    sys.exit(f"counts differ from the paper's: {counts}")

out = {
    "source": "Task list and constraint types: the RoboARC paper (arXiv version, table of every task). "
              "Families and robots: the paper and the code release's README. Written by scripts/make_suite.py.",
    "counts": counts,
    "superseded": superseded,
    "types": [{"id": tid, "name": name, "material": material, "families": fams} for tid, name, material, fams in TYPES],
    "families": families,
}
(ROOT / "assets" / "data" / "suite.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
print(json.dumps(counts))
missing = [t["base"].removeprefix("roboarc-") for t in tasks if not t.get("video")]
print(f"no clip ({len(missing)}):", ", ".join(missing))
print("start state only:", ", ".join(t["base"].removeprefix("roboarc-") for t in tasks if t.get("orbit")))
for x in superseded:
    print("superseded:", x["base"].removeprefix("roboarc-"), "-", x["why"])
