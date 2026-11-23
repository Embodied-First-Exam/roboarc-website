#!/usr/bin/env python3
"""Rebuild the page's 3D replays (assets/oracle/) from the scenes the reference videos were rendered from.

usage: export_from_scenes.py <scenes dir> <site root> [--only BASE ...] [--out DIR] [--difficulty FILE]

<scenes dir>/<base>/scene.{json,npz}: written by the studio render batch's export_scene.py (2026-10-14 Cycles batch). They
hold, per part, the mesh the video drew (one model file per part, so parts that shared a file name no longer overwrite
each other), its colour (glTF factor x texture mean, URDF material) and its pose relative to its moving group; per frame,
every moving group's world pose (z-up, metres); ropes and cloth. export_roboarc_oracle.py read the replay's flat meshes/
folder instead, where e.g. the two claws of claws-05 or the keyhole's gold and silver plates shared one file.

The output format is the one assets/js/oracle.js reads (see export_roboarc_oracle.py). The family, difficulty and the
task list come from the current assets/oracle/<base>.json, so only bases already on the page are rewritten, and the bases
named with --only that have no replay yet are added: their family from scene.json, their difficulty from
--difficulty FILE ("<base> <difficulty>" per line, the release's task.toml).
"""
import hashlib, json, math, sys
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial.transform import Rotation as Rot

SCENES, SITE = Path(sys.argv[1]), Path(sys.argv[2])
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
ONLY = [a for a in sys.argv[sys.argv.index("--only") + 1:] if not a.startswith("--")] if "--only" in sys.argv else None
OUT = Path(arg("--out", SITE)) / "assets" / "oracle"
DIFF = dict(l.split()[:2] for l in Path(arg("--difficulty")).read_text().splitlines() if l.strip()) if arg("--difficulty") else {}
(OUT / "m").mkdir(parents=True, exist_ok=True)

TRACK_BYTES, DEFORM_BYTES = 1_200_000, 2_400_000
FACES_ROBOT, FACES_PART = 2500, 24000
GOAL_RGBA = [62, 170, 140, 70]
_written, FALLBACKS = {}, []


def faithful(a, b):
    size = np.maximum(a.bounds[1] - a.bounds[0], 1e-9)
    box = np.abs(np.asarray(b.bounds) - np.asarray(a.bounds)).max() <= 0.0005 + 0.01 * size.max()
    return bool(len(b.faces)) and box and 0.9 <= b.area / max(a.area, 1e-12) <= 1.1


def write_mesh(m, robot):
    """As export_roboarc_oracle.write_mesh: decimate only while the shape survives, crease normals, quantize."""
    key = (hashlib.sha1(np.ascontiguousarray(m.vertices, np.float64).tobytes() + np.ascontiguousarray(m.faces, np.int64).tobytes()).hexdigest(), robot)
    if key in _written:
        return _written[key]
    m = trimesh.Trimesh(m.vertices, m.faces, process=True)
    m.remove_unreferenced_vertices()
    target = FACES_ROBOT if robot else FACES_PART
    if len(m.faces) > target:
        import fast_simplification
        for t in (target, 2 * target, 4 * target, 8 * target):
            if t >= len(m.faces):
                break
            v, f = fast_simplification.simplify(np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32), target_reduction=1 - t / len(m.faces))
            d = trimesh.Trimesh(v, f, process=True)
            if faithful(m, d):
                m = d
                break
        if len(m.faces) > target:
            FALLBACKS.append(len(m.faces))
    m = trimesh.graph.smooth_shade(m, angle=math.radians(35)) if len(m.faces) else m
    v = np.asarray(m.vertices, float); f = np.asarray(m.faces, np.int64); n = np.asarray(m.vertex_normals, float)
    lo, hi = v.min(0), v.max(0)
    span = np.maximum(hi - lo, 1e-9)
    q = np.round((v - lo) / span * 65535 - 32768).astype(np.int16)
    nq = np.round(np.clip(n, -1, 1) * 127).astype(np.int8)
    big = len(v) > 65535
    pad = lambda b: b + b"\0" * (-len(b) % 4)
    body = (np.array([0x314d4152, len(v), len(f), int(big)], np.uint32).tobytes() + np.concatenate([lo, hi]).astype(np.float32).tobytes()
            + pad(q.tobytes()) + pad(nq.tobytes()) + f.astype(np.uint32 if big else np.uint16).tobytes())
    h = hashlib.sha1(body).hexdigest()[:16]
    p = OUT / "m" / f"{h}.bin"
    if not p.exists():
        p.write_bytes(body)
    _written[key] = h
    return h


