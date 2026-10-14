// "In 3D": every reference solution of the release, redrawn from the replay that its video shows (scripts/
// export_roboarc_oracle.py): each piece, the robot, the rope and the cloth where the simulator had them, frame by frame.
// The visitor orbits, zooms, scrubs, hides the robot, steps through a family's tasks; rigid families can also be played
// (play.js). Data: assets/oracle/<base>.{json,bin} and the shared mesh library assets/oracle/m/<id>.bin (z-up, metres,
// the puzzle's table top at z = 0).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createStage } from './stage.js';
import { PLAYABLE, makePuzzle } from './play.js';

const BASE = new URL('../oracle/', import.meta.url);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const meshCache = new Map();

/** A library mesh: int16 positions over its box, int8 normals, 16- or 32-bit indices. */
function loadMesh(id) {
  if (!meshCache.has(id)) meshCache.set(id, fetch(new URL(`m/${id}.bin`, BASE)).then((r) => r.arrayBuffer()).then((buf) => {
    const [, nv, nf, big] = new Uint32Array(buf, 0, 4);
    const box = new Float32Array(buf, 16, 6);
    let off = 40;
    const q = new Int16Array(buf, off, nv * 3); off += Math.ceil(nv * 6 / 4) * 4;
    const nq = new Int8Array(buf, off, nv * 3); off += Math.ceil(nv * 3 / 4) * 4;
    const idx = big ? new Uint32Array(buf, off, nf * 3) : new Uint16Array(buf, off, nf * 3);
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) {
      const k = i % 3;
      pos[i] = box[k] + (q[i] + 32768) / 65535 * (box[k + 3] - box[k]);
      nrm[i] = nq[i] / 127;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }));
  return meshCache.get(id);
}

/** The material the renders give a part: metal for the near-grey parts, plastic for coloured ones (tools/looks.py). */
function materialFor(part, robot) {
  const [r, g, b, a] = part.rgba, c = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  if (part.role === 'goal') return new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.6 });
  if (part.role === 'robot') {
    return robot === 'aloha' ? new THREE.MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.62, metalness: 0.1 })
      : new THREE.MeshStandardMaterial({ color: (r + g + b) / 3 > 128 ? 0xeceeef : 0x34373b, roughness: 0.6, metalness: 0.05 });
  }
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.38, metalness: sat < 0.12 ? 0.5 : 0 });
  if (a < 250) Object.assign(m, { transparent: true, opacity: a / 255, depthWrite: false });
  return m;
}

/** A tube along a polyline, re-shaped every frame: rings carried along by parallel transport. */
class Tube {
  constructor(points, radius, material, radial = 10) {
    this.n = points; this.radial = radial; this.radius = radius;
    const nv = points * radial, idx = [];
    for (let i = 0; i < points - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    this.geometry.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.t = new THREE.Vector3(); this.u = new THREE.Vector3(); this.v = new THREE.Vector3(); this.p = new THREE.Vector3(); this.q = new THREE.Vector3();
  }
  update(c) {                          // c: Float32Array of points * 3
    const { n, radial, radius, t, u, v } = this, P = this.geometry.attributes.position.array, N = this.geometry.attributes.normal.array;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      t.set(c[3 * b] - c[3 * a], c[3 * b + 1] - c[3 * a + 1], c[3 * b + 2] - c[3 * a + 2]).normalize();
      if (i === 0) { u.set(Math.abs(t.z) < 0.9 ? 0 : 1, 0, Math.abs(t.z) < 0.9 ? 1 : 0).cross(t).normalize(); }
      else { u.addScaledVector(t, -u.dot(t)).normalize(); }
      v.crossVectors(t, u);
      for (let j = 0; j < radial; j++) {
        const ang = (j / radial) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang), k = 3 * (i * radial + j);
        const nx = u.x * cs + v.x * sn, ny = u.y * cs + v.y * sn, nz = u.z * cs + v.z * sn;
        N[k] = nx; N[k + 1] = ny; N[k + 2] = nz;
        P[k] = c[3 * i] + radius * nx; P[k + 1] = c[3 * i + 1] + radius * ny; P[k + 2] = c[3 * i + 2] + radius * nz;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }
}

/** A cloth grid, re-shaped every frame. */
function clothMesh(rows, cols, material) {
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rows * cols * 3), 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = true; mesh.frustumCulled = false;
  return mesh;
}

