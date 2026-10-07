// "Try to escape yourself": the puzzles in the visitor's hands. Orbit and zoom the stage, then:
// - rigid puzzles: move or turn the highlighted piece with the gizmo. Every move is checked against the fixed pieces with
//   exact mesh intersection (three-mesh-bvh) in small sub-steps, so a piece slides up to a contact and stops there.
// - ropes and cloth: simulated live (rope.js, cloth.js) against the same fixed meshes, and solved in front of the
//   visitor by a scripted demonstration (demos.js). ?ropeplay=1 lets the visitor pull them instead.
// Each puzzle says when it is solved (puzzles.js): by default, once the moving piece's bounding sphere is clear of the
// fixed piece's.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MeshBVH } from 'three-mesh-bvh';
import { createStage } from './stage.js';
import { clawMaterials, poseAt } from './claws.js';
import { PLAY_PUZZLES, PLAY_GROUPS, loadPuzzle } from './puzzles.js';
import { DEMOS } from './demos.js';

const HEIGHT = 0.3;
const STEP_M = 0.002, STEP_RAD = 0.025, MAX_STEPS = 120;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeInOut = (u) => u * u * (3 - 2 * u);
const RIGID_TIPS = ['Drag the background to rotate the view. Scroll or pinch to zoom.', 'Drag an arrow to move the piece, a ring to turn it.'];
const SOFT_TIPS = ['Press on the rope and pull. Release to let go.', 'Drag the background to rotate the view. Scroll or pinch to zoom.'];
const WATCH_TIPS = ['The oracle\'s whole run from the simulation: every piece where the simulator had it, the robot hidden and its pauses left out.', 'Switch to Play it to move the pieces yourself.', 'Drag the background to rotate the view. Scroll or pinch to zoom.'];
const ROPE_PLAY = new URLSearchParams(location.search).get('ropeplay') === '1';

/** The fixed parts as one geometry in the puzzle frame, with a BVH, for the rope and cloth to collide with. */
function mergeColliders(fixed) {
  if (!fixed.length) return null;
  const pos = [], idx = [], v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const f of fixed) {
    const g = f.body.geometry, a = g.attributes.position, base = pos.length / 3;
    m.compose(f.body.position, f.body.quaternion, new THREE.Vector3(1, 1, 1));
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
    const ix = g.index;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.boundsTree = new MeshBVH(g);
  return g;
}

/** The mesh shrunk by `d` all round, a collision proxy with a contact tolerance: each corner moves so that every face
 *  meeting there moves inward by `d` (least squares over those faces' normals), so faces shrink at their edges too. */
function inset(geometry, d) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const a = g.attributes.position, p = [0, 1, 2].map(() => new THREE.Vector3()), normals = [];
  for (let i = 0; i < a.count; i += 3) {
    for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(a, i + k);
    const n = new THREE.Vector3().subVectors(p[2], p[1]).cross(new THREE.Vector3().subVectors(p[0], p[1]));   // outward, as three.js has it
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
    if (o.length() > 4 * d) o.setLength(4 * d);          // a very sharp corner would otherwise run far
    for (const i of ids) a.setXYZ(i, a.getX(i) + o.x, a.getY(i) + o.y, a.getZ(i) + o.z);
  }
  return g;
}

