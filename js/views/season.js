import { CONFIG } from '../config.js';
import { setQuery } from '../app.js';
import { esc, f2, f1, pct, signed, chip, nameOf, table, tile, seasonSelect, weekSelect, record, ordinal, empty } from '../ui.js';
import { standingsThrough, powerRankings, powerHistory, playoffOdds, oddsHistory, consistency, mean, byesFor, winProb } from '../stats.js';
import { weekReport, reportText } from '../report.js';
import { lineChart } from '../charts.js';
import { logo } from '../logo.js';
import { personaColumn } from '../columns.js';
import { personaOf } from '../persona.js';
import { SERVER } from '../server.js';
import { columnNotes } from '../column-notes.js';
import { pickSeason, lastFinalWeek, meOwner, highlightSelect } from './common.js';

// ---------------------------------------------------------------- Home
export function home(model, { q }, el) {
  const latest = model.seasons[model.seasons.length - 1];
  const s = pickSeason(model, {});
  const live = latest.status !== 'complete';
  const wk = live ? Math.min(latest.currentWeek, latest.lastWeek) : latest.lastWeek;
  const lastChamp = [...model.seasons].reverse().find(x => x.champion != null);
  const st = s.regStandings;
  const rep = s.completedThrough >= 1 ? weekReport(model, s, lastFinalWeek(s)) : null;
  const pr = s.completedThrough >= 1 ? powerRankings(s, lastFinalWeek(s)) : [];
  const allSides = model.seasons.flatMap(x => Object.values(x.weeks).flatMap(w => Object.values(w))).filter(e => e.final);
  const best = [...allSides].sort((a, b) => b.pts - a.pts)[0];

  el.innerHTML = `
    <div class="hero field"><div class="ez l" aria-hidden="true"></div><div class="ez r" aria-hidden="true"></div>
    <div class="turf" aria-hidden="true">${['10', '20', '30', '40', '50', '40', '30', '20', '10'].map(n => `<span>${n}</span>`).join('')}</div>
    <div class="inner">${logo()}<div><div class="kicker">Fantasy football league</div><h1>${esc(CONFIG.SITE_NAME)}</h1>
    <p class="sub">${latest.season} season · ${live ? (latest.completedThrough ? `week ${wk}` : 'preseason') : 'final'} · ${Object.keys(latest.teams).length} teams · ${model.seasons.length} Sleeper seasons${model.legacy?.seasons?.length ? ` + ${model.legacy.seasons.length} legacy` : ''}</p></div></div></div>
    <div class="grid g4">
      ${tile('Reigning champion', lastChamp ? chip(lastChamp.owner(lastChamp.champion)) : '–', lastChamp ? `${lastChamp.season} title` : '')}
      ${tile(`${s.season} leader`, st[0] ? chip(st[0].owner) : '–', st[0] ? `${record(st[0])}, ${f1(st[0].pf)} PF` : '')}
      ${tile('Power No. 1', pr[0] ? chip(pr[0].owner) : '–', pr[0] ? `score ${f1(pr[0].score)}` : '')}
      ${tile('All-time high score', best ? f2(best.pts) : '–', best ? `${esc(nameOf(best.owner))}, ${best.season} week ${best.week}` : '')}
    </div>
    <h2>${live ? `Week ${wk} matchups` : `${latest.season} final week`}</h2>
    <div id="mu"></div>
    <div id="typrev" class="tyslot"></div>
    ${rep ? `<h2>Latest report</h2><div class="card report"><div class="headline">${esc(rep.headline)}</div><p class="muted">${s.season} week ${rep.week} · league average ${f2(rep.leagueAvg)}</p><a href="#/reports?season=${s.season}&week=${rep.week}">Read the full week ${rep.week} report →</a></div>` : ''}
    <div class="grid g2" style="margin-top:14px">
      <div><h2>Standings</h2><div id="st"></div></div>
      <div><h2>Power rankings</h2><div id="pr"></div></div>
    </div>`;
  matchupCards(model, latest, wk, el.querySelector('#mu'));
  // Before a week kicks off, the persona previews it.
  const upcoming = latest.games.filter(g => g.week === wk && g.matchupId != null);
  if (live && upcoming.length && upcoming.every(g => !g.final && !g.a.pts && !g.b.pts)) {
    personaColumn(el.querySelector('#typrev'), model, { kind: 'preview', season: latest.season, week: wk, facts: () => previewFacts(model, latest, wk) });
  }
  table(el.querySelector('#st'), [
    { key: 'rank', label: '#', num: true },
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'pct', label: 'Record', fmt: r => record(r), num: true },
    { key: 'pf', label: 'PF', num: true, fmt: r => f1(r.pf) },
  ], st, { sortKey: 'rank', desc: false, rowClass: (r, i, rows) => (i === s.playoffTeams - 1 ? 'cut' : '') });
  table(el.querySelector('#pr'), [
    { key: 'rank', label: '#', num: true },
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'record', label: 'Record' },
    { key: 'score', label: 'Score', num: true, fmt: r => f1(r.score) },
  ], pr, { sortKey: 'rank', desc: false });
}

