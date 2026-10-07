import sys
sys.path.insert(0, "/scripts")
from common import *  # noqa

import numpy as np
from topogym.evaluation.cloth_metrics import footprint_area
from topogym.tasks.blanket_flatten.blanket_flatten_easy import BlanketFlattenEasyTask
from topogym.tasks.blanket_flatten.blanket_flatten_medium import BlanketFlattenMediumTask
from topogym.tasks.blanket_flatten.blanket_flatten_hard import BlanketFlattenHardTask
from topogym.world.physics.initial_state_compatibility import ARCHIVE_REVISION

man = Manifest("blanket_flatten")
base = OUT / "blanket_flatten"
RES = Path("/WT/topogym/assets/resources/variations/blanket_flatten") / ARCHIVE_REVISION
profiles = sorted(p.name for p in RES.iterdir() if p.is_dir())
tiers = [("easy", BlanketFlattenEasyTask, "topogym-blanket-flatten-easy-i00-standard"),
         ("medium", BlanketFlattenMediumTask, "topogym-blanket-flatten-medium-i00-standard"),
         ("hard", BlanketFlattenHardTask, "topogym-blanket-flatten-hard-i00-standard")]


def archive(task_dir):
    # The Harbor instance loads its own frozen archive (simulator.task_parameters.initial_state_path).
    folder = TASKS / task_dir / "environment" / "sim" / "instance_assets" / "initial_state"
    m = json.loads((folder / "manifest.json").read_text())
    keys = {}

    def walk(node, path):
        if isinstance(node, dict):
            if node.get("kind") in ("tensor", "array") and "key" in node:
                keys[path] = node["key"]
            items = node.get("items")
            if isinstance(items, dict):
                for k, v in items.items():
                    walk(v, path + "/" + k)
            elif isinstance(items, list):
                for i, v in enumerate(items):
                    walk(v, path + f"[{i}]")
    walk(m["tree"], "")
    arrays = np.load(folder / "arrays.npz")
    get = lambda name: arrays[keys["/buffers/PBDSolver/" + name]]
    return get, folder


