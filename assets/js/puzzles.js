// The puzzles of the play section: rigid TopoGym puzzles on the oracle's exact geometry and motion, each with the oracle's
// whole run to watch (scripts/export_oracle_poses.py), the lock (scripts/export_rigid.py), two oracle runs to watch only,
// and the rope puzzles with scripted demonstrations (scripts/export_soft.py); assets/data/puzzles/<id>/<tier>/:
// puzzle.json + .bin files, y-up, metres. Each rope puzzle also says when it is solved, following its TopoGym grader.
import * as THREE from 'three';
import { Rope, RopeTube } from './rope.js';

const BASE = new URL('../data/puzzles/', import.meta.url);

export const PLAY_GROUPS = [['rigid', 'Rigid'], ['precision', 'Precision'], ['rope', 'Rope'], ['soft', 'Fiber']];
export const PLAY_PUZZLES = [
  { id: 'interlocked_claws', group: 'rigid', name: 'Interlocked Claws', tiers: ['easy', 'medium', 'hard'], mover: 'orange claw', goal: 'Get the orange claw off the other one.',
    demoText: 'That was the oracle\'s solution, replayed from the simulation with the steel claw held still. Reset and find your own.',
    demoTextShortened: 'That was the oracle\'s solution from the simulation, with the steel claw held still and its long detours cut: each straight move was checked against the exact pieces. Reset and find your own.' },
  { id: 'cast_keyhole', group: 'rigid', name: 'Cast Keyhole', tiers: ['easy', 'medium', 'hard'], mover: 'orange piece', goal: 'Slide the orange piece out of the other one.',
    demoText: 'That was the oracle\'s solution, replayed from the simulation with the gold piece held still. Reset and find your own.' },
  { id: 'cast_coil', group: 'rigid', name: 'Cast Coil', tiers: ['easy', 'medium', 'hard'], mover: 'orange half', goal: 'Fit the orange half into the gold one until the two interlock.',
    from: 'Apart', to: 'Together', demoTitle: 'One way in', demoText: 'That was the oracle\'s solution, replayed from the simulation with the gold half held still. Reset and find your own.' },
  { id: 'hedgehog_in_cage', group: 'rigid', name: 'Hedgehog in a Cage', tiers: ['easy', 'medium', 'hard'], mover: 'spiky ball', goal: 'Get the orange spiky ball out of the cage.', from: 'Caged', to: 'Free',
    demoText: 'That was the oracle\'s solution, replayed from the simulation. Reset and find your own.' },
  { id: 'horseshoe_ring', group: 'rigid', name: 'Horseshoe Ring', tiers: ['easy', 'medium', 'hard'], watchOnly: true, goal: 'Take the ring off the two horseshoes joined by chain links.',
    from: 'Start', to: 'End', demoTips: ['The oracle\'s run from the simulation, every piece where the simulator had it: the robot is hidden and its pauses are left out.', 'Only the ring has to come off. The horseshoes and the chain links are free to swing and fold.', 'Drag the background to rotate the view. Scroll to zoom.'] },
  { id: 'buzz_wire_3d', group: 'precision', name: 'Buzz Wire 3D', tiers: ['easy', 'medium', 'hard'], mover: 'wand', demoText: 'That was the oracle\'s run along the wire, replayed from the simulation. Reset and steer it yourself.', goal: 'Guide the loop along the whole wire, from one end to the other.',
    from: 'Start', to: 'Finish', tips: ['Drag an arrow to move the wand, a ring to turn it. The loop stops wherever it would touch the wire.', 'Zoom in close and turn the loop to follow the bends.', 'Drag the background to rotate the view.'] },
  { id: 'lock_picking', group: 'precision', name: 'Lock Picking', tiers: ['easy', 'medium', 'hard'], mover: 'key', goal: 'Push the key all the way through the three rotor plates and the end plate.',
    from: 'Out', to: 'Through', demoText: 'That was the oracle\'s key motion from the simulation, played through this page\'s lock rules: ratchet strokes on the first rotor, then straight through. Reset and find your own.',
    tips: ['The key only slides along the lock and turns about it. Its tabs pass a plate only through a slot.', 'Turning with a tab inside a rotor drags the rotor with it, up to the rotor\'s stop.', 'Drag the background to rotate the view.'] },
  { id: 'knot_untying', group: 'rope', name: 'Knot Untying', tiers: ['easy', 'medium', 'hard'], goal: 'Untie the knot and lay the rope flat, crossing itself nowhere.',
    from: 'Knotted', to: 'Untied', demoTips: ['A scripted solution, played live in the rope simulation: draw a loop along the rope, pull the ends apart, carry the last strand over an end.', 'Seen from above, the rope crosses itself 3, 2, 1, then 0 times.', 'Drag the background to rotate the view.'], tips: ['Press on the rope and pull. Lift a strand to carry it over another.', 'Solved once, seen from above, the rope crosses itself nowhere and lies flat and still.', 'Drag the background to rotate the view. Scroll to zoom.'],
    check: (rope, pz) => untie(rope, pz.goal) },
  { id: 'rope_threading', group: 'rope', name: 'Rope Threading', tiers: ['easy', 'medium', 'hard'], goal: 'Thread the rope through the rings in order: cyan, then green, then purple.',
    from: 'Loose', to: 'Threaded', tip: '#b8322c', frame: { span: 0.3 }, demoTips: ['A scripted solution, played live in the rope simulation: the red-tipped end goes through the cyan ring against its facing, then the green and the purple with theirs.', 'The rope cannot pass through the rings or their stands.', 'Drag the background to rotate the view.'],
    tips: ['Lead with the red-tipped end: press on it and pull it up to the rings.', 'Through the cyan ring first, then the green, then the purple, each time following the way the rope is already going.', 'Drag the background to rotate the view. Scroll to zoom.'],
    check: (rope, pz) => thread(rope, pz.goal) },
  { id: 'fiber_bundling', group: 'soft', name: 'Fiber Bundling', tiers: ['easy', 'medium', 'hard'], watchOnly: true, goal: 'Pass the sheath and every fiber through the copper ring while the cable stays anchored.',
    from: 'Start', to: 'End', demoTips: ['The oracle\'s run from the simulation. The cable and its fibers are chains of short rigid segments, each shown where the simulator had it; the robot is hidden and its pauses are left out.', 'The sheath and all the fibers have to end up through the copper ring.', 'Drag the background to rotate the view. Scroll to zoom.'] },
];

