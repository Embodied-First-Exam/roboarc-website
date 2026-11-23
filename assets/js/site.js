// Page orchestration: the name, day and night, the opening, the puzzle wall (reference solutions of the paper's tasks)
// and the leaderboard.
// URL knobs for previews and screenshots:
//   ?name=robotangle ... the page under another name (see BRANDS in index.html); ?names=1 adds a switcher
//   ?theme=dark          night
//   ?hero=0.5            freeze the opening at that scroll fraction; ?overview=1 a short static opening
//   ?focus=<section id>  open at a section
//   ?reel=1              show the teaser reel under Figure 1; ?palette=paper draws the Standard bars in the paper's teal

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
if (params.get('palette') === 'paper') document.documentElement.dataset.palette = 'paper';

const ROBOT = { aloha2: 'ALOHA 2', franka_robotiq: 'Franka + Robotiq 2F-85', franka_bimanual: 'two Franka Pandas' };
// The paper's 19 puzzle families and its IKEA scenes, in the order of its six constraint types. Which type a family
// belongs to, its robot and its tasks are in assets/data/suite.json; the texts follow the tasks' own goals. `start` is
// the task a card opens on (its number, or the IKEA scene).
const FAMILIES = [
  { id: 'interlocked_claws', name: 'Interlocked claws', start: '05',         // the claws of Figure 1 and of the opening
    text: 'Unhook one claw piece from the other and place it inside the goal region.' },
  { id: 'cast_keyhole', name: 'Cast keyhole', start: '04',
    text: 'Free the silver keyhole piece from the gold one and place it inside the goal region.' },
  { id: 'cast_coil', name: 'Cast coil', start: '04',
    text: 'Assemble the gold and silver pieces into a cube with flush outer faces, then let go.' },
  { id: 'horseshoe_ring', name: 'Horseshoe ring', start: '04',
    text: 'Take the ring off two horseshoes joined by chains, and place it inside the goal region.' },
  { id: 'hedgehog_in_cage', name: 'Hedgehog in cage', start: '02',
    text: 'Bring the spiky ball out between the bars and place it, every spike, inside the goal region.' },
  { id: 'buzz_wire_3d', name: '3D buzz wire', start: '04',
    text: 'Guide the metal loop along the whole wire without touching it, then set the tool on the finish support.' },
  { id: 'lock_picking', name: 'Lock picking', start: '04',
    text: 'Pick up a tabbed key and push it through the rotor plates and the end plate, following their slots and stops.' },
  { id: 'bed_bolt', name: 'Bed bolt',
    text: 'Drive a bed frame\'s corner bolt into its threaded hole with an L-shaped key.' },
  { id: 'clock_assembling', name: 'Clock assembling',
    text: 'Assemble a watch movement\'s gear train, screw down its bridge, wind it and let it run.' },
  { id: 'battery_replacement', name: 'Battery replacement',
    text: 'Swap a game controller\'s two AA cells: pry the old ones out, seat new ones with the right polarity, latch the cover.' },
  { id: 'caliper_sorting', name: 'Caliper sorting',
    text: 'Measure look-alike sleeves with a vernier caliper and sort them into labelled bins.' },
  { id: 'ikea', name: 'IKEA furniture', unit: 'scene', start: 'gladom',
    text: 'Assemble a piece of IKEA furniture from its parts: frames crossed, screws driven, shelves snapped on.' },
  { id: 'knot_untying', name: 'Knot untying', start: '04',
    text: 'Untie the rope and spread it so that, seen from above, it crosses itself nowhere.' },
  { id: 'slotted_post_ring', name: 'Slotted post ring', start: '04',
    text: 'Get the metal ring off the slotted post, past the cord and its beads, into the goal region.' },
  { id: 'orbits', name: 'Orbits', start: '01',
    text: 'Free the cord and its wooden handle from the post and stopper, and place both inside the goal region.' },
  { id: 'rope_threading', name: 'Rope threading', start: '07',
    text: 'Thread the rope through the rings in order, each one the way it faces.' },
  { id: 'fiber_bundling', name: 'Fiber bundling', start: '04',
    text: 'Pass every fine fiber and the front sheath through a copper ring while the rear terminal stays anchored.' },
  { id: 'wire_splicing', name: 'Wire splicing',
    text: 'Splice two stiff wires: an eye round a rod, the other wire threaded and wound round it.' },
  { id: 'blanket_flatten', name: 'Blanket flatten', start: '08',
    text: 'Unfold a crumpled blanket and spread it flat without overlaps, then let go and withdraw.' },
  { id: 'blanket_fold', name: 'Blanket fold', start: '04',
    text: 'Fold a flat blanket into a target shape, such as a half fold, then let go and withdraw.' },
];

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

