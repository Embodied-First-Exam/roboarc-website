"""Export horseshoe_ring / lock_picking / buzz_wire_3d (easy, medium, hard) for the browser.

Runs inside the TopoGym image (repo mounted read-only at /WT). Every body is exported as an OBJ
in one common puzzle frame at the task's INITIAL state (metres, z-up):
    local = world - world_offset_m,  world_offset_m = [puzzle anchor x, anchor y, table-top z].
Meshes come from the generators the tasks themselves call (Task.declare), posed with the
EntitySpec poses the simulator spawns. Nothing in /WT is written.
"""
import sys, json, math, xml.etree.ElementTree as ET
from pathlib import Path
import numpy as np, trimesh
from scipy.spatial.transform import Rotation

sys.path.insert(0, '/WT')
from topogym.config.registry import task_definition

TABLE = 0.91964                     # table-top z of the lab scene (instance.json bounds)
OUT, WORK = Path('/out'), Path('/out/work')
INSTANCE = '/WT/tasks/topogym-{t}-{tier}-i00-privileged/tests/instance.json'
TIERS = ('easy', 'medium', 'hard')


def rot(q_wxyz):
    q = np.asarray(q_wxyz, float)
    return Rotation.from_quat([q[1], q[2], q[3], q[0]])


def wxyz(r):
    x, y, z, w = r.as_quat()
    return [float(w), float(x), float(y), float(z)]


def clean(V, F):
    m = trimesh.Trimesh(np.asarray(V, float), np.asarray(F, np.int64), process=True)
    return m


def load_visual(path):
    m = trimesh.load(path, force='mesh', process=False)
    return np.asarray(m.vertices, float), np.asarray(m.faces, np.int64)


def urdf_visual(urdf):
    root = ET.parse(urdf).getroot()
    names = [n.get('filename') for n in root.findall('.//visual/geometry/mesh')]
    if len(names) != 1:
        raise ValueError(f'{urdf}: expected one visual mesh, got {names}')
    p = Path(names[0])
    return p if p.is_absolute() else Path(urdf).parent / p


def rnd(a, n=6):
    return [round(float(x), n) for x in np.asarray(a).ravel()]


class Writer:
    def __init__(self, folder, offset):
        self.folder, self.offset = Path(folder), np.asarray(offset, float)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.records, self.scene = [], trimesh.Scene()

    def add(self, name, V_world, F, role, sim_role, pose=None, **extra):
        mesh = clean(np.asarray(V_world) - self.offset, F)
        mesh.export(self.folder / f'{name}.obj', digits=7)
        self.scene.add_geometry(mesh.copy(), node_name=name, geom_name=name)
        rec = dict(name=name, file=f'{name}.obj', role=role, sim_role=sim_role,
                   triangles=int(len(mesh.faces)), vertices=int(len(mesh.vertices)),
                   watertight=bool(mesh.is_watertight),
                   bbox_min=rnd(mesh.bounds[0]), bbox_max=rnd(mesh.bounds[1]),
                   size=rnd(mesh.bounds[1] - mesh.bounds[0]))
        if pose is not None:
            p, q = pose
            rec['link_pose'] = dict(position=rnd(np.asarray(p) - self.offset), quaternion_wxyz=rnd(q, 8),
                                    note='body link frame in the puzzle frame; mesh = R*local+position')
        rec.update(extra)
        self.records.append(rec)
        return mesh

    def finish(self, meta):
        self.scene.export(self.folder / 'assembly.glb')
        meta = dict(meta, bodies=self.records)
        (self.folder / 'bodies.json').write_text(json.dumps(meta, indent=1))
        return meta


