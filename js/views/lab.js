// "Sleeper+" pages: the all-play tracker, the what-if lab (playoff machine, lineup swaps) and the
// team breakdown.
import { setQuery } from '../app.js';
import { esc, f1, f2, pct, signed, chip, nameOf, table, seasonSelect, weekSelect, record, posClass, empty, progress } from '../ui.js';
import { allPlayWeeks, careerAllPlay, teamBreakdown, playoffOdds, byesFor, gameKey, SLOT_ELIG, BENCH } from '../stats.js';
import { divergingFill } from '../charts.js';
import { pickSeason, meOwner, lastFinalWeek } from './common.js';
import { CONFIG } from '../config.js';

const apRec = r => `${r.apw}-${r.apl}${r.apt ? '-' + r.apt : ''}`;

// ---------------------------------------------------------------- All-play tracker
export function allPlay(model, { q }, el) {
  if (q.season === 'all') return allPlayCareer(model, el);
  const s = pickSeason(model, q);
  const ap = allPlayWeeks(s);
  const st = s.regStandings;
  const apOrder = [...st].sort((a, b) => b.apPct - a.apPct || b.pf - a.pf);
  const apRank = Object.fromEntries(apOrder.map((r, i) => [r.rid, i + 1]));
  el.innerHTML = `<h1>All-play</h1>
    <p class="sub">Your record if you played every team every week. Each square is how many of the other ${ap.n - 1} teams you outscored that week. A dot marks a game whose real result didn't match: a loss in a week you beat most of the league, or a win in a week you beat almost nobody.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }), { includeAll: true })}<span class="muted">${s.season} regular season, ${ap.weeks.length} week${ap.weeks.length === 1 ? '' : 's'} played.</span></div>
    ${ap.weeks.length ? '' : empty('⏳', 'No weeks have finished yet', 'All-play fills in after week 1.')}
    <div class="tablewrap"><table class="matrix allplay"><thead><tr><th class="rowh">Manager</th>${ap.weeks.map(w => `<th>W${w}</th>`).join('')}<th>All-play</th></tr></thead><tbody>
    ${apOrder.map(r => `<tr><th class="rowh">${chip(r.owner)}</th>${ap.weeks.map(w => {
      const c = ap.cells[r.rid][w]; if (!c) return '<td class="muted">–</td>';
      const share = (c.wins + c.ties / 2) / Math.max(1, c.of);
      const odd = (c.res === 'L' && share >= 0.6) || (c.res === 'W' && share <= 0.4);
      return `<td style="background:${divergingFill(share)}" title="Week ${w}: ${f2(c.pts)} pts, beat ${c.wins} of ${c.of}${c.res ? ` · real result: ${c.res}` : ''}">${c.wins}${odd ? `<span class="odd ${c.res === 'L' ? 'neg' : 'pos'}">●</span>` : ''}</td>`;
    }).join('')}<td><b>${apRec(r)}</b></td></tr>`).join('')}</tbody></table></div>
    <h2>All-play standings</h2><div id="t"></div>
    <h2>Unluckiest losses and luckiest wins</h2><div class="grid two" id="odd"></div>`;
  table(el.querySelector('#t'), [
    { key: 'apRank', label: 'All-play rank', num: true, sort: r => -apRank[r.rid], fmt: r => apRank[r.rid] },
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'apPct', label: 'All-play', num: true, fmt: r => `${apRec(r)} <span class="muted">${pct(r.apPct)}</span>` },
    { key: 'pct', label: 'Actual', num: true, fmt: r => `${record(r)} <span class="muted">${pct(r.pct)}</span>` },
    { key: 'rank', label: 'Actual rank', num: true, sort: r => -r.rank, fmt: r => r.rank },
    { key: 'diff', label: 'Rank vs all-play', num: true, sort: r => apRank[r.rid] - r.rank, fmt: r => { const d = apRank[r.rid] - r.rank; return d ? `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}` : '='; }, cls: r => (apRank[r.rid] - r.rank > 0 ? 'pos' : apRank[r.rid] - r.rank < 0 ? 'neg' : '') },
    { key: 'xw', label: 'Expected wins', num: true, fmt: r => f1(r.xw) },
    { key: 'luck', label: 'Luck', num: true, fmt: r => signed(r.luck), cls: r => (r.luck > 0.5 ? 'pos' : r.luck < -0.5 ? 'neg' : '') },
  ], st, { sortKey: 'apRank' });
  const all = Object.entries(ap.cells).flatMap(([rid, ws]) => Object.entries(ws).map(([w, c]) => ({ rid, owner: s.owner(rid), week: Number(w), ...c })));
  const losses = all.filter(c => c.res === 'L').sort((a, b) => b.wins - a.wins || b.pts - a.pts).slice(0, 6);
  const wins = all.filter(c => c.res === 'W').sort((a, b) => a.wins - b.wins || a.pts - b.pts).slice(0, 6);
  const list = (title, rows, note) => `<div class="card"><h3>${title}</h3>${rows.length ? `<ul class="plain">${rows.map(c => `<li>${chip(c.owner)} <span class="muted">week ${c.week} · ${f2(c.pts)} pts · ${note(c)}</span></li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}</div>`;
  el.querySelector('#odd').innerHTML = list('Lost anyway', losses, c => `would have beaten ${c.wins} of ${c.of}`) + list('Won anyway', wins, c => `would have beaten only ${c.wins} of ${c.of}`);
}

function allPlayCareer(model, el) {
  const rows = careerAllPlay(model);
  const seasons = model.seasons.filter(s => Math.min(s.completedThrough, s.regWeeks) >= 1).map(s => s.season);
  el.innerHTML = `<h1>All-play</h1>
    <p class="sub">Career all-play across every Sleeper season: how often you'd have won if you played the whole league every week, next to how often you actually won.</p>
    <div class="toolbar">${seasonSelect(model, 'all', v => setQuery({ season: v }), { includeAll: true })}</div>
    <div id="t"></div>`;
  table(el.querySelector('#t'), [
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'apPct', label: 'Career all-play', num: true, fmt: r => `${apRec(r)} <span class="muted">${pct(r.apPct, 1)}</span>` },
    { key: 'pct', label: 'Actual', num: true, fmt: r => `${record(r)} <span class="muted">${pct(r.pct, 1)}</span>` },
    { key: 'luck', label: 'Career luck', num: true, fmt: r => signed(r.luck), cls: r => (r.luck > 0.5 ? 'pos' : r.luck < -0.5 ? 'neg' : '') },
    ...seasons.map(se => ({ key: 's' + se, label: se, num: true, sort: r => r.seasons[se]?.apPct ?? -1, fmt: r => (r.seasons[se] ? `<span style="padding:2px 6px;border-radius:5px;background:${divergingFill(r.seasons[se].apPct)}">${pct(r.seasons[se].apPct)}</span>` : '–') })),
  ], rows, { sortKey: 'apPct' });
}