/** One task's replay: its pieces in the scene and how to pose them at a video frame. */
export async function loadReplay(base) {
  const [meta, buf] = await Promise.all([
    fetch(new URL(`${base}.json`, BASE)).then((r) => { if (!r.ok) throw new Error(`${base}: ${r.status}`); return r.json(); }),
    fetch(new URL(`${base}.bin`, BASE)).then((r) => r.arrayBuffer()),
  ]);
  const geoms = await Promise.all(meta.parts.map((p) => loadMesh(p.mesh)));
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;                      // z-up to the page's y-up; the table top is the stage floor
  const groups = Array.from({ length: meta.track.groups }, () => new THREE.Group());
  groups.forEach((g) => root.add(g));
  const robotParts = [];
  const mats = new Map();
  meta.parts.forEach((p, i) => {
    const key = `${p.role}|${p.rgba}`;
    if (!mats.has(key)) mats.set(key, materialFor(p, meta.robot));
    const m = new THREE.Mesh(geoms[i], mats.get(key));
    m.position.fromArray(p.pos);
    m.quaternion.set(p.quat[1], p.quat[2], p.quat[3], p.quat[0]);
    m.castShadow = p.role !== 'goal'; m.receiveShadow = true; m.userData.part = p;
    if (p.role === 'goal') m.renderOrder = 2;
    (p.track >= 0 ? groups[p.track] : root).add(m);
    if (p.role === 'robot') robotParts.push(m);
  });
  const T = meta.track, G = T.groups, S = T.frames.length;
  const track = new Int16Array(buf, 0, T.bytes / 2);
  const deform = meta.deform.map((d) => {
    const data = new Int16Array(buf, d.offset, d.bytes / 2), n = d.kind === 'rope' ? d.points : d.rows * d.cols;
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...d.rgba.slice(0, 3).map((x) => x / 255), THREE.SRGBColorSpace), roughness: d.kind === 'rope' ? 0.7 : 0.85, side: THREE.DoubleSide });
    const view = d.kind === 'rope' ? new Tube(n, d.radius, material) : { mesh: clothMesh(d.rows, d.cols, material) };
    root.add(view.mesh);
    return { d, data, n, view, buf: new Float32Array(n * 3) };
  });
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const sampleAt = (f) => {                            // a video frame -> (sample i, j, weight)
    const fr = T.frames;
    let lo = 0, hi = S - 1;
    if (f <= fr[0]) return [0, 0, 0];
    if (f >= fr[hi]) return [hi, hi, 0];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fr[m] <= f) lo = m; else hi = m; }
    return [lo, hi, (f - fr[lo]) / (fr[hi] - fr[lo])];
  };
  function pose(f) {
    f = clamp(f, 0, meta.frames - 1);
    const [i, j, u] = sampleAt(f), lo = T.lo, hi = T.hi;
    for (let g = 0; g < G; g++) {
      const a = (i * G + g) * 7, b = (j * G + g) * 7, o = groups[g];
      const P = (k, x) => lo[k] + (x + 32768) / 65535 * (hi[k] - lo[k]);
      o.position.set(P(0, track[a] + (track[b] - track[a]) * u), P(1, track[a + 1] + (track[b + 1] - track[a + 1]) * u), P(2, track[a + 2] + (track[b + 2] - track[a + 2]) * u));
      qa.set(track[a + 4], track[a + 5], track[a + 6], track[a + 3]).normalize();
      qb.set(track[b + 4], track[b + 5], track[b + 6], track[b + 3]).normalize();
      o.quaternion.slerpQuaternions(qa, qb, u);
    }
    for (const x of deform) {
      const { d, data, n } = x, s = clamp(f / d.frame_step, 0, d.samples - 1), k0 = Math.floor(s), k1 = Math.min(k0 + 1, d.samples - 1), w = s - k0;
      const a0 = k0 * n * 3, a1 = k1 * n * 3, out = d.kind === 'rope' ? x.buf : x.view.mesh.geometry.attributes.position.array;
      for (let v = 0; v < n * 3; v++) {
        const k = v % 3, q = data[a0 + v] + (data[a1 + v] - data[a0 + v]) * w;
        out[v] = d.lo[k] + (q + 32768) / 65535 * (d.hi[k] - d.lo[k]);
      }
      if (d.kind === 'rope') x.view.update(out);
      else { const g = x.view.mesh.geometry; g.attributes.position.needsUpdate = true; g.computeVertexNormals(); }
    }
  }
  const simTime = (f) => { const [i, j, u] = sampleAt(clamp(f, 0, meta.frames - 1)); return meta.t_sim[i] + (meta.t_sim[j] - meta.t_sim[i]) * u; };
  function dispose() {
    for (const m of mats.values()) m.dispose();
    for (const x of deform) { x.view.mesh.geometry.dispose(); x.view.mesh.material.dispose(); }
  }
  return { meta, root, groups, pose, simTime, robotParts, dispose };
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const WATCH_TIPS = ['Drag to turn the view, scroll or pinch to zoom, right-drag to pan.',
  '1× is the pace of the video on the card: a time-lapse that slows down while the pieces move. The clock shows simulated time.'];
