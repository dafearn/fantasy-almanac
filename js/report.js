// Automated weekly matchup reports, written from the week's numbers.
import { sidesOf, quantile, powerRankings, r2 } from './stats.js';

function pick(arr, seed) { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return arr[h % arr.length]; }
const f1 = x => Number(x).toFixed(2);

export function weekReport(model, s, w) {
  const who = owner => model.managers[owner]?.name || 'Unknown';
  const entries = Object.values(s.weeks[w] || {}).filter(e => e.final);
  if (!entries.length) return null;
  const games = s.games.filter(g => g.week === w && g.final);
  const seed = `${s.season}-${w}`;
  const phase = w >= s.playoffStart ? 'playoffs' : 'regular';
  const med = quantile(entries.map(e => e.pts), 0.5);
  const sections = [];

  const byPts = [...entries].sort((a, b) => b.pts - a.pts);
  const top = byPts[0], bottom = byPts[byPts.length - 1];
  const decided = games.filter(g => g.winner && g.winner !== 'tie');
  const blowout = [...decided].sort((a, b) => b.margin - a.margin)[0];
  const closest = [...decided].sort((a, b) => a.margin - b.margin)[0];
  const winLose = g => { const [x, y] = sidesOf(g); return x.res === 'W' ? [x, y] : [y, x]; };

  // Headline
  let headline;
  if (phase === 'playoffs' && games.some(g => g.type === 'playoff' && g.place === 1)) {
    const g = games.find(g => g.type === 'playoff' && g.place === 1); const [W, L] = winLose(g);
    headline = `${who(W.owner)} wins the ${s.season} championship, ${f1(W.pts)}–${f1(L.pts)} over ${who(L.owner)}`;
  } else if (blowout && blowout.margin > 50) {
    const [W, L] = winLose(blowout);
    headline = pick([`${who(W.owner)} buries ${who(L.owner)} by ${f1(blowout.margin)}`, `No mercy: ${who(W.owner)} over ${who(L.owner)} by ${f1(blowout.margin)}`], seed);
  } else if (closest && closest.margin < 3) {
    const [W, L] = winLose(closest);
    headline = pick([`${who(W.owner)} survives ${who(L.owner)} by ${f1(closest.margin)}`, `Photo finish: ${who(W.owner)} edges ${who(L.owner)}`], seed);
  } else {
    headline = pick([`${who(top.owner)} leads the league with ${f1(top.pts)}`, `${who(top.owner)} posts the top score of week ${w}`], seed);
  }

  // Game-by-game
  const recaps = games.map(g => {
    const [W, L] = g.winner === 'tie' ? sidesOf(g) : winLose(g);
    const tag = g.type === 'playoff' ? (g.place === 1 ? 'Championship' : g.place ? `${g.place}${ord(g.place)}-place game` : 'Playoffs') : g.type === 'placement' ? `${g.place}${ord(g.place)}-place game` : g.type === 'consolation' ? 'Consolation' : '';
    const verb = g.winner === 'tie' ? 'tied' : g.margin > 40 ? pick(['crushed', 'demolished', 'ran over'], seed + W.owner) : g.margin < 5 ? pick(['slipped past', 'squeaked by', 'held off'], seed + W.owner) : pick(['beat', 'handled', 'took care of'], seed + W.owner);
    const we = s.weeks[w][W.rid], le = s.weeks[w][L.rid];
    const mvpW = topStarter(model, we), mvpL = topStarter(model, le);
    let line = `${who(W.owner)} ${verb} ${who(L.owner)}, ${f1(W.pts)}–${f1(L.pts)}.`;
    if (mvpW) line += ` ${mvpW.name} led the way with ${f1(mvpW.pts)}.`;
    if (mvpL && g.winner !== 'tie') line += ` ${mvpL.name} had ${f1(mvpL.pts)} in the loss.`;
    if (le.optimal.pts > W.pts && g.winner !== 'tie') line += ` ${who(L.owner)}'s best possible lineup (${f1(le.optimal.pts)}) would have won.`;
    return { tag, text: line, g };
  });

  // Awards
  const awards = [];
  awards.push({ title: 'Top score', who: top.owner, text: `${who(top.owner)} with ${f1(top.pts)}.` });
  awards.push({ title: 'Pooper 💩', who: bottom.owner, text: `${who(bottom.owner)} with ${f1(bottom.pts)}.` });
  const luckyWinners = decided.map(winLose).filter(([W]) => W.pts < med).sort((a, b) => a[0].pts - b[0].pts);
  if (luckyWinners.length) { const [W, L] = luckyWinners[0]; awards.push({ title: 'Lucky win', who: W.owner, text: `${who(W.owner)} won with just ${f1(W.pts)}, below the league median of ${f1(med)}, thanks to ${who(L.owner)}'s ${f1(L.pts)}.` }); }
  const unlucky = decided.map(winLose).filter(([, L]) => L.pts > med).sort((a, b) => b[1].pts - a[1].pts);
  if (unlucky.length) { const [W, L] = unlucky[0]; awards.push({ title: 'Wrong opponent', who: L.owner, text: `${who(L.owner)} scored ${f1(L.pts)} (would beat ${entries.filter(e => e.pts < L.pts).length} of ${entries.length - 1} teams) and still lost to ${who(W.owner)}.` }); }
  const effs = [...entries].sort((a, b) => b.efficiency - a.efficiency);
  awards.push({ title: 'Best coach', who: effs[0].owner, text: `${who(effs[0].owner)} got ${Math.round(effs[0].efficiency * 100)}% of their best possible lineup.` });
  // Prefer a loss the optimal lineup would have turned into a win.
  const costly = decided.map(winLose).map(([W, L]) => ({ W, e: s.weeks[w][L.rid] })).filter(x => x.e.optimal.pts > x.W.pts).sort((a, b) => (b.e.optimal.pts - b.e.pts) - (a.e.optimal.pts - a.e.pts))[0];
  if (costly) awards.push({ title: 'Bench blunder', who: costly.e.owner, text: `${who(costly.e.owner)} left ${f1(costly.e.optimal.pts - costly.e.pts)} points on the bench and lost to ${who(costly.W.owner)} by ${f1(costly.W.pts - costly.e.pts)}. The best possible lineup scored ${f1(costly.e.optimal.pts)}.` });
  const worstCoach = effs[effs.length - 1];
  if (!costly || costly.e !== worstCoach) awards.push({ title: 'Worst coach', who: worstCoach.owner, text: `${who(worstCoach.owner)} left ${f1(worstCoach.optimal.pts - worstCoach.pts)} points on the bench (${Math.round(worstCoach.efficiency * 100)}% efficiency).` });
  const allStarters = entries.flatMap(e => e.starters.map((id, i) => ({ id, owner: e.owner, pts: Number(e.startersPts[i] || 0) }))).filter(x => x.id && x.id !== '0');
  const mvp = allStarters.sort((a, b) => b.pts - a.pts)[0];
  if (mvp) awards.push({ title: 'Player of the week', who: mvp.owner, text: `${model.nameOf(mvp.id)} (${model.posOf(mvp.id)}) put up ${f1(mvp.pts)} for ${who(mvp.owner)}.` });
  const skill = allStarters.filter(x => ['QB', 'RB', 'WR', 'TE'].includes(model.posOf(x.id)));
  const dud = [...skill].sort((a, b) => a.pts - b.pts)[0];
  if (dud) awards.push({ title: 'Dud of the week', who: dud.owner, text: `${model.nameOf(dud.id)} (${model.posOf(dud.id)}) gave ${who(dud.owner)} ${f1(dud.pts)}.` });
  const benchHero = entries.flatMap(e => e.players.filter(id => !e.starters.includes(id)).map(id => ({ id, owner: e.owner, pts: Number(e.playersPts[id] || 0) }))).sort((a, b) => b.pts - a.pts)[0];
  if (benchHero && benchHero.pts > 0) awards.push({ title: 'Bench hero', who: benchHero.owner, text: `${model.nameOf(benchHero.id)} scored ${f1(benchHero.pts)} on ${who(benchHero.owner)}'s bench.` });

  // Power ranking movement
  let movers = [];
  if (w > 1) {
    const now = powerRankings(s, w), prev = Object.fromEntries(powerRankings(s, w - 1).map(r => [r.rid, r.rank]));
    movers = now.map(r => ({ ...r, move: prev[r.rid] - r.rank }));
  }

  const leagueAvg = r2(entries.reduce((t, e) => t + e.pts, 0) / entries.length);
  return { season: s.season, week: w, phase, headline, recaps, awards, movers, leagueAvg, median: r2(med), top, bottom };
}

function topStarter(model, e) {
  if (!e) return null;
  let best = null;
  e.starters.forEach((id, i) => { const p = Number(e.startersPts[i] || 0); if (id && id !== '0' && (!best || p > best.pts)) best = { id, pts: p, name: model.nameOf(id) }; });
  return best;
}

function ord(n) { return ['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'; }

/** Plain-text version for pasting into the league chat. */
export function reportText(rep, model) {
  const who = o => model.managers[o]?.name || 'Unknown';
  const lines = [`${rep.season} Week ${rep.week}: ${rep.headline}`, ''];
  for (const r of rep.recaps) lines.push(`${r.tag ? `[${r.tag}] ` : ''}${r.text}`);
  lines.push('', 'Awards');
  for (const a of rep.awards) lines.push(`${a.title}: ${a.text}`);
  if (rep.movers.length) {
    lines.push('', 'Power rankings');
    for (const m of rep.movers) lines.push(`${m.rank}. ${who(m.owner)} (${m.record})${m.move ? ` ${m.move > 0 ? '▲' : '▼'}${Math.abs(m.move)}` : ''}`);
  }
  return lines.join('\n');
}