// ---- goals, after the TopoGym graders ----
function speed(sim) {                 // fastest point, m/s, over the last sub-step
  let v = 0;
  for (let i = 0; i < sim.x.length; i += 3) v = Math.max(v, Math.hypot(sim.x[i] - sim.p[i], sim.x[i + 1] - sim.p[i + 1], sim.x[i + 2] - sim.p[i + 2]));
  return sim.h ? v / sim.h : 0;
}
function untie(rope, g) {
  const crossings = rope.crossings();
  let flat = true;
  for (let i = 1; i < rope.x.length; i += 3) if (rope.x[i] > g.maxHeight) { flat = false; break; }
  const clear = crossings === 0 && planarClear(rope, g.clearance, g.apart);
  const still = rope.held < 0 && speed(rope) < 0.01;
  return { progress: Math.min(clear && flat ? 1 : 0.9, 1 - crossings / Math.max(1, g.crossings)), solved: clear && flat && still };
}
function planarClear(rope, clearance, apart) {   // strands further apart along the rope than `apart` keep `clearance` on the table
  const x = rope.x, n = rope.n, gap = Math.ceil(apart / rope.spacing), c2 = clearance * clearance;
  for (let i = 0; i < n; i++) for (let j = i + gap; j < n; j++) {
    const dx = x[3 * j] - x[3 * i], dz = x[3 * j + 2] - x[3 * i + 2];
    if (dx * dx + dz * dz < c2) return false;
  }
  return true;
}
function thread(rope, g) {
  const seq = rope.passages(g.rings).map((p) => `${p.ring}${p.sign > 0 ? '+' : '-'}`);
  let k = 0;
  while (k < g.order.length && seq[k] === g.order[k]) k++;
  return { progress: k / g.order.length, solved: k === g.order.length && seq.length === g.order.length };
}

function materialFor(name) {
  if (/gold|brass|hedgehog/.test(name)) return 'brass';
  if (/cage/.test(name)) return 'iron';
  return 'steel';
}

async function get(url, tries = 3) {           // a small local server can drop a request under a burst; try again
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r;
    } catch (err) {
      if (k >= tries) throw err;
      await new Promise((ok) => setTimeout(ok, 300 * k));
    }
  }
}