export async function initPlay({ section, canvas, ui }) {
  const stage = createStage(canvas, { span: 0.8, cell: 0.02, every: 5, surface: true });
  const { scene, camera, root, renderer } = stage;
  const mats = clawMaterials();
  const assembly = new THREE.Group();
  root.add(assembly);
  stage.resize();

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.maxPolarAngle = 1.48;
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSize(0.8);
  gizmo.setSpace('local');
  scene.add(gizmo.getHelper());

  const ONE = new THREE.Vector3(1, 1, 1), M = new THREE.Matrix4();
  let puzzle = null, def = null, mover = null, fixed = [], proxy = null, proxyScale = 1, enforce = true;
  let startPos = new THREE.Vector3(), startQuat = new THREE.Quaternion(), startDistance = 0, winDistance = 1;
  let soft = null, softView = null, held = null;          // the live rope or cloth, its mesh, the point being pulled
  let lock = null;                                          // the lock: key depth and angle, rotor angles, rotor meshes
  let softDemo = null;                                      // the demonstration playing: its generator, frames to wait
  let replayRun = null;                                     // an oracle replay playing: its time, the meshes it moves
  let watching = false;                                     // the visitor's choice: play the puzzle, or watch the oracle
  const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: 0xc99a42, metalness: 0.6, roughness: 0.3, transparent: true, opacity: 0.75 }));
  marker.visible = false;
  assembly.add(marker);
  const meshes = [];
  const lastPos = new THREE.Vector3(), lastQuat = new THREE.Quaternion();
  const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), okP = new THREE.Vector3(), okQ = new THREE.Quaternion();
  let moves = 0, started = 0, won = false, demo = null, blockedTimer = 0, visible = false, progress = 0, frame = 0, railBest = 0;
  let frameDist = 1, frameFit = 1;                         // the camera distance the puzzle opens at, and its aspect allowance

  function collides(p, q) {
    for (const f of fixed) {
      M.compose(p, q, ONE).premultiply(f.inverse);
      if (f.body.geometry.boundsTree.intersectsGeometry(proxy, M)) return true;
    }
    return false;
  }
  function distance() { return mover.mesh.position.distanceTo(fixed[0].body.position); }
  function fmt(s) { s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function showBlocked() {
    ui.blocked.classList.add('show');
    clearTimeout(blockedTimer);
    blockedTimer = setTimeout(() => ui.blocked.classList.remove('show'), 700);
  }
  function showWin(title, text) { ui.winTitle.textContent = title; ui.winText.textContent = text; ui.win.classList.add('show'); }
  function hideWin() { ui.win.classList.remove('show'); }
  function countMove() { moves += 1; if (!started) started = performance.now(); ui.moves.textContent = moves; }

  // progress toward the goal, 0..1, and whether it is solved
  function evaluate() {
    if (replayRun) return { progress: clamp(replayRun.t / puzzle.replay.seconds), solved: false };
    if (soft) return def.check(soft, puzzle);
    if (lock) {
      const L = lock.cfg;
      return { progress: clamp((lock.x - L.start) / (L.win - L.start)), solved: lock.x >= L.win - 1e-6 };
    }
    if (puzzle.win?.type === 'rail') {             // how far along the rail the loop has come
      const p = mover.mesh.position, rail = puzzle.win.rail;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < rail.length; i++) { const d = rail[i].distanceToSquared(p); if (d < bestD) { bestD = d; best = i; } }
      railBest = Math.max(railBest, best);
      return { progress: railBest / (rail.length - 1), solved: railBest > 0.95 * (rail.length - 1) && p.distanceTo(puzzle.win.finish) < puzzle.win.radius };
    }
    if (puzzle.win?.type === 'reach') {            // into a pose: within `radius` of the target and, if given, `angle` of its turn
      const w = puzzle.win, d = mover.mesh.position.distanceTo(w.target);
      const turn = w.quaternion ? mover.mesh.quaternion.angleTo(w.quaternion) : 0;
      return { progress: clamp(1 - d / w.from), solved: d < w.radius && turn < (w.angle ?? Infinity) };
    }
    if (puzzle.win?.type === 'depth') {
      const a = puzzle.win.axis, x = mover.mesh.position.dot(a);
      return { progress: clamp((x - puzzle.win.start) / (puzzle.win.goal - puzzle.win.start)), solved: (x - puzzle.win.goal) * Math.sign(puzzle.win.goal - puzzle.win.start) >= 0 };
    }
    const d = distance();
    return { progress: clamp((d - startDistance) / (winDistance - startDistance)), solved: d > winDistance };
  }
  function afterMove(blocked) {
    if (blocked) showBlocked();
    const r = evaluate();
    progress = r.progress;
    ui.freedom.style.width = `${(progress * 100).toFixed(1)}%`;
    if (!won && r.solved && softDemo) {
      won = true; softDemo = null;
      soft.release(); marker.visible = false;
      ui.demo.textContent = 'Solved';
      return;
    }
    if (!won && r.solved) {
      won = true;
      gizmo.detach();
      const secs = started ? (performance.now() - started) / 1000 : 0;
      showWin('Solved', `${moves} move${moves === 1 ? '' : 's'}, ${fmt(secs)}. Now imagine doing it through a robot's cameras.`);
    }
  }

  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (e.value) countMove();
  });
  gizmo.addEventListener('objectChange', () => {
    if (demo || !mover) return;
    if (lock) {                          // read the gizmo's proposal as depth and angle, then walk the lock toward it
      const q = mover.mesh.quaternion;
      let deg = -THREE.MathUtils.radToDeg(2 * Math.atan2(q.x, q.w));
      deg += 360 * Math.round((lock.deg - deg) / 360);
      const blocked = lockMove(mover.mesh.position.x, deg);
      afterMove(blocked);
      return;
    }
    const np = mover.mesh.position.clone(), nq = mover.mesh.quaternion.clone();
    if (!enforce) {
      lastPos.copy(np); lastQuat.copy(nq);
      if (!collides(np, nq)) enforce = true;
      afterMove(false);
      return;
    }
    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(Math.max(lastPos.distanceTo(np) / STEP_M, lastQuat.angleTo(nq) / STEP_RAD))));
    okP.copy(lastPos); okQ.copy(lastQuat);
    let blocked = false;
    for (let k = 1; k <= steps; k++) {
      const u = k / steps;
      tp.lerpVectors(lastPos, np, u);
      tq.slerpQuaternions(lastQuat, nq, u);
      if (collides(tp, tq)) { blocked = true; break; }
      okP.copy(tp); okQ.copy(tq);
    }
    setPose(okP, okQ);
    afterMove(blocked);
  });
  function setPose(p, q) { mover.mesh.position.copy(p); mover.mesh.quaternion.copy(q); lastPos.copy(p); lastQuat.copy(q); }

  function setMode(mode) {
    gizmo.setMode(mode);
    ui.modeMove.classList.toggle('on', mode === 'translate');
    ui.modeRotate.classList.toggle('on', mode === 'rotate');
  }

  // ---- pulling a rope or cloth: a point follows the cursor on a plane facing the camera ----
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), plane = new THREE.Plane(), hitW = new THREE.Vector3();
  const invAssembly = new THREE.Matrix4(), localRay = new THREE.Ray();
  function rayAt(e) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    invAssembly.copy(assembly.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(invAssembly);
    localRay.direction.normalize();
    return localRay;
  }
  canvas.parentElement.addEventListener('pointerdown', (e) => {   // capture: runs before the orbit controls see the press
    if (!soft || softDemo || !ROPE_PLAY || won || demo || e.button !== 0) return;
    const i = soft.pick(rayAt(e));
    if (i < 0) return;
    orbit.enabled = false;
    soft.grab(i);
    const w = soft.get(i, new THREE.Vector3()).applyMatrix4(assembly.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), w);
    held = { pointerId: e.pointerId };
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = 'grabbing';
    countMove();
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!soft || !ROPE_PLAY) return;
    if (held) {
      rayAt(e);
      if (raycaster.ray.intersectPlane(plane, hitW)) soft.drag(hitW.applyMatrix4(invAssembly));
    } else if (!won) {
      canvas.style.cursor = soft.pick(rayAt(e)) >= 0 ? 'grab' : '';
    }
  });
  const letGo = () => {
    if (!held) return;
    held = null;
    soft?.release();
    orbit.enabled = true;
    canvas.style.cursor = '';
  };
  addEventListener('pointerup', letGo);
  addEventListener('pointercancel', letGo);

  // ---- the lock (after TopoGym's lock_picking): the key slides along the axis and turns about it. A tab can sit inside a
  // plate only within a slot, with `play` degrees either way; turning while a tab is inside a rotor pushes the rotor
  // along, up to its stop; the end plate does not turn. Between plates the key turns freely.
  function lockTry(x, deg, prevX) {
    const L = lock.cfg, eps = 1e-6, rot = lock.rot.slice();
    if (x > L.endStop + eps) return null;
    for (const off of L.tabs) {
      const t = x + off, was = prevX + off;
      for (const pl of L.plates) {
        if (Math.abs(t - pl.x) >= L.engage) continue;
        const r = pl.rotorIndex, phi = r >= 0 ? rot[r] : 0;
        let slot = 0, d = Infinity;
        for (const sl of pl.slots) { const e = deg - (phi + sl); if (Math.abs(e) < Math.abs(d)) { d = e; slot = sl; } }
        if (Math.abs(d) <= L.play + eps) continue;
        if (r < 0 || Math.abs(was - pl.x) >= L.engage) return null;     // the end plate, or a plate entered off its slots
        const to = deg - slot - Math.sign(d) * L.play;
        if (pl.stop && (to < pl.stop[0] - eps || to > pl.stop[1] + eps)) return null;
        rot[r] = to;
      }
    }
    return rot;
  }
  function lockMove(nx, ndeg) {          // in small steps; stops at the first step the lock refuses
    const x0 = lock.x, d0 = lock.deg;
    const steps = Math.min(600, Math.max(1, Math.ceil(Math.max(Math.abs(nx - x0) / 0.0005, Math.abs(ndeg - d0) / 0.25))));
    let blocked = false;
    for (let k = 1; k <= steps; k++) {
      const x = x0 + (nx - x0) * k / steps, deg = d0 + (ndeg - d0) * k / steps;
      const rot = lockTry(x, deg, lock.x);
      if (!rot) { blocked = true; break; }
      lock.x = x; lock.deg = deg; lock.rot = rot;
    }
    lockPose();
    return blocked;
  }
  const AXIS = new THREE.Vector3(-1, 0, 0);
  function lockPose() {
    mover.mesh.position.set(lock.x, lock.cfg.axisY, 0);
    mover.mesh.quaternion.setFromAxisAngle(AXIS, THREE.MathUtils.degToRad(lock.deg));
    lock.meshes.forEach((m, i) => m.quaternion.setFromAxisAngle(AXIS, THREE.MathUtils.degToRad(lock.rot[i])));
    lastPos.copy(mover.mesh.position); lastQuat.copy(mover.mesh.quaternion);
  }

  function reset() {
    demo = null; won = false; moves = 0; started = 0; held = null; railBest = 0;
    orbit.enabled = true;
    ui.moves.textContent = '0';
    ui.time.textContent = '0:00';
    hideWin();
    if (soft) {
      soft.reset();
      softView.update();
      softDemo = ROPE_PLAY ? null : { gen: DEMOS[def.id](soft, puzzle), wait: 50 };
      ui.demo.textContent = 'Demo';
    } else if (replayRun) {
      replayRun.t = 0; replayRun.wait = 0.8; replayRun.done = false;
      replayPose(0);
      ui.demo.textContent = 'Oracle run';
    } else if (lock) {
      lock.x = lock.cfg.start; lock.deg = 0; lock.rot = lock.cfg.rotors.map(() => 0);
      lockPose();
      gizmo.attach(mover.mesh);
    } else {
      setPose(startPos, startQuat);
      enforce = !collides(startPos, startQuat);
      gizmo.attach(mover.mesh);
    }
    orbit.reset();
    afterMove(false);
  }

  function clear() {
    gizmo.detach();
    for (const m of meshes) assembly.remove(m);
    meshes.length = 0;
    if (softView) { assembly.remove(softView.mesh); softView.dispose ? softView.dispose() : softView.geometry.dispose(); }
    soft = null; softView = null; held = null; lock = null; softDemo = null; replayRun = null; marker.visible = false;
    gizmo.showY = gizmo.showZ = true; gizmo.rotationSnap = null;
    fixed = []; mover = null;
  }

  async function select(id, tier = null) {
    const next = PLAY_PUZZLES.find((p) => p.id === id) || PLAY_PUZZLES[0];
    ui.picker.querySelectorAll('[data-puzzle]').forEach((b) => b.classList.toggle('on', b.dataset.puzzle === next.id));
    const loaded = await loadPuzzle(next.id, tier);
    clear();
    def = next; puzzle = loaded;
    // play it, or watch the oracle's whole run: both where both exist
    const canPlay = puzzle.kind !== 'replay', watch = !!puzzle.replay && (watching || !canPlay);
    ui.modes.hidden = !(canPlay && puzzle.replay);
    ui.modes.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'watch') === watch));
    // tiers: one button each, when the puzzle comes in several
    ui.tiers.hidden = !def.tiers;
    if (def.tiers) ui.tiers.innerHTML = def.tiers.map((t) => `<button data-tier="${t}" class="${t === puzzle.tier ? 'on' : ''}">${t}</button>`).join('');
    assembly.rotation.copy(puzzle.display);
    let lockMeshes = null;
    const byName = new Map();
    for (const b of puzzle.bodies) {
      const mesh = new THREE.Mesh(b.geometry, b.color ? new THREE.MeshPhysicalMaterial({ color: b.color, roughness: b.roughness ?? 0.55, metalness: b.metalness ?? 0 }) : b.role === 'move' ? mats.move : mats[b.material]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.copy(b.position); mesh.quaternion.copy(b.quaternion);
      assembly.add(mesh); meshes.push(mesh); byName.set(b.name, mesh);
      if (b.role === 'move') mover = { body: b, mesh };
      else if (b.role === 'replay') continue;          // posed by the oracle's run only
      else if (b.role === 'rotor') (lockMeshes ??= []).push(mesh);
      else if (puzzle.kind !== 'lock') {
        if (!b.geometry.boundsTree) b.geometry.boundsTree = new MeshBVH(b.geometry);
        fixed.push({ body: b, mesh, inverse: new THREE.Matrix4().compose(b.position, b.quaternion, ONE).invert() });
      }
    }

    let mid, span, floor = puzzle.floor ?? 0;
    if (watch) {                                        // the oracle's whole run, every moving piece as the simulator had it
      replayRun = { meshes: puzzle.replay.bodies.map((n) => byName.get(n)), t: 0, wait: 0.8 };
      replayPose(0);
      mid = puzzle.replay.frame.center; span = puzzle.replay.frame.span; floor = puzzle.replay.floor ?? 0;
      assembly.position.set(-mid.x, -floor, -mid.z);   // the table is the stage floor
    } else if (puzzle.kind === 'lock') {
      const L = puzzle.lock;
      L.plates.forEach((pl) => { pl.rotorIndex = pl.rotor ? L.rotors.findIndex((r) => r.name === pl.rotor) : -1; });
      lock = { cfg: L, x: L.start, deg: 0, rot: L.rotors.map(() => 0), meshes: L.rotors.map((r) => lockMeshes[puzzle.bodies.filter((b) => b.role === 'rotor').findIndex((b) => b.name === r.name)]) };
      gizmo.showY = gizmo.showZ = false;                 // slide along the axis, turn about it
      gizmo.rotationSnap = THREE.MathUtils.degToRad(1);
      mid = puzzle.frame.center; span = puzzle.frame.span;
      assembly.position.set(-mid.x, -(puzzle.floor ?? 0), -mid.z);
    } else if (puzzle.kind === 'rigid') {
      startPos = mover.body.position.clone();
      startQuat = mover.body.quaternion.clone();
      const anchor = fixed[0].body.position;
      startDistance = startPos.distanceTo(anchor);
      winDistance = mover.body.radius + fixed[0].body.radius + 0.005;
      // Collision proxy: the moving mesh itself, or for puzzles replayed from the simulator its faces moved inward by
      // the puzzle's contact tolerance (the robot presses the pieces together as it slides them). If the start still
      // grazes a fixed piece, the smallest uniform shrink about the centre that clears it.
      const g = puzzle.tolerance ? inset(mover.body.geometry, puzzle.tolerance) : mover.body.geometry;
      for (const s of [1, 0.997, 0.994, 0.99, 0.985, 0.98]) {
        proxy = s === 1 ? g : g.clone().scale(s, s, s);
        proxyScale = s;
        if (!proxy.boundsTree) proxy.boundsTree = new MeshBVH(proxy);
        if (!collides(startPos, startQuat)) break;
      }
      mid = puzzle.frame?.center ?? anchor.clone().add(startPos).multiplyScalar(0.5);
      span = puzzle.frame?.span ?? Math.max(...puzzle.bodies.map((b) => b.position.distanceTo(mid) + b.radius));
      const midWorld = mid.clone().applyEuler(puzzle.display);
      assembly.position.set(-midWorld.x, (puzzle.floor != null ? -puzzle.floor : HEIGHT - midWorld.y), -midWorld.z);
    } else {
      puzzle.collider ??= mergeColliders(fixed.filter((f) => f.body.collide));   // one BVH over the fixed parts: one query per particle
      soft = puzzle.makeSim(puzzle.collider ? [{ geometry: puzzle.collider, matrix: new THREE.Matrix4() }] : []);
      softView = puzzle.makeView(soft);
      assembly.add(softView.mesh);
      const box = new THREE.Box3();
      for (const b of puzzle.bodies) box.union(new THREE.Box3().setFromObject(meshes[puzzle.bodies.indexOf(b)]));
      for (let i = 0; i < soft.n; i++) box.expandByPoint(soft.get(i, tp));
      mid = puzzle.frame?.center ?? box.getCenter(new THREE.Vector3());
      span = puzzle.frame?.span ?? 0.5 * box.getSize(new THREE.Vector3()).length();
      assembly.position.set(-mid.x, -(puzzle.floor ?? 0), -mid.z);           // the table is the stage floor
    }

    // frame the puzzle
    const target = new THREE.Vector3(0, !watch && puzzle.kind === 'rigid' && puzzle.floor == null ? HEIGHT : mid.y - floor, 0);   // a floating rigid puzzle; else the table is the stage floor
    const fit = Math.min(2.2, Math.max(1, 1.3 / camera.aspect));
    const dist = 1.15 * fit * span / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    frameDist = dist; frameFit = fit;
    const view = puzzle.view ?? [0.33, 0.32, 0.89];
    camera.position.set(view[0] * dist, target.y + view[1] * dist, view[2] * dist);
    orbit.target.copy(target);
    orbit.minDistance = 0.5 * span;
    orbit.maxDistance = 2.4 * dist;
    orbit.update();
    orbit.saveState();

    ui.name.textContent = def.name;
    ui.goal.textContent = def.goal;
    ui.mover.textContent = def.mover ?? '';
    const demoing = (!!soft && !ROPE_PLAY) || watch;
    ui.ctlRigid.hidden = watch || (puzzle.kind !== 'rigid' && puzzle.kind !== 'lock');
    const tips = watch ? (canPlay ? WATCH_TIPS : def.demoTips) : demoing ? def.demoTips : def.tips;
    ui.tips.innerHTML = (tips ?? (puzzle.kind === 'rigid' ? RIGID_TIPS : SOFT_TIPS)).map((t) => `<li>${t}</li>`).join('');
    ui.moves.parentElement.hidden = ui.time.parentElement.hidden = demoing;
    ui.demo.hidden = !demoing;
    ui.reset.textContent = demoing ? 'Replay' : 'Reset';
    ui.from.textContent = watch ? 'Start' : def.from ?? 'Locked';
    ui.to.textContent = watch ? 'End' : def.to ?? 'Apart';
    ui.solution.hidden = watch || (!puzzle.path && !puzzle.lock?.solution);
    ui.noSolution.hidden = !ui.solution.hidden || demoing;
    reset();
  }

  // While a solution plays, the view eases out and along so that both pieces stay in frame (same direction, never
  // closer than the puzzle opened at). Reset brings the opening view back.
  const fMid = new THREE.Vector3(), fOff = new THREE.Vector3();
  function follow(dt) {
    const a = fixed[0].body.position, m = mover.mesh.position;
    const need = 0.5 * a.distanceTo(m) + Math.max(mover.body.radius, fixed[0].body.radius);
    const dist = Math.max(frameDist, 1.15 * frameFit * need / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    assembly.updateMatrixWorld();
    assembly.localToWorld(fMid.addVectors(a, m).multiplyScalar(0.5));
    const k = 1 - Math.exp(-2.5 * dt);
    fOff.subVectors(camera.position, orbit.target);
    orbit.target.lerp(fMid, k);
    camera.position.copy(orbit.target).add(fOff.setLength(fOff.length() + (dist - fOff.length()) * k));
  }

  const rq1 = new THREE.Quaternion(), rq2 = new THREE.Quaternion();
  function replayPose(f) {               // every replayed link at a continuous sample index f
    const r = puzzle.replay, n = r.count, L = r.bodies.length, d = r.data;
    f = clamp(f, 0, n - 1);
    const i = Math.floor(f), j = Math.min(i + 1, n - 1), u = f - i;
    replayRun.meshes.forEach((m, k) => {
      const a = (i * L + k) * 7, b = (j * L + k) * 7;
      m.position.set(d[a] + (d[b] - d[a]) * u, d[a + 1] + (d[b + 1] - d[a + 1]) * u, d[a + 2] + (d[b + 2] - d[a + 2]) * u);
      m.quaternion.slerpQuaternions(rq1.set(d[a + 3], d[a + 4], d[a + 5], d[a + 6]).normalize(), rq2.set(d[b + 3], d[b + 4], d[b + 5], d[b + 6]).normalize(), u);
    });
  }

  function playSolution() {
    if (!puzzle.path && !lock) return;
    hideWin();
    gizmo.detach();
    won = true;                          // a demonstration is not the visitor's solve
    if (lock) { reset(); won = true; gizmo.detach(); demo = { lock: true, i: 0, u: 0, t: 0 }; return; }
    demo = { t: 0, fromP: mover.mesh.position.clone(), fromQ: mover.mesh.quaternion.clone() };
  }

  ui.picker.innerHTML = PLAY_GROUPS.map(([g, label]) => {
    const items = PLAY_PUZZLES.filter((p) => p.group === g);
    return items.length ? `<div class="pick-group"><span class="pick-label">${label}</span><div class="pick-row">${items.map((p) => `
      <button class="pick" data-puzzle="${p.id}" role="tab"><img src="assets/media/posters/${p.id}.jpg" alt="">${p.watchOnly ? '<em class="pick-tag">Watch</em>' : p.demoTips && !ROPE_PLAY ? '<em class="pick-tag">Demo</em>' : ''}<span>${p.name}</span></button>`).join('')}
      </div></div>` : '';
  }).join('');
  ui.picker.addEventListener('click', (e) => { const b = e.target.closest('[data-puzzle]'); if (b) select(b.dataset.puzzle); });
  ui.tiers.addEventListener('click', (e) => { const b = e.target.closest('[data-tier]'); if (b && def) select(def.id, b.dataset.tier); });
  ui.modes.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && def) { watching = b.dataset.mode === 'watch'; select(def.id, puzzle.tier); } });
  ui.modeMove.addEventListener('click', () => setMode('translate'));
  ui.modeRotate.addEventListener('click', () => setMode('rotate'));
  ui.reset.addEventListener('click', reset);
  ui.again.addEventListener('click', reset);
  ui.solution.addEventListener('click', playSolution);
  addEventListener('keydown', (e) => {
    if (!visible || e.target.closest('input, textarea')) return;
    if (e.key === 'w' || e.key === 'W') setMode('translate');
    if (e.key === 'e' || e.key === 'E') setMode('rotate');
  });

  let running = false, last = performance.now();
  const t0 = last;
  function draw(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    if (demo?.lock && lock.cfg.oracle) {   // the oracle's key motion from the simulation, through the same lock rules
      const o = lock.cfg.oracle;
      demo.t += dt;
      const u = clamp(demo.t / o.seconds), f = easeInOut(u) * (o.x.length - 1), i = Math.floor(f), j = Math.min(i + 1, o.x.length - 1), w = f - i;
      lockMove(o.x[i] + (o.x[j] - o.x[i]) * w, o.deg[i] + (o.deg[j] - o.deg[i]) * w);
      ui.freedom.style.width = `${(evaluate().progress * 100).toFixed(1)}%`;
      if (u >= 1) { demo = null; showWin('One way in', def.demoText); }
    } else if (demo?.lock) {             // the solver's moves, one after another, through the same lock rules
      const sol = lock.cfg.solution, a = demo.i === 0 ? { x: lock.cfg.start, deg: 0 } : sol[demo.i - 1], b = sol[demo.i];
      demo.u = Math.min(1, demo.u + dt / 0.7);
      lockMove(a.x + (b.x - a.x) * demo.u, a.deg + (b.deg - a.deg) * demo.u);
      ui.freedom.style.width = `${(evaluate().progress * 100).toFixed(1)}%`;
      if (demo.u >= 1) { demo.i += 1; demo.u = 0; }
      if (demo.i >= sol.length) { demo = null; showWin('One way in', def.demoText ?? 'That was a solver\'s sequence for this lock. Reset and find your own.'); }
    } else if (demo && puzzle.path) {
      demo.t += dt;
      const back = 0.9, run = puzzle.path.seconds ?? 16;
      if (demo.t < back) {
        const u = easeInOut(demo.t / back);
        mover.mesh.position.lerpVectors(demo.fromP, startPos, u);
        mover.mesh.quaternion.slerpQuaternions(demo.fromQ, startQuat, u);
      } else {
        const u = clamp((demo.t - back) / run);
        poseAt(puzzle.path, easeInOut(u) * (puzzle.path.count - 1), mover.mesh.position, mover.mesh.quaternion);
        if (u >= 1) { demo = null; showWin(def.demoTitle ?? 'One way out', (puzzle.path.shortened && def.demoTextShortened) || def.demoText || 'That was the robot\'s path from simulation. Reset and find your own.'); }
      }
      follow(dt);
      ui.freedom.style.width = `${(evaluate().progress * 100).toFixed(1)}%`;
    }
    if (replayRun && !replayRun.done) {  // the oracle's run, at a steady pace through its samples
      if (replayRun.wait > 0) replayRun.wait -= dt;
      else {
        replayRun.t += dt;
        const u = clamp(replayRun.t / puzzle.replay.seconds);
        replayPose(u * (puzzle.replay.count - 1));
        ui.freedom.style.width = `${(u * 100).toFixed(1)}%`;
        if (u >= 1) { replayRun.done = true; ui.demo.textContent = 'Replay to watch again'; }
      }
    }
    if (soft && softDemo) {              // a fixed 1/60 s per frame, so the scripted solution plays out the same everywhere
      if (softDemo.wait > 0) softDemo.wait -= 1;
      else if (softDemo.gen.next().done) { softDemo = null; ui.demo.textContent = 'Replay to watch again'; }
      soft.step(1 / 60);
      softView.update();
      marker.visible = !!softDemo && soft.held >= 0;
      if (marker.visible) { soft.get(soft.held, marker.position); marker.scale.setScalar(Math.max(0.007, 1.8 * (soft.radius ?? 0.004))); }
      if (++frame % 8 === 0) afterMove(false);
    } else if (soft && !won) {           // once solved, the scene holds still
      soft.step(dt);
      softView.update();
      if (++frame % 8 === 0) afterMove(false);
    }
    if (started && !won) ui.time.textContent = fmt((performance.now() - started) / 1000);
    orbit.update();
    stage.update((now - t0) / 1000, dt);
    renderer.render(scene, camera);
  }
  function loop(now) {
    if (!visible) { running = false; return; }
    draw(now);
    requestAnimationFrame(loop);
  }
  function start() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); } }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }, { rootMargin: '100px' }).observe(section);
  addEventListener('resize', () => { stage.resize(); if (!running) draw(performance.now()); });

  setMode('translate');
  await select(PLAY_PUZZLES[0].id);
  draw(performance.now());

  // Self-test (?selftest=1). Rigid puzzles: whether the start is clear, the contact tolerance and proxy scale, how far
  // straight pushes of the moving piece get, and how many samples of the solution path intersect (if any do, how many
  // still would under larger tolerances). Ropes and cloth: run the simulation for two seconds untouched and report
  // that it stays finite, unsolved and out of the fixed pieces, then when the demonstration first counts as solved.
  async function selfTest(ids) {
    const out = [];
    const pause = () => new Promise((r) => setTimeout(r, 0));
    const keep = watching;
    watching = false;                    // the play checks run in play mode; the oracle's run is checked as data
    for (const p of PLAY_PUZZLES.filter((q) => !ids || ids.includes(q.id))) for (const tier of p.tiers ?? [null]) {
      await select(p.id, tier);
      await pause();
      const w = puzzle.replay && { samples: puzzle.replay.count, bodies: puzzle.replay.bodies.length, seconds: puzzle.replay.seconds,
        finite: puzzle.replay.data.every(Number.isFinite), missing: puzzle.replay.bodies.filter((n) => !puzzle.bodies.some((b) => b.name === n)) };
      if (lock) {                        // a straight push at 0 deg, then the solver's sequence through the lock rules
        const r = { id: p.id, tier, kind: 'lock', watch: w };
        lockMove(lock.cfg.endStop, 0);
        r.straightPushStopsAt = +lock.x.toFixed(4);
        reset();
        let prev = { x: lock.cfg.start, deg: 0 }, stuck = null;
        lock.cfg.solution.forEach((m, i) => { if (!stuck && lockMove(m.x, m.deg)) stuck = { move: i, at: [+lock.x.toFixed(4), +lock.deg.toFixed(2)], rotors: lock.rot.map((v) => +v.toFixed(2)) }; prev = m; });
        r.solution = stuck ?? { reached: +lock.x.toFixed(4), rotors: lock.rot.map((v) => +v.toFixed(2)), solved: evaluate().solved };
        reset();
        if (lock.cfg.oracle) {           // the oracle's key motion: every sample through the lock rules
          const o = lock.cfg.oracle;
          let refused = null;
          for (let i = 1; i < o.x.length && !refused; i++) if (lockMove(o.x[i], o.deg[i])) refused = { sample: i, at: [+lock.x.toFixed(4), +lock.deg.toFixed(2)] };
          r.oracle = refused ?? { samples: o.x.length, reached: +lock.x.toFixed(4), rotors: lock.rot.map((v) => +v.toFixed(2)), solved: evaluate().solved };
          reset();
        }
        out.push(r);
        continue;
      }
      if (puzzle.kind === 'replay') { out.push({ id: p.id, tier, kind: 'replay', watch: w }); continue; }
      if (soft) {
        const r = { id: p.id, tier, kind: puzzle.kind, n: soft.n };
        const t = performance.now();
        for (let f = 0; f < 120; f++) soft.step(1 / 60);
        r.msPerFrame = +((performance.now() - t) / 120).toFixed(2);
        r.finite = Array.from(soft.x).every(Number.isFinite);
        r.start = evaluate();
        r.penetration = soft.penetration?.() ?? null;
        if (DEMOS[p.id]) {                // the demonstration, in a tight loop: when it first counts as solved
          soft.reset();
          const g = DEMOS[p.id](soft, puzzle);
          let f = 0, at = null, done = false;
          while (!done && at == null && f < 6000) { done = g.next().done; soft.step(1 / 60); f++; if (f % 8 === 0 && def.check(soft, puzzle).solved) at = f; }
          r.demoSolvedAtS = at && +(at / 60).toFixed(1);
          soft.release();
        }
        out.push(r);
        continue;
      }
      const r = { id: p.id, tier, kind: 'rigid', tolerance: puzzle.tolerance ?? 0, startClear: !collides(startPos, startQuat), watch: w };
      if (w) {                           // the oracle's run starts where the puzzle does: the moving piece at its start pose
        const k = puzzle.replay.bodies.indexOf(mover.body.name), d = puzzle.replay.data;
        w.startOffsetMm = k < 0 ? null : +(1000 * tp.set(d[7 * k], d[7 * k + 1], d[7 * k + 2]).distanceTo(startPos)).toFixed(3);
      }
      r.proxyScale = proxyScale;
      // straight pushes along the six axes (0.3 m each): where each one first touches a fixed piece (null: never)
      r.pushBlockedAfterM = {};
      for (const [name, dir] of [['+x', [1, 0, 0]], ['-x', [-1, 0, 0]], ['+y', [0, 1, 0]], ['-y', [0, -1, 0]], ['+z', [0, 0, 1]], ['-z', [0, 0, -1]]]) {
        const d = new THREE.Vector3(...dir);
        let hit = null;
        for (let k = 1; k <= 300; k++) {
          if (collides(tp.copy(startPos).addScaledVector(d, 0.001 * k), startQuat)) { hit = +(0.001 * k).toFixed(3); break; }
        }
        r.pushBlockedAfterM[name] = hit;
        await pause();
      }
      r.start = evaluate();
      if (puzzle.path) {
        let hits = 0;
        const at = [];
        for (let i = 0; i < puzzle.path.count; i++) { poseAt(puzzle.path, i, tp, tq); if (collides(tp, tq)) { hits++; at.push(i); } }
        r.pathCollisions = hits; r.pathSamples = puzzle.path.count; r.pathCollisionsAt = at.slice(0, 12);
        if (hits) {                      // how many samples still collide under larger contact tolerances (mm)
          const keep = proxy;
          r.pathCollisionsByToleranceMm = {};
          for (const d of [0.5, 0.75, 1, 1.5, 2]) {
            proxy = inset(mover.body.geometry, d / 1000); proxy.boundsTree = new MeshBVH(proxy);
            r.pathCollisionsByToleranceMm[d] = at.filter((i) => { poseAt(puzzle.path, i, tp, tq); return collides(tp, tq); }).length;
            if (!r.pathCollisionsByToleranceMm[d]) break;
          }
          proxy = keep;
        }
      }
      out.push(r);
    }
    watching = keep;
    await select(PLAY_PUZZLES[0].id);
    return out;
  }
  // Shortcuts (?shortcut=interlocked_claws:hard): the samples of the solution path to keep so that a straight move from
  // each to the next (position lerp, turn slerp) clears the fixed pieces at every sub-step of the visitor's own check.
  // scripts/export_oracle_poses.py rebuilds an over-long oracle path from them (scripts/shortcuts/).
  async function shortcut(id, tier) {
    await select(id, tier);
    const path = puzzle.path, n = path.count, pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion();
    const box = mover.body.geometry.boundingBox, reach = Math.max(box.min.length(), box.max.length(), ...[0, 1, 2, 3, 4, 5, 6, 7].map((c) =>
      tp.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z).length()));
    const clear = (i, j) => {                // checked at the very poses the export re-samples the move into (1.5 mm steps)
      poseAt(path, i, pa, qa); poseAt(path, j, pb, qb);
      const steps = Math.max(1, Math.ceil((pa.distanceTo(pb) + qa.angleTo(qb) * reach) / 0.0015));
      for (let k = 1; k <= steps; k++) {
        tp.lerpVectors(pa, pb, k / steps); tq.slerpQuaternions(qa, qb, k / steps);
        if (collides(tp, tq)) return false;
      }
      return true;
    };
    const keep = [0];
    for (let i = 0; i < n - 1;) {
      let good = i + 1, bad = n, step = 2;
      while (good < n - 1) {                // gallop, then bisect between the last clear and the first blocked
        const j = Math.min(n - 1, i + step);
        if (clear(i, j)) { good = j; step *= 2; } else { bad = j; break; }
      }
      while (bad - good > 1) { const j = (good + bad) >> 1; if (clear(i, j)) good = j; else bad = j; }
      keep.push(good); i = good;
    }
    return { id, tier, samples: n, waypoints: keep };
  }

  return { select, reset, playSolution, selfTest, shortcut, get soft() { return soft; }, get puzzle() { return puzzle; }, assembly, camera };
}
