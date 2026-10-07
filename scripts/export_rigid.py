"""Convert TopoGym's lock to the site's play files (assets/data/puzzles/lock_picking/<tier>/: puzzle.json + .bin).

Input: the folder written by scripts/topogym/export_rigid.py (run in the TopoGym image): per tier, one OBJ per body at
the task's initial pose (z-up, metres, table top at z = 0) and bodies.json with link poses and joint data. Output: y-up.
(The buzz wire now comes from the oracle's run, scripts/export_oracle_poses.py.)

usage: python3 scripts/export_rigid.py <export folder>
"""
import json, sys
from pathlib import Path
import numpy as np

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[1] / "assets" / "data" / "puzzles"
YUP = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)      # (x, y, z) z-up -> (x, z, -y) y-up


def yup(v):
    return np.asarray(v, float) @ YUP.T


def quat_to_R(q):                      # wxyz
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def R_to_xyzw(R):
    t = np.trace(R)
    if t > 0:
        s = 2 * np.sqrt(t + 1); w = s / 4; x = (R[2, 1] - R[1, 2]) / s; y = (R[0, 2] - R[2, 0]) / s; z = (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = 2 * np.sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]); w = (R[2, 1] - R[1, 2]) / s; x = s / 4; y = (R[0, 1] + R[1, 0]) / s; z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = 2 * np.sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]); w = (R[0, 2] - R[2, 0]) / s; x = (R[0, 1] + R[1, 0]) / s; y = s / 4; z = (R[1, 2] + R[2, 1]) / s
    else:
        s = 2 * np.sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]); w = (R[1, 0] - R[0, 1]) / s; x = (R[0, 2] + R[2, 0]) / s; y = (R[1, 2] + R[2, 1]) / s; z = s / 4
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


def pose_yup(position, q_wxyz):
    """A z-up link pose as a y-up position and an xyzw quaternion."""
    return yup(position), R_to_xyzw(YUP @ quat_to_R(q_wxyz) @ YUP.T)


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
    return np.array(V), np.array(F, np.int64)


def write_bin(pid, name, V, F):
    u32 = len(V) > 65535
    path = OUT / pid / f"{name}.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(np.asarray(V, np.float32).tobytes())
        f.write(np.asarray(F, np.uint32 if u32 else np.uint16).tobytes())
    return {"url": f"{name}.bin", "vertices": int(len(V)), "triangles": int(len(F)), "index": "u32" if u32 else "u16"}


def r6(v):
    return [round(float(c), 6) for c in v]


def save(pid, meta):
    (OUT / pid).mkdir(parents=True, exist_ok=True)
    (OUT / pid / "puzzle.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(pid, [(b["name"], b["role"], b["triangles"]) for b in meta["bodies"]])


# ---- lock picking, easy / medium / hard: rotor 0 has 2 / 3 / 4 slots, so 1 / 2 / 3 ratchet strokes ----
# The key slides along the lock's axis and turns about it; the rotors turn only when a key tab inside one pushes it.
# The browser emulates that coupling (play.js, lockMove) from the parameters below instead of colliding meshes; the
# key starts on the axis in front of the lock (in TopoGym it lies in a cradle and must be picked up and inserted).
for tier in ["easy", "medium", "hard"]:
    src = SRC / "lock_picking" / tier
    info = json.load(open(src / "bodies.json"))
    kin = info["kinematics"]
    axis_z = kin["axis"]["origin"][2]
    bodies, rotors = [], []
    for b in info["bodies"]:
        V, F = load_obj(src / b["file"])
        name, rec = b["name"], {"name": b["name"]}
        if b["role"] == "move":                       # the key, in its link frame: origin = leading tab centre on the shaft axis
            p = np.array(b["link_pose"]["position"])
            rec.update(write_bin(f"lock_picking/{tier}", name, yup(V - p), F), role="move", material="steel", position=[0, 0, 0], radius=0.6)
        elif b["role"] == "articulated-part":         # a rotor, about its pivot on the axis
            p = np.array(b["joint"]["origin"])
            rec.update(write_bin(f"lock_picking/{tier}", name, yup(V - p), F), role="rotor", material="brass", position=r6(yup(p)), radius=0.1)
            rotors.append({"name": name, "pivot": r6(yup(p))})
        else:
            rec.update(write_bin(f"lock_picking/{tier}", name, yup(V), F), role="fixed", position=[0, 0, 0], radius=0.6)
            if name.startswith("lock_frame") or name == "lock_goal":
                rec.update(material="iron")
            else:
                rec.update(color="#9b7b55" if "cradle" in name or "tray" in name else "#7d6a55", roughness=0.75)
        bodies.append(rec)
    plates = [{"x": round(pl["x"], 6), "slots": pl["slots_deg"], "stop": pl.get("stop_deg"), "rotor": pl["name"] if pl["name"].startswith("lock_disc") else None}
              for pl in kin["plates"]]
    solution = json.load(open(SRC / "lock_picking" / "lock_solution_margin1deg.json"))[tier]
    key = kin["key"]
    start_x = -0.075                                  # depth 0.5: the leading tab just in front of rotor 0
    save(f"lock_picking/{tier}", {
        "id": "lock_picking", "kind": "lock", "tier": tier, "floor": 0, "bodies": bodies,
        "lock": {"axisY": round(axis_z, 6), "pitch": kin["pitch"], "tabs": key["tab_x"], "play": kin["free_play_deg"],
                 "engage": round(0.5 * (0.01 + key["tab_thickness"]), 6), "plates": plates, "rotors": rotors,
                 "start": start_x, "endStop": kin["success"]["physical_end_stop_x"], "win": kin["success"]["key_x_min"],
                 # the BFS solver's moves (depth z, key angle after each); depth z -> key x = (z - 1) * pitch, capped at the stop
                 "solution": [{"x": round(min((m["z"] - 1) * kin["pitch"], kin["success"]["physical_end_stop_x"] - 0.004), 6), "deg": m["key_deg"]} for m in solution]},
        "frame": {"center": r6(yup([0.0, 0.0, axis_z * 0.7])), "span": 0.42},
    })