summary = {}
for tier, cls, task_dir in tiers:
    cfg = cls.defaults
    inst, ipath = load_instance(task_dir)
    assert inst["variation_id"] == cls.variation_id
    pos = to_task(np.asarray(inst["soft_state"]["blanket"]["position_m"]))
    get, afolder = archive(task_dir)
    apos = to_task(get("particles/value/pos")[:, 0])
    rest = get("particles_info/value/pos_rest")
    v1, v2 = get("edges_info/value/v1"), get("edges_info/value/v2")
    center = np.asarray(cfg["center_xy_m"], float)
    uv = rest[:, :2] - center                       # material coordinates (flat birth)
    xs, ys = np.unique(np.round(uv[:, 0], 9)), np.unique(np.round(uv[:, 1], 9))
    nx, ny = len(xs), len(ys)
    ii = np.searchsorted(xs, np.round(uv[:, 0], 9)); jj = np.searchsorted(ys, np.round(uv[:, 1], 9))
    assert nx * ny == len(rest) and len(set(zip(ii, jj))) == len(rest)
    grid = -np.ones((nx, ny), dtype=np.int64); grid[ii, jj] = np.arange(len(rest))
    edges = set(map(tuple, np.sort(np.c_[v1, v2], axis=1)))
    faces = []
    for i in range(nx - 1):
        for j in range(ny - 1):
            a, b, c, d = grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]
            if tuple(sorted((a, c))) in edges:
                faces += [(a, b, c), (a, c, d)]
            elif tuple(sorted((b, d))) in edges:
                faces += [(a, b, d), (b, c, d)]
            else:
                raise ValueError("quad without diagonal")
    faces = np.asarray(faces)
    # sanity: every edge of the faces is a PBD stretch edge and vice versa
    fe = set(map(tuple, np.sort(np.concatenate([faces[:, :2], faces[:, 1:], faces[:, [2, 0]]]), axis=1)))
    assert fe == edges, (len(fe), len(edges))
    tex = (uv - uv.min(0)) / np.ptp(uv, axis=0)
    p = write_obj(base / tier / "blanket_particles_initial.obj", pos, faces, uv=tex,
                  header=f"PBD particle mesh {nx}x{ny} at its frozen initial state; vt = material (rest) coordinates normalised to [0,1]")
    man.add(p, f"{tier}: cloth simulation mesh - {nx}x{ny} PBD particles ({len(pos)}), {len(faces)} triangles, initial (crumpled) state; vt = rest UV grid", tier=tier)
    # visual mesh (51x41) reconstructed from the particle state with Genesis' own support weights
    sidx, sw = get("vverts_info/value/support_idxs"), get("vverts_info/value/support_weights")
    vfaces, vuv = get("vfaces_indices/value"), get("vverts_uvs/value")
    vpos = np.einsum("vk,vkd->vd", sw, pos[sidx])
    vrender = to_task(get("vverts_render/value/pos")[:, 0])
    p = write_obj(base / tier / "blanket_visual_initial.obj", vpos, vfaces, uv=vuv,
                  header="visual cloth mesh 51x41 (12 mm control grid) at the initial state; vt = Genesis visual uvs")
    man.add(p, f"{tier}: cloth visual/control mesh - 51x41 vertices ({len(vpos)}), {len(vfaces)} triangles at the initial state, with UVs (recommended browser resolution)", tier=tier)
    rest_vis = None
    # rest (flat) versions for reference
    flat = np.c_[uv + center, np.zeros(len(uv))]
    p = write_obj(base / tier / "blanket_particles_rest_flat.obj", flat, faces, uv=tex, header="flat rest configuration of the particle mesh (z=0, centred at center_xy)")
    man.add(p, f"{tier}: flat rest/target configuration of the particle mesh (what full coverage looks like), centred at the task's center_xy", tier=tier)
    area = cfg["length_m"] * cfg["width_m"]
    cov = footprint_area(pos, faces) / area
    rest_len = np.linalg.norm(rest[v1] - rest[v2], axis=1)
    stretch = np.linalg.norm(pos[v1] - pos[v2], axis=1) / rest_len
    write_json(base / tier / "blanket_grid.json", dict(
        frame=FRAME, length_m=cfg["length_m"], width_m=cfg["width_m"], center_xy_m=r6(center),
        particle_grid=dict(nx=nx, ny=ny, spacing_m=[float(np.diff(xs).mean()), float(np.diff(ys).mean())],
                           index_of_ij="particle index = grid_ij[i][j]; i along x (length 0.60 m), j along y (width 0.48 m)",
                           grid_ij=grid.tolist(), rest_uv_m=r6(uv)),
        visual_grid=dict(nx=51, ny=41, spacing_m=0.012, note="Genesis remeshed the 51x41 authored control grid into the 101x81 PBD particle grid; visual vertices are skinned from 12 particles each"),
        pbd=dict(particle_size_m=cfg["particle_size_m"], stretch_edges=len(v1), bending_pairs=int(len(get("inner_edges_info/value/v1"))),
                 material=cfg["material"], table_friction=cfg["table_friction"],
                 stretch_compliance=float(get("edges_info/value/stretch_compliance")[0]),
                 bending_compliance=float(get("inner_edges_info/value/bending_compliance")[0]),
                 particle_mass_kg=float(get("particles_info/value/mass")[0]), max_stretch_solver_iterations=8),
        initial=dict(coverage_ratio=cov, max_height_m=float(pos[:, 2].max()), min_height_m=float(pos[:, 2].min()),
                     max_edge_stretch_ratio=float(stretch.max()),
                     archive=str(afolder.relative_to("/WT")), instance_matches_archive_max_abs_m=float(np.abs(pos - apos).max()),
                     visual_matches_archive_render_max_abs_m=float(np.abs(vpos - vrender).max())),
        goal=dict(minimum_coverage_ratio=cfg["minimum_coverage_ratio"], maximum_height_m=cfg["maximum_height_m"],
                  min_height_m=-cfg["particle_size_m"], maximum_stretch_ratio=cfg["maximum_stretch_ratio"],
                  settle_max_speed_m_s=cfg["maximum_speed_m_s"], settle_max_drift_m=cfg["maximum_drift_m"],
                  release_clearance_m=0.005, stable_duration_s=cfg["stable_duration_s"]),
        gathered_profile=cfg["gathered_profile"]))
    man.add(base / tier / "blanket_grid.json", f"{tier}: grid dimensions, particle->(i,j) map, rest UV, PBD material, initial coverage and goal thresholds", tier=tier)
    summary[tier] = dict(variation_id=cls.variation_id, twist_deg=cfg["gathered_profile"]["twist_angle_deg"],
                         particles=len(pos), grid=[nx, ny], triangles=len(faces), initial_coverage=cov,
                         initial_max_height_m=float(pos[:, 2].max()), initial_max_stretch=float(stretch.max()),
                         bounds_m=[r6(pos.min(0)), r6(pos.max(0))],
                         instance_vs_archive_max_abs_m=float(np.abs(pos - apos).max()),
                         visual_vs_archive_render_max_abs_m=float(np.abs(vpos - vrender).max()))
write_json(base / "summary.json", dict(source_archives="tasks/<harbor task>/environment/sim/instance_assets/initial_state (the packaged gathered_archive_v2 states differ by up to 2.4 cm and are NOT what Harbor loads)", tiers=summary))
man.add(base / "summary.json", "per-tier numbers")
man.save(notes=dict(rigid_obstacles="none (table only)"))
print(json.dumps(summary, indent=1))
