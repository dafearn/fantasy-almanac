// A compact plain-text digest of the league for the Ask page: everything a question is likely
// to need (standings, careers, head-to-head, records, weekly scores, rosters, trades, drafts),
// written so it stays well under ~15K tokens for a dozen teams and a handful of seasons.
import { careers, headToHead, recordBook, powerRankings, playoffOdds, scoutingReports, sidesOf, finalPlace } from './stats.js';
import { hofDigest } from './hof.js';
import { CONFIG } from './config.js';

const f1 = x => (x == null || Number.isNaN(x) ? '-' : Number(x).toFixed(1));
const pc = x => `${Math.round((x || 0) * 100)}%`;

export function leagueDigest(model) {
  const name = o => model.managers[o]?.name || 'Unknown';
  const out = [];
  const latest = model.seasons[model.seasons.length - 1];
  const s = [...model.seasons].reverse().find(x => x.completedThrough >= 1) || latest;
  out.push(`LEAGUE: ${CONFIG.SITE_NAME || latest.name || 'the league'}, ${Object.keys(latest.teams).length} teams, Sleeper seasons ${model.seasons.map(x => x.season).join(', ')}${model.legacy?.seasons?.length ? `; earlier pre-Sleeper seasons ${model.legacy.seasons.map(x => x.season).join(', ')}` : ''}.`);
  out.push(`Current: ${latest.season} season, status ${latest.status}, ${latest.completedThrough ? `week ${latest.completedThrough} is the last final week` : 'no games final yet'}. Regular season is weeks 1-${latest.regWeeks}; ${latest.playoffTeams} teams make the playoffs.`);
  out.push(`Managers (name: current team): ${Object.values(latest.teams).map(t => `${name(t.ownerId)}: ${t.teamName || '-'}`).join('; ')}.`);

  // Careers
  const car = Object.values(careers(model)).filter(c => model.managers[c.id]).sort((a, b) => b.pct - a.pct);
  out.push('\nCAREERS (all seasons; record, win%, PF, titles, runner-ups, playoff trips, last places, luck = wins minus expected wins, avg weekly score, trades, adds):');
  for (const c of car) out.push(`${name(c.id)}: ${c.w}-${c.l}${c.t ? '-' + c.t : ''} (${pc(c.pct)}), PF ${f1(c.pf)}, titles ${c.titles.join('/') || 0}, runner-up ${c.runnerUps.join('/') || 0}, playoffs ${c.playoffs}, last ${c.lastPlaces}, luck ${f1(c.luck)}, avg ${f1(c.avg)}, trades ${c.trades}, adds ${c.adds}`);

  // Season by season
  out.push('\nSEASONS (regular-season rank. manager W-L PF PA all-play% luck, final place):');
  for (const x of model.seasons) {
    if (x.completedThrough < 1) continue;
    const done = x.status === 'complete';
    out.push(`${x.season}${done ? '' : ` (in progress, through week ${Math.min(x.completedThrough, x.regWeeks)})`}${x.champion != null ? `, champion ${name(x.owner(x.champion))}` : ''}:`);
    for (const r of x.regStandings) out.push(`  ${r.rank}. ${name(r.owner)} ${r.w}-${r.l}${r.t ? '-' + r.t : ''} PF ${f1(r.pf)} PA ${f1(r.pa)} AP ${pc(r.apPct)} luck ${f1(r.luck)}${done ? ` final ${finalPlace(x, r.rid) ?? '-'}` : ''}`);
  }
  for (const ls of model.legacy?.seasons || []) {
    out.push(`${ls.season} (${ls.platform || 'another platform'}, before Sleeper)${ls.champion ? `, champion ${name(ls.champion)}` : ''}${ls.runnerUp ? `, runner-up ${name(ls.runnerUp)}` : ''}${ls.lastPlace ? `, last place ${name(ls.lastPlace)}` : ''}${(ls.standings || []).length ? ':' : '. No standings or scores on file.'}`);
    for (const r of ls.standings || []) out.push(`  ${name(r.owner)}${r.wins != null ? ` ${r.wins}-${r.losses}${r.ties ? '-' + r.ties : ''}` : ''}${r.pf != null ? ` PF ${f1(r.pf)} PA ${f1(r.pa)}` : ''} final ${r.rank ?? '-'}`);
  }

  // Current season detail
  const through = Math.min(s.completedThrough, s.lastWeek);
  if (through >= 1) {
    out.push(`\n${s.season} WEEKLY SCORES (W/L vs opponent), weeks 1-${through}:`);
    const res = {};
    for (const g of s.games) if (g.final) for (const x of sidesOf(g)) (res[x.rid] ||= {})[g.week] = `${x.res} v ${name(x.opp.owner)}`;
    for (const [rid, t] of Object.entries(s.teams)) {
      const wk = []; for (let w = 1; w <= through; w++) { const e = s.weeks[w]?.[rid]; if (e) wk.push(`W${w} ${f1(e.pts)}${res[rid]?.[w] ? ` ${res[rid][w]}` : ''}`); }
      out.push(`${name(t.ownerId)}: ${wk.join('; ')}`);
    }
    out.push(`\n${s.season} POWER RANKINGS after week ${through}: ${powerRankings(s, through).map(r => `${r.rank}. ${name(r.owner)} (${r.record}, score ${f1(r.score)})`).join('; ')}`);
    if (s.completedThrough < s.regWeeks) {
      const o = playoffOdds(s, Math.min(s.completedThrough, s.regWeeks), 2000);
      out.push(`${s.season} PLAYOFF ODDS (simulated): ${Object.entries(o).sort((a, b) => b[1].playoff - a[1].playoff).map(([rid, v]) => `${name(s.owner(rid))} ${pc(v.playoff)}`).join('; ')}`);
      const next = s.games.filter(g => g.week === s.completedThrough + 1);
      if (next.length) out.push(`Week ${s.completedThrough + 1} matchups: ${next.map(g => `${name(g.a.owner)} vs ${name(g.b.owner)}`).join('; ')}`);
    }
    out.push(`\n${s.season} SCOUTING NOTES:`);
    for (const r of scoutingReports(model, s)) out.push(`${name(r.owner)} (${r.tag}): ${r.lines.filter(l => l.k !== 'Résumé').map(l => l.text).join(' ')}`);
  }

  // Rosters
  const rw = latest.weeks[Math.max(1, Math.min(latest.currentWeek || 1, latest.lastWeek))] || latest.weeks[latest.completedThrough] || {};
  if (Object.keys(rw).length) {
    out.push(`\n${latest.season} ROSTERS (starters first):`);
    for (const e of Object.values(rw)) {
      const st = (e.starters || []).filter(id => id && id !== '0'), bench = (e.players || []).filter(id => !st.includes(id));
      out.push(`${name(e.owner)}: ${st.map(id => `${model.nameOf(id)} ${model.posOf(id)}`).join(', ')} | bench: ${bench.map(id => `${model.nameOf(id)} ${model.posOf(id)}`).join(', ')}`);
    }
  }

  // Head to head
  const h2h = headToHead(model), owners = car.map(c => c.id);
  out.push('\nHEAD-TO-HEAD (manager vs opponent W-L, regular season and playoffs):');
  for (const a of owners) {
    const row = owners.filter(b => b !== a && h2h[`${a}|${b}`]).map(b => { const p = h2h[`${a}|${b}`]; return `${name(b)} ${p.w}-${p.l}${p.t ? '-' + p.t : ''}`; });
    if (row.length) out.push(`${name(a)}: ${row.join(', ')}`);
  }

  // Records
  const rb = recordBook(model);
  const side = x => `${name(x.owner)} ${f1(x.pts)} (${x.g.season} W${x.g.week})`;
  const game = g => `${name(g.a.owner)} ${f1(g.a.pts)}-${f1(g.b.pts)} ${name(g.b.owner)} (${g.season} W${g.week})`;
  out.push('\n' + hofDigest(model));
  out.push('\nRECORDS:');
  out.push(`Highest scores: ${rb.highScore.slice(0, 5).map(side).join('; ')}`);
  out.push(`Lowest scores: ${rb.lowScore.slice(0, 5).map(side).join('; ')}`);
  out.push(`Biggest blowouts: ${rb.blowouts.slice(0, 5).map(game).join('; ')}`);
  out.push(`Closest games: ${rb.closest.slice(0, 5).map(game).join('; ')}`);
  out.push(`Longest win streaks: ${rb.winStreaks.slice(0, 5).map(x => `${name(x.owner)} ${x.n}`).join('; ')}`);
  out.push(`Longest losing streaks: ${rb.lossStreaks.slice(0, 5).map(x => `${name(x.owner)} ${x.n}`).join('; ')}`);
  out.push(`Best single-player games: ${rb.playerGames.slice(0, 5).map(x => `${model.nameOf(x.id)} ${f1(x.pts)} for ${name(x.owner)} (${x.season} W${x.week})`).join('; ')}`);

  // Trades and drafts
  for (const x of model.seasons) {
    const trades = x.transactions.filter(t => t.type === 'trade');
    if (trades.length) {
      out.push(`\n${x.season} TRADES:`);
      for (const t of trades) out.push(`W${t.week || '-'}: ${t.rids.map(rid => `${name(x.owner(rid))} got ${Object.entries(t.adds).filter(([, r]) => r === rid).map(([id]) => model.nameOf(id)).join(', ') || 'picks/nothing'}`).join(' | ')}`);
    }
    const picks = x.draft?.picks || [];
    if (picks.length) out.push(`${x.season} DRAFT first two rounds: ${picks.filter(p => p.round <= 2).map(p => `${p.pickNo}. ${name(p.ownerId)} ${p.name || model.nameOf(p.playerId)} ${p.pos || ''}`).join('; ')}`);
  }
  return out.join('\n');
}