# ---------------------------------------------------------------- horseshoe_ring
def horseshoe(tier):
    vid = f'horseshoe_ring_{tier}'
    task = task_definition('horseshoe_ring', vid, 0)(None, seed=0)
    spec = task.declare(WORK / vid, TABLE)
    ents = {e.name: e for e in spec.entities}
    cx, cy = task.config['center_xy_m']
    offset = np.array([cx, cy, TABLE])
    w = Writer(OUT / 'horseshoe_ring' / tier, offset)
    world_pose = {}
    for body in task.assembly.bodies:
        e = ents[body.name]
        R, p = rot(e.quaternion_wxyz), np.asarray(e.position_m, float)
        world_pose[body.name] = (R, p)
        # check the generated GLB is the same COM-centred mesh the task uses
        gv, _ = load_visual(WORK / vid / body.name / f'{body.name}.glb')
        dev = float(np.abs(np.sort(gv, axis=0) - np.sort(task.local_vertices[body.name], axis=0)).max())
        V = R.apply(task.local_vertices[body.name]) + p
        role = 'move' if body.name == 'target_ring' else 'fixed'
        w.add(body.name, V, body.visual.faces, role, 'free rigid body (no joints)', pose=(p, e.quaternion_wxyz),
              com_template_frame=rnd(task.body_origins[body.name]), glb_check_max_dev_m=dev)
    loops = {}
    for name, loop in task.assembly.loops.items():
        R, p = world_pose[loop.body]
        c = R.apply(loop.center - task.body_origins[loop.body]) + p - offset
        Rl = R * loop.rotation
        loops[name] = dict(body=loop.body, center=rnd(c), rotation_matrix=rnd(Rl.as_matrix(), 8),
                           radii_m=rnd(loop.radii), wire_radius_m=round(float(loop.wire_radius), 6),
                           collision_segments=int(loop.segments),
                           note='planar ellipse x=a cos t, y=b sin t, z=0 in the loop frame; world = R*p + center')
    # placement goal: replicate choose_region numbers, check against instance.json
    inst = json.loads(Path(INSTANCE.format(t='horseshoe-ring', tier=tier)).read_text())
    gb = np.asarray(inst['objects']['goal_region']['bounds'])
    ring_pts = rot(ents['target_ring'].quaternion_wxyz).apply(task.placement_vertices['target_ring']) + ents['target_ring'].position_m
    rigid = float(np.linalg.norm(np.ptp(ring_pts, axis=0)))
    half = max(.10, rigid/2 + .015)
    height = max(.15, rigid + .02)
    rem = np.vstack([rot(ents[n].quaternion_wxyz).apply(task.placement_vertices[n]) + ents[n].position_m
                     for n in task.placement_remainder])
    sep_y_world = float(rem[:, 1].min() - .005)
    center_world = (gb[0, :2] + gb[1, :2]) / 2
    goal = dict(center_xy=rnd(center_world - offset[:2]), half_size_m=round(half, 6),
                containment_half_m=round(half - .001, 6), placement_height_m=round(height, 6),
                marker_bounds_half_m=rnd((gb[1, :2] - gb[0, :2]) / 2),
                separator=dict(normal_xy=[0, -1], plane_y_local=round(sep_y_world - cy, 6),
                               rule='every remainder vertex (horseshoes, chain links) must keep y >= plane_y_local'),
                ring_rule='every ring vertex: |x-cx|<=containment_half, |y-cy|<=containment_half, '
                          '-0.001 <= z <= placement_height (table top z=0); ring speed <=1 mm/s, <=0.02 rad/s for 0.5 s',
                source='topogym/tasks/placement.py:11-61, utils/geometry/regions.py:53-62')
    meta = dict(puzzle='horseshoe_ring', tier=tier, variation_id=vid, family_id=task.family_id,
                template_resource=task.template_resource, layout_resource=task.layout_resource,
                frame='z-up metres; local = world - world_offset_m; table top at z=0',
                world_offset_m=rnd(offset), loops=loops,
                chain_edges=[list(e) for e in task.assembly.edges], goal=goal,
                template=task.assembly.template)
    return w.finish(meta)


