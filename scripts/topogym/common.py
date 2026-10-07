"""Shared export helpers (run inside the TopoGym image; /WT is the read-only checkout).

World frame for every export ("task frame"): Genesis world x/y, z measured from
the tabletop surface (Genesis world z - 0.9196429). Metres, z up, right-handed.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, "/WT")

TABLE_Z = 0.9196429            # topogym/config/profiles/env_configs/world_tabletop_v1.yaml frames.table_surface
TABLE_POS = (-0.1356786, 0.0, 0.45982145)
TABLE_SIZE = (1.5, 1.4, 0.9196429)
OUT = Path("/out")
TASKS = Path("/WT/tasks")
FRAME = ("task frame: Genesis world x/y, z = world_z - 0.9196429 (tabletop surface at z=0); "
         "metres; z up; right-handed")


def to_task(points):
    p = np.asarray(points, dtype=float).copy()
    p[..., 2] -= TABLE_Z
    return p


def write_obj(path, vertices, faces, uv=None, header=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    v = np.asarray(vertices, dtype=float)
    f = np.asarray(faces, dtype=np.int64)
    lines = [f"# {header or path.stem}", f"# {FRAME}", f"# vertices {len(v)} faces {len(f)}"]
    lines += [f"v {a:.7f} {b:.7f} {c:.7f}" for a, b, c in v]
    if uv is not None:
        lines += [f"vt {a:.7f} {b:.7f}" for a, b in np.asarray(uv, dtype=float)]
        lines += [f"f {a+1}/{a+1} {b+1}/{b+1} {c+1}/{c+1}" for a, b, c in f]
    else:
        lines += [f"f {a+1} {b+1} {c+1}" for a, b, c in f]
    path.write_text("\n".join(lines) + "\n")
    return path


def mesh_obj(path, mesh, header=None):
    return write_obj(path, mesh.vertices, mesh.faces, header=header)


def arclength(points):
    p = np.asarray(points, dtype=float)
    return np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]


def resample(points, spacing):
    p = np.asarray(points, dtype=float)
    s = arclength(p)
    n = max(2, int(np.ceil(s[-1] / spacing)) + 1)
    q = np.linspace(0.0, s[-1], n)
    return np.column_stack([np.interp(q, s, p[:, i]) for i in range(3)])


def r6(a):
    return np.round(np.asarray(a, dtype=float), 6).tolist()


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1) + "\n")
    return path


def centerline_record(points, radius, *, kind, source, browser_spacing=None, extra=None):
    p = np.asarray(points, dtype=float)
    s = arclength(p)
    rec = dict(frame=FRAME, kind=kind, source=source, radius_m=float(radius),
               length_m=float(s[-1]), count=len(p),
               mean_spacing_m=float(s[-1] / max(1, len(p) - 1)),
               order="index 0 = material start (s=0); material coordinate increases with index",
               bounds_m=[r6(p.min(0)), r6(p.max(0))], points_m=r6(p))
    if browser_spacing:
        b = resample(p, browser_spacing)
        rec["browser_spacing_m"] = float(browser_spacing)
        rec["browser_count"] = len(b)
        rec["browser_points_m"] = r6(b)
    if extra:
        rec.update(extra)
    return rec


def load_instance(task_dir):
    path = TASKS / task_dir / "environment" / "sim" / "instance.json"
    with open(path) as fh:
        return json.load(fh), path


def body_transform(obj):
    """Rigid body pose from instance.json objects[name] (world frame)."""
    from scipy.spatial.transform import Rotation
    q = np.asarray(obj["orientation_wxyz"], dtype=float)
    rot = Rotation.from_quat(q[[1, 2, 3, 0]])
    return rot, np.asarray(obj["position"], dtype=float)


def pose_vertices(vertices_local, obj):
    rot, pos = body_transform(obj)
    return rot.apply(np.asarray(vertices_local, dtype=float)) + pos


def fem_ring_centerline(positions_world, volume_npz):
    """Centroid of each authored surface ring (TetGen keeps them as the first vertices)."""
    with np.load(volume_npz, allow_pickle=False) as v:
        rings = v["surface_ring_indices"]
        n_total = len(v["rest"])
        s = v["material_s_m"][rings[:, 0]]
    p = np.asarray(positions_world, dtype=float)
    return p[rings].mean(axis=1), n_total, s


def table_box():
    import trimesh
    box = trimesh.creation.box(extents=TABLE_SIZE)
    box.apply_translation([TABLE_POS[0], TABLE_POS[1], TABLE_POS[2] - TABLE_Z])
    return box


class Manifest:
    def __init__(self, puzzle):
        self.puzzle = puzzle
        self.entries = []

    def add(self, path, meaning, **extra):
        rel = str(Path(path).relative_to(OUT))
        self.entries.append(dict(file=rel, meaning=meaning, **extra))

    def save(self, notes=None):
        write_json(OUT / "manifest_parts" / f"{self.puzzle}.json",
                   dict(puzzle=self.puzzle, notes=notes or {}, files=self.entries))
