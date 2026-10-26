// Players: positional charts in the style of trade tools (tier curves, weekly form, floor and ceiling,
// buy-low and sell-high, a trade lens) plus the league-history table that was here before.
import { setQuery } from '../app.js';
import { esc, f1, pct, table, empty, skeleton, seasonSelect } from '../ui.js';
import { lineChart, scatter } from '../charts.js';
import { pickSeason, meOwner, highlightSelect } from './common.js';
import { players as historyPage } from './lore.js';
import { SERVER } from '../server.js';
import { loadLab, analyze, ranked, tiers, tradeLens, METRICS, LAB_POS } from '../player-lab.js';

const MINE = 'var(--accent)', WATCH = 'var(--gold)';
const PAL = ['var(--accent)', 'var(--gold)', '#1baf7a', '#6250d6', '#e0603e', '#1597a5', '#c94f9b', '#7a8b2e'];
const store = k => `almanac-${k}-${SERVER.league || 'site'}`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(store(k))) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(store(k), JSON.stringify(v)); } catch { /* private mode */ } };
const last = n => String(n).split(' ').slice(-1)[0];
let seq = 0;

const tabs = cur => `<div class="seg ptabs" role="tablist"><button type="button" role="tab" data-view="" class="${cur ? '' : 'on'}" aria-selected="${!cur}">Charts</button><button type="button" role="tab" data-view="history" class="${cur ? 'on' : ''}" aria-selected="${!!cur}">League history</button></div>`;
function wireTabs(el) { el.querySelectorAll('.ptabs button').forEach(b => (b.onclick = () => setQuery({ view: b.dataset.view || null }))); }

export async function playersPage(model, ctx, el) {
  const { parts, q } = ctx;
  if (parts[0]) return historyPage(model, ctx, el);
  if (q.view === 'history') {
    historyPage(model, ctx, el);
    el.querySelector('h1')?.insertAdjacentHTML('afterend', tabs('history'));
    return wireTabs(el);
  }
  const mine = ++seq;
  const s = pickSeason(model, q);
  el.innerHTML = `<h1>Players</h1><p class="sub">Every fantasy-relevant player in the NFL, scored with this league's settings. Compare a position's top 12, 24, 36 or more, see who's trending, and test a trade against both starting lineups.</p>${tabs('')}<div id="lab">${skeleton('list', 6)}</div>`;
  wireTabs(el);
  let lab;
  try { lab = await loadLab(model, s); } catch (e) { if (mine === seq) el.querySelector('#lab').innerHTML = empty('📉', 'Couldn’t load player stats', esc(e.message)); return; }
  if (mine !== seq) return;
  const a = analyze(model, s, lab, { range: Number(q.range) || 0 });
  const box = el.querySelector('#lab');
  const state = { watch: load('watch', []), trade: load('trade', { give: [], get: [] }) };
  const draw = () => render(model, s, lab, a, q, box, state);
  state.redraw = () => { const y = window.scrollY; draw(); window.scrollTo(0, y); };
  draw();
}

