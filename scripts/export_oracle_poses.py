#!/usr/bin/env python3
"""Turn the oracle replays' link poses into the play section's rigid puzzles.

usage: export_oracle_poses.py <oracle_poses dir> <family> [tiers...]

Input, one folder per family and tier (<family>-<tier>/, a fresh-process re-run of the graded oracle trajectory in its
release image, sampled read-only): manifest.json (links, frame, table height), keyframes.json (link poses in the world,
+z up, metres, quaternions wxyz; lerp / nlerp between kept frames reproduces every control step within 0.5 mm /
0.005 rad) and meshes/<link>.visual.glb (link-local).

On the page the fixed pieces stay put and the visitor moves one piece. Where the robot also moves the main fixed piece
(the anchor), the moving piece's motion is taken relative to it, rel(t) = A(t)^-1 M(t), and shown with the anchor at
its start pose. "Show me how" plays that motion re-sampled by how far the moving piece travels, so the robot's pauses and
regrasps, where nothing moves relative to the anchor, drop out. It is cut where a plane first separates the pieces and
goes on as a straight pull along that plane's normal until the page counts them apart (bounding spheres clear); Cast
Coil (assembly) and the buzz wire keep the oracle's run to its end. Writes assets/data/puzzles/<family>/
<tier>/ (puzzle.json, one .bin per piece): y-up, centred on the anchor's mesh.
"""
import json, math, sys
from pathlib import Path
import numpy as np
import trimesh
from scipy.optimize import linprog
from scipy.spatial.transform import Rotation

SRC, FAMILY = Path(sys.argv[1]), sys.argv[2]
TIERS = sys.argv[3:] or ["easy", "medium", "hard"]
OUT = Path(__file__).resolve().parents[1] / "assets" / "data" / "puzzles" / FAMILY
YUP = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)     # world (x, y, z), +z up -> page (x, z, -y), +y up
PLINTH = {"color": "#d8d4cb", "roughness": 0.85, "metalness": 0}

# fixed links (the first is the anchor, the frame the motion is shown in), the moving link; "a|b" = whichever the tier
# has. origin "link": the moving piece turns about its link origin (the wand's loop centre) instead of its mesh centre.
# floor: the table is the stage floor (static fixed parts that stand on it); else the puzzle floats. goal: "apart"
# (default; the bounding spheres clear), "assemble" (reach the oracle's final pose: Cast Coil starts apart, as in
# TopoGym) or "rail" (follow the wire to where the oracle's run ends).
FAMILIES = {
    "cast_keyhole": {"fixed": ["keyhole_gold/keyhole_gold"], "move": "keyhole_silver/keyhole_silver"},
    "cast_coil": {"fixed": ["coil_gold/coil_gold"], "move": "coil_silver/coil_silver", "goal": "assemble"},
    "interlocked_claws": {"fixed": ["piece_0/piece_0|claw_0/claw_0"], "move": "piece_1/piece_1|claw_1/claw_1"},
    "hedgehog_in_cage": {"fixed": ["hedgehog_cage/cage", "hedgehog_mount/box_baselink"], "move": "hedgehog_ball/hedgehog",
                         "looks": {"hedgehog_mount": PLINTH}, "floor": True},
    "buzz_wire_3d": {"fixed": ["wire/wire", "wire_base/base"], "move": "wand/wand", "origin": "link", "goal": "rail",
                     "looks": {"wire_base": {**PLINTH, "color": "#b07a45", "roughness": 0.7}, "wire": {"material": "brass"}},
                     "floor": True},
}
DENSE = 0.0005     # densify the keyframes until the moving piece's corners move at most this much per sub-step (m)
SAMPLE = 0.0015    # spacing of the path's samples, same measure
SPEED = 0.07       # "Show me how" plays this many metres of corner travel per second
SHORTCUTS = Path(__file__).resolve().parent / "shortcuts"   # <family>-<tier>.json: samples to keep on an over-long path
TOLERANCE = 0.00025  # contact tolerance of the page's collision check: the robot presses the pieces together as it
                     # slides them, and touching counts as hitting there (cast_keyhole, exact depth between the convex
                     # collision parts: at most 0.06 mm at the keyframes, up to 0.27 mm between them where the
                     # keyframe interpolation adds its own error)