# ---------------------------------------------------------------- lock_picking
def lock(tier):
    vid = f'lock_picking_{tier}'
    task = task_definition('lock_picking', vid, 0)(None, seed=0)
    folder = WORK / vid
    spec = task.declare(folder, TABLE)
    g = task.layout
    offset = np.array([g.first_x, g.center_y, TABLE])
    w = Writer(OUT / 'lock_picking' / tier, offset)
    stops = task.config['rotor_stops']
    for e in spec.entities:
        p = np.asarray(e.position_m, float)
        R = rot(e.quaternion_wxyz)
        if e.morph_type == 'box':
            m = trimesh.creation.box(extents=e.morph_options['size'])
            V, F = R.apply(m.vertices) + p, m.faces
        elif e.morph_type == 'mesh':
            V, F = load_visual(e.asset_path)
            V = R.apply(V) + p
        else:
            V, F = load_visual(urdf_visual(e.asset_path))
            if e.initial_joint_positions:
                th = float(e.initial_joint_positions['disc_hinge'])
                V = Rotation.from_rotvec([-th, 0, 0]).apply(V)       # joint axis is -x
            V = R.apply(V) + p
        extra = {}
        if e.name.startswith('lock_disc_'):
            i = int(e.name[-1])
            lo, hi = map(float, stops[i]['bounds_deg'])
            role = 'articulated-part'
            extra = dict(joint=dict(type='continuous' if hi - lo >= 360 - 1e-9 else 'revolute',
                                    origin=rnd(p - offset), axis=[-1, 0, 0],
                                    lower_deg=lo, upper_deg=hi, initial_deg=float(g.initial_disc_deg[i]),
                                    angle_convention='positive = rotation about -x = from +z toward +y'),
                         slots_deg=list(map(float, g.slots[i])), stop_style=stops[i].get('style'),
                         ear_phase_deg=float(stops[i].get('ear_phase_deg', -35)))
        elif e.name == 'lock_key':
            role = 'move'
            key_pose = p.copy()
        else:
            role = 'fixed'
        w.add(e.name, V, F, role, 'fixed' if e.fixed and not e.name.startswith('lock_disc_') else
              ('revolute rotor (passive, driven by key tabs)' if e.name.startswith('lock_disc_') else 'free rigid body'),
              pose=(p, e.quaternion_wxyz), **extra)
    tabs = [-i * g.pitch for i in range(g.tab_count)]
    kin = dict(
        axis=dict(origin=[0.0, 0.0, round(g.axis_z - TABLE, 6)], direction=[1, 0, 0],
                  note='all plates coaxial on the line y=0, z=axis_z (local); key inserts toward +x'),
        angle_convention='plate/key angle a = atan2(y, z) about the axis (from +z toward +y, i.e. right-hand about -x). '
                         'A slot at plate-local angle s on a rotor at joint angle th is at a+th. Key angle = '
                         'atan2(R*[0,0,1].y, R*[0,0,1].z) (common.py:230-231).',
        plates=[dict(name=f'lock_disc_{i}', x=round(g.disc_x(i) - g.first_x, 6), thickness=g.disc_thickness,
                     outer_radius=g.disc_radius, bore_radius=g.bore_radius, slot_radius=g.slot_radius,
                     slot_half_deg=g.slot_half_deg, slots_deg=list(map(float, g.slots[i])),
                     stop_deg=list(map(float, stops[i]['bounds_deg'])), initial_deg=float(g.initial_disc_deg[i]),
                     joint='continuous' if stops[i]['bounds_deg'][1]-stops[i]['bounds_deg'][0] >= 360 else 'revolute')
                for i in range(g.disc_count)]
               + [dict(name='lock_goal', x=round(g.disc_x(g.disc_count) - g.first_x, 6), thickness=g.disc_thickness,
                       outer_radius=g.disc_radius, outer_shape='rounded square (half 0.08, corner r 0.012)',
                       bore_radius=g.bore_radius, slot_radius=g.slot_radius, slot_half_deg=g.slot_half_deg,
                       slots_deg=[float(g.endpoint_deg)], joint='fixed')],
        key=dict(link_origin='leading tab centre on the shaft axis', tab_x=[round(t, 6) for t in tabs],
                 tab_radius=g.tab_radius, tab_half_deg=g.tab_half_deg, tab_thickness=g.tab_thickness,
                 tab_inner_radius=g.shaft_radius, tab_angle_local_deg=0.0,
                 shaft_radius=g.shaft_radius, shaft_x=[round(-g.grip_offset - .02, 6), .015],
                 handle=dict(radius=g.handle_radius, length=.035, center_x=-g.grip_offset),
                 initial_position=rnd(np.asarray(key_pose) - offset),
                 initial_position_note='resting on the V cradles: z = tray_top + sqrt(2)*shaft_radius + 1e-4; identity rotation',
                 depth_formula='depth = (key_x - x_plate0)/pitch + 1; tab k sits in plate (depth-1-k) at integer depth'),
        pitch=g.pitch, free_play_deg=g.slot_half_deg - g.tab_half_deg,
        success=dict(key_x_min=round(g.disc_x(g.disc_count) + g.disc_thickness/2 + .001 + g.tab_thickness/2 - g.first_x, 6),
                     key_x_max=round(g.disc_x(0) - g.disc_thickness/2 + g.grip_offset + .02 - g.first_x, 6),
                     rule='key coaxial (shaft within every bore, radial tol 0.01 mm), rear face of leading tab >= END outer '
                          'face + 1 mm, all 8 plate faces inside the shaft length, no tab overlapping a plate outside a slot '
                          '(margin >= asin(offset/36mm)+tilt), every limited rotor within its stop +-0.5 deg, held 0.5 s',
                     source='topogym/tasks/lock_picking/common.py:207-287'),
    )
    meta = dict(puzzle='lock_picking', tier=tier, variation_id=vid, family_id=task.family_id,
                frame='z-up metres; local = world - world_offset_m; table top z=0; x=0 at rotor 0',
                world_offset_m=rnd(offset), geometry=json.loads(json.dumps(g.__dict__, default=list)),
                rotor_stops=stops, kinematics=kin)
    return w.finish(meta)


