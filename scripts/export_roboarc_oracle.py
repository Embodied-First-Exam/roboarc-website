#!/usr/bin/env python3
"""Turn the RoboARC reference replays into the page's 3D "Watch the oracle" data.

usage: export_roboarc_oracle.py <hq dir> <release.json> <difficulty.txt> [--out DIR] [--only BASE ...]

Inputs per base (<hq dir>/out/roboarc-<base>/, written next to the high-quality renders): poses.npz (the world pose of
every drawn geometry slot at every video frame of the fresh-process replay of the reference, z-up, wxyz; deformable
vertices for ropes and cloth), bodies.json (what each slot draws), meshes/ and deform_topology.npz (rope surface faces
and arc lengths, cloth faces and UVs).

Writes, under <out>/assets/oracle/:
  <base>.json   the scene: parts (mesh, colour, which track moves them), the run's timing, deformables, framing
  <base>.bin    int16 tracks: per sample, each moving group's position (over the run's box) and quaternion; then the
                deformables (rope centrelines, cloth grids) over their own box
  m/<hash>.bin  the meshes, shared between tasks: decimated, normals split at creases, int16 positions over the mesh
                box, int8 normals, 16- or 32-bit indices
The ground, the table and the room are left out: the page draws its own floor at the table top. Run it where the
renders are (needs numpy, scipy, trimesh, fast_simplification); copy assets/oracle back.
"""
import hashlib, json, math, sys, xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial.transform import Rotation as Rot

SRC, REL, DIFF = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
ONLY = sys.argv[sys.argv.index("--only") + 1:] if "--only" in sys.argv else None
ROOT = Path(arg("--out", Path(__file__).resolve().parents[1]))
OUT = ROOT / "assets" / "oracle"
(OUT / "m").mkdir(parents=True, exist_ok=True)

TABLE_TOP = 0.9196429
TRACK_BYTES = 1_200_000            # per task: the moving pieces' poses
DEFORM_BYTES = 2_400_000           # per task: rope centrelines or cloth grids
FACES_ROBOT, FACES_PART = 2500, 24000
YUP_TO_ZUP = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # glTF entities are y-up (checked: their stands meet the table)
DROP = lambda e: e in ("ground", "table") or e.startswith("table_frame") or e.startswith("lab_")
FIXTURE_RGBA = [150, 152, 156, 255]
GOAL_RGBA = [62, 170, 140, 70]


def quat_mat(q):                    # wxyz -> 3x3
    return Rot.from_quat([q[1], q[2], q[3], q[0]]).as_matrix()


def mat_quat(m):                    # 3x3 -> wxyz
    x, y, z, w = Rot.from_matrix(m).as_quat()
    return [w, x, y, z]


def colour_of(geom):
    """A geometry's base colour (RGBA 0..255): the material's factor, times its texture's mean colour."""
    v = geom.visual
    try:
        if isinstance(v, trimesh.visual.ColorVisuals):
            c = np.asarray(v.face_colors, float).mean(0) if len(v.face_colors) else None
            return [int(round(x)) for x in c] if c is not None else None
        m = v.material
        f = np.array(getattr(m, "baseColorFactor", None) if getattr(m, "baseColorFactor", None) is not None else [255, 255, 255, 255], float)
        if f.max() <= 1.0:
            f = f * 255
        tex = getattr(m, "baseColorTexture", None) or getattr(m, "image", None)
        if tex is not None:
            t = np.asarray(tex.convert("RGBA"), float).reshape(-1, 4).mean(0)
            f = f * t / 255
        return [int(round(x)) for x in f]
    except Exception:
        return None


def load_parts(path, pre=np.eye(4)):
    """[(trimesh, rgba)] from an .obj/.glb/.stl, in the file's frame times `pre`; glb nodes' transforms applied."""
    sc = trimesh.load(str(path), force="scene", process=False)
    by_colour = {}
    for node in sc.graph.nodes_geometry:
        T, gname = sc.graph[node]
        g = sc.geometry[gname]
        if not isinstance(g, trimesh.Trimesh) or not len(g.faces):
            continue
        rgba = colour_of(g)
        g = trimesh.Trimesh(g.vertices.copy(), g.faces.copy(), process=False)
        g.apply_transform(pre @ T)
        by_colour.setdefault(tuple(rgba) if rgba else None, []).append(g)
    return [(trimesh.util.concatenate(gs), list(c) if c else None) for c, gs in by_colour.items()]