def nlerp(q0, q1, u):
    q = q0 * (1 - u) + q1 * u
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def slerp(q0, q1, u):                                     # as three.js turns between two samples (the page checks these)
    if q0 @ q1 < 0: q1 = -q1
    th = math.acos(min(1.0, float(q0 @ q1)))
    if th < 1e-6: return nlerp(q0, q1, u)
    return (np.sin((1 - u) * th) * q0 + np.sin(u * th) * q1) / math.sin(th)


def unflip(q):                                            # consecutive quaternions in the same hemisphere
    q = q.copy()
    for k in range(1, len(q)):
        if np.dot(q[k], q[k - 1]) < 0: q[k] = -q[k]
    return q


def r6(v):
    return [round(float(c), 6) for c in v]


REPLAY_STEP = 0.003    # watch samples: one per 3 mm of the fastest body's motion (its corners); pauses drop out
REPLAY_MAX = 1200      # at most this many samples (a coarser step for runs that never stop moving) ...
REPLAY_BUDGET = 120000  # ... and at most this many body-samples (Fiber Bundling hard has 186 links)
REPLAY_SPEED = 0.18    # metres of that motion per second of playback, within 16 to 45 s


def corners_of(V):
    return np.array(trimesh.bounds.corners(np.array([V.min(0), V.max(0)])))