def quantize(a, lo, hi):
    return np.round((a - lo) / np.maximum(hi - lo, 1e-9) * 65535 - 32768).astype(np.int16)


def mat_quat(m):
    x, y, z, w = Rot.from_matrix(m).as_quat()
    return [w, x, y, z]


def export(base, old):
    sc = json.load(open(SCENES / base / "scene.json"))
    z = np.load(SCENES / base / "scene.npz")
    F = int(sc["frames"])
    TT = z["T"].astype(np.float64)                       # (F, G, 4, 4) world pose of each moving group's lead
    G = TT.shape[1]
    robot_kind = {"franka": "panda"}.get(sc["robot"], sc["robot"])
    parts, pts = [], []
    for p in sc["parts"]:
        m = trimesh.Trimesh(z[f"v{p['id']}"], z[f"f{p['id']}"], process=False)
        if not len(m.faces):
            continue
        robot = p["role"] == "robot"
        T = np.asarray(p["T"], float)
        rgba = GOAL_RGBA if p["role"] == "goal" else p["rgba"]
        parts.append(dict(mesh=write_mesh(m, robot), rgba=[int(x) for x in rgba], role=p["role"], track=int(p["track"]),
                          pos=[float(x) for x in T[:3, 3]], quat=[float(x) for x in mat_quat(T[:3, :3])]))
        if not robot:                                    # framing: the puzzle over the whole run, not the robot
            local = np.asarray(m.bounding_box.vertices) @ T[:3, :3].T + T[:3, 3]
            if p["track"] < 0:
                pts.append(local)
            else:
                for k in range(0, F, max(1, F // 40)):
                    W = TT[k, p["track"]]
                    pts.append(local @ W[:3, :3].T + W[:3, 3])
    deform = []
    for rec in sc["deform"]:
        name = rec["name"]
        if rec["kind"] == "cloth":
            data = z[f"cloth_{name}"].astype(np.float32)
            data = data.reshape(len(data), -1, 3)
            out = dict(kind="cloth", name=name, rows=rec["rows"], cols=rec["cols"], rgba=rec["rgba"])
        else:
            data = z[f"rope_{name}"].astype(np.float32)
            out = dict(kind="rope", name=name, points=rec["points"], radius=rec["radius"], length=rec["length"], rgba=rec["rgba"])
        per = data[0].size * 2
        step = max(1, math.ceil(len(data) * per / DEFORM_BYTES))
        data = data[::step]
        out.update(samples=len(data), frame_step=int(rec["stride"]) * step)
        pts.append(data.reshape(-1, 3)[:: max(1, data.shape[1] // 50)])
        deform.append((out, data))
    P = np.concatenate(pts)
    lo_f, hi_f = np.percentile(P, 0.5, 0), np.percentile(P, 99.5, 0)
    c0 = np.array([(lo_f[0] + hi_f[0]) / 2, (lo_f[1] + hi_f[1]) / 2, float(sc["table_top"])])
    step = max(1, math.ceil(F * G * 14 / TRACK_BYTES)) if G else 1
    frames = np.arange(0, F, step)
    if frames[-1] != F - 1:
        frames = np.append(frames, F - 1)
    track, pos_lo, pos_hi = b"", [0, 0, 0], [0, 0, 0]
    if G:
        TP = TT[frames][:, :, :3, 3] - c0
        TQ = np.stack([Rot.from_matrix(TT[frames][:, g, :3, :3]).as_quat()[:, [3, 0, 1, 2]] for g in range(G)], 1)
        for k in range(1, len(frames)):
            flip = (TQ[k] * TQ[k - 1]).sum(-1) < 0
            TQ[k, flip] *= -1
        pos_lo, pos_hi = TP.reshape(-1, 3).min(0) - 1e-4, TP.reshape(-1, 3).max(0) + 1e-4
        track = np.concatenate([quantize(TP, pos_lo, pos_hi), np.round(np.clip(TQ, -1, 1) * 32767).astype(np.int16)], -1).tobytes()
    t_sim = np.asarray(sc["t_sim"])
    meta = dict(base=base, family=old["family"], difficulty=old["difficulty"], robot=robot_kind, fps=float(sc["fps"]), frames=F,
                t_sim=[round(float(x), 3) for x in t_sim[frames]], sim_seconds=round(float(t_sim[-1]), 2),
                hold=[int(sc["hold_start_frames"]), int(sc["hold_end_frames"])],
                track=dict(frames=[int(x) for x in frames], groups=G, lo=[float(x) for x in pos_lo], hi=[float(x) for x in pos_hi], offset=0, bytes=len(track)),
                center=[float(x) for x in c0], box=[[float(x) for x in lo_f - c0], [float(x) for x in hi_f - c0]],
                parts=parts, deform=[], source="scene")
    rig = sc["rig"]                                      # the reference video's camera at its first frame
    a, e = math.radians(rig["az"] - rig["orbit"] / 2), math.radians(rig["el"])
    meta["view"] = dict(look=[round(rig["look"][i] - c0[i], 5) for i in range(3)], dir=[round(x, 6) for x in (math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))],
                        d=round(rig["d"], 5), vfov=rig["fov"], lens=1.4, aspect=round(16 / 9, 4),
                        note="the reference video camera at its first frame: studio render rig, vertical fov, 16:9, camera at d*lens with the fov narrowed by lens (cycles_studio.py --lens 1.4); z-up, relative to center")
    off, dbin = len(track), b""
    for rec, data in deform:
        rel = data - c0
        lo, hi = rel.reshape(-1, 3).min(0) - 1e-4, rel.reshape(-1, 3).max(0) + 1e-4
        b = quantize(rel, lo, hi).tobytes()
        rec.update(lo=[float(x) for x in lo], hi=[float(x) for x in hi], offset=off, bytes=len(b))
        meta["deform"].append(rec); dbin += b; off += len(b)
    for p in meta["parts"]:
        p["pos"] = [round(x - (c0[i] if p["track"] < 0 else 0), 6) for i, x in enumerate(p["pos"])]
        p["quat"] = [round(x, 7) for x in p["quat"]]
    (OUT / f"{base}.bin").write_bytes(track + dbin)
    (OUT / f"{base}.json").write_text(json.dumps(meta, separators=(",", ":")))
    return dict(parts=len(parts), groups=G, old_groups=old["track"]["groups"], frames=F, old_frames=old["frames"],
                sim=meta["sim_seconds"], old_sim=old["sim_seconds"], kb=round((len(track) + len(dbin)) / 1024))


have = {f.stem for f in (SITE / "assets" / "oracle").glob("roboarc-*.json")}
new = sorted({b if b.startswith("roboarc-") else f"roboarc-{b}" for b in ONLY or []} - have)
for base in sorted(have) + new:
    f = SITE / "assets" / "oracle" / f"{base}.json"
    if ONLY and base not in ONLY and base.removeprefix("roboarc-") not in ONLY:
        continue
    if not (SCENES / base / "scene.npz").exists():
        print(f"{base:36s} no scene: left as it is", flush=True)
        continue
    if f.exists():
        old = json.loads(f.read_text())
    else:                                                # a base new to the page
        sc = json.loads((SCENES / base / "scene.json").read_text())
        old = dict(family=sc["family"], difficulty=DIFF[base], track=dict(groups=0), frames=0, sim_seconds=0)
    r = export(base, old)
    flag = "" if (r["groups"], r["frames"], r["sim"]) == (r["old_groups"], r["old_frames"], r["old_sim"]) else "  <-- differs from the old replay"
    print(f"{base:36s} parts {r['parts']:4d} groups {r['groups']}/{r['old_groups']} frames {r['frames']}/{r['old_frames']} sim {r['sim']}/{r['old_sim']} {r['kb']} KB{flag}", flush=True)
lib = sum(p.stat().st_size for p in (OUT / "m").iterdir())
print(f"mesh library: {len(list((OUT / 'm').iterdir()))} meshes, {lib / 1e6:.1f} MB; kept above target: {len(FALLBACKS)}")