def origin_T(el):
    T = np.eye(4)
    o = el.find("origin") if el is not None else None
    if o is not None:
        T[:3, 3] = [float(x) for x in o.get("xyz", "0 0 0").split()]
        T[:3, :3] = Rot.from_euler("xyz", [float(x) for x in o.get("rpy", "0 0 0").split()]).as_matrix()
    return T


def urdf_parts(path, missing):
    """The URDF's visual meshes in its (single) link frame, with their colours."""
    root = ET.parse(path).getroot()
    out = []
    for vis in root.iter("visual"):
        geo = vis.find("geometry")
        mesh = geo.find("mesh") if geo is not None else None
        rgba = None
        col = vis.find("material/color")
        if col is not None:
            rgba = [int(round(255 * float(x))) for x in col.get("rgba").split()]
        T = origin_T(vis)
        if mesh is not None:
            f = path.parent / mesh.get("filename")
            if not f.is_file():
                missing.append(f"{path.name}:{mesh.get('filename')}")
                continue
            S = np.eye(4)
            if mesh.get("scale"):
                S[:3, :3] = np.diag([float(x) for x in mesh.get("scale").split()])
            for m, c in load_parts(f, T @ S):      # a URDF's glb visuals are in the link frame (checked against its collision meshes)
                out.append((m, c or rgba))
        elif geo is not None and geo.find("box") is not None:
            m = trimesh.creation.box(extents=[float(x) for x in geo.find("box").get("size").split()])
            m.apply_transform(T); out.append((m, rgba))
        elif geo is not None and geo.find("cylinder") is not None:
            c = geo.find("cylinder")
            m = trimesh.creation.cylinder(radius=float(c.get("radius")), height=float(c.get("length")), sections=32)
            m.apply_transform(T); out.append((m, rgba))
        elif geo is not None and geo.find("sphere") is not None:
            m = trimesh.creation.icosphere(subdivisions=2, radius=float(geo.find("sphere").get("radius")))
            m.apply_transform(T); out.append((m, rgba))
    return out


_written = {}
FALLBACKS = []                     # meshes that kept more faces than their target, to stay whole


def faithful(a, b):
    """Whether decimated `b` still covers `a`: the same box (within 0.5 mm + 1 %) and 90-110 % of its area. Quadric
    decimation can drop whole pieces of a mesh that is not one closed surface (it took the ALOHA finger blades)."""
    size = np.maximum(a.bounds[1] - a.bounds[0], 1e-9)
    box = np.abs(np.asarray(b.bounds) - np.asarray(a.bounds)).max() <= 0.0005 + 0.01 * size.max()
    return bool(len(b.faces)) and box and 0.9 <= b.area / max(a.area, 1e-12) <= 1.1


def write_mesh(m, robot):
    """Decimate (only as far as the shape survives), split normals at creases, quantize; returns the library id."""
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