export function matchupCards(model, s, w, el) {
  const games = s.games.filter(g => g.week === w);
  if (!games.length) { el.innerHTML = empty('🗓️', `No matchups in week ${w}`, 'Pick another week to see its games.'); return; }
  el.innerHTML = `<div class="matchups">${games.map(g => {
    const tag = g.type === 'playoff' ? (g.place === 1 ? 'Championship' : 'Playoffs') : g.type === 'placement' ? `${ordinal(g.place)}-place game` : g.type === 'consolation' ? 'Consolation' : (g.final ? 'Final' : 'In progress / upcoming');
    const live = !g.final && g.a.pts === 0 && g.b.pts === 0;
    const wp = live ? winProb(s, g.a.rid, g.b.rid, Math.min(s.completedThrough, s.regWeeks)).p : null;
    const riv = (model.rivals || []).find(r => (r.a === g.a.owner && r.b === g.b.owner) || (r.a === g.b.owner && r.b === g.a.owner));
    const row = (x, win, p) => `<div class="row ${win ? 'win' : ''}">${chip(x.owner, { team: s.teams[x.rid]?.teamName })}<span class="score">${live ? `<span class="muted">${pct(p)} to win</span>` : f2(x.pts)}</span></div>`;
    return `<div class="card matchup"><div class="tag">${esc(live ? 'Preview' : tag)}${riv ? ` · <span class="pill gold">Rivalry: ${esc(riv.name)}</span>` : ''}</div>${row(g.a, g.winner === 'a', wp)}${row(g.b, g.winner === 'b', wp == null ? null : 1 - wp)}</div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- Standings & playoff odds
export function standings(model, { q }, el) {
  const s = pickSeason(model, q);
  const through = Math.min(s.completedThrough, s.regWeeks);
  const rows = standingsThrough(s, through);
  const remaining = s.games.some(g => g.type === 'reg' && g.week > through);
  const odds = remaining ? playoffOdds(s, through, CONFIG.SIMS) : null;
  const hl = q.hl || meOwner(model);
  el.innerHTML = `
    <h1>Standings &amp; playoff odds</h1>
    <p class="sub">${s.season} regular season through week ${through}. All-play is your record if you played every team every week; luck is actual wins minus expected wins.${odds ? ` Odds come from ${CONFIG.SIMS.toLocaleString()} simulations of the remaining schedule.` : ''}</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))} ${highlightSelect(model, hl, v => setQuery({ hl: v }), Object.values(s.teams).map(t => t.ownerId))}</div>
    <div id="t"></div>
    <h2>Playoff odds by week</h2>
    <p class="sub">Each point re-runs the simulation using only results known at that week.</p>
    <div class="card" id="oc"></div>`;
  const cols = [
    { key: 'rank', label: '#', num: true },
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner, { team: s.teams[r.rid].teamName }), sort: r => nameOf(r.owner) },
    { key: 'pct', label: 'W-L', num: true, strong: true, fmt: r => record(r) },
    { key: 'pf', label: 'PF', num: true, fmt: r => f2(r.pf) },
    { key: 'pa', label: 'PA', num: true, extra: true, fmt: r => f2(r.pa) },
    { key: 'apPct', label: 'All-play', num: true, fmt: r => `${r.apw}-${r.apl}${r.apt ? '-' + r.apt : ''} <span class="muted">${pct(r.apPct)}</span>` },
    { key: 'xw', label: 'xWins', num: true, extra: true, fmt: r => f1(r.xw) },
    { key: 'luck', label: 'Luck', num: true, fmt: r => signed(r.luck), cls: r => (r.luck > 0.5 ? 'pos' : r.luck < -0.5 ? 'neg' : '') },
    { key: 'streak', label: 'Streak', extra: true },
  ];
  if (odds) {
    cols.push(
      { key: 'proj', label: 'Proj W', num: true, sort: r => odds[r.rid].projWins, fmt: r => f1(odds[r.rid].projWins) },
      { key: 'po', label: 'Playoffs', num: true, strong: true, sort: r => odds[r.rid].playoff, fmt: r => oddsCell(odds[r.rid].playoff) },
    );
    // With one bye, the bye and the 1 seed are the same thing, so only the 1 seed column shows.
    const byes = byesFor(s.playoffTeams);
    if (byes > 1) cols.push({ key: 'bye', label: 'Bye', num: true, extra: true, sort: r => odds[r.rid].bye, fmt: r => pct(odds[r.rid].bye) });
    cols.push({ key: 'top', label: byes === 1 ? '1 seed (bye)' : '1 seed', num: true, extra: true, sort: r => odds[r.rid].top, fmt: r => pct(odds[r.rid].top) },
      { key: 'last', label: 'Last', num: true, extra: true, sort: r => odds[r.rid].last, fmt: r => pct(odds[r.rid].last) });
  }
  table(el.querySelector('#t'), cols, rows, { sortKey: 'rank', desc: false, rowClass: (r, i) => (i === s.playoffTeams - 1 ? 'cut' : '') });
  const oc = el.querySelector('#oc');
  if (through < 1) { oc.innerHTML = empty('⏳', 'No games played yet', 'The odds chart fills in after week 1 is final.'); return; }
  setTimeout(() => {
    const hist = oddsHistory(s, 1200);
    const x = Array.from({ length: through + 1 }, (_, i) => (i === 0 ? 'Pre' : `W${i}`));
    lineChart(oc, Object.entries(hist).map(([rid, v]) => ({ label: nameOf(s.teams[rid].ownerId), values: v, emphasis: s.teams[rid].ownerId === hl })), { x, yMin: 0, yMax: 1, yFormat: v => pct(v), title: 'Playoff odds by week' });
  });
}
function oddsCell(p) {
  if (p >= 0.995) return '<span class="pos">&gt;99%</span>';
  if (p <= 0.005) return '<span class="neg">&lt;1%</span>';
  return pct(p);
}