# ---------------------------------------------------------------- buzz_wire_3d
def buzz(tier):
    from topogym.assets.geometry.buzz_wire_3d import endpoint_pose, tube_mesh, capsule_mesh
    vid = f'buzz_wire_3d_{tier}'
    task = task_definition('buzz_wire_3d', vid, 0)(None, seed=0)
    folder = WORK / vid
    spec = task.declare(folder, TABLE)
    L, route = task.layout, task.route
    ents = {e.name: e for e in spec.entities}
    origin = np.asarray(task.origin, float)                         # [center_xy, table]
    w = Writer(OUT / 'buzz_wire_3d' / tier, origin)
    # base (deck, feet): the generator's visual GLB = its collision tiers + feet boxes
    e = ents['wire_base']
    V, F = load_visual(urdf_visual(e.asset_path))
    w.add('wire_base', rot(e.quaternion_wxyz).apply(V) + e.position_m, F, 'fixed', 'fixed (finish support = deck)',
          pose=(e.position_m, e.quaternion_wxyz))
    # wire: smooth rail tube from the generator's own tube_mesh + the two block mounts
    rail = route.rail
    sides = 12
    keep = np.arange(len(rail))
    tube = tube_mesh(rail[keep], L.wire_radius_m, sides=sides)
    parts = [tube]
    for a, _, _, part in route.fixed_capsules():
        if part == 'stop':
            b = trimesh.creation.box(L.mount_size_m)
            b.apply_translation(a)
            parts.append(b)
    wire = trimesh.util.concatenate(parts)
    w.add('wire', np.asarray(wire.vertices) + origin, wire.faces, 'fixed', 'fixed (metal rail = touch -> failure)',
          pose=(origin, [1, 0, 0, 0]), tube_sides=sides, rail_points=int(len(rail)),
          note='rail tube is open-ended; both ends are buried in the 8x8x12 mm mounts')
    # wand at its start pose (link origin = loop centre, loop in local xy, handle along +x)
    e = ents['wand']
    segs = L.tool_capsules()
    loop = tube_mesh(np.array([s[0] for s in segs[:-2]]), L.loop_tube_radius_m, True, 24)
    stem = capsule_mesh(*segs[-2][:3])
    a, b, _, _ = segs[-1]
    grip = trimesh.creation.box((L.grip_length_m, 2*L.grip_radius_m, 2*L.grip_half_thickness_m))
    T = np.eye(4); T[:3, :3] = Rotation.from_euler('x', L.grip_flat_roll_deg, degrees=True).as_matrix(); T[:3, 3] = (a+b)/2
    grip.apply_transform(T)
    wand = trimesh.util.concatenate([loop, stem, grip])
    Rw = rot(e.quaternion_wxyz)
    w.add('wand', Rw.apply(wand.vertices) + e.position_m, wand.faces, 'move', 'free rigid body',
          pose=(e.position_m, e.quaternion_wxyz),
          parts=dict(loop_triangles=int(len(loop.faces)), stem_triangles=int(len(stem.faces)),
                     grip_triangles=int(len(grip.faces))))
    # route + kinematic description
    fin_p, fin_r = endpoint_pose(route, 1)
    st_p, st_r = endpoint_pose(route, 0)
    arc = np.r_[0., np.cumsum(np.linalg.norm(np.diff(rail, axis=0), axis=1))]
    step = max(1, int(round(.002 / L.witness_step_m)))           # ~2 mm reference sampling
    idx = np.unique(np.r_[np.arange(0, len(route.progress), step), len(route.progress)-1])
    q_ref = route.rotations.as_quat()[:, [3, 0, 1, 2]]
    deck_top = L.base_elevation_m + L.base_size_m[2]
    info = dict(
        rail_points_local=[rnd(p, 6) for p in (rail + origin - origin)],
        rail_arc_length_m=round(float(arc[-1]), 6), rail_segment_m=L.rail_segment_m,
        wire_radius_m=L.wire_radius_m,
        loop=dict(radius_m=L.loop_radius_m, tube_radius_m=L.loop_tube_radius_m, segments=L.loop_segments,
                  inner_radius_m=round(L.loop_radius_m - L.loop_tube_radius_m, 6),
                  usable_aperture_m=round(L.loop_radius_m - L.loop_tube_radius_m - L.wire_radius_m, 6),
                  frame='wand link: loop centred at origin in the local xy plane, normal = local +z'),
        stem=dict(from_x=L.loop_radius_m, to_x=L.loop_radius_m + L.stem_length_m, radius_m=L.loop_tube_radius_m),
        grip=dict(shape=L.grip_shape, center_x=round(L.loop_radius_m + L.stem_length_m + L.grip_length_m/2, 6),
                  size_m=rnd([L.grip_length_m, 2*L.grip_radius_m, 2*L.grip_half_thickness_m]),
                  roll_deg=L.grip_flat_roll_deg, contact_role='wand_handle (touching wire is NOT a failure)'),
        metal_parts='loop + stem (contact role wand_metal); touching wire_metal -> failure',
        mounts=dict(size_m=rnd(L.mount_size_m),
                    centers_local=[rnd(a) for a, _, _, part in route.fixed_capsules() if part == 'stop'],
                    role='wood_stop (contact allowed)'),
        deck_top_z_local=round(deck_top, 6), base_size_m=rnd(L.base_size_m), base_elevation_m=L.base_elevation_m,
        start_pose=dict(position=rnd(st_p), quaternion_wxyz=rnd(st_r.as_quat()[[3, 0, 1, 2]], 8)),
        finish_pose=dict(position=rnd(fin_p), quaternion_wxyz=rnd(fin_r.as_quat()[[3, 0, 1, 2]], 8),
                         equivalent='also accepted rotated 180 deg about the wand local x (handle) axis',
                         tolerance=dict(position_m=.005, angle_deg=10.)),
        sections=route.sections,
        reference_wand_path=dict(note='generator witness poses of the wand (loop centre) along the playable '
                                      'route (progress 0..1, end reserves excluded); oracle guide, no physics claim',
                                 progress=rnd(route.progress[idx], 6),
                                 positions=[rnd(p) for p in route.positions[idx]],
                                 quaternions_wxyz=[rnd(q, 6) for q in q_ref[idx]]),
        end_reserve_m=L.end_reserve_m, minimum_curvature_radius_m=round(route.minimum_curvature_radius, 6),
        tracking=dict(start_tolerance_m=.01, finish_tolerance_m=.01, progress_tolerance_m=.003,
                      rule='exactly one unambiguous crossing of the rail polyline through the loop disk of radius '
                           'usable_aperture (centre = wand origin, normal = wand local z); cursor = arc length of the '
                           'crossing; must start <= 0.01 m and reach >= length-0.01 m; per tick |jump| <= '
                           '2*(|dp| + aperture*|dtheta|) + 0.003 m', source='topogym/tasks/buzz_wire_3d/common.py:186-260'),
    )
    (w.folder / 'route.json').write_text(json.dumps(info))
    meta = dict(puzzle='buzz_wire_3d', tier=tier, variation_id=vid, family_id=task.family_id,
                layout_resource=task.layout_resource,
                frame='z-up metres; local = world - world_offset_m; table top z=0 (base centre at x=y=0)',
                world_offset_m=rnd(origin), route_file='route.json',
                layout={k: v for k, v in task.layout.__dict__.items()
                        if k not in ('authored_controls_m', 'orientation_knots_wxyz', 'center_offset_knots_m')})
    return w.finish(meta)


if __name__ == '__main__':
    which = sys.argv[1:] or ['horseshoe', 'lock', 'buzz']
    summary = {}
    for name in which:
        fn = dict(horseshoe=horseshoe, lock=lock, buzz=buzz)[name]
        for tier in TIERS:
            meta = fn(tier)
            summary[f'{name}/{tier}'] = [(b['name'], b['role'], b['triangles'], b['watertight'], b['size'])
                                         for b in meta['bodies']]
            print('==', name, tier, flush=True)
            for row in summary[f'{name}/{tier}']:
                print('   ', row, flush=True)
