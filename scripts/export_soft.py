"""Convert TopoGym's deformable puzzles to the site's play files (assets/data/puzzles/<id>/: puzzle.json + .bin).

Input: the folder written by scripts/topogym_soft/ (run in the TopoGym image): z-up task frame, metres, table top at
z = 0; ropes as centrelines (`browser_points_m`, resampled at the rope radius) from the frozen Harbor instances' start
states and rigid parts as OBJ. Output: y-up, table top at y = 0. (The blanket's block is parked in tmp/.)

usage: python3 scripts/export_soft.py <export folder>
"""
import json, sys
from pathlib import Path
import numpy as np

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[1] / "assets" / "data" / "puzzles"
YUP = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)      # (x, y, z) z-up -> (x, z, -y) y-up


def yup(v):
    return np.asarray(v, float) @ YUP.T


def load_obj(path):
    V, UV, F = [], [], []
    for line in open(path):
        t = line.split()
        if not t:
            continue
        if t[0] == "v":
            V.append([float(x) for x in t[1:4]])
        elif t[0] == "vt":
            UV.append([float(x) for x in t[1:3]])
        elif t[0] == "f":
            idx = [int(x.split("/")[0]) - 1 for x in t[1:]]
            for k in range(1, len(idx) - 1):
                F.append([idx[0], idx[k], idx[k + 1]])
    return np.array(V), np.array(UV), np.array(F, np.int64)


def hexcolor(rgba):
    return "#" + "".join(f"{round(255 * c):02x}" for c in rgba[:3])


def write_bin(pid, name, arrays, F):
    """Float32 arrays one after another, then the triangle indices (u16 when they fit)."""
    u32 = max(len(a) for a in arrays) > 65535
    path = OUT / pid / f"{name}.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        for a in arrays:
            f.write(np.asarray(a, np.float32).tobytes())
        f.write(np.asarray(F, np.uint32 if u32 else np.uint16).tobytes())
    return {"url": f"{name}.bin", "vertices": int(len(arrays[0])), "triangles": int(len(F)), "index": "u32" if u32 else "u16"}


def body(pid, name, obj, color, roughness=0.5, metalness=0.0):
    V, _, F = load_obj(obj)
    rec = write_bin(pid, name, [yup(V)], F)
    rec.update(name=name, role="fixed", position=[0, 0, 0], radius=round(float(np.linalg.norm(yup(V), axis=1).max()), 5),
               color=color, roughness=roughness, metalness=metalness)
    return rec


def rope(path, color):
    d = json.load(open(path))
    pts = yup(d["browser_points_m"])
    return {"points": [[round(float(c), 6) for c in p] for p in pts], "radius": d["radius_m"], "length": round(d["length_m"], 4), "color": color}


def save(pid, meta):
    (OUT / pid).mkdir(parents=True, exist_ok=True)
    (OUT / pid / "puzzle.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(pid, {k: (v if k not in ("rope", "bodies", "goal") else "...") for k, v in meta.items()})


TIERS = ["easy", "medium", "hard"]

# ---- knot untying: easy two overlapping loops (2 crossings), medium an overhand knot (3), hard a figure-eight (4) ----
for tier in TIERS:
    k = json.load(open(SRC / "knot_untying" / tier / "rope_centerline_settled.json"))
    save(f"knot_untying/{tier}", {"id": "knot_untying", "kind": "rope", "tier": tier, "floor": 0, "bodies": [],
                                  "rope": rope(SRC / "knot_untying" / tier / "rope_centerline_settled.json", "#c9a36b"),
                                  # grader: no crossing from above, strands > 16 mm apart along the rope stay 8 mm apart on the
                                  # table, one flat layer (every surface point below 11 mm: the centreline below 7 mm), settled
                                  "goal": {"type": "untie", "crossings": k["projected_crossings"], "clearance": 0.008, "apart": 0.016, "maxHeight": 0.007}})

# ---- rope threading: easy two rings, medium three, hard three tighter ones; crossed in order ----
for tier in TIERS:
    src = SRC / "rope_threading" / tier
    rings = json.load(open(src / "rings.json"))
    pid = f"rope_threading/{tier}"
    bodies = []
    for r in rings["rings"]:
        bodies.append(body(pid, r["name"], src / f"{r['name']}.obj", hexcolor(r["rgba"]), 0.35, 0.1))
        bodies.append(body(pid, f"{r['name']}_stand", src / f"{r['name']}_stand.obj", "#8d8f94", 0.4, 0.6))
        bodies.append(body(pid, f"{r['name']}_base", src / f"{r['name']}_base.obj", "#5d5f64", 0.6, 0.3))
    goal_rings = [{"name": r["name"], "color": r["color"], "center": [round(float(c), 6) for c in yup(r["center_m"])],
                   "normal": [round(float(c), 6) for c in yup(r["normal"])], "radius": r["centerline_radius_m"],
                   "sign": r["required_crossing_sign"]} for r in rings["rings"]]
    save(pid, {"id": "rope_threading", "kind": "rope", "tier": tier, "floor": 0, "bodies": bodies,
               "rope": rope(src / "rope_centerline_settled.json", "#d8c7a4"),
               # grader: the rope's crossings of the ring planes, walked from its first point, are exactly these. A crossing
               # counts anywhere inside the ring (the grader also wants it clear of the tube: a rope resting on the ring
               # would not count there; here it does, since the hole is what matters)
               "goal": {"type": "thread", "rings": goal_rings, "order": rings["required_material_order"]}})
