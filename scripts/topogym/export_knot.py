import sys
sys.path.insert(0, "/scripts")
from common import *  # noqa

import tempfile
from dataclasses import asdict
import numpy as np

from topogym.assets.geometry.knot_untying import KnotLayout, inspect_geometry, projected_crossings
from topogym.assets.geometry.rope_volume import write_rope_volume
from topogym.utils.geometry.passage import planar_clearance
from topogym.tasks.knot_untying.knot_untying_easy import KnotUntyingEasyTask
from topogym.tasks.knot_untying.knot_untying_medium import KnotUntyingMediumTask
from topogym.tasks.knot_untying.knot_untying_hard import KnotUntyingHardTask
from topogym.tasks.knot_untying.knot_untying_double_overhand import KnotUntyingDoubleOverhandTask

man = Manifest("knot_untying")
base = OUT / "knot_untying"
summary = {}
tiers = [("easy", KnotUntyingEasyTask, "topogym-knot-untying-easy-i00-standard"),
         ("medium", KnotUntyingMediumTask, "topogym-knot-untying-medium-i00-standard"),
         ("hard", KnotUntyingHardTask, "topogym-knot-untying-hard-i00-standard"),
         ("double_overhand_experimental", KnotUntyingDoubleOverhandTask, None)]
tmp = Path(tempfile.mkdtemp())
for tier, cls, task_dir in tiers:
    cfg = cls.defaults
    layout = KnotLayout(**cfg["geometry"])
    origin = np.asarray(cfg["origin_xy_m"], float)
    assert float(cfg["yaw_deg"]) == 0.0
    pts = layout.centerline()
    pts[:, :2] += origin
    report = inspect_geometry(layout.centerline(), layout)
    r = layout.rope_radius_m
    folder = base / tier
    rec = centerline_record(pts, r, kind="rope centerline (authored spawn, before settling)",
                            source="KnotLayout.centerline() topogym/assets/geometry/knot_untying.py:55-108",
                            browser_spacing=r,
                            extra=dict(layout=asdict(layout), variation_id=cls.variation_id,
                                       family=layout.family,
                                       projected_crossings=report["crossing_count"],
                                       over_under=report["over_under"],
                                       projected_writhe=report["projected_writhe"],
                                       min_nonlocal_surface_gap_m=report["minimum_nonlocal_surface_gap_m"],
                                       min_bend_radius_m=report["minimum_bend_radius_m"],
                                       free_ends="both ends free (no anchors)",
                                       rest_shape="straight (material reference is a straight rope; the knot is pre-stressed)"))
    p = write_json(folder / "rope_centerline_authored.json", rec)
    man.add(p, f"{tier}: rope centerline as authored by the generator (spawn shape, z from table), radius {r} m; also resampled at radius spacing in browser_points_m",
            tier=tier, count=rec["count"], length_m=rec["length_m"])
    info = dict(tier=tier, variation_id=cls.variation_id, family=layout.family,
                rope_radius_m=r, authored_length_m=rec["length_m"],
                authored_crossings=report["crossing_count"])
    if task_dir:
        inst, ipath = load_instance(task_dir)
        assert inst["variation_id"] == cls.variation_id, inst["variation_id"]
        vol = write_rope_volume(tmp / f"knot_{tier}.npz", layout.centerline(), r)
        world = np.asarray(inst["soft_state"]["rope"]["position_m"])
        center_w, n_total, s = fem_ring_centerline(world, vol)
        center = to_task(center_w)
        center[:, :2] += 0  # entity at (origin, table); origin is (0,0) for every tier
        clear, geo = planar_clearance(center, s, 2 * r)
        hits = projected_crossings(center)
        z = to_task(world)[:, 2]
        rec2 = centerline_record(center, r, kind="rope centerline after the instance's IPC settling (what the episode starts from)",
                                 source=f"{ipath.relative_to('/WT')}: soft_state.rope.position_m (FEM vertices) -> centroid of each authored surface ring (rope_volume.py:112-147)",
                                 browser_spacing=r,
                                 extra=dict(fem_vertices=len(world), fem_vertices_regenerated=n_total,
                                            fem_vertex_count_matches=bool(n_total == len(world)),
                                            projected_crossings=len(hits), planar_clear=bool(clear),
                                            min_nonlocal_projected_distance_m=geo["minimum_nonlocal_distance_m"],
                                            fem_z_range_m=[float(z.min()), float(z.max())],
                                            material_s_m=r6(s)))
        p = write_json(folder / "rope_centerline_settled.json", rec2)
        man.add(p, f"{tier}: settled initial rope centerline from the frozen Harbor instance (FEM ring centroids), radius {r} m",
                tier=tier, count=rec2["count"], length_m=rec2["length_m"])
        info.update(settled_length_m=rec2["length_m"], settled_crossings=len(hits),
                    fem_vertices=len(world), fem_vertex_count_matches=bool(n_total == len(world)),
                    settled_max_dev_from_authored_m=float(np.max(np.linalg.norm(
                        center - np.column_stack([np.interp(s, arclength(pts), pts[:, k]) for k in range(3)]), axis=1))))
    summary[tier] = info
tb = table_box()
p = mesh_obj(OUT / "common" / "table.obj", tb, "tabletop box (shared by every puzzle); top face at z=0")
man.add(p, "shared tabletop box, top surface z=0, x in [-0.8857,0.6143], y in [-0.7,0.7] (world_tabletop_v1.yaml table pos/size)")
write_json(base / "summary.json", summary)
man.add(base / "summary.json", "per-tier numbers (lengths, crossing counts, FEM vertex counts)")
man.save(notes=dict(rigid_obstacles="none (table only)"))
print(json.dumps(summary, indent=1))