// ---------------------------------------------------------------- What-if lab
export function whatIf(model, { q }, el) {
  const tab = q.tab || 'playoffs';
  el.innerHTML = `<h1>What-if lab</h1>
    <p class="sub">Play out the rest of the season your way, or replay a week with a different lineup.</p>
    <div class="toolbar"><div class="seg" id="tabs">${[['playoffs', 'Playoff machine'], ['lineup', 'Lineup swap']].map(([v, l]) => `<button type="button" data-v="${v}" class="${v === tab ? 'on' : ''}">${l}</button>`).join('')}</div></div><div id="lab"></div>`;
  el.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setQuery({ tab: b.dataset.v === 'playoffs' ? null : b.dataset.v, week: null, team: null, from: null }));
  const box = el.querySelector('#lab');
  return tab === 'lineup' ? lineupSwap(model, q, box) : playoffMachine(model, q, box);
}

function playoffMachine(model, q, el) {
  const s = pickSeason(model, q);
  const done = Math.min(s.completedThrough, s.regWeeks);
  const from = Math.max(0, Math.min(done, q.from != null ? Number(q.from) : done));
  const games = s.games.filter(g => g.type === 'reg' && g.week > from).sort((a, b) => a.week - b.week);
  const store = `almanac-picks-${s.season}-${from}`;
  let picks = {};
  try { picks = JSON.parse(sessionStorage.getItem(store) || '{}'); } catch {}
  const fromOpts = []; for (let w = 0; w <= done; w++) fromOpts.push(w);
  el.innerHTML = `<div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v, from: null }))}
      <label class="muted">Start after <select id="from">${fromOpts.map(w => `<option value="${w}" ${w === from ? 'selected' : ''}>${w === 0 ? 'the draft' : `week ${w}`}${w === done ? ' (today)' : ''}</option>`).join('')}</select></label>
      <button type="button" class="btn" id="clear">Clear picks</button></div>
    <p class="muted">Pick winners for any of the ${games.length} remaining regular-season game${games.length === 1 ? '' : 's'}. Unpicked games are simulated ${CONFIG.SIMS.toLocaleString()} times from each team's scoring so far. ${from < done ? 'Games already played after your start week show the real winner with a ✓ but can be changed.' : ''}</p>
    <div class="grid machine"><div id="odds"></div><div><div id="mprog"></div><div id="games"></div></div></div>`;
  el.querySelector('#from').onchange = e => setQuery({ from: Number(e.target.value) === done ? null : e.target.value });
  el.querySelector('#clear').onclick = () => { picks = {}; save(); drawGames(); drawOdds(); };
  const save = () => { try { sessionStorage.setItem(store, JSON.stringify(picks)); } catch {} };

  function drawOdds() {
    const odds = playoffOdds(s, from, CONFIG.SIMS, picks);
    const rows = Object.entries(odds).map(([rid, o]) => ({ rid: Number(rid), owner: s.owner(rid), ...o })).sort((a, b) => a.avgSeed - b.avgSeed);
    const byes = byesFor(s.playoffTeams);
    const fmt = p => (p >= 0.9995 ? '<b class="pos">In</b>' : p <= 0.0005 ? '<span class="neg">Out</span>' : pct(p, p > 0.99 || p < 0.01 ? 1 : 0));
    el.querySelector('#odds').innerHTML = `<div class="card"><h3>Projected finish</h3><div class="tablewrap"><table><thead><tr><th>Manager</th><th class="num">Proj. wins</th><th class="num">Avg seed</th><th class="num">Playoffs</th>${byes > 1 ? '<th class="num">Bye</th>' : ''}<th class="num">${byes === 1 ? '1st seed (bye)' : '1st seed'}</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${i === s.playoffTeams - 1 ? 'cutline' : ''}"><td>${chip(r.owner)}</td><td class="num">${f1(r.projWins)}</td><td class="num">${f1(r.avgSeed)}</td><td class="num">${fmt(r.playoff)}</td>${byes > 1 ? `<td class="num">${fmt(r.bye)}</td>` : ''}<td class="num">${fmt(r.top)}</td></tr>`).join('')}
      </tbody></table></div><p class="muted small">${s.playoffTeams} teams make the playoffs. The line marks the cut.</p></div>`;
  }
  // One week at a time: the first week starts open, and whatever you open stays open.
  const openWeeks = new Set(games.length ? [String(games[0].week)] : []);
  function drawGames() {
    const byWeek = {};
    for (const g of games) (byWeek[g.week] ||= []).push(g);
    const picked = games.filter(g => picks[gameKey(g)]).length;
    el.querySelector('#mprog').innerHTML = games.length ? progress(picked, games.length, 'Games you have called', `You've called every game. That's the season, your way.`) : '';
    el.querySelector('#games').innerHTML = Object.entries(byWeek).map(([w, gs]) => {
      const n = gs.filter(g => picks[gameKey(g)]).length;
      return `<details class="card wk" data-w="${w}" ${openWeeks.has(w) ? 'open' : ''}><summary>Week ${w}<span class="muted ${n === gs.length ? 'all' : ''}">${n === gs.length ? '✓ all picked' : `${n} of ${gs.length} picked`}</span></summary><div class="wkbody">${gs.map(g => {
      const k = gameKey(g), pick = picks[k];
      const real = g.final ? g.winner : null;
      const btn = side => { const x = g[side]; return `<button type="button" class="pickbtn ${pick === side ? 'on' : ''}" data-k="${k}" data-side="${side}" aria-pressed="${pick === side}">${esc(nameOf(x.owner))}${real === side ? ' ✓' : ''}</button>`; };
      return `<div class="pickrow">${btn('a')}<span class="muted small">vs</span>${btn('b')}</div>`;
    }).join('')}</div></details>`; }).join('') || empty('🏁', 'The regular season is over', 'Choose an earlier start week above to replay it your way.');
    el.querySelectorAll('details.wk').forEach(d => d.ontoggle = () => { d.open ? openWeeks.add(d.dataset.w) : openWeeks.delete(d.dataset.w); });
    el.querySelectorAll('.pickbtn').forEach(b => b.onclick = () => {
      const { k, side } = b.dataset;
      if (picks[k] === side) delete picks[k]; else picks[k] = side;
      save(); drawGames(); drawOdds();
    });
  }
  drawGames(); drawOdds();
}

function lineupSwap(model, q, el) {
  const s = pickSeason(model, q);
  const maxW = Math.max(1, s.completedThrough);
  const week = Math.min(maxW, Number(q.week) || lastFinalWeek(s));
  const entries = s.weeks[week] || {};
  const me = meOwner(model);
  const rid = Number(q.team) || Number(Object.values(entries).find(e => e.owner === me)?.rid) || Number(Object.keys(entries)[0]);
  const e = entries[rid];
  const teamOpts = Object.values(entries).map(x => ({ rid: x.rid, name: nameOf(x.owner) })).sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `<div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v, week: null }))}${weekSelect(s, week, v => setQuery({ week: v }), maxW)}
    <select id="team" aria-label="Team">${teamOpts.map(t => `<option value="${t.rid}" ${t.rid === rid ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div><div id="swap"></div>`;
  el.querySelector('#team').onchange = ev => setQuery({ team: ev.target.value });
  if (!e) { el.querySelector('#swap').innerHTML = '<p class="muted">No lineup for that week.</p>'; return; }
  const slots = s.rosterPositions.filter(p => !BENCH.has(p));
  const actual = slots.map((_, i) => (e.starters[i] && e.starters[i] !== '0' ? e.starters[i] : null));
  let lineup = [...actual], sel = null;
  const pts = id => (id ? Number(e.playersPts[id] || 0) : 0);
  const g = s.games.find(x => x.week === week && (x.a.rid === rid || x.b.rid === rid));
  const opp = g ? (g.a.rid === rid ? g.b : g.a) : null;
  const fits = (slot, id) => id && model.positionsOf(id).some(p => (SLOT_ELIG[slot] || [slot]).includes(p));
  const optimal = () => {
    const out = slots.map(() => null), used = new Set();
    for (const o of e.optimal.lineup) { const i = slots.findIndex((sl, j) => sl === o.slot && out[j] == null && !used.has(o.id)); if (i >= 0) { out[i] = o.id; used.add(o.id); } }
    return out;
  };

  function draw() {
    const total = lineup.reduce((t, id) => t + pts(id), 0);
    const real = actual.reduce((t, id) => t + pts(id), 0);
    const bench = e.players.filter(id => !lineup.includes(id)).sort((a, b) => pts(b) - pts(a));
    const res = !opp ? '' : total > opp.pts ? '<b class="pos">Win</b>' : total < opp.pts ? '<b class="neg">Loss</b>' : '<b>Tie</b>';
    const realRes = !opp ? '' : real > opp.pts ? 'won' : real < opp.pts ? 'lost' : 'tied';
    const changed = lineup.some((id, i) => id !== actual[i]);
    const row = (id, i) => `<tr class="${sel === i ? 'sel' : ''} ${id !== actual[i] ? 'changed' : ''}" data-i="${i}"><td><span class="pb ${posClass(slots[i])}">${esc(slots[i].replace('SUPER_FLEX', 'SF').replace('_', ' '))}</span></td><td>${id ? `${esc(model.nameOf(id))} <span class="muted">${esc(model.posOf(id))}</span>` : '<span class="muted">Empty</span>'}</td><td class="num">${f2(pts(id))}</td></tr>`;
    el.querySelector('#swap').innerHTML = `<div class="grid two">
      <div class="card"><h3>Starters</h3><p class="muted small">Tap a starter, then a bench player to swap them.</p><div class="tablewrap"><table class="lineup"><tbody>${lineup.map(row).join('')}</tbody></table></div>
        <div class="toolbar" style="margin-top:10px"><button type="button" class="btn" id="best">Best possible lineup</button><button type="button" class="btn" id="reset" ${changed ? '' : 'disabled'}>Reset</button></div></div>
      <div class="stack"><div class="card result"><div class="label muted">${changed ? 'With your changes' : 'As played'}</div><div class="big">${f2(total)} ${opp ? `<span class="muted">vs ${f2(opp.pts)}</span>` : ''}</div>
        <div>${opp ? `${res} against ${chip(opp.owner)}` : 'No opponent this week'}</div>
        ${changed ? `<p class="muted">${signed(total - real, 2)} points vs what was played (${f2(real)}, ${realRes}).${opp && (total > opp.pts) !== (real > opp.pts) ? ' <b>That flips the result.</b>' : ''}</p>` : `<p class="muted">Best possible lineup scored ${f2(e.optimal.pts)} (${pct(e.efficiency)} efficiency).</p>`}</div>
        <div class="card"><h3>Bench</h3><div class="tablewrap"><table class="lineup"><tbody>${bench.map(id => `<tr class="${sel != null && fits(slots[sel], id) ? 'can' : sel != null ? 'cant' : ''}" data-id="${esc(id)}"><td><span class="pb ${posClass(model.posOf(id))}">${esc(model.posOf(id))}</span></td><td>${esc(model.nameOf(id))}</td><td class="num">${f2(pts(id))}</td></tr>`).join('') || '<tr><td class="muted">Nobody on the bench.</td></tr>'}</tbody></table></div></div></div></div>`;
    el.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => { const i = Number(tr.dataset.i); sel = sel === i ? null : i; draw(); });
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => {
      if (sel == null || !fits(slots[sel], tr.dataset.id)) return;
      lineup[sel] = tr.dataset.id; sel = null; draw();
    });
    el.querySelector('#best').onclick = () => { lineup = optimal(); sel = null; draw(); };
    el.querySelector('#reset').onclick = () => { lineup = [...actual]; sel = null; draw(); };
  }
  draw();
}

