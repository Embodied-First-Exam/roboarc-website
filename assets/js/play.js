// "Play it": a rigid puzzle in the visitor's hands, on the replay's own pieces (oracle.js). One piece moves, the others
// hold still; every move is checked against them with exact mesh intersection (three-mesh-bvh), and against the table
// top, in small sub-steps, so the piece slides up to a contact and stops there. Where the robot moved both pieces (claws, keyhole, coil), the first one
// holds still and the second moves relative to it, which is all a collision depends on. Offered only where the
// reference's own motion passes this same check (selfTest; the list is in PLAYABLE).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// per family: what solves it here. apart: the boxes around the piece and around the rest no longer overlap; reach: within a few
// millimetres and degrees of the reference's final pose; rail: along the whole path the reference took, to its end.
export const RULES = {
  interlocked_claws: { goal: 'apart', from: 'Hooked', to: 'Apart' },
  cast_keyhole: { goal: 'apart', from: 'Locked', to: 'Apart' },
  hedgehog_in_cage: { goal: 'apart', from: 'Caged', to: 'Free' },
  cast_coil: { goal: 'reach', from: 'Apart', to: 'Together' },
  lock_picking: { goal: 'reach', from: 'Out', to: 'Through' },
  buzz_wire_3d: { goal: 'rail', from: 'Start', to: 'Finish' },
};
// The tasks whose reference motion clears the check end to end (checkPath, headless Chrome, 2026-10-14), with the
// contact tolerance it needed (m): the robot slides pieces along each other, so the moving piece is checked shrunk by
// that much. Left out: claws 04/05/12, hedgehog 08, buzz 07 (still blocked at 1 mm), cast keyhole (its pieces already
// overlap at the start, on the drawn and on the simulated shapes), claws 06-10, hedgehog 06/07, horseshoe and the lock
// (more than two pieces move).
export const PLAYABLE = {
  'roboarc-interlocked-claws-01-i01': 0, 'roboarc-interlocked-claws-02-i01': 0.00025, 'roboarc-interlocked-claws-03-i01': 0,
  'roboarc-interlocked-claws-11-i01': 0,
  'roboarc-cast-coil-01-i01': 0.00025, 'roboarc-cast-coil-02-i01': 0.00025, 'roboarc-cast-coil-03-i01': 0.00025,
  'roboarc-cast-coil-04-i01': 0.00025, 'roboarc-cast-coil-05-i01': 0.00025, 'roboarc-cast-coil-06-i01': 0,
  'roboarc-cast-coil-07-i01': 0.00025, 'roboarc-cast-coil-08-i01': 0.00025,
  'roboarc-hedgehog-in-cage-01-i01': 0.00025, 'roboarc-hedgehog-in-cage-02-i01': 0.00025, 'roboarc-hedgehog-in-cage-03-i01': 0.00025,
  'roboarc-hedgehog-in-cage-04-i01': 0.0005, 'roboarc-hedgehog-in-cage-05-i01': 0.00025,
  'roboarc-buzz-wire-3d-01-i01': 0.0005, 'roboarc-buzz-wire-3d-02-i01': 0.001, 'roboarc-buzz-wire-3d-06-i01': 0.00025,
  'roboarc-buzz-wire-3d-08-i01': 0.0005, 'roboarc-buzz-wire-3d-09-i01': 0.0005, 'roboarc-buzz-wire-3d-10-i01': 0.001,
};

const ONE = new THREE.Vector3(1, 1, 1);

