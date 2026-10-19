// Page orchestration: the name, day and night, the opening and the puzzle wall (reference solutions of RoboARC 0.1.0).
// URL knobs for previews and screenshots:
//   ?name=robotangle ... the page under another name (see BRANDS in index.html); ?names=1 adds a switcher
//   ?theme=dark          night
//   ?hero=0.5            freeze the opening at that scroll fraction; ?overview=1 a short static opening
//   ?focus=<section id>  open at a section

const params = new URLSearchParams(location.search);
const $ = (s, el = document) => el.querySelector(s);
// A small local server (python -m http.server) can drop a request when many arrive at once: retry a failed image once.
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el.tagName !== 'IMG' || el.dataset.retried) return;
  el.dataset.retried = '1';
  setTimeout(() => { el.src = `${el.src.split('?')[0]}?retry=1`; }, 600);
}, true);
const frozenHero = params.has('hero') ? Math.min(1, Math.max(0, parseFloat(params.get('hero')) || 0)) : null;
const focus = params.get('focus');
if (params.get('overview') === '1') document.documentElement.classList.add('overview');

const ALOHA = 'two ALOHA arms', PANDA = 'one Panda arm';
const GROUP_LABEL = { rigid: 'Rigid', rope: 'Rope & chain', cloth: 'Cloth' };
const GROUPS = [['all', 'All'], ['rigid', 'Rigid'], ['rope', 'Rope & chain'], ['cloth', 'Cloth']];
const FAMILIES = [   // the release's 14 families; texts follow the tasks' own goals
  { id: 'interlocked_claws', name: 'Interlocked Claws', group: 'rigid', robot: ALOHA,
    text: 'Unhook one claw piece from the other and place it inside the goal region.' },
  { id: 'cast_coil', name: 'Cast Coil', group: 'rigid', robot: ALOHA,
    text: 'Assemble the gold and silver pieces into a cube with flush outer faces, then let go.' },
  { id: 'cast_keyhole', name: 'Cast Keyhole', group: 'rigid', robot: ALOHA,
    text: 'Free the silver keyhole piece from the gold one and place it inside the goal region.' },
  { id: 'hedgehog_in_cage', name: 'Hedgehog in a Cage', group: 'rigid', robot: PANDA,
    text: 'Bring the spiky ball out between the bars and place it, every spike, inside the goal region.' },
  { id: 'horseshoe_ring', name: 'Horseshoe Ring', group: 'rigid', robot: ALOHA,
    text: 'Take the ring off two horseshoes joined by chains, and place it inside the goal region.' },
  { id: 'buzz_wire_3d', name: 'Buzz Wire 3D', group: 'rigid', robot: PANDA,
    text: 'Guide the metal loop along the whole wire without touching it, then set the tool on the finish support.' },
  { id: 'lock_picking', name: 'Lock Picking', group: 'rigid', robot: PANDA,
    text: 'Pick up a tabbed key and push it through the rotor plates and the end plate, following their slots and stops.' },
  { id: 'fiber_bundling', name: 'Fiber Bundling', group: 'rope', robot: PANDA,
    text: 'Pass every fine fiber and the front sheath through a copper ring while the rear terminal stays anchored.' },
  { id: 'rope_threading', name: 'Rope Threading', group: 'rope', robot: ALOHA,
    text: 'Thread the rope through the rings in order, each one the way it faces.' },
  { id: 'knot_untying', name: 'Knot Untying', group: 'rope', robot: ALOHA,
    text: 'Untie the rope and spread it so that, seen from above, it crosses itself nowhere.' },
  { id: 'slotted_post_ring', name: 'Slotted Post Ring', group: 'rope', robot: ALOHA,
    text: 'Get the metal ring off the slotted post, past the cord and its beads, into the goal region.' },
  { id: 'orbits', name: 'Orbits', group: 'rope', robot: ALOHA,
    text: 'Free the cord and its wooden handle from the post and stopper, and place both inside the goal region.' },
  { id: 'blanket_flatten', name: 'Blanket Flatten', group: 'cloth', robot: ALOHA,
    text: 'Unfold a crumpled blanket and spread it flat without overlaps, then let go and withdraw.' },
  { id: 'blanket_fold', name: 'Blanket Fold', group: 'cloth', robot: ALOHA,
    text: 'Fold a flat blanket into a target shape, such as a half fold, then let go and withdraw.' },
];
const LEVEL = { very_easy: 'Very easy', easier: 'Easier', easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/* ---------- day / night ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('site-theme', theme); } catch (e) { /* private mode: the choice lasts for this page only */ }
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#121417' : '#f4f6f9';
  dispatchEvent(new Event('themechange'));
}
$('#theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('meta[name="theme-color"]').content = document.documentElement.dataset.theme === 'dark' ? '#121417' : '#f4f6f9';

/* ---------- name preview (?names=1): reload the page under another name ---------- */
if (params.get('names') === '1') {
  const box = $('#name-switch'), sel = $('#name-select');
  sel.innerHTML = Object.entries(window.BRANDS).map(([k, [n]]) => `<option value="${k}"${k === window.BRAND ? ' selected' : ''}>${n}</option>`).join('');
  sel.addEventListener('change', () => { params.set('name', sel.value); location.search = params.toString(); });
  box.hidden = false;
}

/* ---------- the opening ---------- */
import('./hero.js')
  .then(({ initHero }) => initHero({ section: $('#top'), canvas: $('#hero-canvas'), frozen: frozenHero, progressBar: $('#hero-progress'), clock: $('#hero-clock') }))
  .catch((err) => { console.error(err); $('#hero-clock').textContent = '3D needs WebGL'; });

/* ---------- 01 the puzzle wall: one card per family, stepping through its tasks ---------- */
function mediaHTML(f, e) {
  if (e.video && e.orbit) return `<video muted loop playsinline preload="none" poster="${e.poster}" src="${e.video}"></video><span class="card-badge muted">start state · no reference solution</span>`;
  if (e.video) return `<video muted loop playsinline preload="none" poster="${e.poster}" src="${e.video}"></video><span class="card-speed">×${e.speed}</span>`;
  if (e.poster) return `<img src="${e.poster}" alt="${f.name} ${e.nn}: the target shape" loading="lazy"><span class="card-badge muted">target shape · video soon</span>`;
  return `<div class="card-empty">No reference video for this task yet.</div>`;
}
async function renderWall() {
  const wall = $('#wall'), filters = $('#filters');
  const data = await (await fetch('assets/data/roboarc.json')).json();
  const state = {};
  wall.innerHTML = FAMILIES.map((f, i) => {
    const list = data[f.id] || [];
    const medium = list.findIndex((e) => e.difficulty === 'medium' && e.video);
    const start = medium >= 0 ? medium : Math.max(0, list.findIndex((e) => e.video));
    state[f.id] = start;
    const e = list[start];
    return `
    <article class="card reveal" data-group="${f.group}" data-id="${f.id}">
      <div class="card-media frame">
        <div class="card-slot">${mediaHTML(f, e)}</div>
        <div class="card-step" role="group" aria-label="Task">
          <button data-step="-1" aria-label="Previous task">‹</button>
          <span class="card-step-label">${e.nn} · ${LEVEL[e.difficulty]}</span>
          <button data-step="1" aria-label="Next task">›</button>
        </div>
      </div>
      <div class="card-body">
        <div class="card-top"><span class="card-index">${String(i + 1).padStart(2, '0')}</span><h3 class="card-title">${f.name}</h3><span class="card-group">${GROUP_LABEL[f.group]}</span></div>
        <p class="card-text">${f.text}</p>
        <div class="tags"><span class="tag">${list.length} task${list.length === 1 ? '' : 's'}</span><span class="tag">${f.robot}</span><span class="tag card-base">${e.base.replace('roboarc-', '')}</span></div>
      </div>
    </article>`;
  }).join('');
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) en.target.play().catch(() => {}); else en.target.pause();
  }), { threshold: 0.4 });
  filters.innerHTML = GROUPS.map(([g, label], i) => `<button class="chip${i ? '' : ' on'}" data-group="${g}">${label}</button>`).join('');
  filters.addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip'); if (!b) return;
    filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    wall.querySelectorAll('.card').forEach((c) => c.classList.toggle('hidden', b.dataset.group !== 'all' && c.dataset.group !== b.dataset.group));
  });
  wall.addEventListener('click', (ev) => {           // step a card to the family's previous or next task
    const b = ev.target.closest('[data-step]'); if (!b) return;
    const card = b.closest('.card'), f = FAMILIES.find((x) => x.id === card.dataset.id), list = data[f.id];
    state[f.id] = (state[f.id] + Number(b.dataset.step) + list.length) % list.length;
    const e = list[state[f.id]];
    card.querySelector('.card-slot').innerHTML = mediaHTML(f, e);
    card.querySelector('.card-step-label').textContent = `${e.nn} · ${LEVEL[e.difficulty]}`;
    card.querySelector('.card-base').textContent = e.base.replace('roboarc-', '');
    const v = card.querySelector('video');
    if (v) { io.observe(v); v.play().catch(() => {}); }
  });
  wall.querySelectorAll('video').forEach((v) => io.observe(v));
  wall.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));
  return data;
}

