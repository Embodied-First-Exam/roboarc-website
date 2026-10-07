import sys
sys.path.insert(0, "/scripts")
from common import *  # noqa

import tempfile
from dataclasses import asdict
import numpy as np
import trimesh
from scipy.spatial.transform import Rotation

from topogym.assets.geometry.rope_threading import ThreadingLayout, ring_mesh, inspect_geometry, route_crossings
from topogym.assets.geometry.rope_volume import write_rope_volume
from topogym.tasks.scene_presets import PRESETS
from topogym.tasks.rope_threading.rope_threading_very_easy import RopeThreadingVeryEasyTask
from topogym.tasks.rope_threading.rope_threading_easier import RopeThreadingEasierTask
from topogym.tasks.rope_threading.rope_threading_easy import RopeThreadingEasyTask
from topogym.tasks.rope_threading.rope_threading_medium import RopeThreadingMediumTask
from topogym.tasks.rope_threading.rope_threading_hard import RopeThreadingHardTask

man = Manifest("rope_threading")
base = OUT / "rope_threading"
tiers = [("very_easy", RopeThreadingVeryEasyTask, None),
         ("easier", RopeThreadingEasierTask, None),
         ("easy", RopeThreadingEasyTask, "topogym-rope-threading-easy-i00-standard"),
         ("medium", RopeThreadingMediumTask, "topogym-rope-threading-medium-i00-standard"),
         ("hard", RopeThreadingHardTask, "topogym-rope-threading-hard-i00-standard")]
