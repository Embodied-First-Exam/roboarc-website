// Page orchestration: the name, day and night, the opening, the puzzle wall (oracle replays), the playable puzzles,
// the results and the rollouts. URL knobs for previews and screenshots:
//   ?name=robobind ...   the page under another candidate name (see BRANDS in index.html); ?names=1 adds a switcher
//   ?theme=dark          night
//   ?hero=0.5            freeze the opening at that scroll fraction; ?overview=1 a short static opening
//   ?focus=<section id>  open at a section;  ?puzzle=<id> open that puzzle in the play section
//   ?selftest=1          run the play section's self-test into body[data-selftest]
//   ?shortcut=id:tier    the samples a shortened solution path keeps, into body[data-shortcut] (export_oracle_poses.py)
//   ?board=sample        add invented rows, marked as samples, to preview the leaderboard with more entries
import { PLAY_PUZZLES } from './puzzles.js';

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

const GROUP_LABEL = { rigid: 'Rigid', precision: 'Precision', rope: 'Rope', soft: 'Cloth & fiber' };
const GROUPS = [['all', 'All'], ['rigid', 'Rigid'], ['precision', 'Precision'], ['rope', 'Rope'], ['soft', 'Cloth & fiber']];
const PUZZLES = [
  { id: 'interlocked_claws', name: 'Interlocked Claws', group: 'rigid', tags: ['interlock', 'rotation'],
    text: 'Separate the two claw pieces completely and hold both still for a moment.' },
  { id: 'cast_coil', name: 'Cast Coil', group: 'rigid', tags: ['interlock', 'assembly'],
    text: 'Fit the two cast halves together into their interlocking position, then let go.' },
  { id: 'cast_keyhole', name: 'Cast Keyhole', group: 'rigid', tags: ['interlock', 'clearance'],
    text: 'Get the silver keyhole piece free of the gold one and set it down inside the goal region.' },
  { id: 'hedgehog_in_cage', name: 'Hedgehog in a Cage', group: 'rigid', tags: ['enclosure', 'clearance'],
    text: 'Bring the spiky ball out between the bars and set it down, every spike inside the goal region.' },
  { id: 'horseshoe_ring', name: 'Horseshoe Ring', group: 'rigid', tags: ['linkage', 'loop'],
    text: 'Take the ring off two horseshoes joined by chain links, and set it in the goal region.' },
  { id: 'buzz_wire_3d', name: 'Buzz Wire 3D', group: 'precision', tags: ['clearance', 'path'],
    text: 'Guide the metal loop along the whole wire, start to finish, without ever touching it.' },
  { id: 'lock_picking', name: 'Lock Picking', group: 'precision', tags: ['insertion', 'order'],
    text: 'Push a tabbed key through three rotor plates and an end plate, following their slots and stops.' },
  { id: 'knot_untying', name: 'Knot Untying', group: 'rope', tags: ['knot', 'soft body'],
    text: 'Untie the rope and lay it out so that, seen from above, it crosses itself nowhere.' },
  { id: 'rope_threading', name: 'Rope Threading', group: 'rope', tags: ['threading', 'order'],
    text: 'Thread the rope through the rings in order, each one the way it faces.' },
  { id: 'slotted_post_ring', name: 'Slotted Post Ring', group: 'rope', tags: ['loop', 'soft body'],
    text: 'Get the metal ring off the slotted post, past the cord and its beads, into the goal region.' },
  { id: 'orbits', name: 'Orbits', group: 'rope', tags: ['loop', 'soft body'],
    text: 'Free the cord loop and its wooden handle from the rings and posts, and set both in the goal region.' },
  { id: 'fiber_bundling', name: 'Fiber Bundling', group: 'soft', tags: ['threading', 'soft body'],
    text: 'Pass every fine fiber and the sheath through a copper ring while the cable stays anchored.' },
  { id: 'blanket_flatten', name: 'Blanket Flatten', group: 'soft', tags: ['cloth', 'coverage'],
    text: 'Unfold a pleated blanket and spread it flat without folds or overlaps, then let go.' },
];
const TIERS = ['easy', 'medium', 'hard'];
const ROLLOUTS = [
  { id: 'claws-hard-privileged', title: 'Interlocked Claws, hard', mode: 'Privileged', ok: true,
    caption: 'Solved. The verifier replayed the submitted trajectory twice and both replays separated the claws.' },
  { id: 'claws-easy-standard', title: 'Interlocked Claws, easy', mode: 'Standard', ok: true,
    caption: 'Solved live from camera images, then solved again when the episode was replayed.' },
  { id: 'knot-easy-privileged', title: 'Knot Untying, easy', mode: 'Privileged', ok: true,
    caption: 'Solved. The rope is a finite-element model; it was untied and laid out flat.' },
  { id: 'blanket-easy-standard', title: 'Blanket Flatten, easy', mode: 'Standard', ok: true,
    caption: 'Solved from camera images alone.' },
  { id: 'coil-easy-privileged', title: 'Cast Coil, easy', mode: 'Privileged', ok: false,
    caption: 'Not solved. After six hours, the submitted trajectory did not bring the two halves together.' },
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

/* ---------- name preview (?names=1): reload the page under another candidate name ---------- */
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

/* ---------- 01 the puzzle wall: oracle replays, a tier switch per card ---------- */
const PLAYABLE = new Map(PLAY_PUZZLES.map((p) => [p.id, p.demoTips ? 'view' : 'play']));
let playRequest = null;
async function renderWall() {
  const wall = $('#wall'), filters = $('#filters');
  const oracle = await (await fetch('assets/data/oracle.json')).json().catch(() => ({}));
  wall.innerHTML = PUZZLES.map((p, i) => {
    const vids = oracle[p.id] || {}, tiers = TIERS.filter((t) => vids[t]), first = tiers.includes('medium') ? 'medium' : tiers[0];
    const play = PLAYABLE.get(p.id);
    const media = first
      ? `<video muted loop playsinline preload="none" poster="${vids[first].poster}" src="${vids[first].video}"></video>
         <div class="card-tiers" role="group" aria-label="Tier">${tiers.map((t) => `<button data-tier="${t}" class="${t === first ? 'on' : ''}">${t}</button>`).join('')}</div>
         <span class="card-speed">×${vids[first].speed}</span>`
      : `<img src="assets/media/posters/${p.id}.jpg" alt="${p.name}: the scene at the start" loading="lazy">`;
    const badge = play === 'play' ? `<a class="card-badge" href="#play" data-play="${p.id}">play it</a>`
      : play === 'view' ? `<a class="card-badge view" href="#play" data-play="${p.id}">3D view</a>`
      : first ? '' : '<span class="card-badge muted">oracle video soon</span>';
    return `
    <article class="card reveal" data-group="${p.group}" data-id="${p.id}">
      <div class="card-media frame">${media}${badge}</div>
      <div class="card-body">
        <div class="card-top"><span class="card-index">${String(i + 1).padStart(2, '0')}</span><h3 class="card-title">${p.name}</h3><span class="card-group">${GROUP_LABEL[p.group]}</span></div>
        <p class="card-text">${p.text}</p>
        <div class="tags">${p.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
      </div>
    </article>`;
  }).join('');
  filters.innerHTML = GROUPS.map(([g, label], i) => `<button class="chip${i ? '' : ' on'}" data-group="${g}">${label}</button>`).join('');
  filters.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    wall.querySelectorAll('.card').forEach((c) => c.classList.toggle('hidden', b.dataset.group !== 'all' && c.dataset.group !== b.dataset.group));
  });
  wall.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tier]');
    if (t) {                                       // switch the card's replay to another tier
      const card = t.closest('.card'), v = card.querySelector('video'), rec = oracle[card.dataset.id][t.dataset.tier];
      card.querySelectorAll('[data-tier]').forEach((b) => b.classList.toggle('on', b === t));
      card.querySelector('.card-speed').textContent = `×${rec.speed}`;
      v.poster = rec.poster; v.src = rec.video; v.play().catch(() => {});
      return;
    }
    const a = e.target.closest('[data-play]');
    if (a) {                                       // open that puzzle at the tier the card is showing
      const tier = a.closest('.card').querySelector('[data-tier].on')?.dataset.tier ?? null;
      playRequest = [a.dataset.play, tier];
      window.__play?.select(...playRequest);
    }
  });
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) e.target.play().catch(() => {}); else e.target.pause();
  }), { threshold: 0.4 });
  wall.querySelectorAll('video').forEach((v) => io.observe(v));
  wall.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));
}

