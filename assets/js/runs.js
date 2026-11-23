// The agent runs of the RoboARC results table: a list with filters, and one run step by step. The data is the public
// dataset RoboARC/RoboARC-runs: index.json, index/roboarc.json (one row per run) and runs/<h2>/<slug>/ with run.json,
// steps.bin (the pictures the agent saw, read by byte range), replay.mp4 and poster.jpg; h2 = sha1(slug)[:2].
const Q = new URLSearchParams(location.search);
const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const DATA = LOCAL && Q.get('data') ? Q.get('data').replace(/\/?$/, '/') : 'https://huggingface.co/datasets/RoboARC/RoboARC-runs/resolve/main/';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const int = (n) => Number(n || 0).toLocaleString('en-US');
const clock = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const kTok = (n) => (n == null ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

const AGENTS = ['GPT-6 Astra', 'GPT-6.1 Sol', 'Claude Opus 5.5', 'Gemini 4 Argon', 'Kimi 3.1 Pro', 'DeepSeek v4.1 Flash', 'GLM 5.3 Flash'];
const CONSTRAINTS = { interlocking: 'Interlocking', narrow_passage: 'Narrow passage', assembly: 'Fitting & assembly', untangling: 'Untangling', threading: 'Threading & routing', shape_control: 'Shape control' };
const KINDS = { robot: ['Robot', 'moves the robot'], look: ['Pictures', 'looks at'], edit: ['Edits', 'edits'], shell: ['Shell', 'runs'], other: ['Other', 'calls'] };
const KIND_ORDER = ['robot', 'look', 'edit', 'shell'];

function sha1hex(str) {
  const b = new TextEncoder().encode(str), n = ((b.length + 8) >> 6) + 1, w = new Uint32Array(n * 16), x = new Uint32Array(80);
  for (let i = 0; i < b.length; i++) w[i >> 2] |= b[i] << (24 - (i & 3) * 8);
  w[b.length >> 2] |= 0x80 << (24 - (b.length & 3) * 8);
  w[n * 16 - 1] = b.length * 8;
  const rol = (v, k) => (v << k) | (v >>> (32 - k));
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  for (let i = 0; i < w.length; i += 16) {
    for (let t = 0; t < 80; t++) x[t] = t < 16 ? w[i + t] : rol(x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16], 1);
    let [a, bb, c, d, e] = h;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & d) : t < 40 || t >= 60 ? bb ^ c ^ d : (bb & c) | (bb & d) | (c & d);
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rol(a, 5) + f + e + k + x[t]) >>> 0;
      e = d; d = c; c = rol(bb, 30) >>> 0; bb = a; a = tmp;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + bb) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}
const runBase = (slug) => `${DATA}runs/${sha1hex(slug).slice(0, 2)}/${slug}/`;
const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const pageLink = (params) => { const u = new URLSearchParams(params); for (const k of ['data', 'theme']) if (Q.get(k)) u.set(k, Q.get(k)); const s = u.toString(); return s ? `?${s}` : './'; };
const titleOf = (r) => (r.base || r.task).replace(/^roboarc-/, '').replace(/-i0\d$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bIkea\b/, 'IKEA').replace(/\b3d\b/i, '3D');
const verdict = (r) => (r.success === 1 ? '<span class="verdict ok">Solved</span>' : '<span class="verdict no">Not solved</span>');
const bars = (k) => `<span class="bars">${KIND_ORDER.map((x) => `<span class="k-${x}" style="flex:${k?.[x] || 0}" title="${KINDS[x][0]}: ${int(k?.[x])}"></span>`).join('')}</span>`;

/* ---------- nav ---------- */
function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('site-theme', t); } catch (e) { /* private mode */ } $('meta[name="theme-color"]').content = t === 'dark' ? '#121417' : '#f4f6f9'; }
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
$('#theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#menu-toggle').addEventListener('click', () => { const open = $('.nav').classList.toggle('open'); $('#menu-toggle').setAttribute('aria-expanded', open); });