COLOR_NAMES = {"R1": "cyan", "R2": "green", "R3": "purple"}
summary = {}
tmp = Path(tempfile.mkdtemp())
for tier, cls, task_dir in tiers:
    cfg = cls.defaults
    layout = ThreadingLayout(**(PRESETS["rope_threading"]["geometry"] | cfg["geometry"]))
    folder = base / tier
    rings = layout.rings()
    required = dict(layout.required_crossings())
    rope = layout.centerline()
    r = layout.radius
    report = inspect_geometry(layout)
    ring_records = []
    rot = Rotation.from_euler("z", layout.yaw_deg, degrees=True).as_matrix()
    for ring in rings:
        name = ring["name"]
        mesh = ring_mesh(ring, layout.ring_radial_segments)
        p = mesh_obj(folder / f"{name}.obj", mesh, f"{name} ({COLOR_NAMES[name]}) ring tube, {ring['shape']}")
        man.add(p, f"{tier}: rigid fixed ring {name} ({COLOR_NAMES[name]}), torus R={ring['radius_m']} m tube r={ring['tube_radius_m']} m"
                + (" (lower half only, capped: open cradle)" if ring["shape"] != "closed" else ""), tier=tier)
        parts = {}
        for kind in ("stand", "base"):
            geom = ring[kind]
            if kind == "stand":
                support = trimesh.creation.capsule(height=2 * geom["size"][1], radius=geom["size"][0], count=[16, 16])
                support.apply_translation(-support.bounds.mean(axis=0))
            else:
                support = trimesh.creation.box(extents=2 * np.asarray(geom["size"]))
            m = np.eye(4); m[:3, :3] = rot
            support.apply_transform(m)
            center = layout.transform(geom["position"])
            support.apply_translation(center)
            p = mesh_obj(folder / f"{name}_{kind}.obj", support, f"{name} {kind}")
            man.add(p, f"{tier}: rigid fixed {name} {kind} ("
                    + ("vertical capsule radius %.3f m, half-length %.4f m" % tuple(geom["size"][:2]) if kind == "stand"
                       else "box half-extents %s m" % geom["size"]) + ")", tier=tier)
            parts[kind] = dict(center_m=r6(center), size_m=geom["size"],
                               primitive="capsule along z: [radius, half_length_of_cylinder]" if kind == "stand"
                               else "box: half extents")
        aperture = ring["radius_m"] - ring["tube_radius_m"]
        ring_records.append(dict(name=name, color=COLOR_NAMES[name], rgba=ring["rgba"], shape=ring["shape"],
            center_m=r6(ring["center_m"]), normal=r6(ring["normal"]), basis_u=r6(ring["basis_u"]),
            basis_v=r6(ring["basis_v"]), centerline_radius_m=ring["radius_m"], tube_radius_m=ring["tube_radius_m"],
            aperture_radius_m=aperture, aperture_minus_rope_radius_m=aperture - r,
            grader_disk_radius_m=aperture - r - cfg["terminal"].get("aperture_margin_m", .0001),
            required_crossing_sign=required.get(name), stand=parts["stand"], base=parts["base"]))
    rec = centerline_record(rope, r, kind="rope centerline (authored spawn: planar semicircle on the table)",
        source="ThreadingLayout.centerline() topogym/assets/geometry/rope_threading.py:76-105 + packaged rope_threading_reference.json",
        browser_spacing=r, extra=dict(free_ends="both ends free", rest_shape="straight",
                                      initial_ring_crossings=report["initial_crossings"]))
    p = write_json(folder / "rope_centerline_authored.json", rec)
    man.add(p, f"{tier}: authored rope centerline, radius {r} m, both ends free", tier=tier, count=rec["count"], length_m=rec["length_m"])
    info = dict(tier=tier, variation_id=cls.variation_id, ring_ids=[x["name"] for x in rings], ring_shape=layout.ring_shape,
                rope_radius_m=r, rope_length_m=rec["length_m"],
                ring_aperture_radius_m={x["name"]: x["aperture_radius_m"] for x in ring_records},
                required_order=[f"{k}{'+' if v > 0 else '-'}" for k, v in layout.required_crossings()],
                instruction=getattr(cls, "instruction", None), terminal=cfg["terminal"],
                terminal_revision=cls.terminal_revision)
    if task_dir:
        inst, ipath = load_instance(task_dir)
        assert inst["variation_id"] == cls.variation_id
        vol = write_rope_volume(tmp / f"rt_{tier}.npz", rope, r)
        world = np.asarray(inst["soft_state"]["rope"]["position_m"])
        center_w, n_total, s = fem_ring_centerline(world, vol)
        center = to_task(center_w)
        hits = route_crossings(center, rings, r)
        # verify that the rigid rings in the instance sit where the generator says
        for ring in rings:
            o = inst["objects"][ring["name"]]
            v = to_task(pose_vertices(ring_mesh(ring, layout.ring_radial_segments).vertices, o) )
            b = to_task(np.asarray(o["bounds"]))
            assert np.allclose([v.min(0), v.max(0)], b, atol=2e-5), (ring["name"], v.min(0), v.max(0), b)
        rec2 = centerline_record(center, r, kind="rope centerline after the instance's IPC settling",
            source=f"{ipath.relative_to('/WT')}: soft_state.rope.position_m -> FEM surface ring centroids",
            browser_spacing=r, extra=dict(fem_vertices=len(world), settled_ring_crossings=hits,
                                          material_s_m=r6(s)))
        p = write_json(folder / "rope_centerline_settled.json", rec2)
        man.add(p, f"{tier}: settled initial rope centerline from the frozen Harbor instance", tier=tier,
                count=rec2["count"], length_m=rec2["length_m"])
        info.update(settled_length_m=rec2["length_m"], settled_crossings=len(hits),
                    settled_z_range_m=[float(center[:, 2].min()), float(center[:, 2].max())])
    write_json(folder / "rings.json", dict(frame=FRAME, rings=ring_records, rope_radius_m=r,
        crossing_sign_convention=("+1 when the rope, walked in increasing material coordinate (index order of the centerline), "
                                  "crosses the ring plane from the side opposite the normal to the side the normal points to; -1 otherwise"),
        required_material_order=info["required_order"]))
    man.add(folder / "rings.json", f"{tier}: ring/stand/base parameters, aperture radii and required crossing signs", tier=tier)
    summary[tier] = info
write_json(base / "summary.json", summary)
man.add(base / "summary.json", "per-tier numbers")
man.save()
print(json.dumps(summary, indent=1))