function render(model, s, lab, a, q, box, state) {
  const pos = LAB_POS.includes(q.pos) ? q.pos : 'RB';
  let metric = METRICS[q.m] ? q.m : a.hasProj ? 'ppg' : 'total';
  if (METRICS[metric].proj && !a.hasProj) metric = 'ppg';
  const M = METRICS[metric];
  const teams = a.teams;
  const defN = pos === 'FLEX' ? teams * 5 : ['QB', 'TE', 'K', 'DEF'].includes(pos) ? teams * 2 : teams * 3;
  const list = ranked(a, pos, metric);
  const N = Math.min(list.length, q.n === 'all' ? list.length : Number(q.n) || defN);
  const top = list.slice(0, N);
  const owners = [...new Set(Object.values(s.teams).map(t => t.ownerId))];
  const hl = owners.includes(q.hl) ? q.hl : owners.includes(meOwner(model)) ? meOwner(model) : owners[0];
  const watch = new Set(state.watch);
  const kind = r => (r.owner === hl ? 'mine' : watch.has(r.id) ? 'watch' : r.owner ? 'other' : 'fa');
  const byId = Object.fromEntries(a.rows.map(r => [r.id, r]));
  const posName = pos === 'FLEX' ? 'flex players' : pos === 'DEF' ? 'defenses' : pos === 'K' ? 'kickers' : `${pos}s`;
  const rangeTxt = Number(q.range) ? `last ${q.range} weeks` : `weeks 1-${lab.through}`;
  const nOpts = [...new Set([teams, teams * 2, teams * 3, teams * 4, teams * 5, defN])].filter(n => n <= Math.max(list.length, teams)).sort((x, y) => x - y);

  box.innerHTML = `
    ${!lab.full ? `<div class="callout">Only players who have been on a roster in this league are shown${lab.problem ? ` (the stats feed didn't load: ${esc(lab.problem)})` : ''}, so free agents and projections are missing.</div>` : ''}
    ${lab.errors.length ? `<p class="muted small">Some weeks didn't load: ${esc(lab.errors.join('; '))}</p>` : ''}
    <div class="toolbar labbar">
      ${seasonSelect({ seasons: model.seasons.filter(x => x.completedThrough >= 1) }, s.season, v => setQuery({ season: v }))}
      <div class="seg" role="group" aria-label="Position">${LAB_POS.map(p => `<button type="button" data-pos="${p}" class="${p === pos ? 'on' : ''}">${p}</button>`).join('')}</div>
      <label class="muted">Show <select id="labn">${nOpts.map(n => `<option value="${n}" ${n === N ? 'selected' : ''}>Top ${n}</option>`).join('')}<option value="all" ${q.n === 'all' ? 'selected' : ''}>All ${list.length}</option></select></label>
      <label class="muted">Rank by <select id="labm">${Object.entries(METRICS).filter(([, m]) => !m.proj || a.hasProj).map(([k, m]) => `<option value="${k}" ${k === metric ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
      <div class="seg" role="group" aria-label="Weeks">${[['', 'All weeks'], ['5', 'Last 5'], ['3', 'Last 3']].map(([v, t]) => `<button type="button" data-range="${v}" class="${String(q.range || '') === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${highlightSelect(model, hl, v => setQuery({ hl: v }), owners)}
    </div>
    <div class="watchbar card">
      <b>Watchlist</b>
      ${state.watch.length ? state.watch.map(id => `<span class="pchip watch">${esc(byId[id]?.name || model.nameOf(id))} <small>${esc(byId[id]?.pos || model.posOf(id))}</small><button type="button" data-unwatch="${esc(id)}" aria-label="Remove ${esc(model.nameOf(id))}">×</button></span>`).join('') : '<span class="muted small">Players you\'re eyeing, say trade targets, light up gold on every chart.</span>'}
      <input type="text" list="labpl" id="wadd" placeholder="Add a player" autocomplete="off">
    </div>
    <datalist id="labpl">${a.rows.filter(r => r.gp || r.rosGames).sort((x, y) => (y.ppg ?? 0) - (x.ppg ?? 0)).map(r => `<option value="${esc(`${r.name} · ${r.pos} ${r.team}`)}"></option>`).join('')}</datalist>

    <section class="card labcard">
      <div class="labhead"><h2>Top ${N} ${esc(posName)} by ${esc(M.label.toLowerCase())}</h2><span class="muted small">${M.proj ? `weeks ${lab.through + 1}-${lab.last}` : rangeTxt}</span></div>
      <div class="legend"><span><i class="dot" style="background:${MINE}"></i>${esc(model.managers[hl]?.name || 'Team')}</span><span><i class="dot" style="background:${WATCH}"></i>Watchlist</span><span><i class="dot" style="background:var(--other-line)"></i>Rostered</span><span><i class="dot hollow"></i>Free agent</span></div>
      <div id="curve"></div>
      <p class="muted small">Shaded bands are tiers, split at the biggest drop-offs. Dashed lines mark every ${teams} players, so you can see where ${pos === 'FLEX' ? 'each round of starters' : `${pos}1, ${pos}2${['QB', 'TE', 'K', 'DEF'].includes(pos) ? '' : `, ${pos}3`}`} ends.${['ppg', 'ros', 'vor', 'rosVor'].includes(metric) && pos !== 'FLEX' ? ' The replacement line is the first player past the league\'s starters, roughly what the waiver wire gives you.' : ''}</p>
      ${offList(list, N, kind, pos)}
    </section>

    <div class="grid two">
      <section class="card labcard"><h2>Week by week</h2><p class="muted small">Solid lines are points scored, dashed lines are projections. The gray line is what it took to be a top-${teams} ${pos === 'FLEX' ? 'RB' : pos} that week.</p><div id="weekly"></div></section>
      <section class="card labcard"><h2>Floor and ceiling</h2><p class="muted small">Each dot is one game. The box covers the middle half of his weeks and the tick is his median. Boom is a top-${teams} week at his position; bust is finishing outside the league's starters.</p><div id="range"></div></section>
    </div>
    ${a.hasProj ? `<section class="card labcard"><h2>Buy low, sell high</h2><p class="muted small">Points per game so far against the projection from here. Above the dashed line, he's projected to score more than he has (buy low). Below it, he's been outplaying his projection (sell high).</p><div id="buysell"></div></section>` : ''}
    <section class="card labcard" id="lens"></section>
    <section class="labcard"><h2>The full list</h2><div id="labtable"></div></section>`;

  // Controls
  box.querySelectorAll('[data-pos]').forEach(b => (b.onclick = () => setQuery({ pos: b.dataset.pos === 'RB' ? null : b.dataset.pos, n: null })));
  box.querySelectorAll('[data-range]').forEach(b => (b.onclick = () => setQuery({ range: b.dataset.range || null })));
  box.querySelector('#labn').onchange = e => setQuery({ n: e.target.value });
  box.querySelector('#labm').onchange = e => setQuery({ m: e.target.value });
  const pickId = v => a.rows.find(r => `${r.name} · ${r.pos} ${r.team}` === v)?.id;
  const wadd = box.querySelector('#wadd');
  wadd.onchange = () => { const id = pickId(wadd.value); if (id && !state.watch.includes(id)) { state.watch.push(id); save('watch', state.watch); state.redraw(); } };
  box.querySelectorAll('[data-unwatch]').forEach(b => (b.onclick = () => { state.watch = state.watch.filter(x => x !== b.dataset.unwatch); save('watch', state.watch); state.redraw(); }));

  tierCurve(box.querySelector('#curve'), top, { kind, a, pos, metric, teams, posLabel: pos === 'FLEX' ? 'FLEX' : pos, model });

  // Weekly lines: your guys and watchlist at this position, else the top five.
  const inPos = r => (pos === 'FLEX' ? ['RB', 'WR', 'TE'].includes(r.pos) : r.pos === pos);
  let focus = list.map(x => x.r).filter(r => kind(r) === 'mine' || kind(r) === 'watch');
  if (!focus.length) focus = top.slice(0, 5).map(x => x.r);
  focus = focus.slice(0, 8);
  const W = []; for (let w = 1; w <= lab.last; w++) W.push(w);
  const series = [];
  const benchPos = pos === 'FLEX' ? 'RB' : pos;
  series.push({ label: `Top-${teams} ${benchPos} line`, values: W.map(w => a.boomLine[benchPos][w] ?? null), color: 'var(--other-line)', legend: true });
  focus.forEach((r, i) => {
    const c = PAL[i % PAL.length], act = lab.pts[r.id] || [];
    series.push({ label: r.name, values: W.map(w => (w <= lab.through ? act[w - 1] ?? null : null)), color: c, emphasis: true });
    if (r.proj.length) series.push({ label: `${r.name} (proj)`, values: W.map(w => (w === lab.through ? act[w - 1] ?? null : w > lab.through ? r.proj[w - lab.through - 1] ?? null : null)), color: c, dash: true, noLegend: true });
  });
  lineChart(box.querySelector('#weekly'), series, { x: W.map(w => `W${w}`), yMin: 0, yFormat: v => f1(v), title: 'Weekly points' });

  // Floor and ceiling rows.
  const rangeRows = (focus.length ? focus : top.map(x => x.r)).filter(r => r.gp).slice(0, 10);
  rangeChart(box.querySelector('#range'), rangeRows, { kind, a });

  // Buy low / sell high.
  if (a.hasProj) {
    const pts = list.map(x => x.r).filter(r => inPos(r) && r.gp >= a.minGames && r.rosGames)
      .sort((x, y) => y.rosPpg - x.rosPpg);
    const chosen = [...pts.slice(0, Math.min(18, N)), ...pts.filter(r => kind(r) === 'mine' || kind(r) === 'watch')];
    const uniq = [...new Map(chosen.map(r => [r.id, r])).values()];
    if (uniq.length >= 3) {
      scatter(box.querySelector('#buysell'), uniq.map(r => ({ x: r.ppg, y: r.rosPpg, label: last(r.name), me: kind(r) !== 'other' && kind(r) !== 'fa', color: kind(r) === 'mine' ? MINE : kind(r) === 'watch' ? WATCH : 'var(--other-line)', title: `${r.name}: ${f1(r.ppg)} so far, ${f1(r.rosPpg)} projected` })),
        { xLabel: 'Points per game so far', yLabel: 'Projected per game from here', quads: ['', 'Buy low', 'Sell high', ''], diag: true, xFmt: v => f1(v), yFmt: v => f1(v), height: 380 });
    } else box.querySelector('#buysell').innerHTML = '<p class="muted">Not enough players with both games and projections yet.</p>';
  }

  lens(model, s, lab, a, hl, state, box.querySelector('#lens'), byId, pickId);

  // The table.
  const rows = list.slice(0, N).map(x => ({ ...x.r, rank: x.rank, val: x.v }));
  const tcols = [
    { key: 'rank', label: '#', num: true, sort: r => -r.rank },
    { key: 'name', label: 'Player', fmt: r => `<a href="#/players/${encodeURIComponent(r.id)}">${esc(r.name)}</a> <span class="muted small">${esc(r.pos)} ${esc(r.team)}</span>`, sort: r => r.name },
    { key: 'owner', label: 'Manager', fmt: r => (r.owner ? `<span class="${r.owner === hl ? 'mineown' : ''}">${esc(model.managers[r.owner]?.name || '?')}</span>` : '<span class="muted">Free agent</span>'), sort: r => (r.owner ? model.managers[r.owner]?.name || '' : '~') },
    { key: 'val', label: M.short, num: true, strong: true, fmt: r => f1(r.val) },
    ...(metric === 'ppg' ? [] : [{ key: 'ppg', label: 'PPG', num: true, fmt: r => f1(r.ppg), sort: r => r.ppg ?? -99 }]),
    { key: 'recent', label: 'Last 3', num: true, fmt: r => f1(r.recent), sort: r => r.recent ?? -99 },
    { key: 'boom', label: 'Boom', num: true, fmt: r => pct(r.boom), sort: r => r.boom ?? -1 },
    { key: 'bust', label: 'Bust', num: true, fmt: r => pct(r.bust), sort: r => r.bust ?? 2 },
    ...(a.hasProj && metric !== 'ros' ? [{ key: 'rosPpg', label: 'ROS PPG', num: true, fmt: r => f1(r.rosPpg), sort: r => r.rosPpg ?? -99 }] : []),
    { key: 'gp', label: 'Games', num: true, extra: true },
    { key: 'total', label: 'Pts', num: true, extra: true, fmt: r => f1(r.total) },
    { key: 'lo', label: 'Floor', num: true, extra: true, fmt: r => f1(r.lo), sort: r => r.lo ?? -99 },
    { key: 'hi', label: 'Ceiling', num: true, extra: true, fmt: r => f1(r.hi), sort: r => r.hi ?? -99 },
    { key: 'vor', label: 'VOR', num: true, extra: true, fmt: r => f1(r.vor), sort: r => r.vor ?? -99 },
    ...(a.hasProj ? [{ key: 'rosVor', label: 'ROS VOR', num: true, extra: true, fmt: r => f1(r.rosVor), sort: r => r.rosVor ?? -999 }, { key: 'next', label: 'Next', num: true, extra: true, fmt: r => f1(r.next), sort: r => r.next ?? -99 }] : []),
    { key: 'star', label: 'Watch', fmt: r => `<button type="button" class="star ${watch.has(r.id) ? 'on' : ''}" data-star="${esc(r.id)}" aria-pressed="${watch.has(r.id)}" aria-label="Watch ${esc(r.name)}">${watch.has(r.id) ? '★' : '☆'}</button>`, sort: r => (watch.has(r.id) ? 0 : 1) },
  ];
  const tEl = box.querySelector('#labtable');
  table(tEl, tcols, rows, { sortKey: 'val', rowClass: r => (r.owner === hl ? 'mine-row' : watch.has(r.id) ? 'watch-row' : '') });
  tEl.onclick = e => {
    const b = e.target.closest('[data-star]'); if (!b) return;
    const id = b.dataset.star;
    state.watch = state.watch.includes(id) ? state.watch.filter(x => x !== id) : [...state.watch, id];
    save('watch', state.watch); state.redraw();
  };
}

/** Your guys and watchlist players at this position who fall outside the chart. */
function offList(list, N, kind, pos) {
  const out = list.slice(N).filter(x => kind(x.r) === 'mine' || kind(x.r) === 'watch');
  if (!out.length) return '';
  return `<p class="small muted">Also: ${out.map(x => `<span class="pchip ${kind(x.r)}">${esc(x.r.name)} <small>${pos === 'FLEX' ? x.r.pos : pos}${x.rank}</small></span>`).join(' ')}</p>`;
}

function width(el) { const w = el.clientWidth; return w > 0 ? Math.max(300, w) : 760; }

/** Positional curve: one dot per player in rank order, tier bands, a line every `teams` players. */
function tierCurve(el, top, { kind, a, pos, metric, teams, posLabel, model }) {
  if (!top.length) { el.innerHTML = '<p class="muted">No players to show yet.</p>'; return; }
  const W = width(el), H = W < 520 ? 300 : 360, m = { t: 24, r: 14, b: 30, l: 42 };
  const vals = top.map(x => x.v);
  const isVor = metric === 'vor' || metric === 'rosVor';
  const replV = pos === 'FLEX' ? null : isVor ? 0 : metric === 'ppg' ? a.repl[pos] : metric === 'ros' ? a.replRos[pos] : null;
  let lo = Math.min(0, ...vals, replV ?? 0), hi = Math.max(...vals);
  if (hi === lo) hi = lo + 1;
  hi += (hi - lo) * 0.06;
  const n = top.length, bw = (W - m.l - m.r) / n;
  const X = i => m.l + (i + 0.5) * bw, Y = v => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top ${n} ${esc(pos)} by ${esc(METRICS[metric].label)}">`;
  // Tier bands
  const starts = tiers(vals);
  starts.forEach((st, k) => {
    const en = k + 1 < starts.length ? starts[k + 1] : n;
    if (k % 2 === 0) svg += `<rect x="${m.l + st * bw}" y="${m.t}" width="${(en - st) * bw}" height="${H - m.t - m.b}" fill="var(--surface-2)" opacity=".75"/>`;
    if ((en - st) * bw >= 16) svg += `<text x="${m.l + ((st + en) / 2) * bw}" y="${m.t - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--muted)">T${k + 1}</text>`;
  });
  // Grid
  const step = niceStep(hi - lo);
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(t * 10) / 10}</text>`;
  // Starter lines every `teams` players
  for (let k = 1; k * teams <= n + teams - 1; k++) {
    const a0 = (k - 1) * teams, a1 = Math.min(n, k * teams);
    if (k * teams < n) svg += `<line x1="${m.l + k * teams * bw}" x2="${m.l + k * teams * bw}" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-dasharray="4 4"/>`;
    if ((a1 - a0) * bw > 24) svg += `<text x="${m.l + ((a0 + a1) / 2) * bw}" y="${H - 10}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink-2)">${esc(posLabel === 'FLEX' ? `${a0 + 1}-${a1}` : `${posLabel}${k}`)}</text>`;
  }
  if (replV != null) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(replV)}" y2="${Y(replV)}" stroke="var(--div-neg)" stroke-width="1.5" stroke-dasharray="6 3"/><text x="${m.l + 4}" y="${Y(replV) + 14}" text-anchor="start" font-size="11" font-weight="600" fill="var(--div-neg)" paint-order="stroke" stroke="var(--surface)" stroke-width="3">Replacement ${Math.round(replV * 10) / 10}</text>`;
  // Dots, highlighted last so they sit on top
  const order = top.map((x, i) => ({ x, i, k: kind(x.r) })).sort((p, q) => (p.k === 'mine' || p.k === 'watch') - (q.k === 'mine' || q.k === 'watch'));
  const r0 = Math.max(2.5, Math.min(5, bw * 0.38));
  for (const { x, i, k } of order) {
    const big = k === 'mine' || k === 'watch';
    const fill = k === 'mine' ? MINE : k === 'watch' ? WATCH : k === 'fa' ? 'var(--surface)' : 'var(--other-line)';
    svg += `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.v).toFixed(1)}" r="${big ? r0 + 2.5 : r0}" fill="${fill}" stroke="${k === 'fa' ? 'var(--muted)' : 'var(--surface)'}" stroke-width="${k === 'fa' ? 1.5 : 1.5}"/>`;
  }
  // Labels for highlighted players (or the top five), nudged so they don't overlap
  let lab = top.map((x, i) => ({ x, i })).filter(({ x }) => kind(x.r) === 'mine' || kind(x.r) === 'watch');
  if (!lab.length) lab = top.slice(0, 5).map((x, i) => ({ x, i }));
  const boxes = [];
  for (const { x, i } of lab) {
    const txt = last(x.r.name), tw = txt.length * 6.6 + 4, cx = X(i), cy = Y(x.v);
    let best = null;
    for (const dy of [-12, 16, -26, 30, -40]) {
      const right = cx + tw + 8 < W - m.r;
      const bx = right ? cx + 6 : cx - 6 - tw, b = { x0: bx, x1: bx + tw, y0: cy + dy - 10, y1: cy + dy + 2 };
      if (b.y0 < m.t - 4 || b.y1 > H - m.b) continue;
      if (!boxes.some(o => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1)) { best = { b, right, y: cy + dy }; break; }
    }
    if (!best) continue;
    boxes.push(best.b);
    const k = kind(x.r);
    svg += `<text x="${best.right ? best.b.x0 : best.b.x1}" y="${best.y}" text-anchor="${best.right ? 'start' : 'end'}" font-size="11.5" font-weight="650" fill="${k === 'mine' ? 'var(--accent-ink)' : k === 'watch' ? 'var(--accent-2)' : 'var(--ink)'}" paint-order="stroke" stroke="var(--surface)" stroke-width="3">${esc(txt)}</text>`;
  }
  svg += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" class="hit"/></svg>`;
  el.innerHTML = `<div class="chart">${svg}<div class="tip"></div></div>`;
  const root = el.querySelector('.chart'), tip = root.querySelector('.tip'), svgEl = root.querySelector('svg');
  const show = ev => {
    const r = svgEl.getBoundingClientRect(), sx = (ev.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(n - 1, Math.floor((sx - m.l) / bw)));
    const { r: p, v, rank } = top[i];
    const own = p.owner ? (model.managers[p.owner]?.name || 'Rostered') : 'Free agent';
    tip.innerHTML = `<b>${esc(p.pos)}${rank} ${esc(p.name)}</b><div class="r"><span>${esc(p.team || 'FA')}</span><span>${esc(own)}</span></div><div class="r"><span>${esc(METRICS[metric].short)}</span><span>${f1(v)}</span></div>${p.gp ? `<div class="r"><span>PPG (${p.gp} games)</span><span>${f1(p.ppg)}</span></div>` : ''}${p.rosGames ? `<div class="r"><span>ROS per game</span><span>${f1(p.rosPpg)}</span></div>` : ''}`;
    tip.style.display = 'block';
    const px = (X(i) / W) * r.width;
    tip.style.left = `${px + 14 + tip.offsetWidth > r.width ? px - tip.offsetWidth - 14 : px + 14}px`; tip.style.top = '8px';
  };
  root.querySelector('.hit').addEventListener('pointermove', show);
  root.querySelector('.hit').addEventListener('pointerdown', show);
  root.querySelector('.hit').addEventListener('pointerleave', () => (tip.style.display = 'none'));
}

function niceStep(span) { const raw = span / 5, mag = 10 ** Math.floor(Math.log10(raw || 1)); return [1, 2, 2.5, 5, 10].map(x => x * mag).find(st => span / st <= 5) || 10 * mag; }

/** Floor and ceiling: weekly dots, the middle half as a box, the median as a tick. */
function rangeChart(el, rows, { kind, a }) {
  if (!rows.length) { el.innerHTML = '<p class="muted">No games yet.</p>'; return; }
  const max = Math.max(...rows.map(r => r.max ?? 0), 1) * 1.04;
  const W = 260, x = v => (Math.max(0, v) / max) * W;
  el.innerHTML = `<div class="rangeg">${rows.map(r => {
    const k = kind(r), c = k === 'mine' ? MINE : k === 'watch' ? WATCH : 'var(--accent)';
    const dots = r.wk.filter(v => v != null).map(v => `<circle cx="${x(v).toFixed(1)}" cy="11" r="3" fill="${c}" opacity=".45"/>`).join('');
    return `<div class="rg-row"><div class="rg-name"><b class="${k}">${esc(r.name)}</b><small>${esc(r.pos)} ${esc(r.team)}</small></div>
      <svg class="rg-svg" viewBox="0 0 ${W} 22" preserveAspectRatio="none" role="img" aria-label="${esc(`${r.name}: floor ${f1(r.lo)}, median ${f1(r.med)}, ceiling ${f1(r.hi)}`)}">
        <line x1="${x(r.min)}" x2="${x(r.max)}" y1="11" y2="11" stroke="var(--axis)"/>
        <rect x="${x(r.lo)}" y="4" width="${Math.max(2, x(r.hi) - x(r.lo))}" height="14" rx="3" fill="${c}" opacity=".22"/>${dots}
        <line x1="${x(r.med)}" x2="${x(r.med)}" y1="2" y2="20" stroke="var(--ink)" stroke-width="2"/></svg>
      <div class="rg-num"><span title="Median">${f1(r.med)}</span><small>${pct(r.boom)} boom · ${pct(r.bust)} bust</small></div></div>`;
  }).join('')}<div class="rg-axis"><span></span><span>0</span><span>${Math.round(max)} pts</span></div></div>`;
}

/** Trade lens: put players on each side and see value and both starting lineups move. */
function lens(model, s, lab, a, hl, state, el, byId, pickId) {
  const { give, get } = state.trade;
  const t = give.length || get.length ? tradeLens(model, s, a, hl, give, get) : null;
  const weeksLeft = lab.last - lab.through;
  const chipList = (side, ids) => ids.map(id => `<span class="pchip ${byId[id]?.owner === hl ? 'mine' : ''}">${esc(byId[id]?.name || model.nameOf(id))} <small>${esc(byId[id]?.pos || '')} ${byId[id]?.owner ? esc(model.managers[byId[id].owner]?.name || '') : 'FA'}</small><button type="button" data-drop="${side}:${esc(id)}" aria-label="Remove">×</button></span>`).join('');
  const sgn = v => `${v > 0 ? '+' : ''}${f1(v)}`;
  let out = '<p class="muted">Add a player to either side to start.</p>';
  if (t) {
    const tot = t.giveValue + t.getValue, share = tot ? t.getValue / tot : 0.5, diff = t.getValue - t.giveValue;
    const verdict = !tot ? 'Neither side has value over replacement yet.' : Math.abs(diff) < tot * 0.1 ? 'About even on value.' : diff > 0 ? `You win on value by ${f1(diff)} points over replacement.` : `They win on value by ${f1(-diff)} points over replacement.`;
    const dMe = t.myAfter - t.myBefore, dThem = t.theirAfter != null ? t.theirAfter - t.theirBefore : null;
    out = `<div class="lens-bar" role="img" aria-label="${esc(verdict)}"><i style="width:${Math.round(share * 100)}%"></i></div>
      <div class="lens-key"><span>You get ${f1(t.getValue)}</span><span>You give ${f1(t.giveValue)}</span></div>
      <p><b>${esc(verdict)}</b> <span class="muted small">Value is ${t.useRos ? `projected points over a replacement-level player for the rest of the season (weeks ${lab.through + 1}-${lab.last})` : 'points over replacement scored this season'}.</span></p>
      <div class="grid two lens-teams">
        <div class="card"><div class="muted small">${esc(model.managers[hl]?.name || 'You')}'s starting lineup</div><div class="lens-n ${dMe >= 0 ? 'good' : 'err'}">${sgn(dMe)} <small>pts / week</small></div><div class="small muted">${f1(t.myBefore)} → ${f1(t.myAfter)}${t.useRos && weeksLeft ? ` · ${sgn(dMe * weeksLeft)} over ${weeksLeft} weeks` : ''}</div></div>
        ${t.partner ? `<div class="card"><div class="muted small">${esc(model.managers[t.partner]?.name || 'Them')}'s starting lineup</div><div class="lens-n ${dThem >= 0 ? 'good' : 'err'}">${sgn(dThem)} <small>pts / week</small></div><div class="small muted">${f1(t.theirBefore)} → ${f1(t.theirAfter)}${t.useRos && weeksLeft ? ` · ${sgn(dThem * weeksLeft)} over ${weeksLeft} weeks` : ''}</div></div>` : '<div class="card muted small">No other manager owns the players you get, so this is a waiver move.</div>'}
      </div>
      ${t.partners > 1 ? `<p class="muted small">The players you get come from ${t.partners} managers. Their side shows ${esc(model.managers[t.partner]?.name || 'the main partner')}, who sends the most.</p>` : ''}
      ${t.rosterGap > 0 ? `<p class="muted small">You'd need to drop ${t.rosterGap} player${t.rosterGap === 1 ? '' : 's'} to make room.</p>` : ''}
      <p class="muted small">Lineups are filled with each player's ${t.useRos ? 'projected points per game from here' : 'points per game this season'}, using the league's starting spots. Byes and injuries aren't counted.</p>`;
  }
  el.innerHTML = `<h2>Trade lens</h2><p class="muted small">Like a trade analyzer: put players on each side to see who wins on value and what it does to both starting lineups.</p>
    <div class="lens-sides">
      <div><h3>You give</h3><div class="pchips">${chipList('give', give)}</div><input type="text" list="labpl" data-add="give" placeholder="Add a player" autocomplete="off"></div>
      <div><h3>You get</h3><div class="pchips">${chipList('get', get)}</div><input type="text" list="labpl" data-add="get" placeholder="Add a player" autocomplete="off">
        ${state.watch.length ? '<button type="button" class="linkbtn" data-fromwatch>Add my watchlist</button>' : ''}</div>
    </div>${out}${give.length || get.length ? '<button type="button" class="linkbtn" data-clear>Clear trade</button>' : ''}`;
  const commit = () => { save('trade', state.trade); state.redraw(); };
  el.querySelectorAll('[data-add]').forEach(inp => (inp.onchange = () => {
    const id = pickId(inp.value), side = inp.dataset.add;
    if (!id) return;
    for (const k of ['give', 'get']) state.trade[k] = state.trade[k].filter(x => x !== id);
    state.trade[side].push(id); commit();
  }));
  el.querySelectorAll('[data-drop]').forEach(b => (b.onclick = () => { const [side, id] = b.dataset.drop.split(':'); state.trade[side] = state.trade[side].filter(x => x !== id); commit(); }));
  el.querySelector('[data-fromwatch]')?.addEventListener('click', () => { state.trade.get = [...new Set([...state.trade.get, ...state.watch.filter(id => !state.trade.give.includes(id))])]; commit(); });
  el.querySelector('[data-clear]')?.addEventListener('click', () => { state.trade = { give: [], get: [] }; commit(); });
}