/* ---------- 02 the playable puzzles, started when they come near the viewport ---------- */
function setupPlay() {
  const section = $('#play');
  const ui = { moves: $('#hud-moves'), time: $('#hud-time'), blocked: $('#hud-blocked'), freedom: $('#hud-freedom'),
    win: $('#play-win'), winTitle: $('#win-title'), winText: $('#win-text'), again: $('#win-again'),
    modeMove: $('#mode-move'), modeRotate: $('#mode-rotate'), reset: $('#btn-reset'), solution: $('#btn-solution'),
    picker: $('#play-picker'), name: $('#play-name'), goal: $('#play-goal'), mover: $('#play-mover'), tips: $('#play-tips'),
    ctlRigid: $('#ctl-rigid'), from: $('#hud-from'), to: $('#hud-to'), noSolution: $('#no-solution'), demo: $('#hud-demo'),
    tiers: $('#play-tiers'), modes: $('#play-modes') };
  let started = false;
  const go = () => {
    if (started) return; started = true;
    import('./play.js').then(({ initPlay }) => initPlay({ section, canvas: $('#play-canvas'), ui }))
      .then(async (api) => {
        window.__play = api;
        if (playRequest) await api.select(...playRequest);
        const st = params.get('selftest');
        if (st) document.body.dataset.selftest = JSON.stringify(await api.selfTest(st === '1' ? null : st.split(',')));
        const sc = params.get('shortcut');
        if (sc) document.body.dataset.shortcut = JSON.stringify(await api.shortcut(...sc.split(':')));
        if (params.get('puzzle')) await api.select(params.get('puzzle'));
      })
      .catch((err) => { console.error(err); ui.winTitle.textContent = 'The puzzle could not load'; ui.winText.textContent = String(err); ui.win.classList.add('show'); });
  };
  new IntersectionObserver(([e]) => { if (e.isIntersecting) go(); }, { rootMargin: '700px' }).observe(section);
}