// ---------------------------------------------------------------- Team breakdown
export function breakdown(model, { q }, el) {
  const s = pickSeason(model, q);
  const b = teamBreakdown(model, s);
  el.innerHTML = `<h1>Team breakdown</h1>
    <p class="sub">Where each team's points come from, how much it left on the bench, and how it does in close games. Positional numbers are starter points per game; colors compare each team to the league average (blue above, gold below).</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))}<span class="muted">${s.season} regular season through week ${b.through}.</span></div>
    <h2>Points by position</h2>
    <div class="tablewrap"><table class="matrix"><thead><tr><th class="rowh">Manager</th>${b.positions.map(p => `<th>${p}</th>`).join('')}</tr></thead><tbody>
    ${[...b.rows].sort((x, y) => y.pf - x.pf).map(r => `<tr><th class="rowh">${chip(r.owner)}</th>${b.positions.map(p => {
      const v = r.posPg[p], avg = b.league[p] || 1;
      return `<td style="background:${divergingFill(0.5 + Math.max(-0.5, Math.min(0.5, (v - avg) / avg)))}" title="${esc(nameOf(r.owner))} ${p}: ${f1(v)} per game (league ${f1(avg)})">${f1(v)}</td>`;
    }).join('')}</tr>`).join('')}
    <tr><th class="rowh muted">League average</th>${b.positions.map(p => `<td class="muted">${f1(b.league[p])}</td>`).join('')}</tr></tbody></table></div>
    <h2>Lineups, luck and close calls</h2><div id="t"></div>`;
  table(el.querySelector('#t'), [
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'pf', label: 'Points for', num: true, fmt: r => f1(r.pf) },
    { key: 'maxPf', label: 'Max possible', num: true, fmt: r => f1(r.maxPf) },
    { key: 'eff', label: 'Lineup efficiency', num: true, fmt: r => pct(r.eff, 1) },
    { key: 'left', label: 'Left on bench', num: true, fmt: r => f1(r.left) },
    { key: 'benchPg', label: 'Bench pts/week', num: true, fmt: r => f1(r.benchPg) },
    { key: 'pa', label: 'Points against', num: true, fmt: r => `${f1(r.pa)} <span class="muted">#${r.paRank}</span>` },
    { key: 'close', label: 'Games < 10 pts', num: true, sort: r => r.close.w - r.close.l, fmt: r => `${r.close.w}-${r.close.l}` },
    { key: 'blow', label: 'Blowouts (40+)', num: true, sort: r => r.blow.w - r.blow.l, fmt: r => `${r.blow.w}-${r.blow.l}` },
    { key: 'mvp', label: 'Team MVP', sort: r => r.mvp?.share || 0, fmt: r => (r.mvp ? `${esc(model.nameOf(r.mvp.id))} <span class="muted">${f1(r.mvp.pts)} · ${pct(r.mvp.share)} of points</span>` : '–') },
  ], b.rows, { sortKey: 'pf' });
}