// ---------------------------------------------------------------- Power rankings
export function power(model, { q }, el) {
  const s = pickSeason(model, q);
  const maxW = lastFinalWeek(s);
  const w = Math.min(Number(q.week) || maxW, maxW);
  const hl = q.hl || meOwner(model);
  if (s.completedThrough < 1) { el.innerHTML = `<h1>Power rankings</h1>${empty('⏳', `No games played in ${s.season} yet`, 'Rankings appear once week 1 is final. Last season is still here.', `<a class="btn" href="#/power?season=${Number(s.season) - 1}">See ${Number(s.season) - 1} rankings</a>`)}`; return; }
  const now = powerRankings(s, w);
  const prev = w > 1 ? Object.fromEntries(powerRankings(s, w - 1).map(r => [r.rid, r.rank])) : {};
  el.innerHTML = `
    <h1>Power rankings</h1>
    <p class="sub">A composite score: win % (35%), all-play win rate (30%), last-3-weeks scoring (15%), season scoring (10%), lineup efficiency (5%) and consistency (5%), each as a percentile within the league.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v, week: null }))} ${weekSelect(s, w, v => setQuery({ week: v }), maxW)} ${highlightSelect(model, hl, v => setQuery({ hl: v }), Object.values(s.teams).map(t => t.ownerId))}</div>
    <div id="t"></div>
    <h2>Rank by week</h2><div class="card" id="c"></div>`;
  table(el.querySelector('#t'), [
    { key: 'rank', label: '#', num: true, fmt: r => `<span class="jno">${r.rank}</span>` },
    { key: 'move', label: '±', num: true, sort: r => (prev[r.rid] ? prev[r.rid] - r.rank : 0), fmt: r => { const d = prev[r.rid] ? prev[r.rid] - r.rank : 0; return d ? `<span class="${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>` : '<span class="muted">–</span>'; } },
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner, { team: s.teams[r.rid].teamName }), sort: r => nameOf(r.owner) },
    { key: 'record', label: 'Record' },
    { key: 'score', label: 'Score', num: true, fmt: r => `<span class="bartrack"><span class="bar" style="display:block;width:${r.score}%"></span></span> ${f1(r.score)}` },
    { key: 'apPct', label: 'All-play', num: true, fmt: r => pct(r.apPct) },
    { key: 'recent', label: 'Last 3 avg', num: true, fmt: r => f1(r.recent) },
    { key: 'avg', label: 'Season avg', num: true, fmt: r => f1(r.avg) },
    { key: 'eff', label: 'Lineup eff.', num: true, fmt: r => pct(r.eff, 1) },
  ], now, { sortKey: 'rank', desc: false });
  const hist = powerHistory(s);
  const n = Object.values(hist)[0]?.length || 0;
  lineChart(el.querySelector('#c'), Object.entries(hist).map(([rid, v]) => ({ label: nameOf(s.teams[rid].ownerId), values: v, emphasis: s.teams[rid].ownerId === hl })),
    { x: Array.from({ length: n }, (_, i) => `W${i + 1}`), invert: true, yMin: 1, yMax: Object.keys(s.teams).length, yFormat: v => `#${Math.round(v)}`, title: 'Power rank by week' });
}