/* ---------- 04 results: the leaderboard. A row is a model; the harness around it is a filter; VLA policies, which act
   without a harness, have their own table and only the standard mode. ---------- */
const MODES = ['privileged', 'standard'];
const SAMPLE_ROWS = [                 // ?board=sample: invented rows that preview the layout with more entries, never results
  { kind: 'agent', harness: 'Harness B', model: 'Model A', org: 'Lab A', counts: { privileged: [9, 39], standard: [4, 39] } },
  { kind: 'agent', harness: 'Harness B', model: 'Model B', org: 'Lab B', counts: { privileged: [3, 39], standard: [3, 39] } },
  { kind: 'agent', harness: 'Harness C', model: 'Model A', org: 'Lab A', counts: { privileged: [6, 39], standard: [5, 39] } },
  { kind: 'agent', harness: 'Harness C', model: 'Model C', org: 'Lab C', counts: { privileged: [2, 30], standard: [0, 31] } },
  { kind: 'vla', model: 'VLA policy A', org: 'Lab D', counts: { standard: [2, 39] } },
  { kind: 'vla', model: 'VLA policy B', org: 'Lab E', counts: { standard: [0, 39] } },
].map((e) => ({ ...e, sample: true }));

async function renderResults() {
  const r = await (await fetch('assets/data/results.json')).json();
  const perMode = PUZZLES.length * TIERS.length;
  const tally = (e, mode) => {
    if (e.kind === 'vla' && mode === 'privileged') return null;
    if (e.counts) return { solved: e.counts[mode][0], graded: e.counts[mode][1], of: perMode };
    const states = PUZZLES.flatMap((p) => TIERS.map((t) => e.cells[`${p.id}/${t}/${mode}`]));
    return { solved: states.filter((s) => s === 'escaped').length, graded: states.filter((s) => ['escaped', 'failed', 'infra'].includes(s)).length, of: perMode };
  };
  const sample = params.get('board') === 'sample';
  const rows = [...r.entries, ...(sample ? SAMPLE_ROWS : [])].map((e) => {
    const s = Object.fromEntries(MODES.map((m) => [m, tally(e, m)]));
    s.overall = s.privileged ? { solved: s.privileged.solved + s.standard.solved, graded: s.privileged.graded + s.standard.graded, of: 2 * perMode } : null;
    return { ...e, s };
  });
  const when = r.snapshot ? new Date(r.snapshot).toISOString().slice(0, 10) : '';
  $('#prelim').textContent = `snapshot ${when} · preliminary, the sweep is still running`;
  $('#sample-note').hidden = !sample;
  $('#n-agent').textContent = rows.filter((e) => e.kind === 'agent').length;
  $('#n-vla').textContent = rows.filter((e) => e.kind === 'vla').length;

  const view = { kind: 'agent', harness: 'all', sort: 'overall' };
  const harnesses = [...new Set(rows.filter((e) => e.kind === 'agent').map((e) => e.harness))];
  const chips = $('#harness-chips');
  chips.innerHTML = ['all', ...harnesses].map((h) => `<button class="chip${h === 'all' ? ' on' : ''}" data-harness="${h}">${h === 'all' ? 'All' : h}</button>`).join('');
  const label = { privileged: 'Privileged', standard: 'Standard', overall: 'Overall' };
  const score = (x, top, c) => (x ? `<td class="score${top && x.solved === top ? ' best' : ''}" data-label="${label[c]}">
      <div class="score-top"><b>${x.solved}</b><span>/ ${x.of}</span></div>
      <div class="bar"><i style="width:${(100 * x.solved / x.of).toFixed(1)}%"></i></div><small>${x.graded} graded</small></td>` : '<td class="score na">–</td>');

  function draw() {
    const agents = view.kind === 'agent';
    const cols = agents ? ['privileged', 'standard', 'overall'] : ['standard'];
    const key = agents ? view.sort : 'standard';
    const list = rows.filter((e) => e.kind === view.kind && (!agents || view.harness === 'all' || e.harness === view.harness))
      .sort((a, b) => b.s[key].solved - a.s[key].solved || cols.reduce((d, c) => d || b.s[c].solved - a.s[c].solved, 0));
    const top = Object.fromEntries(cols.map((c) => [c, Math.max(0, ...list.map((e) => e.s[c].solved))]));
    let rank = 0, prev = null;
    const body = list.map((e, i) => {
      if (e.s[key].solved !== prev) { rank = i + 1; prev = e.s[key].solved; }
      const sub = [e.org, e.setting].filter(Boolean).join(' · ');
      return `<tr class="${e.sample ? 'sample' : ''}"><td class="rank">${rank}</td>
        <td class="model"><b>${e.model}${e.sample ? '<em class="sample-tag">sample</em>' : ''}</b><small>${agents ? `<span class="h-inline">${e.harness} · </span>` : ''}${sub}</small></td>
        ${agents ? `<td class="hcol"><span class="hchip">${e.harness}</span></td>` : ''}
        ${cols.map((c) => score(e.s[c], top[c], c)).join('')}</tr>`;
    }).join('');
    const empty = agents ? 'No agent has been graded with this harness yet.' : 'No VLA policy has been evaluated yet.';
    $('#board').innerHTML = !body ? `<tbody><tr class="empty"><td>${empty}</td></tr></tbody>` : `<thead><tr><th class="rank">#</th><th>${agents ? 'Model' : 'Policy'}</th>${agents ? '<th class="hcol">Harness</th>' : ''}
      ${cols.map((c) => agents
        ? `<th class="sortable${c === key ? ' on' : ''}" aria-sort="${c === key ? 'descending' : 'none'}"><button data-sort="${c}">${label[c]}</button></th>`
        : `<th>${label[c]}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>`;
    $('#board-harness').hidden = !agents;
    $('#board-foot').textContent = agents
      ? `Instances solved out of ${perMode} in each mode, ${2 * perMode} overall; "graded" counts the attempts finished so far. More harnesses, models and VLA policies will be added as they are evaluated.`
      : 'A VLA policy maps camera images and joint readings straight to joint actions, so it runs in the standard mode only.';
  }
  $('#board-kind').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]'); if (!b) return;
    view.kind = b.dataset.kind;
    $('#board-kind').querySelectorAll('.tab').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    draw();
  });
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-harness]'); if (!b) return;
    view.harness = b.dataset.harness;
    chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  $('#board').addEventListener('click', (e) => { const b = e.target.closest('[data-sort]'); if (b) { view.sort = b.dataset.sort; draw(); } });
  draw();
}

/* ---------- 04 rollouts: two per row, each plays while it is on screen ---------- */
function renderRollouts() {
  const grid = $('#rollouts');
  grid.innerHTML = ROLLOUTS.map((r) => `
    <figure class="roll">
      <video muted loop playsinline preload="none" poster="assets/media/rollouts/${r.id}.jpg" src="assets/media/rollouts/${r.id}.mp4"></video>
      <div class="roll-meta"><b>${r.title}</b><span class="${r.ok ? 'ok' : 'no'}">${r.mode} · ${r.ok ? 'solved' : 'not solved'}</span></div>
      <p>${r.caption}</p>
    </figure>`).join('');
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) e.target.play().catch(() => {}); else e.target.pause();
  }), { threshold: 0.35 });
  grid.querySelectorAll('video').forEach((v) => io.observe(v));
}

/* ---------- reveal on scroll, the bar at the top, the active link ---------- */
const revealer = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
function setupNav() {
  const nav = $('.nav'), menu = $('#menu-toggle');
  const open = (on) => { nav.classList.toggle('open', on); menu.setAttribute('aria-expanded', String(on)); };
  menu.addEventListener('click', () => open(!nav.classList.contains('open')));      // narrow screens: the links in a card
  nav.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => open(false)));
  document.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));
  const links = [...document.querySelectorAll('.nav-links a')];
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
  }), { rootMargin: '-45% 0px -50% 0px' });
  ['puzzles', 'play', 'modes', 'results'].forEach((id) => io.observe(document.getElementById(id)));
}

setupNav();
renderWall().then(() => { if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: 'instant', block: 'start' }); }).catch((err) => console.error(err));
renderRollouts();
setupPlay();
renderResults().catch((err) => console.error(err));
if (focus) {
  const el = document.getElementById(focus);
  if (el) requestAnimationFrame(() => { el.scrollIntoView({ behavior: 'instant', block: 'start' }); document.querySelectorAll('.reveal').forEach((r) => r.classList.add('in')); });
}