/* ---------- 01 the puzzle wall: one card per family with a clip, stepping through its tasks ---------- */
const stepLabel = (e) => e.label || e.nn;             // a task's number; an IKEA scene's name
function mediaHTML(e) {
  const video = `<video muted loop playsinline preload="none" poster="${e.poster}" src="${e.video}"></video>`;
  return e.orbit ? `${video}<span class="card-badge muted">start state</span>` : video;
}
async function renderWall() {
  const wall = $('#wall'), filters = $('#filters');
  const suite = await (await fetch('assets/data/suite.json')).json();
  const typeOf = Object.fromEntries(suite.types.flatMap((t) => t.families.map((id) => [id, t])));
  const clips = (id) => suite.families[id].tasks.filter((e) => e.video);
  const shown = FAMILIES.filter((f) => clips(f.id).length);              // a family joins the wall once it has a clip
  const state = {};
  wall.innerHTML = shown.map((f, i) => {
    const fam = suite.families[f.id], list = clips(f.id);
    const start = Math.max(0, list.findIndex((e) => e.nn === f.start));
    state[f.id] = start;
    const e = list[start];
    return `
    <article class="card reveal" data-group="${fam.type}" data-id="${f.id}" tabindex="0">
      <div class="card-media frame">
        <div class="card-slot">${mediaHTML(e)}</div>
        <div class="card-step" role="group" aria-label="Task">
          <button data-step="-1" aria-label="Previous task">‹</button>
          <span class="card-step-label">${stepLabel(e)}</span>
          <button data-step="1" aria-label="Next task">›</button>
        </div>
        <p class="card-goal">${f.text}</p>
      </div>
      <div class="card-body">
        <div class="card-top"><span class="card-index">${String(i + 1).padStart(2, '0')}</span><h3 class="card-title">${f.name}</h3><span class="card-group">${typeOf[f.id].name}</span></div>
      </div>
    </article>`;
  }).join('');
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) en.target.play().catch(() => {}); else en.target.pause();
  }), { threshold: 0.4 });
  filters.innerHTML = [{ id: 'all', name: 'All' }, ...suite.types].filter((t) => t.id === 'all' || shown.some((f) => typeOf[f.id] === t))
    .map((t, i) => `<button class="chip${i ? '' : ' on'}" data-group="${t.id}">${t.name}</button>`).join('');
  filters.addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip'); if (!b) return;
    filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    wall.querySelectorAll('.card').forEach((c) => c.classList.toggle('hidden', b.dataset.group !== 'all' && c.dataset.group !== b.dataset.group));
  });
  wall.addEventListener('click', (ev) => {           // step a card to the family's previous or next task
    const b = ev.target.closest('[data-step]'); if (!b) return;
    const card = b.closest('.card'), id = card.dataset.id, list = clips(id);
    state[id] = (state[id] + Number(b.dataset.step) + list.length) % list.length;
    const e = list[state[id]];
    card.querySelector('.card-slot').innerHTML = mediaHTML(e);
    card.querySelector('.card-step-label').textContent = stepLabel(e);
    const v = card.querySelector('video');
    if (v) { io.observe(v); v.play().catch(() => {}); }
  });
  wall.querySelectorAll('video').forEach((v) => io.observe(v));
  wall.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));
  return suite;
}

/* ---------- 04 leaderboard (assets/data/results.json: the paper's two result tables) ----------
   In the Embodied First Exam leaderboard's look (its assets/app.js lbRow / lbAxis and exam.css .lbh): one setting at a
   time behind a switch, one bar per model, longest first, the maker's mark, gold / silver / bronze for the first three,
   the share and its spread at the end of the row. */
const TYPE_HEAD = { interlocking: ['Interl.', 'Interlocking'], narrow_passage: ['Passage', 'Narrow passage'], assembly: ['Assem.', 'Assembly'],
  untangling: ['Untang.', 'Untangling'], threading: ['Thread.', 'Threading'], shape_control: ['Shape', 'Shape control'], all: ['All', 'All 90 tasks'] };