// ---------------------------------------------------------------- Weekly reports
export function reports(model, { q }, el) {
  const s = pickSeason(model, q);
  const maxW = lastFinalWeek(s);
  const w = Math.min(Number(q.week) || maxW, maxW);
  const rep = weekReport(model, s, w);
  if (!rep) { el.innerHTML = `<h1>Weekly reports</h1>${empty('📰', `No reports for ${s.season} yet`, 'A report lands as soon as a week is final.', `<a class="btn" href="#/reports?season=${Number(s.season) - 1}">Read ${Number(s.season) - 1} reports</a>`)}`; return; }
  el.innerHTML = `
    <h1>Weekly reports</h1>
    <p class="sub">${SERVER.available ? `${esc(personaOf(SERVER.persona).name)} writes the column; the` : 'The'} box score below is computed straight from each week's scores, lineups and benches.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v, week: null }))} ${weekSelect(s, w, v => setQuery({ week: v }), maxW)}
      <button class="btn" id="copy" type="button">Copy as text</button></div>
    <div id="tycol" class="tyslot"></div>
    <h2>The box score</h2>
    <div class="card report">
      <div class="muted">${s.season} · Week ${w}${rep.phase === 'playoffs' ? ' · Playoffs' : ''} · league average ${f2(rep.leagueAvg)}, median ${f2(rep.median)}</div>
      <div class="headline">${esc(rep.headline)}</div>
      ${rep.recaps.map(r => `<p>${r.tag ? `<span class="pill">${esc(r.tag)}</span> ` : ''}${esc(r.text)}</p>`).join('')}
    </div>
    <h2>Awards</h2>
    <div class="awards">${rep.awards.map(a => `<div class="card award"><div class="t">${esc(a.title)}</div><div style="margin:4px 0">${chip(a.who)}</div><div>${esc(a.text)}</div></div>`).join('')}</div>
    <h2>Scoreboard</h2><div id="mu"></div>
    ${rep.movers.length ? '<h2>Power ranking movement</h2><div id="mv"></div>' : ''}
    <h2>Lineup efficiency</h2><div id="eff"></div>`;
  matchupCards(model, s, w, el.querySelector('#mu'));
  personaColumn(el.querySelector('#tycol'), model, { kind: 'recap', season: s.season, week: w, facts: () => recapFacts(model, s, w, rep) });
  if (rep.movers.length) table(el.querySelector('#mv'), [
    { key: 'rank', label: '#', num: true },
    { key: 'move', label: '±', num: true, fmt: r => (r.move ? `<span class="${r.move > 0 ? 'pos' : 'neg'}">${r.move > 0 ? '▲' : '▼'}${Math.abs(r.move)}</span>` : '<span class="muted">–</span>') },
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'record', label: 'Record' },
    { key: 'score', label: 'Score', num: true, fmt: r => f1(r.score) },
  ], rep.movers, { sortKey: 'rank', desc: false });
  const effRows = Object.values(s.weeks[w]).map(e => ({ owner: e.owner, pts: e.pts, opt: e.optimal.pts, eff: e.efficiency, left: e.optimal.pts - e.pts }));
  table(el.querySelector('#eff'), [
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'pts', label: 'Scored', num: true, fmt: r => f2(r.pts) },
    { key: 'opt', label: 'Best possible', num: true, fmt: r => f2(r.opt) },
    { key: 'left', label: 'Left on bench', num: true, fmt: r => f2(r.left) },
    { key: 'eff', label: 'Efficiency', num: true, fmt: r => pct(r.eff, 1) },
  ], effRows, { sortKey: 'eff' });
  el.querySelector('#copy').onclick = async e => {
    try { await navigator.clipboard.writeText(reportText(rep, model)); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
  };
}