/* ---------- the list ---------- */
async function listPage() {
  const head = $('#runs-head'), body = $('#runs-body');
  head.innerHTML = '<p class="kicker">Agent runs</p><h1>Watch an agent work</h1><p class="lead" id="ri-lead">The coding-agent runs behind the results table, step by step.</p>';
  body.innerHTML = '<div class="run-state"><span class="spin"></span>Loading the runs…</div>';
  let rows;
  try { rows = (await getJSON(`${DATA}index/roboarc.json`)).runs; } catch (e) {
    body.innerHTML = `<div class="run-state">The list of runs could not be loaded (${esc(e.message)}). <a class="btn" href="${esc(location.href)}">Try again</a></div>`; return;
  }
  const ag = (r) => { const i = AGENTS.indexOf(r.agent); return i < 0 ? 99 : i; };
  rows.sort((a, b) => a.base.localeCompare(b.base) || ag(a) - ag(b) || a.regime.localeCompare(b.regime) * -1 || a.seed_run - b.seed_run);
  const nTasks = new Set(rows.map((r) => r.base)).size, nAgents = new Set(rows.map((r) => r.agent)).size;
  $('#ri-lead').textContent = `${int(rows.length)} runs: ${nAgents} coding agent${nAgents > 1 ? 's' : ''} on ${nTasks} puzzle${nTasks > 1 ? 's' : ''}, in the Standard and Privileged regimes. Open one to read what the agent wrote, ran and saw.`;
  const families = [...new Map(rows.map((r) => [r.family, r.family_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const st = { q: Q.get('q') || '', agent: Q.get('agent') || '', constraint: Q.get('constraint') || '', family: Q.get('family') || '', regime: Q.get('regime') || '', out: Q.get('out') || '', page: Math.max(1, +Q.get('page') || 1) };
  const opt = (v, n, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(n)}</option>`;
  body.innerHTML = `<div class="ri-tools">
      <input type="search" id="f-q" placeholder="Search puzzles" aria-label="Search puzzles" value="${esc(st.q)}">
      <select id="f-agent" aria-label="Agent">${opt('', 'All agents', st.agent)}${AGENTS.filter((a) => rows.some((r) => r.agent === a)).map((a) => opt(a, a, st.agent)).join('')}</select>
      <select id="f-constraint" aria-label="Constraint type">${opt('', 'All constraint types', st.constraint)}${Object.entries(CONSTRAINTS).filter(([k]) => rows.some((r) => r.constraint === k)).map(([k, n]) => opt(k, n, st.constraint)).join('')}</select>
      <select id="f-family" aria-label="Family">${opt('', 'All families', st.family)}${families.map(([k, n]) => opt(k, n, st.family)).join('')}</select>
      <select id="f-regime" aria-label="Regime">${opt('', 'Both regimes', st.regime)}${opt('Standard', 'Standard', st.regime)}${opt('Privileged', 'Privileged', st.regime)}</select>
    </div>
    <div class="ri-sub">${[['', 'All'], ['ok', 'Solved'], ['no', 'Not solved']].map(([v, n]) => `<button type="button" class="chip${v === st.out ? ' on' : ''}" data-out="${v}">${n}</button>`).join('')}<span class="ri-count" id="ri-count"></span></div>
    <div class="ri-list" id="ri-list"></div><nav class="ri-pager" id="ri-pager" aria-label="Pages"></nav>`;
  const PER = 50;
  const row = (r) => `<a class="rr" href="${esc(pageLink({ r: r.slug }))}">
      <span class="rr-pic">${r.poster ? `<img loading="lazy" src="${esc(runBase(r.slug) + r.poster)}" alt="">` : ''}</span>
      <span class="rr-task"><b>${esc(titleOf(r))}</b><small>${esc(CONSTRAINTS[r.constraint] || '')}</small></span>
      <span class="rr-agent"><span>${esc(r.agent)}</span><small>${esc(r.harness)} · ${esc(r.effort)}</small></span>
      <span class="rr-reg">${esc(r.regime)}</span><span class="rr-n">${r.seed_run}</span>${verdict(r)}
      <span class="rr-n">${clock(r.wall_s)}</span><span class="rr-n">${int(r.steps)}</span>${bars(r.kinds)}</a>`;
  const draw = () => {
    const q = st.q.trim().toLowerCase();
    const list = rows.filter((r) => (!st.agent || r.agent === st.agent) && (!st.constraint || r.constraint === st.constraint) && (!st.family || r.family === st.family) && (!st.regime || r.regime === st.regime)
      && (!st.out || (st.out === 'ok') === (r.success === 1)) && (!q || `${titleOf(r)} ${r.family_name} ${r.agent}`.toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(list.length / PER)); st.page = Math.min(st.page, pages);
    const shown = list.slice((st.page - 1) * PER, st.page * PER);
    $('#ri-list').innerHTML = shown.length ? `<div class="rr rr-head"><span></span><span>Puzzle</span><span>Agent</span><span>Regime</span><span class="rr-n">Run</span><span>Verdict</span><span class="rr-n">Agent time</span><span class="rr-n">Steps</span><span>Actions</span></div>${shown.map(row).join('')}` : '<div class="run-state" style="padding:24px">No run matches these filters.</div>';
    $('#ri-count').textContent = shown.length ? `${int((st.page - 1) * PER + 1)}–${int((st.page - 1) * PER + shown.length)} of ${int(list.length)} runs` : '0 runs';
    const nums = [...new Set([1, pages, st.page - 1, st.page, st.page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    $('#ri-pager').innerHTML = pages < 2 ? '' : `<button data-p="${st.page - 1}" ${st.page === 1 ? 'disabled' : ''} aria-label="Previous page">←</button>${nums.map((n, i) => `${i && n - nums[i - 1] > 1 ? '<span>…</span>' : ''}<button data-p="${n}" class="${n === st.page ? 'on' : ''}">${n}</button>`).join('')}<button data-p="${st.page + 1}" ${st.page === pages ? 'disabled' : ''} aria-label="Next page">→</button>`;
    const u = new URLSearchParams(); for (const k of ['q', 'agent', 'constraint', 'family', 'regime', 'out']) if (st[k]) u.set(k, st[k]); if (st.page > 1) u.set('page', st.page); for (const k of ['data', 'theme']) if (Q.get(k)) u.set(k, Q.get(k));
    history.replaceState(null, '', u.toString() ? `?${u}` : location.pathname);
  };
  const set = (k, v) => { st[k] = v; st.page = 1; draw(); };
  $('#f-q').addEventListener('input', (e) => set('q', e.target.value));
  for (const k of ['agent', 'constraint', 'family', 'regime']) $(`#f-${k}`).addEventListener('change', (e) => set(k, e.target.value));
  $$('.ri-sub .chip').forEach((c) => c.addEventListener('click', () => { $$('.ri-sub .chip').forEach((d) => d.classList.toggle('on', d === c)); set('out', c.dataset.out); }));
  $('#ri-pager').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (b && !b.disabled) { st.page = +b.dataset.p; draw(); $('#ri-list').scrollIntoView({ block: 'start', behavior: 'smooth' }); } });
  draw();
}

/* ---------- pictures: byte ranges of steps.bin, through the CDN address the dataset redirects to ---------- */
function stepPictures(url, mime) {
  let cdn = null, resolving = null;
  const got = new Map();
  const resolve = () => (resolving ??= fetch(url, { headers: { Range: 'bytes=0-0' } }).then(async (r) => {
    if (!r.ok) throw new Error(`steps.bin: HTTP ${r.status}`);
    await r.arrayBuffer(); cdn = r.url || url; return cdn;
  }).finally(() => { resolving = null; }));
  const read = async ([off, len]) => {
    for (let k = 0; k < 2; k++) {
      const u = cdn || await resolve();
      const r = await fetch(u, { headers: { Range: `bytes=${off}-${off + len - 1}` } }).catch(() => null);
      if (r && (r.status === 206 || r.status === 200)) {
        let b = await r.blob();
        if (r.status === 200) b = b.slice(off, off + len);
        return URL.createObjectURL(new Blob([b], { type: mime || 'image/jpeg' }));
      }
      cdn = null;
    }
    throw new Error('steps.bin: picture not readable');
  };
  return (p) => { if (!got.has(p[0])) { const q = read(p); got.set(p[0], q); q.catch(() => got.delete(p[0])); } return got.get(p[0]); };
}
const prose = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>')}</p>`).join('');

/* ---------- one run ---------- */
async function runPage(slug) {
  const head = $('#runs-head'), body = $('#runs-body');
  if (!/^[a-z0-9._-]+$/.test(slug)) slug = '';
  head.innerHTML = '<p class="kicker">Run</p><h1>&nbsp;</h1>';
  body.innerHTML = '<div class="run-state"><span class="spin"></span>Loading the run…</div>';
  let r;
  try { if (!slug) throw new Error('no run'); r = await getJSON(`${runBase(slug)}run.json`); } catch (e) {
    head.innerHTML = '<p class="kicker">Run</p><h1>Run not found</h1>';
    body.innerHTML = `<div class="run-state">This run could not be loaded. <a class="btn" href="${esc(pageLink({}))}">All runs</a></div>`; return;
  }
  const file = (f) => runBase(slug) + f, steps = r.steps || [], solved = r.success === 1;
  document.title = `${titleOf(r)} · ${r.agent} · RoboARC`;
  const total = Math.max(1, (steps[steps.length - 1]?.t || 0) + 5);   // the strip spans the steps the agent took
  const est = r.step_times && r.step_times !== 'recorded', at = (t) => `${est ? '≈' : ''}${clock(t)}`;
  const count = (k) => steps.reduce((a, s) => a + (s.calls || []).filter((c) => c.kind === k).length, 0);
  const nPics = steps.reduce((a, s) => a + (s.out?.pics?.length || 0), 0);
  head.innerHTML = `<p class="kicker">${esc(CONSTRAINTS[r.constraint] || '')} · ${esc(r.family_name)} · ${esc(r.regime)} · run ${esc(r.seed_run)}</p>
    <h1>${esc(titleOf(r))}</h1>
    <div class="run-top"><span class="run-who">${esc(r.agent)} <small>${esc(r.harness)} · ${esc(r.effort)}</small></span>${verdict(r)}
      <span class="run-links"><a class="btn" href="${esc(pageLink({}))}">All runs</a><a class="btn" href="${esc(pageLink({ agent: r.agent, family: r.family }))}">This agent on ${esc(r.family_name)}</a></span></div>
    <dl class="run-stats">
      <div><dt>Agent time</dt><dd>${clock(r.wall_s)}</dd></div>
      <div><dt>Model steps</dt><dd>${int(steps.length)}</dd></div>
      <div><dt>Robot commands</dt><dd>${int(Math.max(r.sim_total?.submit || 0, count('robot')))}${r.sim_total?.reset ? `<small> · ${r.sim_total.reset} reset${r.sim_total.reset > 1 ? 's' : ''}</small>` : ''}</dd></div>
      <div><dt>Pictures seen</dt><dd>${int(nPics)}</dd></div>
      <div><dt>Tokens</dt><dd>${kTok(r.tokens?.in)}<small> in · ${kTok(r.tokens?.out)} out</small></dd></div>
    </dl>
    ${r.task_text ? `<details class="run-task"><summary>The task, as the agent read it</summary><pre>${esc(r.task_text)}</pre></details>` : ''}`;
  const picOf = r.steps_bin ? stepPictures(file(r.steps_bin.file || 'steps.bin'), r.steps_bin.mime) : null;
  const pct = (t) => `${Math.min(100, (t / total) * 100).toFixed(2)}%`;
  const laneHTML = KIND_ORDER.map((k) => `<div class="lane k-${k}" title="${KINDS[k][0]}">${steps.map((s, i) => ((s.calls || []).some((c) => c.kind === k) ? `<i style="left:${pct(s.t)};width:${Math.max(0.15, (((steps[i + 1]?.t ?? s.t + 4) - s.t) / total) * 100).toFixed(2)}%"></i>` : '')).join('')}</div>`).join('');
  const stepHTML = (s, i) => {
    const kinds = [...new Set((s.calls || []).map((c) => c.kind))], o = s.out || {}, lines = (o.text || '').split('\n'), bad = (o.exit || []).some((e) => e !== 0);
    const text = o.text ? (lines.length > 6 || o.text.length > 520 ? `<details class="ro-more"><summary><pre class="ro-preview">${esc(lines.slice(0, 5).join('\n').slice(0, 480))}</pre><span class="ro-expand">show all ${int(lines.length)} lines</span></summary><pre>${esc(o.text)}</pre></details>` : `<pre>${esc(o.text)}</pre>`) : '';
    const out = o.text || o.pics?.length ? `<div class="ro ${bad ? 'bad' : ''}"><div class="ro-head"><span>Back to the agent</span>${(o.exit || []).length ? `<span>exit ${o.exit.map(esc).join(', ')}</span>` : ''}</div>${text}${o.pics?.length ? `<div class="ro-pics">${o.pics.map((p, j) => `<img data-i="${i}" data-j="${j}" alt="A picture the agent looked at">`).join('')}</div>` : ''}</div>` : '';
    const sim = s.sim?.submit || s.sim?.reset ? `<span class="rt-sim">${s.sim.submit ? `${s.sim.submit} robot command${s.sim.submit > 1 ? 's' : ''}` : ''}${s.sim.reset ? ' · reset' : ''}</span>` : '';
    return `<article class="rstep" data-i="${i}" data-kinds="${['all', ...(s.say ? ['say'] : []), ...(s.think ? ['think'] : []), ...kinds].join(' ')}">
      <div class="rt"><span>${at(s.t)}</span><span>step ${i + 1}</span>${sim}<span class="rt-tok">${kTok(s.tok?.in)} context · +${int(s.tok?.out)}</span></div>
      ${s.think ? `<details class="rthink"><summary>Thinking</summary><div>${esc(s.think)}</div></details>` : ''}${s.say ? `<div class="rsay">${prose(s.say)}</div>` : ''}
      ${(s.calls || []).map((c) => `<details class="rc k-${esc(c.kind)}"><summary><span class="rc-verb">${esc(KINDS[c.kind]?.[1] || 'calls')}</span><span class="rc-lab">${esc(c.label)}</span></summary><pre class="rc-code">${esc(c.code)}</pre></details>`).join('')}${out}</article>`;
  };
  const hasThink = steps.some((s) => s.think);
  const filters = [['all', 'Everything'], ['say', 'Messages'], ...(hasThink ? [['think', 'Thinking']] : []), ...KIND_ORDER.map((k) => [k, KINDS[k][0]])];
  body.innerHTML = `<section class="strip"><div class="strip-ctl"><button class="play" type="button" aria-label="Play the run"><svg class="pl" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><svg class="pa" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg></button><span><b id="rs-now">0:00</b> / ${clock(total)}</span></div>
      <div class="lanes" id="lanes">${laneHTML}<span class="head-line" id="rs-head"></span></div></section>
    <section class="run-body">
      <aside class="run-side"><div class="rv-card"><div class="rv-label">What the agent was looking at</div><div class="rv-pic"><img id="rv-img" alt="" hidden><div class="rv-none" id="rv-none">No picture yet.</div></div><div class="rv-cap" id="rv-cap"></div></div>
        ${r.replay ? `<div class="rv-card"><div class="rv-label">What the robot did</div><video src="${esc(file(r.replay))}" ${r.poster ? `poster="${esc(file(r.poster))}"` : ''} controls muted loop playsinline preload="none"></video><div class="rv-cap">The verifier's replay of the final trajectory.</div></div>` : ''}</aside>
      <div class="run-log"><div class="rl-bar">${filters.map(([f, n]) => `<button type="button" class="chip${f === 'all' ? ' on' : ''}" data-f="${f}">${n}</button>`).join('')}</div>
        <div id="rl-steps">${steps.length ? steps.map(stepHTML).join('') : '<div class="rstep">This run saved no step log. Its verdict and replay are shown.</div>'}</div>
        <div class="rl-end ${solved ? 'ok' : 'no'}">${solved ? 'Verdict: solved. The verifier replayed the final trajectory and the goal held.' : 'Verdict: not solved.'}</div></div>
    </section>`;
  const arts = $$('.rstep');
  const picAt = (i) => { for (let k = i; k >= 0; k--) if (steps[k].out?.pics?.length) return [k, steps[k].out.pics[steps[k].out.pics.length - 1]]; return [-1, null]; };
  let cur = -1, quiet = 0;
  const setStep = (i, scroll) => {
    if (i < 0 || i >= steps.length) return;
    if (i !== cur) {
      cur = i; arts.forEach((a, k) => a.classList.toggle('on', k === i));
      $('#rs-head').style.left = pct(steps[i].t); $('#rs-now').textContent = at(steps[i].t);
      const [k, p] = picAt(i), img = $('#rv-img');
      img.hidden = !p; $('#rv-none').hidden = !!p;
      if (p && picOf && img.dataset.key !== String(p[0])) { img.dataset.key = p[0]; picOf(p).then((u) => { if (img.dataset.key === String(p[0])) img.src = u; }, (e) => console.warn('runs', e)); }
      $('#rv-cap').textContent = p ? `Step ${k + 1} · ${at(steps[k].t)}` : '';
    }
    if (scroll && !arts[i].hidden) { quiet = performance.now() + 900; arts[i].scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  };
  const io = new IntersectionObserver((es) => {
    if (playing || performance.now() < quiet) return;
    const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (v.length) setStep(+v[0].target.dataset.i);
  }, { rootMargin: '-30% 0px -60% 0px' });
  arts.forEach((a) => io.observe(a));
  const picIO = new IntersectionObserver((es) => { for (const e of es) { if (!e.isIntersecting) continue; const im = e.target; picIO.unobserve(im); if (picOf) picOf(steps[+im.dataset.i].out.pics[+im.dataset.j]).then((u) => { im.src = u; }, (err) => console.warn('runs', err)); } }, { rootMargin: '500px 0px' });
  $$('.ro-pics img').forEach((im) => picIO.observe(im));
  let playing = false, timer = null;
  const btn = $('.play');
  const tick = () => { if (!playing) return; const n = cur + 1; if (n >= steps.length) { playing = false; btn.classList.remove('on'); return; } setStep(n, true); timer = setTimeout(tick, 900 + (steps[n].say ? 1300 : 0) + (steps[n].out?.pics?.length ? 700 : 0)); };
  btn.addEventListener('click', () => { playing = !playing; btn.classList.toggle('on', playing); clearTimeout(timer); if (playing) { if (cur >= steps.length - 1) cur = -1; tick(); } });
  const lanes = $('#lanes');
  const seek = (ev) => { const b = lanes.getBoundingClientRect(), t = ((ev.clientX - b.left) / b.width) * total; let i = 0; while (i + 1 < steps.length && steps[i + 1].t <= t) i++; if (arts[i].hidden) { $$('.rl-bar .chip').forEach((c) => c.classList.toggle('on', c.dataset.f === 'all')); arts.forEach((a) => { a.hidden = false; }); } setStep(i, true); };
  let drag = false;
  lanes.addEventListener('pointerdown', (e) => { drag = true; lanes.setPointerCapture(e.pointerId); seek(e); });
  lanes.addEventListener('pointermove', (e) => { if (drag) seek(e); });
  lanes.addEventListener('pointerup', () => { drag = false; });
  $$('.rl-bar .chip').forEach((c) => c.addEventListener('click', () => { $$('.rl-bar .chip').forEach((d) => d.classList.toggle('on', d === c)); arts.forEach((a) => { a.hidden = !a.dataset.kinds.split(' ').includes(c.dataset.f); }); }));
  if (steps.length) setStep(0);
  const s0 = parseInt(Q.get('s'), 10) - 1;
  if (s0 > 0 && s0 < steps.length) setStep(s0, true);
}

const slug = Q.get('r');
if (slug) runPage(slug); else listPage();