/** The parts' meshes merged into one geometry in `frame`'s coordinates (each part's own pose applied). */
function merge(meshes, frame) {
  const pos = [], idx = [], v = new THREE.Vector3(), inv = new THREE.Matrix4().copy(frame).invert(), m = new THREE.Matrix4();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const g = mesh.geometry, a = g.attributes.position, base = pos.length / 3;
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
    const ix = g.index;
    for (let i = 0; i < ix.count; i += 3) {
      const A = ix.getX(i), B = ix.getX(i + 1), C = ix.getX(i + 2);
      if (A !== B && B !== C && A !== C) idx.push(base + A, base + B, base + C);   // a zero-area triangle reads as a hit
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** The mesh shrunk by `d` all round (a contact tolerance): each corner moves so that every face meeting there moves
 *  inward by `d` (least squares over those faces' normals), so faces shrink at their edges too. */
export function inset(geometry, d) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const a = g.attributes.position, p = [0, 1, 2].map(() => new THREE.Vector3()), normals = [];
  for (let i = 0; i < a.count; i += 3) {
    for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(a, i + k);
    const n = new THREE.Vector3().subVectors(p[2], p[1]).cross(new THREE.Vector3().subVectors(p[0], p[1]));
    normals.push(n.lengthSq() > 1e-24 ? n.normalize() : null);
  }
  const corners = new Map();
  for (let i = 0; i < a.count; i++) {
    const key = `${Math.round(a.getX(i) * 1e6)},${Math.round(a.getY(i) * 1e6)},${Math.round(a.getZ(i) * 1e6)}`;
    if (!corners.has(key)) corners.set(key, []);
    corners.get(key).push(i);
  }
  const A = new THREE.Matrix3(), nn = new THREE.Matrix3(), b = new THREE.Vector3(), o = new THREE.Vector3();
  for (const ids of corners.values()) {
    const ns = [];
    for (const i of ids) { const n = normals[Math.floor(i / 3)]; if (n && !ns.some((q) => q.dot(n) > 0.9999)) ns.push(n); }
    if (!ns.length) continue;
    A.set(1e-9, 0, 0, 0, 1e-9, 0, 0, 0, 1e-9); b.set(0, 0, 0);
    for (const n of ns) {
      nn.set(n.x * n.x, n.x * n.y, n.x * n.z, n.y * n.x, n.y * n.y, n.y * n.z, n.z * n.x, n.z * n.y, n.z * n.z);
      for (let k = 0; k < 9; k++) A.elements[k] += nn.elements[k];
      b.addScaledVector(n, -d);
    }
    o.copy(b).applyMatrix3(A.invert());
    if (o.length() > 4 * d) o.setLength(4 * d);
    for (const i of ids) a.setXYZ(i, a.getX(i) + o.x, a.getY(i) + o.y, a.getZ(i) + o.z);
  }
  return g;
}

/** The puzzle as a game: which piece moves, what it collides with, the reference's path for it, or null. */
export function makePuzzle(replay, family) {
  const rule = RULES[family];
  if (!rule) return null;
  const { meta, root, groups } = replay;
  const partTracks = [...new Set(meta.parts.filter((p) => p.role === 'part').map((p) => p.track))];
  if (partTracks.length !== 1 && partTracks.length !== 2) return null;
  // the reference's poses of the moving groups, at every sample
  const S = meta.track.frames.length, poses = partTracks.map(() => []);
  for (let k = 0; k < S; k++) {
    replay.pose(meta.track.frames[k]);
    partTracks.forEach((t, i) => poses[i].push({ p: groups[t].position.clone(), q: groups[t].quaternion.clone() }));
  }
  let mover = 0, anchor = -1;
  if (partTracks.length === 2) {                       // the one that travels less holds still
    const travel = poses.map((ps) => ps.reduce((s, x, k) => s + (k ? x.p.distanceTo(ps[k - 1].p) : 0), 0));
    anchor = travel[0] <= travel[1] ? 0 : 1; mover = 1 - anchor;
  }
  const moverObj = groups[partTracks[mover]];
  // the path of the moving piece in the root's frame, relative to the anchor held at its first pose
  const M = new THREE.Matrix4(), A0 = new THREE.Matrix4(), Ak = new THREE.Matrix4(), Bk = new THREE.Matrix4();
  const path = poses[mover].map((x, k) => {
    if (anchor < 0) return x;
    const a = poses[anchor];
    A0.compose(a[0].p, a[0].q, ONE); Ak.compose(a[k].p, a[k].q, ONE).invert(); Bk.compose(x.p, x.q, ONE);
    M.multiplyMatrices(A0, Ak).multiply(Bk);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    M.decompose(p, q, new THREE.Vector3());
    return { p, q };
  });
  // the start: everything at the first sample
  replay.pose(0);
  root.updateMatrixWorld(true);
  const moverMeshes = [], fixedMeshes = [];
  moverObj.traverse((o) => { if (o.isMesh) moverMeshes.push(o); });
  root.traverse((o) => {
    if (!o.isMesh || moverMeshes.includes(o)) return;
    const part = o.userData.part;
    if (part && (part.role === 'fixture' || part.role === 'part')) fixedMeshes.push(o);
  });
  if (!fixedMeshes.length) return null;
  const rootM = root.matrixWorld.clone();
  const moverGeom = merge(moverMeshes, new THREE.Matrix4().multiplyMatrices(rootM, new THREE.Matrix4().compose(moverObj.position, moverObj.quaternion, ONE)));
  const fixedGeom = merge(fixedMeshes, rootM);
  // Two pieces: the robot held both up in the air, so the moving one's path relative to the other, held at its first
  // pose, can dip below the table. Lift the held piece (and so the path) until none of it does.
  const va = moverGeom.attributes.position, every = Math.max(1, Math.floor(va.count / 4000)), low = [];
  for (let i = 0; i < va.count; i += every) low.push(new THREE.Vector3().fromBufferAttribute(va, i));
  const w = new THREE.Vector3();
  const lowest = (p, q) => low.reduce((m, v) => Math.min(m, w.copy(v).applyQuaternion(q).add(p).z), Infinity);
  let lift = 0;
  if (anchor >= 0) {
    lift = Math.max(0, -Math.min(...path.map((x) => lowest(x.p, x.q))));
    if (lift) { fixedGeom.translate(0, 0, lift); path.forEach((x) => { x.p.z += lift; }); }
  }
  fixedGeom.boundsTree = new MeshBVH(fixedGeom);
  const start = { p: path[0].p.clone(), q: path[0].q.clone() };
  let proxy = moverGeom, tolerance = 0;
  if (!moverGeom.boundsTree) moverGeom.boundsTree = new MeshBVH(moverGeom);
  const T = new THREE.Matrix4();
  // the table: no point of the piece more than 2 mm below its top (the robot presses pieces into it a little)
  const collides = (p, q, g = proxy) => lowest(p, q) < -0.002 || fixedGeom.boundsTree.intersectsGeometry(g, T.compose(p, q, ONE));
  function setTolerance(d) {
    tolerance = d;
    proxy = d > 0 ? inset(moverGeom, d) : moverGeom;
    if (!proxy.boundsTree) proxy.boundsTree = new MeshBVH(proxy);
  }
  // the widest gap between the moving piece's box (posed) and the box of the rest, along any axis of the scene
  fixedGeom.computeBoundingBox(); moverGeom.computeBoundingBox();
  const fixedBox = fixedGeom.boundingBox, box = new THREE.Box3();
  function gap(p, q) {
    box.copy(moverGeom.boundingBox).applyMatrix4(T.compose(p, q, ONE));
    return Math.max(box.min.x - fixedBox.max.x, fixedBox.min.x - box.max.x, box.min.y - fixedBox.max.y, fixedBox.min.y - box.max.y,
      box.min.z - fixedBox.max.z, fixedBox.min.z - box.max.z);
  }
  const finalP = path[path.length - 1].p, finalQ = path[path.length - 1].q;
  const startGap = gap(start.p, start.q);
  const frame = fixedBox.clone().union(box.copy(moverGeom.boundingBox).applyMatrix4(T.compose(start.p, start.q, ONE)));
  const arc = path.map((x, k) => (k ? x.p.distanceTo(path[k - 1].p) : 0));
  for (let k = 1; k < arc.length; k++) arc[k] += arc[k - 1];
  let railBest = 0;
  function evaluate(p, q) {                             // progress 0..1 and whether it is solved
    if (rule.goal === 'apart') {                        // the boxes around the piece and the rest no longer overlap
      const g = gap(p, q), g0 = startGap;
      return { progress: THREE.MathUtils.clamp((g - g0) / (0.003 - g0), 0, 1), solved: g > 0.003 };
    }
    if (rule.goal === 'reach') {
      const d = p.distanceTo(finalP), d0 = start.p.distanceTo(finalP);
      return { progress: THREE.MathUtils.clamp(1 - d / d0, 0, 1), solved: d < 0.004 && q.angleTo(finalQ) < THREE.MathUtils.degToRad(6) };
    }
    let best = 0, bestD = Infinity;                     // rail: the nearest sample of the reference's path, never back
    for (let k = 0; k < path.length; k++) { const d = path[k].p.distanceToSquared(p); if (d < bestD) { bestD = d; best = k; } }
    if (bestD < 0.03 * 0.03) railBest = Math.max(railBest, best);
    const along = arc[railBest] / arc[path.length - 1];   // by distance travelled, so the reference's closing pause counts as the end
    return { progress: along, solved: along > 0.98 && p.distanceTo(finalP) < 0.02 };
  }
  return { rule, moverObj, path, start, collides, setTolerance, get tolerance() { return tolerance; }, evaluate,
    resetRail() { railBest = 0; }, anchorTrack: anchor < 0 ? -1 : partTracks[anchor], lift, frame };
}

/** How the reference's path fares under the page's check: samples (and sub-steps between them) that collide, by
 *  contact tolerance in millimetres; the first tolerance that clears it all. */
export function checkPath(pz, tolerances = [0, 0.25, 0.5, 1, 1.5, 2, 3]) {
  const out = { samples: pz.path.length };
  const tp = new THREE.Vector3(), tq = new THREE.Quaternion();
  for (const mm of tolerances) {
    pz.setTolerance(mm / 1000);
    let hits = 0, startHit = pz.collides(pz.start.p, pz.start.q);
    for (let k = 1; k < pz.path.length; k++) {
      const a = pz.path[k - 1], b = pz.path[k];
      const steps = Math.max(1, Math.ceil(Math.max(a.p.distanceTo(b.p) / 0.002, a.q.angleTo(b.q) / 0.025)));
      for (let s = 1; s <= steps; s++) {
        tp.lerpVectors(a.p, b.p, s / steps); tq.slerpQuaternions(a.q, b.q, s / steps);
        if (pz.collides(tp, tq)) { hits++; break; }
      }
    }
    out[`${mm}mm`] = startHit ? `start+${hits}` : hits;
    if (!hits && !startHit) { out.clearAt = mm; break; }
  }
  return out;
}
