// Charts (scoring ranges, the luck quadrant, league scoring by week, points by position) and the
// written scouting reports.
import { setQuery } from '../app.js';
import { esc, f1, chip, nameOf, seasonSelect, empty } from '../ui.js';
import { teamBreakdown, quantile, mean, scoutingReports } from '../stats.js';
import { lineChart } from '../charts.js';
import { pickSeason, meOwner, highlightSelect } from './common.js';
import { personaTakes } from '../columns.js';

const regThrough = s => Math.min(s.completedThrough, s.regWeeks);
// Draw at the card's real width so text stays readable on a phone instead of shrinking with the SVG.
const widthOf = el => { const cs = getComputedStyle(el); return Math.max(300, Math.round(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) || 760); };

// ---------------------------------------------------------------- Charts
export function chartsPage(model, { q }, el) {
  const s = pickSeason(model, q);
  const hl = q.hl || meOwner(model);
  const through = regThrough(s);
  const owners = Object.values(s.teams).map(t => t.ownerId);
  el.innerHTML = `<h1>Charts</h1>
    <p class="sub">The season in pictures. Everything here is regular-season scoring${through ? ` through week ${through}` : ''}.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))} ${highlightSelect(model, hl, v => setQuery({ hl: v }), owners)}</div>
    ${through < 1 ? empty('📊', `No final scores in ${s.season} yet`, 'Charts fill in after week 1.') : `
    <h2>Scoring range</h2><p class="sub">Every weekly score as a dot, with each team's median as a gold tick. A tight cluster means a team you can count on; a long spread means boom or bust.</p><div class="card" id="range"></div>
    <h2>Luck quadrant</h2><p class="sub">Points scored against points allowed. Bottom right is good and lucky; top left is bad and cursed. The dashed lines are league averages.</p><div class="card" id="quad"></div>
    <h2>League scoring by week</h2><p class="sub">The top score, the median and the pooper each week.</p><div class="card" id="band"></div>
    <h2>Where the points come from</h2><p class="sub">Starter points per game by position.</p><div class="card" id="stack"></div>`}`;
  if (through < 1) return;
  scoringRange(el.querySelector('#range'), s, through, hl);
  luckQuadrant(el.querySelector('#quad'), s, hl);
  leagueBand(el.querySelector('#band'), s, through, hl);
  positionStack(el.querySelector('#stack'), model, s, hl);
}

function scoresOf(s, rid, through) {
  const out = [];
  for (let w = 1; w <= through; w++) { const e = s.weeks[w]?.[rid]; if (e?.final) out.push({ w, pts: e.pts }); }
  return out;
}

function scoringRange(el, s, through, hl) {
  const rows = Object.entries(s.teams).map(([rid, t]) => {
    const sc = scoresOf(s, rid, through), v = sc.map(x => x.pts);
    return { owner: t.ownerId, sc, med: quantile(v, 0.5), lo: Math.min(...v), hi: Math.max(...v) };
  }).filter(r => r.sc.length).sort((a, b) => b.med - a.med);
  const all = rows.flatMap(r => r.sc.map(x => x.pts));
  const lo = Math.floor(Math.min(...all) / 10) * 10, hi = Math.ceil(Math.max(...all) / 10) * 10;
  const W = widthOf(el), narrow = W < 520, L = narrow ? 88 : 120, R = 12, rowH = 28, top = 8, H = top + rows.length * rowH + 26;
  const X = v => L + ((v - lo) / Math.max(1, hi - lo)) * (W - L - R);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly scoring range by team">`;
  for (let t = lo; t <= hi; t += narrow ? 40 : 20) svg += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - 22}" stroke="var(--grid)"/><text x="${X(t)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${t}</text>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2, me = r.owner === hl;
    svg += `<text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="${narrow ? 11 : 12}" fill="var(--ink${me ? '' : '-2'})" font-weight="${me ? 700 : 400}">${esc(nameOf(r.owner))}</text>`;
    svg += `<line x1="${X(r.lo)}" x2="${X(r.hi)}" y1="${y}" y2="${y}" stroke="var(--axis)" stroke-width="2" stroke-linecap="round"/>`;
    for (const x of r.sc) svg += `<circle cx="${X(x.pts).toFixed(1)}" cy="${y}" r="5" fill="${me ? 'var(--accent)' : 'var(--other-line)'}" fill-opacity="${me ? 0.85 : 0.75}" stroke="var(--surface)" stroke-width="1"><title>${esc(nameOf(r.owner))}, week ${x.w}: ${f1(x.pts)}</title></circle>`;
    svg += `<line x1="${X(r.med)}" x2="${X(r.med)}" y1="${y - 9}" y2="${y + 9}" stroke="var(--gold)" stroke-width="3" stroke-linecap="round"><title>Median ${f1(r.med)}</title></line>`;
  });
  el.innerHTML = `<div class="chart">${svg}</svg></div>`;
}