// ---------------------------------------------------------------- Trends
export function trends(model, { q }, el) {
  const s = pickSeason(model, q);
  const hl = q.hl || meOwner(model);
  const last = Math.min(s.completedThrough, s.lastWeek);
  if (last < 1) { el.innerHTML = `<h1>Trends</h1>${empty('📈', `No games played in ${s.season} yet`, 'Trends start after week 1.', `<a class="btn" href="#/trends?season=${Number(s.season) - 1}">See ${Number(s.season) - 1} trends</a>`)}`; return; }
  const weeks = Array.from({ length: last }, (_, i) => i + 1);
  const series = Object.entries(s.teams).map(([rid, t]) => ({ label: nameOf(t.ownerId), owner: t.ownerId, values: weeks.map(w => s.weeks[w]?.[rid]?.pts ?? null), emphasis: t.ownerId === hl }));
  const avg = weeks.map(w => mean(Object.values(s.weeks[w] || {}).map(e => e.pts)));
  el.innerHTML = `
    <h1>Trends</h1>
    <p class="sub">Weekly scoring, consistency and boom/bust rates. Boom = a top-quarter score for that season; bust = a bottom-quarter score.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))} ${highlightSelect(model, hl, v => setQuery({ hl: v }), Object.values(s.teams).map(t => t.ownerId))}</div>
    <div class="card" id="c"></div>
    <h2>Consistency</h2><div id="t"></div>
    <h2>Scoring by season</h2><div class="card" id="sz"></div>`;
  lineChart(el.querySelector('#c'), [...series, { label: 'League average', values: avg, color: 'var(--accent-2)', dash: true, legend: true }], { x: weeks.map(w => `W${w}`), yFormat: v => Math.round(v), title: 'Weekly score' });
  table(el.querySelector('#t'), [
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'avg', label: 'Avg', num: true, fmt: r => f1(r.avg) },
    { key: 'sd', label: 'Std dev', num: true, fmt: r => f1(r.sd) },
    { key: 'min', label: 'Low', num: true, fmt: r => f1(r.min) },
    { key: 'max', label: 'High', num: true, fmt: r => f1(r.max) },
    { key: 'boom', label: 'Boom %', num: true, fmt: r => pct(r.boom) },
    { key: 'bust', label: 'Bust %', num: true, fmt: r => pct(r.bust) },
    { key: 'aboveMedian', label: 'Weeks above median', num: true, fmt: r => `${r.aboveMedian}/${r.n}` },
  ], consistency(s), { sortKey: 'avg' });
  // average score per season for each manager, plus league
  const seasons = model.seasons.filter(x => x.completedThrough >= 1);
  const owners = [...new Set(seasons.flatMap(x => Object.values(x.teams).map(t => t.ownerId)))];
  const per = owners.map(o => ({ label: nameOf(o), emphasis: o === hl, values: seasons.map(x => { const rid = Object.values(x.teams).find(t => t.ownerId === o)?.rid; if (rid == null) return null; const pts = []; for (let w = 1; w <= Math.min(x.completedThrough, x.regWeeks); w++) { const e = x.weeks[w]?.[rid]; if (e) pts.push(e.pts); } return pts.length ? mean(pts) : null; }) }));
  const lg = seasons.map(x => { const pts = []; for (let w = 1; w <= Math.min(x.completedThrough, x.regWeeks); w++) for (const e of Object.values(x.weeks[w] || {})) pts.push(e.pts); return mean(pts); });
  if (seasons.length > 1) lineChart(el.querySelector('#sz'), [...per, { label: 'League average', values: lg, color: 'var(--accent-2)', dash: true, legend: true }], { x: seasons.map(x => x.season), yFormat: v => f1(v), title: 'Average weekly score by season' });
  else el.querySelector('#sz').innerHTML = '<p class="muted">Needs more than one season.</p>';
}

