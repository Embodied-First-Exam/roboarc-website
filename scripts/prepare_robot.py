#!/usr/bin/env python3
"""prepare_robot.py <claw manifest.json> <geometry.json> <piece-0.obj> <piece-1.obj> <out dir>

The opening's robot: the two ALOHA arms of the robot-puzzle demo (qinengwang-aiden.github.io/demos/constraint_demos,
data/claw/manifest.json + geometry.json) disentangling the claws. Writes
- robot.bin: every mesh the opening draws, as Float32 positions followed by Uint32 triangle indices, the detailed
  gripper, finger and camera meshes thinned by vertex clustering (2 mm cells) to keep the download small;
- robot.json: the kinematic tree (bodies, joints), the visible geoms of both arms (body, mesh, local pose, part),
  the two claw pieces (gripper body, inverse grasp) and the "unlock" phase's joint positions, re-sampled so that equal
  steps of scroll show equal amounts of motion.
The page runs the same forward kinematics as the demo viewer (scene-renderer.js, class Claw.seek)."""
import json, sys
from pathlib import Path
import numpy as np

manifest_path, geometry_path, obj0, obj1, out = sys.argv[1:6]
out = Path(out); out.mkdir(parents=True, exist_ok=True)
d, g = json.load(open(manifest_path)), json.load(open(geometry_path))


def load_obj(path):
    V, F = [], []
    for line in open(path):
        t = line.split()
        if not t:
            continue
        if t[0] == "v":
            V.append([float(x) for x in t[1:4]])
        elif t[0] == "f":
            idx = [int(x.split("/")[0]) - 1 for x in t[1:]]
            for k in range(1, len(idx) - 1):
                F.append([idx[0], idx[k], idx[k + 1]])
    return np.array(V, float), np.array(F, np.int64)


def cluster(V, F, cell):
    """Vertex clustering: merge the vertices in each `cell`-sized cube, drop the triangles that collapse."""
    keys = np.floor(V / cell).astype(np.int64)
    _, inv, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    W = np.zeros((counts.size, 3)); np.add.at(W, inv, V); W /= counts[:, None]
    G = inv[F]
    G = G[(G[:, 0] != G[:, 1]) & (G[:, 1] != G[:, 2]) & (G[:, 0] != G[:, 2])]
    G = np.unique(np.sort(G, axis=1), axis=0, return_index=True)[1]
    G = inv[F][(inv[F][:, 0] != inv[F][:, 1]) & (inv[F][:, 1] != inv[F][:, 2]) & (inv[F][:, 0] != inv[F][:, 2])][np.sort(G)]
    used = np.unique(G)
    remap = -np.ones(len(W), np.int64); remap[used] = np.arange(used.size)
    return W[used], remap[G]


# ---- meshes: the arms' visible geoms (groups 1-2 on the arm bodies) and the two claw pieces ----
body_id = {b["name"]: b["id"] for b in d["bodies"]}
frames = {f["id"]: f for f in d["geom_frames"]}
geoms, meshes, mesh_of = [], [], {}
for x in g["geoms"]:
    if x["type"] != 7 or x["group"] not in (1, 2) or x["body"] == "world":
        continue
    name = g["meshes"][x["mesh"]]["name"]
    if x["mesh"] not in mesh_of:
        m = g["meshes"][x["mesh"]]
        V, F = np.array(m["vertices"], float).reshape(-1, 3), np.array(m["faces"], np.int64).reshape(-1, 3)
        if len(F) > 6000:
            V, F = cluster(V, F, 0.002)
        mesh_of[x["mesh"]] = len(meshes); meshes.append((name, V, F))
    f = frames[x["id"]]
    part = "finger" if "finger" in name else "camera" if "d405" in name else "arm"
    geoms.append({"body": body_id[x["body"]], "mesh": mesh_of[x["mesh"]], "position": f["position"], "quaternion_wxyz": f["quaternion_wxyz"], "part": part})

pieces = []
for asset, path in zip(d["pieces"], [obj0, obj1]):
    V, F = load_obj(path)
    V = (V - np.asarray(asset["source_origin"], float)) * asset["scale"]
    assert len(F) == asset["triangles"], (path, len(F), asset["triangles"])
    pieces.append({"id": asset["id"], "mesh": len(meshes), "gripper_body": asset["gripper_body"],
                   "inverse_grasp_column_major": asset["inverse_grasp_column_major"]})
    meshes.append((f"claw_piece_{asset['id']}", V, F))

table, offset = [], 0
with open(out / "robot.bin", "wb") as fh:
    for name, V, F in meshes:
        fh.write(V.astype(np.float32).tobytes()); fh.write(F.astype(np.uint32).tobytes())
        table.append({"name": name, "offset": offset, "vertices": int(len(V)), "triangles": int(len(F))})
        offset += len(V) * 12 + len(F) * 12

# ---- the unlock phase, re-sampled by motion: joints of both arms plus the grippers' travel ----
unlock = next(t for t in d["timeline"] if t["name"] == "unlock")
t = np.array(d["time_s"]); q = np.array(d["qpos"], float)
sel = np.where((t >= unlock["start_s"]) & (t <= unlock["end_s"]))[0]
assert np.array(d["held_mask"])[sel].all(), "a piece is let go during the unlock phase"
qs = q[sel]
step = np.abs(np.diff(qs, axis=0)).sum(1)
s = np.concatenate([[0], np.cumsum(step + 1e-6)])
samples = 600
target = np.linspace(0, s[-1], samples)
frames_q = np.stack([np.interp(target, s, qs[:, k]) for k in range(qs.shape[1])], 1)

bodies = [{"id": b["id"], "parent": b["parent"], "position": b["position"], "quaternion_wxyz": b["quaternion_wxyz"],
           "joints": [{"type": j["type"], "axis": j["axis"], "position": j.get("position", [0, 0, 0]), "qpos": j["qpos"],
                       "reference": j.get("reference", 0.0)} for j in b["joints"]]} for b in d["bodies"]]
meta = {"source": "robot-puzzle demo, Claw: two-arm disentanglement (data/claw/manifest.json, unlock phase)",
        "meshes": table, "bodies": bodies, "geoms": geoms, "pieces": pieces,
        "qpos": {"count": samples, "width": int(qs.shape[1]), "values": [round(float(v), 5) for v in frames_q.ravel()]},
        "unlock_seconds": round(unlock["end_s"] - unlock["start_s"], 2)}
(out / "robot.json").write_text(json.dumps(meta, separators=(",", ":")))
tris = sum(m["triangles"] for m in table)
print(f"meshes {len(table)}, triangles {tris}, robot.bin {offset / 1e6:.2f} MB, frames {samples} x {qs.shape[1]}")
for m in table:
    print(f"  {m['name']:32s} {m['triangles']:6d}")