/* ---------- 02 in 3D: the reference solutions redrawn from their replays ---------- */
function setupOracle(data) {
  const ids = ['picker', 'canvas', 'clock', 'loading', 'blocked', 'progress', 'from', 'to', 'bar', 'win', 'win-title', 'win-text', 'again', 'scrubber',
    'play', 'scrub', 'name', 'goal', 'modes', 'stepper', 'prev', 'step', 'next', 'playctl', 'move', 'turn', 'watchctl', 'speeds', 'robot', 'robot-kind',
    'tips', 'solution', 'restart', 'base'];
  const el = Object.fromEntries(ids.map((k) => [k, document.getElementById(`o-${k}`)]));
  const ui = { ...el, robot: el['robot-kind'], robotToggle: el.robot, winTitle: el['win-title'], winText: el['win-text'] };
  const tasks = Object.fromEntries(FAMILIES.map((f) => [f.id, (data[f.id] || []).map((e) => ({ ...e, level: LEVEL[e.difficulty] }))]));   // e.oracle: its replay is in assets/oracle/
  import('./oracle.js')
    .then(({ initOracle }) => initOracle({ section: $('#in3d'), canvas: el.canvas, ui, families: FAMILIES, tasks }))
    .then((o) => { window.oracle = o; })
    .catch((err) => { console.error(err); el.loading.hidden = false; el.loading.textContent = '3D needs WebGL'; });
}