// ---------------------------------------------------------------- Facts for the persona's columns
// Everything here is computed by the site, so the column's numbers match the rest of the pages.
function standingsLines(model, s, through) {
  if (through < 1) return [];
  const pr = Object.fromEntries(powerRankings(s, through).map(r => [r.rid, r.rank]));
  return standingsThrough(s, Math.min(through, s.regWeeks)).map(r => `${r.rank}. ${nameOf(r.owner)} ${record(r)}, PF ${f2(r.pf)}, PA ${f2(r.pa)}, luck ${signed(r.luck)}, streak ${r.streak || '-'}, power rank ${pr[r.rid] ?? '-'}`);
}
function recapFacts(model, s, w, rep) {
  return [reportText(rep, model), '', `STANDINGS AFTER WEEK ${w}`, ...standingsLines(model, s, w), '', columnNotes(model, s, w, 'recap')].join('\n');
}
function previewFacts(model, s, w) {
  const through = Math.min(s.completedThrough, s.regWeeks);
  const games = s.games.filter(g => g.week === w && g.matchupId != null);
  const lines = [`WEEK ${w} MATCHUPS (win probability from the site's model, based on scoring through week ${through})`];
  for (const g of games) {
    const p = winProb(s, g.a.rid, g.b.rid, through).p;
    const riv = (model.rivals || []).find(r => (r.a === g.a.owner && r.b === g.b.owner) || (r.a === g.b.owner && r.b === g.a.owner));
    const tag = g.type === 'playoff' ? (g.place === 1 ? ' [Championship]' : ' [Playoffs]') : g.type === 'consolation' ? ' [Consolation]' : '';
    lines.push(`${nameOf(g.a.owner)} ${pct(p)} vs ${nameOf(g.b.owner)} ${pct(1 - p)}${tag}${riv ? ` (rivalry: ${riv.name})` : ''}`);
  }
  if (through >= 1) lines.push('', `STANDINGS AFTER WEEK ${through}`, ...standingsLines(model, s, through));
  if (through >= 1 && s.games.some(g => g.type === 'reg' && g.week > through)) {
    const odds = playoffOdds(s, through, 3000);
    lines.push('', 'PLAYOFF ODDS', Object.entries(odds).sort((a, b) => b[1].playoff - a[1].playoff).map(([rid, o]) => `${nameOf(s.owner(rid))} ${pct(o.playoff)}`).join('; '));
  }
  const last = through >= 1 ? weekReport(model, s, through) : null;
  if (last) lines.push('', `LAST WEEK (week ${through}): ${last.headline}`);
  lines.push('', columnNotes(model, s, w, 'preview'));
  return lines.join('\n');
}