async function fetchBin(dir, rec, count) {     // `count` float32 arrays of rec.vertices x 3, then the indices
  const buf = await (await get(new URL(`${dir}/${rec.url}`, BASE))).arrayBuffer();
  const arrays = [];
  for (let k = 0; k < count; k++) arrays.push(new Float32Array(buf, k * rec.vertices * 12, rec.vertices * 3));
  const offset = count * rec.vertices * 12, n = rec.triangles * 3;
  return { arrays, index: rec.index === 'u32' ? new Uint32Array(buf, offset, n) : new Uint16Array(buf, offset, n) };
}

const cache = new Map();
/** A puzzle's files: assets/data/puzzles/<id>/<tier>/ when the puzzle lists tiers, else assets/data/puzzles/<id>/. */
export function loadPuzzle(id, tier = null) {
  const def = PLAY_PUZZLES.find((p) => p.id === id);
  tier = def?.tiers?.includes(tier) ? tier : def?.tiers ? def.tiers[0] : null;
  const dir = tier ? `${id}/${tier}` : id, key = dir;
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const meta = await (await get(new URL(`${dir}/puzzle.json`, BASE))).json();
    const bodies = await Promise.all(meta.bodies.map(async (b) => {
      const { arrays, index } = await fetchBin(dir, b, 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arrays[0], 3));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return { name: b.name, role: b.role, collide: b.collide !== false, geometry: g, material: b.material ?? materialFor(b.name), color: b.color, roughness: b.roughness, metalness: b.metalness,
        position: new THREE.Vector3(...b.position), quaternion: b.quaternion ? new THREE.Quaternion(...b.quaternion) : new THREE.Quaternion(), radius: b.radius };
    }));
    const kind = meta.kind ?? 'rigid';
    if (meta.goal?.rings) meta.goal.rings = meta.goal.rings.map((r) => ({ ...r, center: new THREE.Vector3(...r.center), normal: new THREE.Vector3(...r.normal).normalize() }));
    const path = meta.path ? { count: meta.path.count, seconds: meta.path.seconds, shortened: !!meta.path.shortened, pos: Float32Array.from(meta.path.position), quat: Float32Array.from(meta.path.quaternion_xyzw) } : null;
    const win = meta.win?.type === 'rail' ? { ...meta.win, rail: meta.win.rail.map((p) => new THREE.Vector3(...p)), finish: new THREE.Vector3(...meta.win.finish) }
      : meta.win?.type === 'reach' ? { ...meta.win, target: new THREE.Vector3(...meta.win.target), quaternion: meta.win.quaternion && new THREE.Quaternion(...meta.win.quaternion) }
      : meta.win;
    const frame = meta.frame ? { center: new THREE.Vector3(...meta.frame.center), span: meta.frame.span } : undefined;
    const base = { id, kind, display: new THREE.Euler(0, 0, 0), path, bodies, floor: meta.floor, goal: meta.goal, tier: tier ?? meta.tier, win, frame, lock: meta.lock, tolerance: meta.tolerance };
    if (meta.replay) {                        // the oracle's run to watch: per sample and body, position (3), quaternion xyzw (4)
      const buf = await (await get(new URL(`${dir}/${meta.replay.url}`, BASE))).arrayBuffer();
      const q = new Int16Array(buf), d = new Float32Array(q.length), lo = meta.replay.lo, hi = meta.replay.hi;
      for (let i = 0; i < q.length; i++) {      // int16 on disk: positions over the run's box, quaternions x 32767
        const c = i % 7;
        d[i] = c < 3 ? lo[c] + (q[i] + 32768) / 65535 * (hi[c] - lo[c]) : q[i] / 32767;
      }
      const f = meta.replay.frame;
      base.replay = { ...meta.replay, data: d, frame: { center: new THREE.Vector3(...f.center), span: f.span } };
    }
    if (kind === 'replay') return base;
    if (kind === 'rope') {
      const r = meta.rope, def = PLAY_PUZZLES.find((p) => p.id === id);
      const material = new THREE.MeshStandardMaterial({ color: def.tip ? 0xffffff : r.color, roughness: 0.85, vertexColors: !!def.tip });
      return { ...base, frame: def.frame,
        makeSim: (colliders) => new Rope({ points: r.points, radius: r.radius, colliders, floor: meta.floor }).settle(30),
        makeView: (rope) => new RopeTube(rope, material, 10, def.tip ? { body: r.color, tip: def.tip, length: 0.03 } : null) };
    }
    return base;
  })();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));         // a failed download can be retried
  return promise;
}
