// The opening: scrolling plays the two-arm robot's disentanglement of the claws (robot.js), from a close look at the
// hooked pair to a wide shot of both arms holding them apart, while the captions take turns. At the end the camera
// steps back and the name comes in on the left.
import * as THREE from 'three';
import { createStage } from './stage.js';
import { createRobot } from './robot.js';

const MOTION = [0.06, 0.86];             // scroll window over which the recorded motion plays
// caption windows on scroll progress: fade in over [a, b], out over [c, d]
const WINDOWS = { kicker: [null, null, 0.03, 0.07], cue: [null, null, 0.02, 0.05], l1: [0.08, 0.12, 0.28, 0.33],
  l2: [0.35, 0.4, 0.55, 0.6], l3: [0.62, 0.67, 0.8, 0.85], title: [0.88, 0.94, 9, 9] };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function initHero({ section, canvas, frozen = null, progressBar = null, clock = null }) {
  const stage = createStage(canvas, { span: 0.9, cell: 0.05, every: 5 });
  const { scene, camera, root, renderer } = stage;
  const robot = await createRobot();
  root.add(robot.group);
  const centres = robot.pieces.map((p) => { p.mesh.geometry.computeBoundingBox(); return p.mesh.geometry.boundingBox.getCenter(new THREE.Vector3()); });

  const copy = [...section.querySelectorAll('[data-hero]')].map((el) => ({
    el, w: WINDOWS[el.dataset.hero], base: el.dataset.hero === 'cue' ? 'translateX(-50%) ' : '', title: el.dataset.hero === 'title' }));
  const c0 = new THREE.Vector3(), c1 = new THREE.Vector3(), mid = new THREE.Vector3(), target = new THREE.Vector3(), look = new THREE.Vector3();
  let shown = frozen ?? 0, visible = true, running = false, first = true;

  function progress() {
    if (frozen != null) return frozen;
    const r = section.getBoundingClientRect(), total = section.offsetHeight - innerHeight;
    return total > 0 ? clamp(-r.top / total) : 0;
  }

  function draw() {
    const p = progress();
    shown = frozen != null ? p : shown + (p - shown) * 0.12;   // ease toward the scroll position: no jumps

    const m = clamp((shown - MOTION[0]) / (MOTION[1] - MOTION[0]));
    robot.pose(m * (robot.frames - 1));
    c0.copy(centres[0]).applyMatrix4(robot.pieces[0].mesh.matrixWorld);
    c1.copy(centres[1]).applyMatrix4(robot.pieces[1].mesh.matrixWorld);
    mid.copy(c0).add(c1).multiplyScalar(0.5);
    if (first || frozen != null) { target.copy(mid); first = false; } else target.lerp(mid, 0.06);

    const reveal = smooth(0.86, 1.0, shown);
    const portrait = Math.min(2.4, Math.max(1, 1.3 / camera.aspect));   // narrow screens: step back so the picture fits
    const az = 0.38 - 0.55 * smooth(0.05, 0.86, shown) + 0.12 * reveal;
    const el = 0.34 + 0.06 * smooth(0.3, 0.86, shown) + 0.16 * reveal;
    const dist = (1.15 + 0.35 * smooth(0.2, 0.86, shown) + 1.75 * reveal) * portrait;
    // the wide shot looks a little above the robot, so it sits low in the frame, under the title's line
    look.copy(target).lerp(new THREE.Vector3(0.05, 0.62, 0.05), reveal);
    camera.position.set(look.x + dist * Math.sin(az) * Math.cos(el), look.y + dist * Math.sin(el), look.z + dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(look);
    // text sits on the left on wide screens: slide the picture right so it never covers the claws or the arms
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const wide = camera.aspect > 1.2;
    const shift = wide ? w * (0.12 * smooth(0.06, 0.12, shown) * (1 - reveal) + 0.22 * reveal) : 0;
    const drop = wide ? 0 : h * 0.18 * reveal;          // portrait: the title takes the top, the robot goes down
    if (shift > 0.5 || drop > 0.5) camera.setViewOffset(w, h, -shift, -drop, w, h); else camera.clearViewOffset();

    for (const c of copy) {
      const a = (c.w[0] == null ? 1 : smooth(c.w[0], c.w[1], shown)) * (1 - smooth(c.w[2], c.w[3], shown));
      c.el.style.opacity = a.toFixed(3);
      c.el.style.transform = `${c.base}translateY(${((1 - a) * (c.title ? 10 : 16)).toFixed(1)}px)`;
      c.el.style.pointerEvents = a > 0.5 ? 'auto' : 'none';
    }
    if (progressBar) progressBar.style.width = `${(m * 100).toFixed(1)}%`;
    if (clock) clock.textContent = `${fmt(m * robot.seconds)} / ${fmt(robot.seconds)}`;
    renderer.render(scene, camera);
  }

  function loop() {
    if (!visible) { running = false; return; }
    draw();
    requestAnimationFrame(loop);
  }
  function start() { if (!running) { running = true; requestAnimationFrame(loop); } }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(section);
  addEventListener('resize', () => { stage.resize(); if (!running) draw(); });
  addEventListener('themechange', () => { if (!running) draw(); });
  stage.resize();
  draw();
  start();
  return { redraw: draw };
}