const PLAY_TIPS = ['Drag an arrow to move the highlighted piece, a ring to turn it. It stops wherever it would pass through another piece.',
  'Drag the background to turn the view, scroll or pinch to zoom.',
  'Show me how plays the reference solution\'s own motion of that piece, through the same check.'];
const GOAL_TEXT = { apart: 'Get the highlighted piece free of the rest.', reach: 'Bring the highlighted piece to where the reference put it.', rail: 'Guide the loop along the whole wire to its end.' };
const STEP_M = 0.002, STEP_RAD = 0.025, MAX_STEPS = 150;

export async function initOracle({ section, canvas, ui, families, tasks }) {
  const stage = createStage(canvas, { span: 1.0, cell: 0.05, every: 5, surface: true });
  const { scene, camera, renderer } = stage;
  stage.resize();
  const orbit = new OrbitControls(camera, renderer.domElement);
  Object.assign(orbit, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.5 });
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSize(0.8); gizmo.setSpace('local');
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; if (e.value && game) game.moves++; });

  let replay = null, fam = null, index = 0, f = 0, playing = true, speed = 1, showRobot = true, visible = false, token = 0;
  let mode = 'watch', game = null;                     // play: the puzzle, its last clear pose, the demo playing
  const playable = (fid) => (tasks[fid] || []).filter((e) => e.oracle);
  const canPlay = () => !!(replay && fam && PLAYABLE[replay.meta.base] !== undefined);

  function frameView([lo, hi]) {                        // a box, z-up, about the table-top centre
    const c = new THREE.Vector3((lo[0] + hi[0]) / 2, Math.max(0.02, (lo[2] + hi[2]) / 2), -(lo[1] + hi[1]) / 2);
    const span = Math.max(0.12, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    const fit = Math.min(2.2, Math.max(1, 1.25 / camera.aspect));
    const dist = 1.25 * fit * span / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dir = new THREE.Vector3(0.18, 0.62, 0.77).normalize();
    camera.position.copy(c).addScaledVector(dir, dist);
    orbit.target.copy(c);
    orbit.minDistance = 0.25 * span; orbit.maxDistance = 4 * dist;
    orbit.update(); orbit.saveState();
  }

  /* ---- play ---- */
  const tp = new THREE.Vector3(), tq = new THREE.Quaternion();
  let blockedTimer = 0;
  function showBlocked() { ui.blocked.classList.add('show'); clearTimeout(blockedTimer); blockedTimer = setTimeout(() => ui.blocked.classList.remove('show'), 700); }
  function progress() {
    const o = game.pz.moverObj, r = game.pz.evaluate(o.position, o.quaternion);
    ui.bar.style.width = `${(r.progress * 100).toFixed(1)}%`;
    if (r.solved && !game.won) {
      game.won = true; gizmo.detach();
      const demo = !!game.demo;
      ui.winTitle.textContent = demo ? 'One way through' : 'Solved';
      ui.winText.textContent = demo ? 'That was the reference solution\'s motion of this piece. Reset and find your own.'
        : `${game.moves} move${game.moves === 1 ? '' : 's'}. Now imagine doing it through a robot's cameras.`;
      ui.win.classList.add('show');
    }
  }
  function playReset() {
    const pz = game.pz;
    ui.win.classList.remove('show');
    pz.resetRail();
    Object.assign(game, { won: false, moves: 0, demo: null });
    replay.pose(0);
    if (pz.anchorTrack >= 0) replay.groups[pz.anchorTrack].position.z += pz.lift;   // held up, clear of the table
    pz.moverObj.position.copy(pz.start.p); pz.moverObj.quaternion.copy(pz.start.q);
    game.lastP = pz.start.p.clone(); game.lastQ = pz.start.q.clone();
    gizmo.attach(pz.moverObj);
    ui.bar.style.width = '0%';
  }
  gizmo.addEventListener('objectChange', () => {
    if (!game || game.demo) return;
    const o = game.pz.moverObj, np = o.position.clone(), nq = o.quaternion.clone();
    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(Math.max(game.lastP.distanceTo(np) / STEP_M, game.lastQ.angleTo(nq) / STEP_RAD))));
    let blocked = false;
    for (let k = 1; k <= steps; k++) {
      tp.lerpVectors(game.lastP, np, k / steps); tq.slerpQuaternions(game.lastQ, nq, k / steps);
      if (game.pz.collides(tp, tq)) { blocked = true; break; }
      game.okP.copy(tp); game.okQ.copy(tq);
    }
    if (!blocked) { game.okP.copy(np); game.okQ.copy(nq); }
    o.position.copy(game.okP); o.quaternion.copy(game.okQ);
    game.lastP.copy(game.okP); game.lastQ.copy(game.okQ);
    if (blocked) showBlocked();
    progress();
  });
  function setMode(next) {
    if (next === 'play' && !canPlay()) next = 'watch';
    mode = next;
    ui.modes.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const play = mode === 'play';
    ui.playctl.hidden = ui.progress.hidden = ui.solution.hidden = !play;
    ui.watchctl.hidden = ui.scrubber.hidden = play;
    ui.clock.parentElement.hidden = play;
    ui.robotToggle.hidden = play;
    ui.win.classList.remove('show');
    gizmo.detach();
    if (game) { game.pz.moverObj.traverse((o) => { if (o.isMesh) o.material = o.userData.baseMaterial; }); game = null; }
    replay.robotParts.forEach((m) => { m.visible = !play && showRobot; });
    if (play) {
      const pz = makePuzzle(replay, fam.id);
      pz.setTolerance(PLAYABLE[replay.meta.base]);
      game = { pz, okP: new THREE.Vector3(), okQ: new THREE.Quaternion() };
      pz.moverObj.traverse((o) => {                   // the piece in the visitor's hands glows a little
        if (!o.isMesh) return;
        o.userData.baseMaterial = o.material;
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0xd2683f); o.material.emissiveIntensity = 0.28;
      });
      ui.from.textContent = pz.rule.from; ui.to.textContent = pz.rule.to;
      frameView([pz.frame.min.toArray(), pz.frame.max.toArray()]);
      ui.goal.textContent = GOAL_TEXT[pz.rule.goal];
      playReset();
    } else {
      ui.goal.textContent = fam.text;
      frameView(replay.meta.box);
      f = 0; playing = true; ui.play.textContent = 'Pause';
      replay.pose(0);
    }
    const tips = play ? [...PLAY_TIPS] : WATCH_TIPS;
    if (play && game.pz.anchorTrack >= 0) tips.splice(1, 0, `The robot held both pieces; here the other one holds still${game.pz.lift > 0.01 ? ', lifted clear of the table,' : ''} and only how the two move against each other counts.`);
    ui.tips.innerHTML = tips.map((t) => `<li>${t}</li>`).join('');
  }
  function setGizmo(m) { gizmo.setMode(m); ui.move.classList.toggle('on', m === 'translate'); ui.turn.classList.toggle('on', m === 'rotate'); }

  async function select(fid, i = null, keepMode = false) {
    const list = playable(fid);
    if (!list.length) return;
    fam = families.find((x) => x.id === fid);
    if (i == null) { const m = list.findIndex((e) => e.difficulty === 'medium'); i = m >= 0 ? m : 0; }
    index = (i + list.length) % list.length;
    const e = list[index], my = ++token;
    ui.picker.querySelectorAll('[data-fam]').forEach((b) => b.classList.toggle('on', b.dataset.fam === fid));
    ui.name.textContent = fam.name;
    ui.step.textContent = `${e.nn} · ${e.level}`;
    ui.stepper.hidden = list.length < 2;
    ui.loading.hidden = false; ui.loading.textContent = 'loading';
    let next;
    try { next = await loadReplay(e.base); } catch (err) { console.error(err); ui.loading.textContent = 'Could not load this run.'; return; }
    if (my !== token) { next.dispose(); return; }
    gizmo.detach(); game = null;
    if (replay) { scene.remove(replay.root); replay.dispose(); }
    replay = next;
    scene.add(replay.root);
    ui.loading.hidden = true;
    ui.robot.textContent = replay.meta.robot === 'panda' ? '(one Panda arm)' : '(two ALOHA arms)';
    ui.base.textContent = e.base.replace('roboarc-', '');
    ui.modes.hidden = !canPlay();
    setMode(keepMode && canPlay() ? mode : 'watch');
    draw(performance.now(), 0);
  }

  ui.picker.innerHTML = families.filter((x) => playable(x.id).length).map((x) => {
    const e = playable(x.id).find((t) => t.poster) || {};
    const n = playable(x.id).filter((t) => PLAYABLE[t.base] !== undefined).length;
    return `<button class="pick" data-fam="${x.id}" role="tab"><img src="${e.poster || ''}" alt="" loading="lazy">${n ? '<em class="pick-tag">Play</em>' : ''}<span>${x.name}</span></button>`;
  }).join('');
  ui.picker.addEventListener('click', (ev) => { const b = ev.target.closest('[data-fam]'); if (b) select(b.dataset.fam); });
  ui.prev.addEventListener('click', () => fam && select(fam.id, index - 1, true));
  ui.next.addEventListener('click', () => fam && select(fam.id, index + 1, true));
  ui.modes.addEventListener('click', (ev) => { const b = ev.target.closest('[data-mode]'); if (b && replay) setMode(b.dataset.mode); });
  ui.move.addEventListener('click', () => setGizmo('translate'));
  ui.turn.addEventListener('click', () => setGizmo('rotate'));
  addEventListener('keydown', (e) => {
    if (!visible || mode !== 'play' || e.target.closest('input, textarea')) return;
    if (e.key === 'w' || e.key === 'W') setGizmo('translate');
    if (e.key === 'e' || e.key === 'E') setGizmo('rotate');
  });
  ui.play.addEventListener('click', () => {
    if (!replay) return;
    if (!playing && f >= replay.meta.frames - 1) f = 0;
    playing = !playing; ui.play.textContent = playing ? 'Pause' : 'Play';
  });
  ui.scrub.addEventListener('input', () => { if (!replay) return; f = ui.scrub.value / 1000 * (replay.meta.frames - 1); replay.pose(f); });
  ui.scrub.addEventListener('pointerdown', () => { playing = false; ui.play.textContent = 'Play'; });
  ui.speeds.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-speed]'); if (!b) return;
    speed = Number(b.dataset.speed);
    ui.speeds.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
  });
  ui.robotToggle.addEventListener('click', () => {
    showRobot = !showRobot;
    ui.robotToggle.classList.toggle('on', showRobot);
    ui.robotToggle.setAttribute('aria-pressed', String(showRobot));
    replay?.robotParts.forEach((m) => { m.visible = showRobot && mode === 'watch'; });
  });
  ui.restart.addEventListener('click', () => {
    if (!replay) return;
    orbit.reset();
    if (game) { playReset(); return; }
    f = 0; playing = true; ui.play.textContent = 'Pause';
  });
  ui.again.addEventListener('click', () => game && playReset());
  ui.solution.addEventListener('click', () => {
    if (!game) return;
    playReset(); gizmo.detach();
    game.demo = { t: 0 };
  });

  let running = false, last = performance.now();
  function draw(now, dt) {
    if (replay && mode === 'watch') {
      const M = replay.meta;
      if (playing) {
        f += dt * M.fps * speed;
        if (f >= M.frames - 1) { f = M.frames - 1; playing = false; ui.play.textContent = 'Play'; }
        replay.pose(f);
      }
      ui.scrub.value = String(Math.round(f / (M.frames - 1) * 1000));
      ui.clock.textContent = `${fmt(replay.simTime(f))} / ${fmt(M.sim_seconds)}`;
    } else if (game?.demo && !game.won) {             // the reference's path for this piece, at the video's pace
      const pz = game.pz, n = pz.path.length, M = replay.meta;
      game.demo.t += dt;
      const s = Math.min(n - 1, game.demo.t * M.fps / (M.frames / n));
      const i = Math.floor(s), j = Math.min(i + 1, n - 1), u = s - i;
      pz.moverObj.position.lerpVectors(pz.path[i].p, pz.path[j].p, u);
      pz.moverObj.quaternion.slerpQuaternions(pz.path[i].q, pz.path[j].q, u);
      progress();
      if (s >= n - 1 && !game.won) { game.demo = null; ui.winTitle.textContent = 'One way through'; ui.winText.textContent = 'That was the reference solution\'s motion of this piece.'; ui.win.classList.add('show'); }
    }
    orbit.update();
    renderer.render(scene, camera);
  }
  function loop(now) {
    if (!visible) { running = false; return; }
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    draw(now, dt);
    requestAnimationFrame(loop);
  }
  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    if (visible && !running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
  }, { rootMargin: '100px' }).observe(section);
  addEventListener('resize', () => { stage.resize(); if (!running) draw(performance.now(), 0); });

  setGizmo('translate');
  const first = new URLSearchParams(location.search).get('oracle');
  const firstFam = families.find((x) => first && first.startsWith(x.id)) || families.find((x) => playable(x.id).length);
  await select(firstFam.id);
  return { select, setMode, gizmo, get replay() { return replay; }, get game() { return game; }, setFrame(x) { f = x; replay?.pose(f); draw(performance.now(), 0); }, camera, orbit };
}