const REGIMES = [['standard', 'Standard'], ['privileged', 'Privileged']];   // the paper's column order
const rate = (v) => (v === 0 ? '0' : v.toFixed(1));
const HARNESS = { DSH: 'DeepSeek Harness' };            // the paper's table abbreviates it
const lbAxis = (n) => `<div class="lbh-axis"><span></span><span class="lbh-ticks" aria-hidden="true">${[0, 25, 50, 75, 100]
  .map((v) => `<i style="left:${v}%">${v}%</i>`).join('')}</span><span class="lbh-n">${n}</span></div>`;
/** One ranked row: place, maker's mark, model with harness and effort, an ink bar (deeper for higher), the share. */
function lbRow({ rank, model, mark, sub, q, em, best, title }) {
  const k = Math.round(38 + 62 * q / Math.max(best, 1));
  return `<div class="lbh-row" style="--i:${Math.min(rank, 12)}" title="${title}">
    <span class="rk r${q > 0 ? rank : 0}">${q > 0 ? rank : '·'}</span>${mark}
    <span class="lbh-name"><span class="lbh-nl"><b>${model}</b><span class="lbh-set">${sub}</span></span></span>
    <span class="lbh-track"><span class="lbh-s" style="--w:${q.toFixed(1)}%;--k:${k}%"></span></span>
    <span class="lbh-val" style="--k:${k}%"><b>${rate(q)}<small>%</small></b><em>${em}</em></span></div>`;
}
/** A board: the switch for its settings, the scale, then the rows of the setting shown, ranked by it (ties share a place). */
function board(el, settings, rowsOf) {
  let on = settings[0][0];
  el.innerHTML = `<div class="lbh-top"><div class="seg lb-set" role="tablist">${settings.map(([id, label]) =>
    `<button role="tab" data-set="${id}">${label}</button>`).join('')}</div></div><div class="lbh-chart"></div>`;
  const draw = () => {
    el.querySelectorAll('[data-set]').forEach((b) => { b.classList.toggle('on', b.dataset.set === on); b.setAttribute('aria-selected', String(b.dataset.set === on)); });
    const { n, rows } = rowsOf(on);
    const sorted = [...rows].sort((a, b) => b.q - a.q), best = sorted.length ? sorted[0].q : 0;
    let rank = 0, prev = null;
    $('.lbh-chart', el).innerHTML = lbAxis(n) + `<div class="lbh-rows">${sorted.map((r, i) => {
      if (r.q !== prev) { rank = i + 1; prev = r.q; }
      return lbRow({ ...r, rank, best });
    }).join('')}</div>`;
  };
  el.addEventListener('click', (ev) => { const b = ev.target.closest('[data-set]'); if (b) { on = b.dataset.set; draw(); } });
  draw();
}
async function renderResults() {
  const [r, { makerMark }] = await Promise.all([fetch('assets/data/results.json?v=2026-11-22-scenes2').then((x) => x.json()), import('./makers.js?v=2026-11-22-scenes2')]);
  // coding agents: Standard or Privileged, the mean over the runs, ± its s.d.
  board($('#lb-agents'), REGIMES, (regime) => ({
    n: `${r.tasks ?? 90} tasks`,
    rows: r.agents.map((a) => ({ model: a.model, mark: makerMark(a.model), sub: `${HARNESS[a.harness] || a.harness} · ${a.effort}`,
      q: a[regime].all, em: `±${a[regime].sd.toFixed(1)}`,
      title: `${a.model}, ${regime}: ${rate(a[regime].all)} % ± ${a[regime].sd.toFixed(1)} (mean ± s.d. of ${r.runs} runs)` })),
  }));
  // VLA policies, a reference on their own puzzles: episodes solved, or episodes in which the gripper touched the object
  const v = r.vla;
  board($('#lb-vla'), [['all', 'Solved'], ['touched', 'Touched the object']], (key) => ({
    n: `${v.puzzles.all} puzzles`,
    rows: v.policies.map((p) => ({ model: p.name, mark: '<span class="mk txt">VLA</span>', sub: 'Standard · zero-shot', q: p[key], em: '',
      title: `${p.name.replace(/<[^>]+>/g, '')}: solved ${rate(p.all)} %, touched the task object in ${rate(p.touched)} % of the episodes (${v.runs_per_puzzle} runs per puzzle)` })),
  }));
  // the two tabs
  const tabs = $('#lb-tabs');
  tabs.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tab]'); if (!b) return;
    tabs.querySelectorAll('[data-tab]').forEach((t) => { t.classList.toggle('on', t === b); t.setAttribute('aria-selected', String(t === b)); });
    $('#lb-agents').hidden = b.dataset.tab !== 'agents';
    $('#lb-vla').hidden = b.dataset.tab !== 'vla';
    $('#bytype').hidden = b.dataset.tab !== 'agents';
  });
  // behind the toggle: the paper's table per constraint type
  const cols = [...r.columns, 'all'];
  const value = (a, regime, k) => (k < r.columns.length ? a[regime].cells[k] : a[regime].all);
  const best = Object.fromEntries(REGIMES.map(([regime]) => [regime, cols.map((_, k) => Math.max(...r.agents.map((a) => value(a, regime, k))))]));
  const cell = (a, regime, k) => {
    const x = value(a, regime, k), all = k === r.columns.length;
    const text = x === best[regime][k] ? `<b>${rate(x)}</b>` : rate(x);
    return `<td class="${regime}${all ? ' all' : ''}" style="--p:${(x * 0.42).toFixed(1)}%">${text}${all ? `<small>±${a[regime].sd.toFixed(1)}</small>` : ''}</td>`;
  };
  const groups = [...new Set(r.agents.map((a) => a.group))];
  $('#results-table').innerHTML = `
    <thead>
      <tr><th class="l" rowspan="2">Agent</th><th class="l harness" rowspan="2">Harness (effort)</th>${REGIMES.map(([regime, label]) => `<th class="regime ${regime}" colspan="${cols.length}">${label}</th>`).join('')}</tr>
      <tr>${REGIMES.map(([regime]) => cols.map((c) => `<th class="${regime}${c === 'all' ? ' all' : ''}"><abbr title="${TYPE_HEAD[c][1]}">${TYPE_HEAD[c][0]}</abbr></th>`).join('')).join('')}</tr>
    </thead>
    <tbody>${groups.map((g) => `<tr class="group"><td class="l" colspan="${2 + 2 * cols.length}">${g}</td></tr>${r.agents.filter((a) => a.group === g).map((a) => `
      <tr><th class="l" scope="row">${a.model}<span class="sub">${HARNESS[a.harness] || a.harness} (${a.effort})</span></th><td class="l harness">${HARNESS[a.harness] ? `<abbr title="${HARNESS[a.harness]}">${a.harness}</abbr>` : a.harness} <span class="effort">(${a.effort})</span></td>${REGIMES.map(([regime]) => cols.map((_, k) => cell(a, regime, k)).join('')).join('')}</tr>`).join('')}`).join('')}</tbody>`;
}