/* ---------- reveal on scroll, the menu, the active link ---------- */
const revealer = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
function setupNav() {
  const nav = $('.nav'), menu = $('#menu-toggle');
  const open = (on) => { nav.classList.toggle('open', on); menu.setAttribute('aria-expanded', String(on)); };
  menu.addEventListener('click', () => open(!nav.classList.contains('open')));      // narrow screens: the links in a card
  nav.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => open(false)));
  document.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));
  // the section under the middle of the screen, measured on every scroll (the wall changes height as it loads)
  const links = [...document.querySelectorAll('.nav-links a')];
  const ids = ['puzzles', 'in3d', 'modes', 'results'];
  let queued = false;
  const spy = () => {
    queued = false;
    const mid = innerHeight / 2;
    const cur = ids.find((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
    links.forEach((a) => a.classList.toggle('active', !!cur && a.getAttribute('href') === `#${cur}`));
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(spy); } }, { passive: true });
  addEventListener('resize', spy);
  spy();
}

setupNav();
const teaser = $('#teaser');                          // the families' reel plays while it is on screen
new IntersectionObserver(([en]) => { if (en.isIntersecting) teaser.play().catch(() => {}); else teaser.pause(); }, { threshold: 0.3 }).observe(teaser);
renderWall().then((data) => { setupOracle(data); if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: 'instant', block: 'start' }); }).catch((err) => console.error(err));
if (focus) {
  const el = document.getElementById(focus);
  if (el) requestAnimationFrame(() => { el.scrollIntoView({ behavior: 'instant', block: 'start' }); document.querySelectorAll('.reveal').forEach((r) => r.classList.add('in')); });
}