def export(base, family, difficulty):
    d = SRC / "out" / f"roboarc-{base}"
    bodies = json.load(open(d / "bodies.json"))
    z = np.load(d / "poses.npz")
    F = len(z["t_sim"])
    SP, SQ = z["slot_pos"].astype(np.float64), z["slot_quat_wxyz"].astype(np.float64)
    missing = []
    # ---- moving groups: slots on the same body share one track (the first slot's pose; the rest ride along)
    slots = [s for s in bodies["slots"] if not DROP(s["entity"]) and s["kind"] != "plane"]
    # A slot exported as static whose own body (<entity>::<node>) moves in the replay (the lock's rotor discs): carry
    # it with that body from its first pose on.
    names = [str(x) for x in z["body_names"]]
    for s in slots:
        b = f"{s['entity']}::{s['node']}"
        if s["body"] is not None or b not in names:
            continue
        k = names.index(b)
        bp, bq = z["body_pos"][:, k].astype(np.float64), z["body_quat_wxyz"][:, k].astype(np.float64)
        if max(np.ptp(bp, 0).max(), np.ptp(bq, 0).max()) < 1e-4:
            continue
        i = s["index"]
        Rb = Rot.from_quat(bq[:, [1, 2, 3, 0]])
        rel = Rb[0].inv() * Rot.from_quat(SQ[0, i][[1, 2, 3, 0]])
        off = Rb[0].inv().apply(SP[0, i] - bp[0])
        SP[:, i] = bp + Rb.apply(np.broadcast_to(off, bp.shape))
        SQ[:, i] = (Rb * rel).as_quat()[:, [3, 0, 1, 2]]
        s["body"] = b
        missing.append(f"{s['entity']}: carried with {b}")
    groups, order = {}, []
    for s in slots:
        if s["body"] is None:
            continue
        i = s["index"]
        moves = np.abs(SP[:, i] - SP[0, i]).max() > 1e-5 or np.abs(np.abs((SQ[:, i] * SQ[0, i]).sum(1)) - 1).max() > 1e-7
        if s["body"] not in groups:
            groups[s["body"]] = dict(lead=i, moves=False)
            order.append(s["body"])
        groups[s["body"]]["moves"] |= bool(moves)
    moving = [b for b in order if groups[b]["moves"]]
    gidx = {b: k for k, b in enumerate(moving)}
    # ---- parts: geometry in its slot frame, placed relative to its group's lead slot (or statically)
    parts, robot_kind = [], None
    world0 = lambda i: (SP[0, i], quat_mat(SQ[0, i]))
    for s in slots:
        i, kind, ent = s["index"], s["kind"], s["entity"]
        robot = ent == "robot"
        geo = []
        if kind == "mjcf":
            geo = [(trimesh.load(str(d / "meshes" / s["mesh"]), force="mesh", process=False), s.get("rgba_u8"))]
        elif kind == "mesh":
            geo = [(m, c) for m, c in load_parts(d / "meshes" / s["mesh"])]
        elif kind == "gltf":
            pre = np.eye(4); pre[:3, :3] = YUP_TO_ZUP
            geo = load_parts(d / "meshes" / s["mesh"], pre)
        elif kind == "urdf":
            geo = urdf_parts(d / "meshes" / s["mesh"], missing)
        elif kind == "box":
            geo = [(trimesh.creation.box(extents=s["size"]), None)]
        elif kind in ("sphere", "capsule", "cylinder"):
            sz = s.get("size") or [0.01, 0.01]
            m = {"sphere": lambda: trimesh.creation.icosphere(2, sz[0]), "capsule": lambda: trimesh.creation.capsule(2 * sz[1], sz[0]),
                 "cylinder": lambda: trimesh.creation.cylinder(sz[0], 2 * sz[1], sections=32)}[kind]()
            geo = [(m, None)]
        else:
            missing.append(f"{ent}:{kind}")
            continue
        scale = s.get("scale") or 1.0
        # slot frame -> where the part is drawn: relative to the group's lead slot (moving) or the world (static)
        if s["body"] is not None and s["body"] in gidx:
            lead = groups[s["body"]]["lead"]
            pl, Rl = world0(lead); ps, Rs = world0(i)
            rel_p, rel_R, track = Rl.T @ (ps - pl), Rl.T @ Rs, gidx[s["body"]]
            if lead != i:                    # check the slot really rides rigidly with its lead
                k = F - 1
                pk = SP[k, lead] + quat_mat(SQ[k, lead]) @ rel_p
                assert np.abs(pk - SP[k, i]).max() < 2e-4, (base, ent, s["node"], np.abs(pk - SP[k, i]).max())
        else:
            if s["body"] is None:
                rel_p, rel_R = np.array(s["static_pos"]), quat_mat(s["static_quat_wxyz"])
            else:
                rel_p, rel_R = world0(i)
            rel_p = rel_p - [0, 0, 0]; track = -1
        for m, rgba in geo:
            if not len(m.faces):
                continue
            if scale != 1.0:
                m = m.copy(); m.apply_scale(scale)
            role = "goal" if ent in ("goal_region",) or ent.endswith("goal_region") else "robot" if robot else "part" if track >= 0 else "fixture"
            rgba = GOAL_RGBA if role == "goal" else (rgba or FIXTURE_RGBA)
            parts.append(dict(mesh=write_mesh(m, robot), rgba=[int(x) for x in rgba], role=role, track=track,
                              pos=[float(x) for x in rel_p], quat=[float(x) for x in mat_quat(rel_R)], _m=m))
        if robot and robot_kind is None:
            robot_kind = "panda" if s["body"] and s["body"].startswith("link") else "aloha"
    # ---- framing: the puzzle (not the robot) over the whole run
    pts = []
    for p in parts:
        if p["role"] == "robot":
            continue
        v = np.asarray(p["_m"].bounding_box.vertices)
        R0, p0 = quat_mat(p["quat"]), np.asarray(p["pos"])
        local = v @ R0.T + p0
        if p["track"] < 0:
            pts.append(local)
        else:
            lead = groups[moving[p["track"]]]["lead"]
            for k in range(0, F, max(1, F // 40)):
                pts.append(local @ quat_mat(SQ[k, lead]).T + SP[k, lead])
    deform, dbin = [], b""
    if "deform_vertices" in z.files:
        DV = z["deform_vertices"].astype(np.float32)
        top = np.load(d / "deform_topology.npz")
        stride0 = int(z["deform_frame_stride"])
        for name, (a, b) in zip(z["deformables"], z["deform_slices"]):
            V = DV[:, a:b]
            if f"{name}__uvs" in top.files:                # cloth: the regular UV grid
                uv = top[f"{name}__uvs"]
                us, vs = np.unique(np.round(uv[:, 0], 5)), np.unique(np.round(uv[:, 1], 5))
                col = np.searchsorted(us, np.round(uv[:, 0], 5)); row = np.searchsorted(vs, np.round(uv[:, 1], 5))
                grid = np.full((len(vs), len(us)), -1); grid[row, col] = np.arange(len(uv))
                assert (grid >= 0).all(), "cloth UVs are not a full grid"
                data = V[:, grid.ravel()]
                rec = dict(kind="cloth", name=str(name), rows=len(vs), cols=len(us), rgba=[58, 128, 205, 255])
            else:                                           # rope: centreline from the surface, ring by arc length
                faces = top[f"{name}__faces"]
                surf = np.unique(faces)
                s_arc = top[f"{name}__material_s"][surf]
                L = float(s_arc.max() - s_arc.min())
                r0 = V[0, surf]
                nb = int(np.clip(L / 0.004, 60, 420))
                bins = np.minimum(((s_arc - s_arc.min()) / max(L, 1e-9) * nb).astype(int), nb - 1)
                cnt = np.bincount(bins, minlength=nb)
                keep = cnt > 0
                C = np.stack([np.stack([np.bincount(bins, V[k, surf, c], nb) for c in range(3)], 1) for k in range(len(V))]) / np.maximum(cnt, 1)[None, :, None]
                C = C[:, keep]
                c0 = C[0][np.searchsorted(np.flatnonzero(keep), bins)]
                radius = float(np.median(np.linalg.norm(r0 - c0, axis=1)))
                data = C
                rec = dict(kind="rope", name=str(name), points=int(keep.sum()), radius=radius, length=L, rgba=[214, 160, 92, 255])
            n_s = len(data)
            per = data[0].size * 2
            step = max(1, math.ceil(n_s * per / DEFORM_BYTES))
            data = data[::step]
            rec.update(samples=len(data), frame_step=stride0 * step)
            pts.append(data.reshape(-1, 3)[:: max(1, data.shape[1] // 50)])
            deform.append((rec, data))
    P = np.concatenate(pts)
    lo_f, hi_f = np.percentile(P, 0.5, 0), np.percentile(P, 99.5, 0)
    c0 = np.array([(lo_f[0] + hi_f[0]) / 2, (lo_f[1] + hi_f[1]) / 2, TABLE_TOP])
    # ---- tracks: every `step`-th video frame, positions relative to c0
    G = len(moving)
    step = max(1, math.ceil(F * G * 14 / TRACK_BYTES)) if G else 1
    frames = np.arange(0, F, step)
    if frames[-1] != F - 1:
        frames = np.append(frames, F - 1)
    track = b""
    pos_lo = pos_hi = [0, 0, 0]
    if G:
        leads = [groups[b]["lead"] for b in moving]
        TP = SP[frames][:, leads] - c0
        TQ = SQ[frames][:, leads].copy()
        for k in range(1, len(frames)):                  # keep each quaternion on the side of the previous one
            flip = (TQ[k] * TQ[k - 1]).sum(-1) < 0
            TQ[k, flip] *= -1
        pos_lo, pos_hi = TP.reshape(-1, 3).min(0) - 1e-4, TP.reshape(-1, 3).max(0) + 1e-4
        track = np.concatenate([quantize(TP, pos_lo, pos_hi), np.round(np.clip(TQ, -1, 1) * 32767).astype(np.int16)], -1).tobytes()
    meta = dict(base=f"roboarc-{base}", family=family, difficulty=difficulty, robot=robot_kind,
                fps=float(z["video_fps"]), frames=int(F), t_sim=[round(float(x), 3) for x in z["t_sim"][frames]],
                sim_seconds=round(float(z["t_sim"][-1]), 2), hold=[int(z["hold_start_frames"]), int(z["hold_end_frames"])],
                track=dict(frames=[int(x) for x in frames], groups=G, lo=[float(x) for x in pos_lo], hi=[float(x) for x in pos_hi], offset=0, bytes=len(track)),
                center=[float(x) for x in c0], box=[[float(x) for x in lo_f - c0], [float(x) for x in hi_f - c0]],
                parts=[{k: v for k, v in p.items() if k != "_m"} for p in parts], deform=[])
    off = len(track)
    for rec, data in deform:
        rel = data - c0
        lo, hi = rel.reshape(-1, 3).min(0) - 1e-4, rel.reshape(-1, 3).max(0) + 1e-4
        b = quantize(rel, lo, hi).tobytes()
        rec.update(lo=[float(x) for x in lo], hi=[float(x) for x in hi], offset=off, bytes=len(b))
        meta["deform"].append(rec); dbin += b; off += len(b)
    for p in meta["parts"]:
        p["pos"] = [round(x - (c0[i] if p["track"] < 0 else 0), 6) for i, x in enumerate(p["pos"])]
        p["quat"] = [round(x, 7) for x in p["quat"]]
    (OUT / f"roboarc-{base}.bin").write_bytes(track + dbin)
    (OUT / f"roboarc-{base}.json").write_text(json.dumps(meta, separators=(",", ":")))
    return dict(parts=len(parts), groups=G, step=step, kb=round((len(track) + len(dbin)) / 1024), missing=missing,
                deform=[(r["kind"], r.get("points") or f"{r.get('rows')}x{r.get('cols')}", r["samples"]) for r in meta["deform"]])


difficulty = dict(l.split() for l in DIFF.read_text().splitlines() if l.strip())
for base, rec in sorted(json.load(open(REL))["bases"].items()):
    if ONLY and base not in ONLY and f"roboarc-{base}" not in ONLY:
        continue
    if not (SRC / "out" / f"roboarc-{base}" / "poses.npz").exists():
        print(f"{base:28s} no replay poses", flush=True)
        continue
    r = export(base, rec["family"], difficulty[base])
    print(f"{base:28s} parts {r['parts']:4d} groups {r['groups']:4d} step {r['step']:2d} {r['kb']:6d} KB deform {r['deform']} missing {r['missing']}", flush=True)
lib = sum(p.stat().st_size for p in (OUT / "m").iterdir())
print(f"mesh library: {len(list((OUT / 'm').iterdir()))} meshes, {lib / 1e6:.1f} MB; kept above target to stay whole: {len(FALLBACKS)} {sorted(FALLBACKS)[-8:]}")