def watch_track(kf, items, c0, out_dir):
    """The oracle's run as the page's watch mode plays it: per sample, the pose on the page (y-up, centred on c0) of every
    moving body, posing the very mesh the page draws for it. mode "local": that mesh is YUP (v - c) in the link frame;
    mode "start": it is the link's page vertices at the run's start, and the pose is the motion since then. Samples
    follow the fastest corner (pauses drop out); int16 on disk (replay.bin). Returns the meta for puzzle.json."""
    F = kf["frames"]; N = len(F)
    P = [np.array([f["pos"][kf["links"].index(it["link"])] for f in F]) for it in items]
    Q = [unflip(np.array([f["quat"][kf["links"].index(it["link"])] for f in F])) for it in items]
    R = [Rotation.from_quat(q, scalar_first=True).as_matrix() for q in Q]
    C = [np.einsum("nij,kj->nki", R[k], it["corners"]) + P[k][:, None, :] for k, it in enumerate(items)]   # world corners
    sacc = np.r_[0, np.cumsum(np.max([np.linalg.norm(np.diff(c, axis=0), axis=2).max(1) for c in C], axis=0))]
    n = min(REPLAY_MAX, REPLAY_BUDGET // len(items), int(math.ceil(sacc[-1] / REPLAY_STEP)) + 1)
    su = np.linspace(0, sacc[-1], n)
    j = np.clip(np.searchsorted(sacc, su, side="right") - 1, 0, N - 2)
    w = np.clip((su - sacc[j]) / np.maximum(sacc[j + 1] - sacc[j], 1e-12), 0, 1)
    track = np.zeros((n, len(items), 7))
    for k, it in enumerate(items):
        pos = P[k][j] * (1 - w)[:, None] + P[k][j + 1] * w[:, None]
        Rw = Rotation.from_quat(nlerp(Q[k][j], Q[k][j + 1], w[:, None]), scalar_first=True).as_matrix()
        if it["mode"] == "local":
            M = Rw
            track[:, k, :3] = (np.einsum("nij,j->ni", Rw, it["c"]) + pos - c0) @ YUP.T
        else:
            M = np.einsum("nij,kj->nik", Rw, R[k][0])                         # R(t) R(0)^T
            track[:, k, :3] = (np.einsum("nij,j->ni", M, c0 - P[k][0]) + pos - c0) @ YUP.T
        track[:, k, 3:] = unflip(Rotation.from_matrix(np.einsum("ij,njk,kl->nil", YUP, M, YUP.T)).as_quat())
    lo, hi = track[:, :, :3].reshape(-1, 3).min(0) - 1e-3, track[:, :, :3].reshape(-1, 3).max(0) + 1e-3
    q16 = np.empty(track.shape, np.int16)
    q16[:, :, :3] = np.round((track[:, :, :3] - lo) / (hi - lo) * 65535 - 32768)
    q16[:, :, 3:] = np.round(track[:, :, 3:] * 32767)
    q16.tofile(out_dir / "replay.bin")
    cen = np.concatenate([c.mean(1) for c in C]) - c0                          # where the bodies go, for the view
    cen = cen @ YUP.T
    flo, fhi = cen.min(0), cen.max(0)
    radius = max(float(np.linalg.norm(it["corners"] - it["corners"].mean(0), axis=1).max()) for it in items)
    return {"url": "replay.bin", "count": n, "lo": r6(lo), "hi": r6(hi), "bodies": [it["name"] for it in items],
            "seconds": round(min(45, max(16, sacc[-1] / REPLAY_SPEED)), 1), "motion_m": round(float(sacc[-1]), 3),
            "frame": {"center": r6(0.5 * (flo + fhi)), "span": round(float(0.5 * np.linalg.norm(fhi - flo) + radius), 4)}}


def lock_oracle():
    """Lock Picking keeps its emulated lock (play.js lockTry: slots, play, stops). Add the oracle's key motion on the
    lock's axis to each tier's puzzle.json as lock.oracle (depth x along the axis, turn about it, as the page measures
    them), with its pauses left out; the page's rules accept every step of it (?selftest), and the rotors they compute
    stay within 2 degrees of the simulator's."""
    for tier in TIERS:
        d = SRC / f"{FAMILY}-{tier}"
        man, kf = json.load(open(d / "manifest.json")), json.load(open(d / "keyframes.json"))
        out = OUT / tier / "puzzle.json"
        meta = json.load(open(out))
        L = meta["lock"]
        ik = kf["links"].index("lock_key/key")
        axis = np.array(links_pose0(man, "lock_disc_0/disc")["pos"])             # the axis passes the discs' origins
        x, deg = [], []
        for f in kf["frames"]:
            p, (w, qx, _, _) = np.array(f["pos"][ik]), f["quat"][ik]
            if abs(p[1] - axis[1]) < 0.003 and abs(p[2] - axis[2]) < 0.003:      # on the axis
                x.append(max(L["start"], p[0] - axis[0])); deg.append(-math.degrees(2 * math.atan2(qx, w)))
        x, deg = np.array(x), np.array(deg)
        x = np.r_[L["start"], x]; deg = np.r_[0.0, deg]                         # from the page's start pose
        step = np.abs(np.diff(x)) / 0.003 + np.abs(np.diff(deg)) / 1.0              # 3 mm or 1 degree = one unit
        sacc = np.r_[0, np.cumsum(step)]
        n = int(math.ceil(sacc[-1])) + 1
        su = np.linspace(0, sacc[-1], n)
        xs, ds = np.interp(su, sacc, x), np.interp(su, sacc, deg)
        L["oracle"] = {"x": [round(float(v), 5) for v in xs], "deg": [round(float(v), 3) for v in ds],
                       "seconds": round(max(12.0, sacc[-1] / 24), 1),
                       "run": man["run"], "image": man["image"]["reference"], "replay_state_hash_matches_verdict": man["hash"]["match"]}
        # watch mode: the key (picked off its tray) and the discs, posing the play meshes (link frames, y-up)
        links = {Lk["id"]: Lk for Lk in man["links"]}
        pivot = next(r["pivot"] for r in L["rotors"] if r["name"] == "lock_disc_0")
        c0 = np.array(links["lock_disc_0/disc"]["pose0"]["pos"]) - YUP.T @ np.array(pivot)   # the page origin in the world
        items = []
        for link in kf["links"]:
            g = trimesh.load(d / links[link]["visual"], force="mesh", process=False)
            items.append({"name": link.split("/")[0], "link": link, "mode": "local", "c": np.zeros(3), "corners": corners_of(np.asarray(g.vertices))})
        meta["replay"] = {**watch_track(kf, items, c0, OUT / tier), "floor": 0}
        out.write_text(json.dumps(meta, separators=(",", ":")) + "\n")
        print(f"lock_picking {tier}: {len(x)} on-axis keyframes -> {n} samples, {L['oracle']['seconds']} s; key x {xs[0]:.4f} -> {xs[-1]:.4f} (win {L['win']})")


REPLAYS = {   # watched, not played: every moving link where the simulator had it (the robot hidden), plus the static parts
    "horseshoe_ring": {"looks": {"target_ring": {"color": "#d2683f", "roughness": 0.38, "metalness": 0.15},
                                 "goal_region_obj_baselink": {"color": "#cfe3e6", "roughness": 0.9, "metalness": 0}}},
    "fiber_bundling": {"looks": {"ring": {"color": "#d2683f", "roughness": 0.38, "metalness": 0.3}},
                       "focus": ("bundling_ring/ring", 0.2)},   # the view opens on the ring (link, span in m)
}
def replay():
    cfg = REPLAYS[FAMILY]
    for tier in TIERS:
        d = SRC / f"{FAMILY}-{tier}"
        man, kf = json.load(open(d / "manifest.json")), json.load(open(d / "keyframes.json"))
        links = {L["id"]: L for L in man["links"]}
        ids = kf["links"]
        P0 = np.array(kf["frames"][0]["pos"])                                  # the links at the start
        static = [L["id"] for L in man["links"] if L["role"] == "task" and not L["moving"] and not L.get("empty_frame")]
        meshes = {}
        for link in ids + static:
            g = trimesh.load(d / links[link]["visual"], force="mesh", process=False)
            g.merge_vertices(merge_tex=True, merge_norm=True)                  # smooth shading; a replay is not collided
            meshes[link] = (np.asarray(g.vertices, float), np.asarray(g.faces, np.int64))
        # the page: y-up, the table top as the stage floor, centred on the pieces at the start
        c0 = P0.mean(0); c0[2] = man["pose_frame"]["table_top_z_m"]
        page = lambda X: (X - c0) @ YUP.T
        (OUT / tier).mkdir(parents=True, exist_ok=True)
        for old in (OUT / tier).glob("*.bin"): old.unlink()
        bodies = []
        for link in ids + static:
            V, Fc = meshes[link]
            name = link.split("/")[-1] if link.split("/")[-1] not in ("box_baselink", "baselink") else link.split("/")[0]
            if link in ids: Vs = V @ YUP.T                                     # link-local, turned y-up; posed by the track
            else:
                p0 = links[link]["pose0"]
                Vs = page(V @ Rotation.from_quat(p0["quat"], scalar_first=True).as_matrix().T + p0["pos"])
            u32 = len(Vs) > 65535
            with open(OUT / tier / f"{name}.bin", "wb") as f:
                f.write(np.asarray(Vs, np.float32).tobytes()); f.write(np.asarray(Fc, np.uint32 if u32 else np.uint16).tobytes())
            rgba = links[link].get("visual_color_rgba") or [0.6, 0.6, 0.6, 1]
            bodies.append({"url": f"{name}.bin", "vertices": int(len(Vs)), "triangles": int(len(Fc)), "index": "u32" if u32 else "u16",
                           "name": name, "role": "replay" if link in ids else "fixed", "position": [0, 0, 0],
                           "color": "#%02x%02x%02x" % tuple(int(round(255 * c)) for c in rgba[:3]), "roughness": 0.4, "metalness": 0.6,
                           **cfg["looks"].get(name, {})})
        def focus_centre(link):                                                # a static link's mesh centre on the page
            V = meshes[link][0]; p0 = links[link]["pose0"]
            W = page(V @ Rotation.from_quat(p0["quat"], scalar_first=True).as_matrix().T + p0["pos"])
            return 0.5 * (W.min(0) + W.max(0))
        items = [{"name": b["name"], "link": link, "mode": "local", "c": np.zeros(3), "corners": corners_of(meshes[link][0])}
                 for b, link in zip(bodies, ids)]
        watch = {**watch_track(kf, items, c0, OUT / tier), "floor": 0}
        if "focus" in cfg: watch["frame"] = {"center": r6(focus_centre(cfg["focus"][0])), "span": cfg["focus"][1]}
        n = watch["count"]
        meta = {"id": FAMILY, "kind": "replay", "tier": tier, "floor": 0, "bodies": bodies, "replay": watch,
                "oracle": {"run": man["run"], "image": man["image"]["reference"], "control_steps": man["replay"]["sim_steps"],
                           "sim_seconds": round(man["replay"]["sim_time_s"], 1), "replay_state_hash_matches_verdict": man["hash"]["match"],
                           "keyframes": kf["n_frames"]}}
        (OUT / tier / "puzzle.json").write_text(json.dumps(meta, separators=(",", ":")) + "\n")
        size = sum(f.stat().st_size for f in (OUT / tier).iterdir())
        print(f"{FAMILY} {tier}: {len(ids)} links, {n} samples over {watch['motion_m']:.2f} m of motion -> {watch['seconds']} s; {size / 1e6:.2f} MB")


def links_pose0(man, link):
    return next(L for L in man["links"] if L["id"] == link)["pose0"]


if FAMILY == "lock_picking":
    lock_oracle()
    sys.exit()
if FAMILY in REPLAYS:
    replay()
    sys.exit()
cfg = FAMILIES[FAMILY]
for tier in TIERS:
    d = SRC / f"{FAMILY}-{tier}"
    man, kf = json.load(open(d / "manifest.json")), json.load(open(d / "keyframes.json"))
    links = {L["id"]: L for L in man["links"]}
    pick = lambda alts: next(a for a in alts.split("|") if a in links)
    fixed_ids, mover_id = [pick(a) for a in cfg["fixed"]], pick(cfg["move"])
    t = np.array([f["t"] for f in kf["frames"]])
    N = len(t)

    def track(link):                                      # a link's pose at every keyframe (static links: their pose0)
        if link in kf["links"]:
            i = kf["links"].index(link)
            return np.array([f["pos"][i] for f in kf["frames"]]), unflip(np.array([f["quat"][i] for f in kf["frames"]]))
        p0 = links[link]["pose0"]
        return np.tile(p0["pos"], (N, 1)).astype(float), np.tile(p0["quat"], (N, 1)).astype(float)

    def mesh(link):                                       # the visual mesh as the sim draws it (a triangle soup)
        g = trimesh.load(d / links[link]["visual"], force="mesh", process=False)
        V, F = np.asarray(g.vertices, float), np.asarray(g.faces, np.int64)
        T = V[F]                                          # zero-area triangles add no surface, and three-mesh-bvh's
        keep = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) > 1e-12   # triangle test
        return V, F[keep]                                 # reports them as hits

    pa, qa = track(fixed_ids[0]); pm, qm = track(mover_id)
    Va, Fa = mesh(fixed_ids[0]); Vm, Fm = mesh(mover_id)
    ca = 0.5 * (Va.min(0) + Va.max(0))
    cm = np.zeros(3) if cfg.get("origin") == "link" else 0.5 * (Vm.min(0) + Vm.max(0))
    corners = np.array(trimesh.bounds.corners(np.array([Vm.min(0), Vm.max(0)])))

    def relative(pa_, qa_, pm_, qm_):                     # the mover's pose in the anchor's link frame
        RA, RM = Rotation.from_quat(qa_, scalar_first=True), Rotation.from_quat(qm_, scalar_first=True)
        return RA.inv() * RM, RA.inv().apply(pm_ - pa_)

    def corner_path(R, p):
        return np.einsum("nij,kj->nki", R.as_matrix(), corners) + p[:, None, :]

    # densify between keyframes: interpolate each link as the exporter does, then compose
    gap = np.linalg.norm(np.diff(corner_path(*relative(pa, qa, pm, qm)), axis=0), axis=2).max(1)
    us, ks = [], []
    for k in range(N - 1):
        m = max(1, math.ceil(gap[k] / DENSE))
        us.append(np.arange(m) / m); ks.append(np.full(m, k))
    us.append([0.0]); ks.append([N - 1])
    u, k = np.concatenate(us), np.concatenate(ks)
    k1 = np.minimum(k + 1, N - 1)
    R, p = relative(pa[k] * (1 - u)[:, None] + pa[k1] * u[:, None], nlerp(qa[k], qa[k1], u[:, None]),
                    pm[k] * (1 - u)[:, None] + pm[k1] * u[:, None], nlerp(qm[k], qm[k1], u[:, None]))
    td = t[k] * (1 - u) + t[k1] * u

    # the page: the world at the start, centred on the anchor's mesh, turned y-up; the mover as if the anchor stayed put
    A0R, A0p = Rotation.from_quat(qa[0], scalar_first=True).as_matrix(), pa[0]
    c0 = A0R @ ca + A0p
    page = lambda X: (X - c0) @ YUP.T
    WR = np.einsum("ij,njk->nik", A0R, R.as_matrix()); Wp = p @ A0R.T + A0p
    pos = page(np.einsum("nij,j->ni", WR, cm) + Wp)                  # the mover's origin on the page
    # its mesh is stored turned y-up, local = YUP (v - cm), so its rotation on the page is YUP W YUP^T (xyzw, as three.js)
    quat = unflip(Rotation.from_matrix(np.einsum("ij,njk,kl->nil", YUP, WR, YUP.T)).as_quat())

    bodies = []
    (OUT / tier).mkdir(parents=True, exist_ok=True)
    for old in (OUT / tier).glob("*.bin"): old.unlink()            # files of earlier exports of this tier
    def body(link, V, F, role, **extra):
        name = link.split("/")[0]
        u32 = len(V) > 65535
        with open(OUT / tier / f"{name}.bin", "wb") as f:
            f.write(np.asarray(V, np.float32).tobytes()); f.write(np.asarray(F, np.uint32 if u32 else np.uint16).tobytes())
        rec = {"url": f"{name}.bin", "vertices": int(len(V)), "triangles": int(len(F)), "index": "u32" if u32 else "u16",
               "name": name, "role": role, **extra, **cfg.get("looks", {}).get(name, {})}
        bodies.append(rec)
        return rec
    for i, link in enumerate(fixed_ids):
        if i and link in kf["links"]:                     # a second fixed part must stay rigid with the anchor
            pb, qb = track(link)
            Rb, pbr = relative(pa, qa, pb, qb)
            drift = np.linalg.norm(pbr - pbr[0], axis=1).max()
            assert drift < 1e-3, f"{link} moves {drift * 1000:.1f} mm relative to the anchor"
        p0 = links[link]["pose0"] if i else {"pos": pa[0], "quat": qa[0]}
        V, F = mesh(link)
        Vw = V @ Rotation.from_quat(p0["quat"], scalar_first=True).as_matrix().T + p0["pos"]
        Vp = page(Vw)
        body(link, Vp, F, "fixed", position=[0, 0, 0], radius=round(float(np.linalg.norm(Vp, axis=1).max()), 5))["_page"] = Vp
    mover_local = (Vm - cm) @ YUP.T
    ra, rm = bodies[0]["radius"], float(np.linalg.norm(mover_local, axis=1).max())

    # how far the moving piece travels (its corners, in the anchor's frame); where the pieces count as apart
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(corner_path(R, p), axis=0), axis=2).max(1))])
    dist = np.linalg.norm(pos - page(c0), axis=1)
    win = ra + rm + 0.005                                 # play.js: bounding spheres clear by 5 mm
    goal = cfg.get("goal", "apart")
    cut, nrm = None, None
    if goal == "apart":
        # the first keyframe where one plane separates the moving piece from every fixed piece: from there it can simply
        # be pulled away, and what the robot does afterwards (regrasps, carrying it to the goal) is not the puzzle
        hulls = [trimesh.convex.convex_hull(b["_page"]).vertices for b in bodies]
        hm = trimesh.convex.convex_hull(mover_local).vertices
        kd = np.flatnonzero(u == 0)                       # dense index of every keyframe

        def separating(i):
            M = hm @ Rotation.from_quat(quat[i]).as_matrix().T + pos[i]
            nb = len(hulls)
            rows = [np.c_[H, -np.eye(nb)[[b] * len(H)]] for b, H in enumerate(hulls)]       # w.a - b_i <= -1
            rows += [np.c_[-M, np.eye(nb)[[b] * len(M)]] for b in range(nb)]               # w.m - b_i >= 1
            A_ub = np.vstack(rows)
            lp = linprog(np.zeros(3 + nb), A_ub=A_ub, b_ub=-np.ones(len(A_ub)), bounds=[(None, None)] * (3 + nb), method="highs")
            return lp.x[:3] / np.linalg.norm(lp.x[:3]) if lp.status == 0 else None
        stride = 8
        for a in range(0, len(kd), stride):
            if separating(kd[a]) is not None:
                for b in range(max(0, a - stride + 1), a + 1):        # the first one within the stride
                    nrm = separating(kd[b])
                    if nrm is not None: cut = kd[b]; break
                break
        if cut is None:
            print(f"  WARNING {tier}: the pieces never come apart in the oracle's run")
    s_end = s[cut] if cut is not None else s[-1]

    # re-sample by travel: equal steps of corner motion, the robot's pauses and regrasps drop out
    n = int(math.ceil(s_end / SAMPLE)) + 1
    su = np.linspace(0, s_end, n)
    j = np.clip(np.searchsorted(s, su, side="right") - 1, 0, len(s) - 2)
    w = np.clip((su - s[j]) / np.maximum(s[j + 1] - s[j], 1e-12), 0, 1)[:, None]
    Ps = pos[j] * (1 - w) + pos[j + 1] * w
    Qs = nlerp(quat[j], quat[j + 1], w)
    pull = 0.0
    if nrm is not None:
        # then straight out along the separating plane's normal until the page counts the pieces apart (+1 cm)
        P, goal_r = Ps[-1], win + 0.01
        pull = float(-P @ nrm + math.sqrt(max(0.0, (P @ nrm) ** 2 - P @ P + goal_r ** 2)))
        ext = np.arange(1, int(math.ceil(pull / SAMPLE)) + 1)[:, None] * SAMPLE
        Ps = np.vstack([Ps, P + np.minimum(ext, pull) * nrm]); Qs = np.vstack([Qs, np.repeat(Qs[-1:], len(ext), 0)])
        n = len(Ps)
    full_m = s_end + pull
    sc = SHORTCUTS / f"{FAMILY}-{tier}.json"
    if sc.exists():
        # an over-long path (the page's ?shortcut=<family>:<tier> picks the samples): straight moves between the kept
        # samples, each checked by the page against the exact pieces, re-sampled by travel like the rest
        keep = json.load(open(sc))
        assert keep["samples"] == n, f"{sc.name} was made for a path of {keep['samples']} samples, this one has {n}"
        cw = lambda i: (corners - cm) @ YUP.T @ Rotation.from_quat(Qs[i]).as_matrix().T + Ps[i]   # corners on the page
        reach = float(np.linalg.norm((corners - cm) @ YUP.T, axis=1).max())
        P2, Q2 = [Ps[:1]], [Qs[:1]]
        for a, b in zip(keep["waypoints"][:-1], keep["waypoints"][1:]):
            turn = 2 * math.acos(min(1.0, abs(float(Qs[a] @ Qs[b]))))
            m = max(1, int(math.ceil((np.linalg.norm(Ps[b] - Ps[a]) + turn * reach) / SAMPLE)))  # the page's step count
            v = (np.arange(1, m + 1) / m)[:, None]
            P2.append(Ps[a] * (1 - v) + Ps[b] * v); Q2.append(slerp(Qs[a], Qs[b], v))
        Ps, Qs = np.vstack(P2), np.vstack(Q2)
        n = len(Ps)
        full_m = float(sum(np.linalg.norm(cw(i + 1) - cw(i), axis=1).max() for i in range(n - 1)))
    body(mover_id, mover_local, Fm, "move", position=r6(Ps[0]), quaternion=r6(Qs[0]), radius=round(rm, 5))

    meta = {
        "id": FAMILY, "kind": "rigid", "tier": tier, "tolerance": TOLERANCE, "bodies": bodies,
        "path": {"count": n, "seconds": round(max(16, full_m / SPEED), 1), **({"shortened": True} if sc.exists() else {}),
                 "position": [round(float(c), 6) for c in Ps.ravel()], "quaternion_xyzw": [round(float(c), 6) for c in Qs.ravel()]},
        "oracle": {"run": man["run"], "image": man["image"]["reference"], "control_steps": man["replay"]["sim_steps"],
                   "sim_seconds": round(man["replay"]["sim_time_s"], 1), "replay_state_hash_matches_verdict": man["hash"]["match"],
                   "keyframes": kf["n_frames"], "travel_m": round(float(s[-1]), 3), "travel_kept_m": round(float(s_end), 3),
                   "separable_at_sim_s": round(float(td[cut]), 2) if cut is not None else None, "pull_away_m": round(pull, 4),
                   "path_m": round(full_m, 3)},
    }
    if cfg.get("floor"):
        meta["floor"] = round(float(page(np.array([0, 0, man["pose_frame"]["table_top_z_m"]]))[1]), 6)
    # watch mode: the oracle's whole run as the simulator had it, posing the play meshes; the table is the stage floor
    items = [{"name": link.split("/")[0], "link": link, "mode": "start", "corners": corners_of(mesh(link)[0])}
             for link in fixed_ids if link in kf["links"]]
    items.append({"name": mover_id.split("/")[0], "link": mover_id, "mode": "local", "c": cm, "corners": corners_of(Vm)})
    meta["replay"] = {**watch_track(kf, items, c0, OUT / tier), "floor": round(float(man["pose_frame"]["table_top_z_m"] - c0[2]), 6)}
    if goal == "rail":
        # solved once the loop has followed the wire to where the oracle's run ends (the oracle's own loop path is the rail)
        rail = Ps[::max(1, n // 400)]
        meta["win"] = {"type": "rail", "rail": [r6(q) for q in rail], "finish": r6(Ps[-1]), "radius": 0.02}
    if goal == "assemble":
        # solved at the oracle's final pose, which the grader accepted (1 mm, 0.02 rad from the matching frames);
        # the page allows 2 mm and 0.03 rad
        meta["win"] = {"type": "reach", "target": r6(Ps[-1]), "quaternion": r6(Qs[-1]), "radius": 0.002, "angle": 0.03,
                       "from": round(float(np.linalg.norm(Ps[0] - Ps[-1])), 5)}
    for b in bodies: b.pop("_page", None)
    (OUT / tier / "puzzle.json").write_text(json.dumps(meta, separators=(",", ":")) + "\n")
    print(f"{FAMILY} {tier}: fixed {[b['name'] + ' ' + str(b['triangles']) for b in bodies[:-1]]}, mover {len(Fm)} tris; "
          f"travel {s[-1]:.3f} m, kept {s_end:.3f} m + pull {pull:.3f} m (separable at sim {meta['oracle']['separable_at_sim_s']} s of {t[-1]:.1f}); "
          f"path {n} samples, {meta['path']['seconds']} s; centre distance {dist[0]:.4f} -> {np.linalg.norm(Ps[-1] - page(c0)):.4f} "
          f"(apart beyond {win:.4f}); floor {meta.get('floor')}, lowest mover centre y {Ps[:, 1].min():.4f}")