function luckQuadrant(el, s, hl) {
  const st = s.regStandings.filter(r => r.games);
  const W = widthOf(el), H = 440, m = { t: 16, r: 12, b: 40, l: 34 };
  const pf = st.map(r => r.pf), pa = st.map(r => r.pa);
  const pad = (a, f) => { const lo = Math.min(...a), hi = Math.max(...a), d = (hi - lo || 10) * f; return [lo - d, hi + d]; };
  const [x0, x1] = pad(pf, 0.12), [y0, y1] = pad(pa, 0.12);
  const X = v => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r), Y = v => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ax = mean(pf), ay = mean(pa);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points for against points against">`;
  const q = (x, y, anchor, txt) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="12" font-weight="600" fill="var(--muted)" letter-spacing=".04em">${txt}</text>`;
  svg += q(W - m.r - 4, m.t + 12, 'end', 'GOOD, UNLUCKY') + q(m.l + 6, m.t + 12, 'start', 'BAD AND CURSED') + q(W - m.r - 4, H - m.b - 8, 'end', 'GOOD AND LUCKY') + q(m.l + 6, H - m.b - 8, 'start', 'BAD, LUCKY');
  svg += `<line x1="${X(ax)}" x2="${X(ax)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-dasharray="5 4"/><line x1="${m.l}" x2="${W - m.r}" y1="${Y(ay)}" y2="${Y(ay)}" stroke="var(--axis)" stroke-dasharray="5 4"/>`;
  svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="var(--axis)"/><line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)"/>`;
  svg += `<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="var(--ink-2)">Points for →</text><text transform="translate(16 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="var(--ink-2)">Points against →</text>`;
  // Dots first, then labels placed one by one, nudged up or down (or to the other side) to avoid
  // landing on a label already placed.
  const pts = st.map(r => ({ r, me: r.owner === hl, cx: X(r.pf), cy: Y(r.pa) }));
  for (const p of [...pts].sort((a, b) => a.me - b.me)) svg += `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${p.me ? 8 : 6}" fill="${p.me ? 'var(--gold)' : 'var(--accent)'}" stroke="var(--surface)" stroke-width="2"><title>${esc(nameOf(p.r.owner))}: ${f1(p.r.pf)} for, ${f1(p.r.pa)} against (${p.r.w}-${p.r.l})</title></circle>`;
  const boxes = pts.map(p => ({ x0: p.cx - 7, x1: p.cx + 7, y0: p.cy - 7, y1: p.cy + 7, dot: p }));
  for (const p of [...pts].sort((a, b) => b.me - a.me || a.cy - b.cy)) {
    const label = `${nameOf(p.r.owner)} ${p.r.w}-${p.r.l}`, tw = label.length * 7 + 4;
    const prefRight = p.cx + 11 + tw < W;
    let best = null;
    place: for (const dy of [0, -15, 15, -30, 30, -45, 45]) for (const right of [prefRight, !prefRight]) {
      const x = p.cx + (right ? 11 : -11), y = p.cy + dy;
      const b = { x0: right ? x : x - tw, x1: right ? x + tw : x, y0: y - 9, y1: y + 5 };
      if (b.x0 < m.l || b.x1 > W) continue;
      if (!boxes.some(o => o.dot !== p && b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1)) { best = { x, y, right, b }; break place; }
    }
    if (!best) best = { x: p.cx + (prefRight ? 11 : -11), y: p.cy, right: prefRight, b: null };
    if (best.b) boxes.push(best.b);
    if (best.y !== p.cy) svg += `<line x1="${p.cx}" y1="${p.cy}" x2="${best.x + (best.right ? -2 : 2)}" y2="${best.y - 3}" stroke="var(--axis)"/>`;
    svg += `<text x="${best.x}" y="${best.y + 4}" text-anchor="${best.right ? 'start' : 'end'}" font-size="12" font-weight="${p.me ? 700 : 500}" fill="var(--ink)">${esc(nameOf(p.r.owner))} <tspan fill="var(--muted)" font-weight="400">${p.r.w}-${p.r.l}</tspan></text>`;
  }
  el.innerHTML = `<div class="chart">${svg}</svg></div>`;
}