/* ---------- 02 in 3D: the reference solutions redrawn from their replays ---------- */
function setupOracle(data) {
  const ids = ['picker', 'canvas', 'clock', 'loading', 'blocked', 'progress', 'from', 'to', 'bar', 'win', 'win-title', 'win-text', 'again', 'scrubber',
    'play', 'scrub', 'name', 'goal', 'modes', 'stepper', 'prev', 'step', 'next', 'playctl', 'move', 'turn', 'watchctl', 'speeds', 'robot', 'robot-kind',
    'hint', 'solution', 'restart'];
  const el = Object.fromEntries(ids.map((k) => [k, document.getElementById(`o-${k}`)]));
  const ui = { ...el, robot: el['robot-kind'], robotToggle: el.robot, winTitle: el['win-title'], winText: el['win-text'] };
  const tasks = Object.fromEntries(FAMILIES.map((f) => [f.id, data.families[f.id].tasks]));   // e.oracle: its replay is in assets/oracle/
  import('./oracle.js?v=2026-11-22-scenes2')
    .then(({ initOracle }) => initOracle({ section: $('#in3d'), canvas: el.canvas, ui, families: FAMILIES, tasks, robots: ROBOT }))
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
  const ids = ['puzzles', 'in3d', 'modes', 'results', 'start'];
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
if (params.get('reel') === '1') {                     // the families' reel plays while it is on screen
  const teaser = $('#teaser');
  $('#reel').hidden = false;
  new IntersectionObserver(([en]) => { if (en.isIntersecting) teaser.play().catch(() => {}); else teaser.pause(); }, { threshold: 0.3 }).observe(teaser);
}
renderResults().catch((err) => console.error(err));
renderWall().then((data) => { setupOracle(data); if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: 'instant', block: 'start' }); }).catch((err) => console.error(err));
if (focus) {
  const el = document.getElementById(focus);
  if (el) requestAnimationFrame(() => { el.scrollIntoView({ behavior: 'instant', block: 'start' }); document.querySelectorAll('.reveal').forEach((r) => r.classList.add('in')); });
}
