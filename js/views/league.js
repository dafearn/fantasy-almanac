import { setQuery } from '../app.js';
import { esc, f2, f1, pct, signed, chip, nameOf, table, tile, record, ordinal, empty } from '../ui.js';
import { headToHead, recordBook, careers, sidesOf, draftTendencies, mean, finalPlace } from '../stats.js';
import { lineChart, divergingFill } from '../charts.js';
import { sortedManagers, highlightSelect } from './common.js';

const gameLabel = g => `${g.season} W${g.week}${g.type === 'playoff' ? (g.place === 1 ? ' · Final' : ' · Playoffs') : g.type === 'placement' ? ' · Placement' : g.type === 'consolation' ? ' · Consolation' : ''}`;

// ---------------------------------------------------------------- Rivalries
export function rivalries(model, { parts, q }, el) {
  if (parts.length === 2) return rivalry(model, parts[0], parts[1], el);
  const h2h = headToHead(model);
  const mgrs = sortedManagers(model, { activeOnly: q.all !== '1' });
  const pairs = [];
  for (let i = 0; i < mgrs.length; i++) for (let j = i + 1; j < mgrs.length; j++) {
    const p = h2h[`${mgrs[i].id}|${mgrs[j].id}`]; if (p) pairs.push({ a: mgrs[i].id, b: mgrs[j].id, ...p, n: p.w + p.l + p.t, diff: p.pf - p.pa });
  }
  const named = (model.rivals || []).map(r => { const p = h2h[`${r.a}|${r.b}`] || { w: 0, l: 0, t: 0 }; return `<a class="card rival" href="#/rivalries/${encodeURIComponent(r.a)}/${encodeURIComponent(r.b)}"><div class="t">${esc(r.name)}</div><div>${esc(nameOf(r.a))} <b>${p.w}-${p.l}${p.t ? '-' + p.t : ''}</b> ${esc(nameOf(r.b))}</div>${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}</a>`; }).join('');
  el.innerHTML = `
    <h1>Rivalries</h1>
    ${named ? `<h2>Named rivalries</h2><div class="grid g3">${named}</div>` : ''}
    <h2>Every head-to-head</h2>
    <p class="sub">All-time head-to-head, regular season and playoffs. Read across a row: that manager's record against each column. Click any cell for the full series.</p>
    <div class="toolbar"><label class="muted"><input type="checkbox" id="all" ${q.all === '1' ? 'checked' : ''}> Include former managers</label></div>
    <div class="tablewrap"><table class="matrix"><thead><tr><th class="rowh"></th>${mgrs.map(m => `<th title="${esc(m.name)}">${esc(m.name.slice(0, 10))}</th>`).join('')}</tr></thead><tbody>
    ${mgrs.map(r => `<tr><th class="rowh">${chip(r.id)}</th>${mgrs.map(c => {
      if (r.id === c.id) return '<td class="self"></td>';
      const p = h2h[`${r.id}|${c.id}`];
      if (!p) return '<td class="muted">–</td>';
      const n = p.w + p.l + p.t; const share = (p.w + p.t / 2) / n;
      return `<td class="cell" style="background:${divergingFill(share)}" data-a="${esc(r.id)}" data-b="${esc(c.id)}" title="${esc(r.name)} vs ${esc(c.name)}: ${p.w}-${p.l}${p.t ? '-' + p.t : ''}">${p.w}-${p.l}${p.t ? '-' + p.t : ''}</td>`;
    }).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="legend"><span><i style="background:var(--div-pos)"></i>row manager leads</span><span><i style="background:var(--mid)"></i>even</span><span><i style="background:var(--div-neg)"></i>row manager trails</span></div>
    <div class="grid g2" style="margin-top:8px">
      <div><h2>Most lopsided</h2><div id="lop"></div></div>
      <div><h2>Closest series</h2><div id="close"></div></div>
    </div>`;
  el.querySelector('#all').onchange = e => setQuery({ all: e.target.checked ? '1' : null });
  el.querySelectorAll('td.cell').forEach(td => td.onclick = () => (location.hash = `#/rivalries/${encodeURIComponent(td.dataset.a)}/${encodeURIComponent(td.dataset.b)}`));
  const pairCols = [
    { key: 'a', label: 'Series', fmt: r => `<a href="#/rivalries/${encodeURIComponent(r.a)}/${encodeURIComponent(r.b)}">${esc(nameOf(r.a))} vs ${esc(nameOf(r.b))}</a>`, sort: r => nameOf(r.a) },
    { key: 'rec', label: 'Record', fmt: r => record(r), sort: r => r.w - r.l, num: true },
    { key: 'diff', label: 'Point diff', num: true, fmt: r => signed(r.diff) },
  ];
  const lop = pairs.map(p => (p.w >= p.l ? p : { a: p.b, b: p.a, w: p.l, l: p.w, t: p.t, n: p.n, diff: -p.diff })).sort((x, y) => (y.w - y.l) - (x.w - x.l) || y.diff - x.diff).slice(0, 8);
  table(el.querySelector('#lop'), pairCols, lop, {});
  const close = pairs.filter(p => p.n >= 2).sort((x, y) => Math.abs(x.w - x.l) - Math.abs(y.w - y.l) || Math.abs(x.diff) - Math.abs(y.diff)).slice(0, 8);
  table(el.querySelector('#close'), pairCols, close, {});
}

function rivalry(model, a, b, el) {
  const games = model.games.filter(g => g.final && g.type !== 'consolation' && ((g.a.owner === a && g.b.owner === b) || (g.a.owner === b && g.b.owner === a)));
  const rows = games.map(g => { const [x, y] = g.a.owner === a ? [g.a, g.b] : [g.b, g.a]; const res = x.pts > y.pts ? 'W' : x.pts < y.pts ? 'L' : 'T'; return { g, label: gameLabel(g), ap: x.pts, bp: y.pts, res, margin: x.pts - y.pts, season: g.season, week: g.week }; });
  const w = rows.filter(r => r.res === 'W').length, l = rows.filter(r => r.res === 'L').length, t = rows.length - w - l;
  const bigA = [...rows].sort((x, y) => y.margin - x.margin)[0], bigB = [...rows].sort((x, y) => x.margin - y.margin)[0];
  const playoff = rows.filter(r => r.g.type !== 'reg');
  let streak = '';
  if (rows.length) { const lastRes = rows[rows.length - 1].res; let n = 0; for (let i = rows.length - 1; i >= 0 && rows[i].res === lastRes; i--) n++; streak = `${lastRes === 'W' ? nameOf(a) : lastRes === 'L' ? nameOf(b) : 'Tied'} ${lastRes === 'T' ? '' : `has won ${n} straight`}`; }
  el.innerHTML = `
    <p><a href="#/rivalries">← All rivalries</a></p>
    <h1>${esc(nameOf(a))} vs ${esc(nameOf(b))}</h1>
    <p class="sub">${rows.length} meetings${playoff.length ? `, ${playoff.length} in the playoffs` : ''}. ${esc(streak)}</p>
    <div class="grid g4">
      ${tile('Series', `${w}-${l}${t ? '-' + t : ''}`, `from ${esc(nameOf(a))}'s side`)}
      ${tile('Points', `${f1(mean(rows.map(r => r.ap)))} – ${f1(mean(rows.map(r => r.bp)))}`, 'average per meeting')}
      ${tile(`${nameOf(a)}'s biggest win`, bigA && bigA.margin > 0 ? signed(bigA.margin) : '–', bigA && bigA.margin > 0 ? bigA.label : '')}
      ${tile(`${nameOf(b)}'s biggest win`, bigB && bigB.margin < 0 ? signed(-bigB.margin) : '–', bigB && bigB.margin < 0 ? bigB.label : '')}
    </div>
    <h2>Game log</h2><div id="t"></div>`;
  table(el.querySelector('#t'), [
    { key: 'label', label: 'Game', sort: r => r.season * 100 + r.week },
    { key: 'res', label: nameOf(a), fmt: r => `<span class="${r.res === 'W' ? 'pos' : r.res === 'L' ? 'neg' : ''}">${r.res}</span>` },
    { key: 'ap', label: `${nameOf(a)} pts`, num: true, fmt: r => f2(r.ap) },
    { key: 'bp', label: `${nameOf(b)} pts`, num: true, fmt: r => f2(r.bp) },
    { key: 'margin', label: 'Margin', num: true, fmt: r => signed(r.margin, 2) },
  ], rows, { sortKey: 'label' });
}

// ---------------------------------------------------------------- Record book
export function records(model, _, el) {
  const rb = recordBook(model);
  const side = r => `${chip(r.owner)}`;
  const g2 = g => { const [w, l] = g.winner === 'b' ? [g.b, g.a] : [g.a, g.b]; return `${chip(w.owner)} <span class="muted">over</span> ${chip(l.owner)}`; };
  const blocks = [
    ['Highest scores', rb.highScore, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'pts', label: 'Pts', num: true, fmt: r => f2(r.pts) }, { key: 'when', label: 'When', fmt: r => gameLabel(r.g) }]],
    ['Lowest scores', rb.lowScore, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'pts', label: 'Pts', num: true, fmt: r => f2(r.pts) }, { key: 'when', label: 'When', fmt: r => gameLabel(r.g) }]],
    ['Biggest blowouts', rb.blowouts, [{ key: 'w', label: 'Game', fmt: g2 }, { key: 'margin', label: 'Margin', num: true, fmt: r => f2(r.margin) }, { key: 'when', label: 'When', fmt: gameLabel }]],
    ['Closest games', rb.closest, [{ key: 'w', label: 'Game', fmt: g2 }, { key: 'margin', label: 'Margin', num: true, fmt: r => f2(r.margin) }, { key: 'when', label: 'When', fmt: gameLabel }]],
    ['Highest-scoring losses', rb.highLoss, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'pts', label: 'Pts', num: true, fmt: r => f2(r.pts) }, { key: 'when', label: 'When', fmt: r => gameLabel(r.g) }]],
    ['Lowest-scoring wins', rb.lowWin, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'pts', label: 'Pts', num: true, fmt: r => f2(r.pts) }, { key: 'when', label: 'When', fmt: r => gameLabel(r.g) }]],
    ['Highest combined', rb.combined, [{ key: 'w', label: 'Game', fmt: g2 }, { key: 'c', label: 'Total', num: true, fmt: g => f2(g.a.pts + g.b.pts) }, { key: 'when', label: 'When', fmt: gameLabel }]],
    ['Best scoring seasons (per game)', rb.seasonPF, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'ppg', label: 'PPG', num: true, fmt: r => f2(r.pf / Math.max(1, r.games)) }, { key: 'season', label: 'Season', fmt: r => `${r.season}${r.inProgress ? ' (in progress)' : ''}` }]],
    ['Best regular-season records', rb.seasonWins, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'r', label: 'Record', fmt: record }, { key: 'season', label: 'Season' }]],
    ['Luckiest seasons', rb.luckiest, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'luck', label: 'Wins over expected', num: true, fmt: r => signed(r.luck) }, { key: 'season', label: 'Season' }]],
    ['Unluckiest seasons', rb.unluckiest, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'luck', label: 'Wins over expected', num: true, fmt: r => signed(r.luck) }, { key: 'season', label: 'Season' }]],
    ['Longest winning streaks', rb.winStreaks, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'n', label: 'Games', num: true }, { key: 'span', label: 'From', fmt: r => `${r.start.season} W${r.start.week} – ${r.end.season} W${r.end.week}` }]],
    ['Longest losing streaks', rb.lossStreaks, [{ key: 'w', label: 'Manager', fmt: side }, { key: 'n', label: 'Games', num: true }, { key: 'span', label: 'From', fmt: r => `${r.start.season} W${r.start.week} – ${r.end.season} W${r.end.week}` }]],
    ['Best individual performances (started)', rb.playerGames, [{ key: 'p', label: 'Player', fmt: r => `${esc(model.nameOf(r.id))} <span class="muted">${esc(model.posOf(r.id))}</span>` }, { key: 'pts', label: 'Pts', num: true, fmt: r => f2(r.pts) }, { key: 'w', label: 'For', fmt: side }, { key: 'when', label: 'When', fmt: r => `${r.season} W${r.week}` }]],
  ];
  el.innerHTML = `<h1>Record book</h1><p class="sub">Every Sleeper season${model.legacy?.games?.length ? ' plus imported pre-Sleeper games' : ''}. Consolation games count for scoring records but not for wins and streaks.</p>
    <h2>All-time standings</h2><p class="muted small">Regular-season record across every season, ranked by win percentage. Playoff games are counted separately. <a href="#/managers">Full career numbers on Managers</a>.</p><div id="alltime"></div>
    <div class="grid g2">${blocks.map((b, i) => `<div><h2>${esc(b[0])}</h2><div id="rb${i}"></div></div>`).join('')}</div>`;
  const car = Object.values(careers(model)).filter(c => model.managers[c.id] && c.games)
    .sort((a, b) => b.pct - a.pct || b.pf - a.pf).map((c, i) => ({ ...c, owner: c.id, rank: i + 1, ppg: c.pf / c.games, ow: c.w + c.pw, ol: c.l + c.pl }));
  table(el.querySelector('#alltime'), [
    { key: 'rank', label: '#', num: true },
    { key: 'id', label: 'Manager', fmt: r => chip(r.id), sort: r => nameOf(r.id) },
    { key: 'pct', label: 'Record', num: true, strong: true, fmt: r => `${record(r)} <span class="muted">${pct(r.pct)}</span>` },
    { key: 'pw', label: 'Playoffs', num: true, sort: r => r.pw - r.pl, fmt: r => (r.pw + r.pl ? `${r.pw}-${r.pl}` : '–') },
    { key: 'titles', label: 'Titles', num: true, sort: r => r.titles.length, fmt: r => (r.titles.length ? `<span class="pill gold">🏆 ${r.titles.length}</span>` : '0') },
    { key: 'ow', label: 'Overall', num: true, extra: true, sort: r => r.ow / Math.max(1, r.ow + r.ol), fmt: r => `${r.ow}-${r.ol}${r.t ? `-${r.t}` : ''}` },
    { key: 'n', label: 'Seasons', num: true, extra: true, sort: r => r.seasons.length, fmt: r => r.seasons.length },
    { key: 'pf', label: 'PF', num: true, fmt: r => f1(r.pf) },
    { key: 'pa', label: 'PA', num: true, extra: true, fmt: r => f1(r.pa) },
    { key: 'ppg', label: 'PF / game', num: true, extra: true, fmt: r => f1(r.ppg) },
    { key: 'playoffs', label: 'Playoff trips', num: true, extra: true },
  ], car, { sortKey: 'rank', desc: false });
  blocks.forEach((b, i) => table(el.querySelector(`#rb${i}`), [{ key: 'i', label: '#', num: true, fmt: r => r.__i }, ...b[2]], b[1].map((r, k) => ({ ...r, __i: k + 1 })), {}));
}

// ---------------------------------------------------------------- Managers
export function managers(model, { parts, q }, el) {
  const car = careers(model);
  if (parts[0]) return profile(model, parts[0], car, el);
  const rows = Object.values(car).filter(c => model.managers[c.id]);
  el.innerHTML = `<h1>Managers</h1><p class="sub">Career numbers across every season in the app. Click a name for the full profile.</p><div id="t"></div>`;
  table(el.querySelector('#t'), [
    { key: 'id', label: 'Manager', fmt: r => chip(r.id), sort: r => nameOf(r.id) },
    { key: 'n', label: 'Seasons', num: true, sort: r => r.seasons.length, fmt: r => r.seasons.length },
    { key: 'pct', label: 'Record', num: true, fmt: r => `${record(r)} <span class="muted">${pct(r.pct)}</span>` },
    { key: 'titles', label: 'Titles', num: true, sort: r => r.titles.length, fmt: r => (r.titles.length ? `<span class="pill gold">🏆 ${r.titles.length}</span>` : '0') },
    { key: 'playoffs', label: 'Playoff trips', num: true },
    { key: 'pw', label: 'Playoff W-L', num: true, fmt: r => `${r.pw}-${r.pl}` },
    { key: 'avg', label: 'Avg score', num: true, fmt: r => f1(r.avg) },
    { key: 'luck', label: 'Career luck', num: true, fmt: r => signed(r.luck), cls: r => (r.luck > 0.5 ? 'pos' : r.luck < -0.5 ? 'neg' : '') },
    { key: 'eff', label: 'Lineup eff.', num: true, fmt: r => pct(r.eff, 1) },
    { key: 'trades', label: 'Trades', num: true },
    { key: 'adds', label: 'Adds', num: true },
  ], rows, { sortKey: 'pct' });
}

function profile(model, id, car, el) {
  const m = model.managers[id]; const c = car[id];
  if (!m || !c) { el.innerHTML = '<p>Unknown manager.</p>'; return; }
  const h2h = headToHead(model);
  const opp = Object.entries(h2h).filter(([k]) => k.startsWith(id + '|')).map(([k, v]) => ({ opp: k.split('|')[1], ...v, n: v.w + v.l + v.t, diff: v.pf - v.pa }));
  // most-started players
  const started = {};
  for (const s of model.seasons) for (const byRid of Object.values(s.weeks)) for (const e of Object.values(byRid)) {
    if (e.owner !== id || !e.final) continue;
    e.starters.forEach((pid, i) => { if (!pid || pid === '0') return; const x = started[pid] ||= { id: pid, starts: 0, pts: 0, seasons: new Set() }; x.starts++; x.pts += Number(e.startersPts[i] || 0); x.seasons.add(s.season); });
  }
  const tend = draftTendencies(model, id);
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  el.innerHTML = `
    <p><a href="#/managers">← All managers</a></p>
    <h1>${chip(id, { link: false })}</h1>
    <p class="sub">Team names: ${Object.entries(m.teamNames).map(([s, n]) => `${esc(n)} <span class="muted">(${s})</span>`).join(', ') || '–'}</p>
    <div class="grid g4">
      ${tile('Career record', record(c), `${pct(c.pct)} · ${c.seasons.length} seasons`)}
      ${tile('Championships', c.titles.length ? '🏆'.repeat(c.titles.length) : '0', c.titles.join(', ') || (c.runnerUps.length ? `Runner-up ${c.runnerUps.join(', ')}` : 'still hunting'))}
      ${tile('Playoffs', `${c.playoffs} trips`, `${c.pw}-${c.pl} in playoff games`)}
      ${tile('Career luck', signed(c.luck), 'wins above all-play expectation')}
      ${tile('Average score', f1(c.avg), `lineup efficiency ${pct(c.eff, 1)}`)}
      ${tile('Best week', c.best ? f2(c.best.pts) : '–', c.best ? `${c.best.season} W${c.best.week}` : '')}
      ${tile('Worst week', c.worst ? f2(c.worst.pts) : '–', c.worst ? `${c.worst.season} W${c.worst.week}` : '')}
      ${tile('Moves', `${c.trades} trade${c.trades === 1 ? '' : 's'}`, `${c.adds} pickup${c.adds === 1 ? '' : 's'} · $${c.faab} FAAB spent`)}
    </div>
    <h2>Season by season</h2><div id="ss"></div>
    <h2>Weekly scores, all time</h2><div class="card" id="wc"></div>
    <div class="grid g2">
      <div><h2>Head to head</h2><div id="h2h"></div></div>
      <div><h2>Most-started players</h2><div id="ms"></div></div>
    </div>
    <h2>Draft tendencies</h2><p class="sub">Positions taken in each round across every Sleeper draft.</p><div id="dt"></div>`;
  table(el.querySelector('#ss'), [
    { key: 'season', label: 'Season' },
    { key: 'team', label: 'Team' },
    { key: 'w', label: 'Record', num: true, fmt: r => r.record },
    { key: 'pf', label: 'PF', num: true, fmt: r => f2(r.pf) },
    { key: 'pa', label: 'PA', num: true, fmt: r => f2(r.pa) },
    { key: 'seed', label: 'Seed', num: true, fmt: r => r.seed ?? '–' },
    { key: 'place', label: 'Finish', num: true, fmt: r => (r.inProgress ? '<span class="muted">in progress</span>' : r.place ? (r.place === 1 ? '🏆 1st' : ordinal(r.place)) : '–') },
    { key: 'luck', label: 'Luck', num: true, fmt: r => (r.luck == null ? '–' : signed(r.luck)) },
  ], c.seasons, { sortKey: 'season' });
  const pts = c.weeks.map(x => x.pts);
  const lg = c.weeks.map(x => { const s = model.seasons.find(y => y.season === x.season); return mean(Object.values(s.weeks[x.week]).map(e => e.pts)); });
  if (pts.length) lineChart(el.querySelector('#wc'), [{ label: m.name, values: pts, emphasis: true }, { label: 'League average', values: lg, color: 'var(--accent-2)', dash: true, legend: true }], { x: c.weeks.map(x => `${String(x.season).slice(2)} W${x.week}`), title: 'Weekly scores' });
  table(el.querySelector('#h2h'), [
    { key: 'opp', label: 'Opponent', fmt: r => `<a href="#/rivalries/${encodeURIComponent(id)}/${encodeURIComponent(r.opp)}">${esc(nameOf(r.opp))}</a>`, sort: r => nameOf(r.opp) },
    { key: 'w', label: 'Record', num: true, fmt: record, sort: r => (r.w - r.l) },
    { key: 'diff', label: 'Pt diff', num: true, fmt: r => signed(r.diff) },
  ], opp, { sortKey: 'w' });
  table(el.querySelector('#ms'), [
    { key: 'id', label: 'Player', fmt: r => `${esc(model.nameOf(r.id))} <span class="muted">${esc(model.posOf(r.id))}</span>`, sort: r => model.nameOf(r.id) },
    { key: 'starts', label: 'Starts', num: true },
    { key: 'pts', label: 'Pts', num: true, fmt: r => f1(r.pts) },
    { key: 'ppg', label: 'Per start', num: true, sort: r => r.pts / r.starts, fmt: r => f1(r.pts / r.starts) },
  ], Object.values(started).sort((a, b) => b.starts - a.starts).slice(0, 15), { sortKey: 'starts' });
  const rounds = Object.keys(tend).map(Number).sort((a, b) => a - b);
  el.querySelector('#dt').innerHTML = rounds.length ? `<div class="tablewrap"><table><thead><tr><th>Round</th>${positions.map(p => `<th class="num">${p}</th>`).join('')}</tr></thead><tbody>${rounds.map(r => `<tr><td>${r}</td>${positions.map(p => { const n = tend[r][p] || 0; return `<td class="num" style="background:${n ? `color-mix(in oklab, var(--accent) ${Math.min(70, n * 25)}%, transparent)` : 'transparent'}">${n || ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : empty('📋', 'No Sleeper drafts yet');
}

// ---------------------------------------------------------------- History
export function history(model, _, el) {
  const rows = [
    ...(model.legacy?.seasons || []).map(s => ({ season: s.season, platform: s.platform || 'Before Sleeper', champ: s.champion, runner: s.runnerUp, legacy: true })),
    ...model.seasons.map(s => {
      const final = s.winners.find(b => b.p === 1 && b.w != null);
      return { season: s.season, platform: 'Sleeper', champ: final ? s.owner(final.w) : null, runner: final ? s.owner(final.l) : null, s, regTop: s.regStandings[0]?.owner, pf: [...s.regStandings].sort((a, b) => b.pf - a.pf)[0]?.owner };
    }),
  ].sort((a, b) => b.season - a.season);
  el.innerHTML = `<h1>History</h1><p class="sub">Champions, brackets and final standings.</p>
    <div id="champs"></div>
    ${model.seasons.slice().reverse().map(s => `<h2>${s.season}${s.status !== 'complete' ? ' (in progress)' : ''}</h2>
      <div class="grid g2"><div id="fs${s.season}"></div><div class="card" id="br${s.season}"></div></div>`).join('')}`;
  table(el.querySelector('#champs'), [
    { key: 'season', label: 'Season' },
    { key: 'platform', label: 'Platform' },
    { key: 'champ', label: 'Champion', fmt: r => (r.champ ? `🏆 ${chip(r.champ)}` : '<span class="muted">TBD</span>'), sort: r => nameOf(r.champ) },
    { key: 'runner', label: 'Runner-up', fmt: r => (r.runner ? chip(r.runner) : '–'), sort: r => nameOf(r.runner) },
    { key: 'regTop', label: 'Regular-season No. 1', fmt: r => (r.regTop ? chip(r.regTop) : '–'), sort: r => nameOf(r.regTop) },
    { key: 'pf', label: 'Most points', fmt: r => (r.pf ? chip(r.pf) : '–'), sort: r => nameOf(r.pf) },
  ], rows, { sortKey: 'season' });
  for (const s of model.seasons) {
    const fs = s.regStandings.map(r => ({ ...r, place: s.status === 'complete' ? finalPlace(s, r.rid) : null })).sort((a, b) => (a.place ?? a.rank) - (b.place ?? b.rank));
    table(el.querySelector(`#fs${s.season}`), [
      { key: 'place', label: s.status === 'complete' ? 'Finish' : 'Seed', num: true, fmt: r => (r.place ?? r.rank) },
      { key: 'owner', label: 'Manager', fmt: r => chip(r.owner, { team: s.teams[r.rid].teamName }), sort: r => nameOf(r.owner) },
      { key: 'rec', label: 'Record', fmt: record },
      { key: 'pf', label: 'PF', num: true, fmt: r => f1(r.pf) },
    ], fs, {});
    bracket(model, s, el.querySelector(`#br${s.season}`));
  }
}

function bracket(model, s, el) {
  const rounds = [...new Set(s.winners.map(b => b.r))].sort((a, b) => a - b);
  if (!rounds.length) { el.innerHTML = '<p class="muted">Bracket not set yet.</p>'; return; }
  const seed = rid => s.regStandings.find(r => r.rid === rid)?.rank;
  const pts = (rid, r) => s.weeks[s.playoffStart + r - 1]?.[rid]?.pts;
  el.innerHTML = `<h3>Playoff bracket</h3><div style="display:grid;grid-template-columns:repeat(${rounds.length},minmax(0,1fr));gap:10px">${rounds.map(r => `<div><div class="muted" style="font-size:12px;margin-bottom:6px">${r === rounds[rounds.length - 1] ? 'Finals' : `Round ${r}`} · W${s.playoffStart + r - 1}</div>${s.winners.filter(b => b.r === r).sort((a, b) => (a.p || 0) - (b.p || 0)).map(b => `
      <div style="border:1px solid var(--border);border-radius:8px;padding:6px 8px;margin-bottom:8px;font-size:13px">
        ${b.p ? `<div class="muted" style="font-size:11px">${b.p === 1 ? 'Championship' : `${ordinal(b.p)} place`}</div>` : ''}
        ${[b.t1, b.t2].map(t => t == null ? '<div class="muted">TBD</div>' : `<div style="display:flex;justify-content:space-between;gap:6px;${b.w === t ? 'font-weight:650' : ''}"><span>${seed(t) ? `<span class="muted">${seed(t)}</span> ` : ''}${esc(nameOf(s.owner(t)))}</span><span>${pts(t, r) != null && b.w != null ? f1(pts(t, r)) : ''}</span></div>`).join('')}
      </div>`).join('')}</div>`).join('')}</div>`;
}