function leagueBand(el, s, through, hl) {
  const weeks = [], hi = [], med = [], lo = [], mine = [];
  const rid = Object.values(s.teams).find(t => t.ownerId === hl)?.rid;
  for (let w = 1; w <= through; w++) {
    const v = Object.values(s.weeks[w] || {}).filter(e => e.final).map(e => e.pts); if (!v.length) continue;
    weeks.push(`W${w}`); hi.push(Math.max(...v)); med.push(quantile(v, 0.5)); lo.push(Math.min(...v)); mine.push(s.weeks[w]?.[rid]?.pts ?? null);
  }
  lineChart(el, [
    { label: 'Top score', values: hi, color: 'var(--good)', legend: true },
    { label: 'Median', values: med, color: 'var(--accent-2)', dash: true, legend: true },
    { label: 'Pooper', values: lo, color: 'var(--bad)', legend: true },
    ...(rid != null ? [{ label: nameOf(hl), values: mine, color: 'var(--accent)', emphasis: true }] : []),
  ], { x: weeks, yFormat: v => Math.round(v), title: 'League scoring by week' });
}

function positionStack(el, model, s, hl) {
  const b = teamBreakdown(model, s);
  const rows = [...b.rows].map(r => ({ ...r, tot: b.positions.reduce((t, p) => t + r.posPg[p], 0) })).sort((x, y) => y.tot - x.tot);
  const max = Math.max(...rows.map(r => r.tot), 1);
  el.innerHTML = `<div class="stackbars">${rows.map(r => `<div class="sb-row${r.owner === hl ? ' me' : ''}"><div class="sb-name">${chip(r.owner)}</div>
      <div class="sb-bar" style="width:${(r.tot / max) * 100}%">${b.positions.map(p => r.posPg[p] > 0 ? `<span class="pos-${p}" style="flex:${r.posPg[p]}" title="${esc(nameOf(r.owner))} ${p}: ${f1(r.posPg[p])} per game">${r.posPg[p] / r.tot > 0.09 ? p : ''}</span>` : '').join('')}</div>
      <div class="sb-tot">${f1(r.tot)}</div></div>`).join('')}</div>
    <div class="legend">${b.positions.map(p => `<span><i class="pos-${p}" style="height:10px;width:10px;border-radius:3px"></i>${p} <span class="muted">${f1(b.league[p])}/g avg</span></span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- Scouting reports
export function scouting(model, { q }, el) {
  const s = pickSeason(model, q);
  const reps = scoutingReports(model, s);
  el.innerHTML = `<h1>Scouting reports</h1>
    <p class="sub">A written report on every team, generated from the numbers: résumé, luck, form, roster strengths, coaching, close games${s.completedThrough < s.regWeeks ? ' and the playoff outlook' : ''}. Ordered by power ranking.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))}</div>
    <div id="tybar"></div>
    ${reps.length ? `<div class="grid g2" id="scouts">${reps.map(r => `<div class="card scout">
      <div class="scout-h"><span class="jersey" title="Power rank">${r.power}</span><div>${chip(r.owner, { team: s.teams[r.rid]?.teamName })}<div><span class="pill gold">${esc(r.tag)}</span></div></div></div>
      <dl>${r.lines.map(l => `<dt>${esc(l.k)}</dt><dd>${esc(l.text)}</dd>`).join('')}</dl><div class="tytake" data-take="${esc(r.owner)}" hidden></div></div>`).join('')}</div>` : empty('🔎', `No scouting reports for ${s.season} yet`, 'Reports appear after week 1 is final.')}`;
  if (reps.length) {
    const through = Math.min(s.completedThrough, s.regWeeks);
    // The site's reports go to the persona as facts, so its numbers match the tiles.
    const facts = () => reps.map(r => `${nameOf(r.owner)} (power rank ${r.power}, ${r.tag})\n${r.lines.map(l => `${l.k}: ${l.text}`).join('\n')}`).join('\n\n');
    personaTakes(el.querySelector('#scouts'), el.querySelector('#tybar'), model, { season: s.season, week: through, facts });
  }
}
