// Notes for the AI columns that the formulas can find but a writer would want handed to them:
// head-to-head histories for this week's matchups, oddities in this week's scores, and what happened
// in this same week in past seasons. Everything is computed here, so the column's numbers are right.
import { sidesOf } from './stats.js';
import { nameOf, f2 } from './ui.js';

const same = (x, y) => String(x) === String(y);
const before = (g, season, week) => Number(g.season) < Number(season) || (same(g.season, season) && g.week < week);
const label = g => `${g.season} week ${g.week}${g.type === 'playoff' ? (g.place === 1 ? ' (championship)' : ' (playoffs)') : g.type === 'consolation' ? ' (consolation)' : g.type === 'placement' ? ' (placement game)' : ''}`;
const sideOf = (g, owner) => (g.a.owner === owner ? g.a : g.b);
const res = (g, owner) => (g.winner === 'tie' ? 'T' : sideOf(g, owner) === (g.winner === 'a' ? g.a : g.b) ? 'W' : 'L');

/** All-time series between two managers, using games before (or through) the given week. */
function series(model, ownA, ownB, season, week, { through = false } = {}) {
  const gs = model.games.filter(g => g.final && g.type !== 'consolation'
    && ((g.a.owner === ownA && g.b.owner === ownB) || (g.a.owner === ownB && g.b.owner === ownA))
    && (before(g, season, week) || (through && same(g.season, season) && g.week === week)));
  let w = 0, l = 0, t = 0;
  for (const g of gs) { const r = res(g, ownA); if (r === 'W') w++; else if (r === 'L') l++; else t++; }
  // Current streak from the most recent meeting backwards.
  let streak = 0, kind = null;
  for (let i = gs.length - 1; i >= 0; i--) { const r = res(gs[i], ownA); if (kind == null) kind = r; if (r !== kind) break; streak++; }
  const blow = [...gs].filter(g => g.winner !== 'tie').sort((x, y) => y.margin - x.margin)[0];
  const playoffs = gs.filter(g => g.type === 'playoff');
  return { games: gs, w, l, t, streak, kind, last: gs[gs.length - 1], blow, playoffs };
}

function seriesLine(model, g, season, week, opts) {
  const A = g.a.owner, B = g.b.owner, sr = series(model, A, B, season, week, opts);
  const a = nameOf(A), b = nameOf(B);
  if (!sr.games.length) return `${a} vs ${b}: first ever meeting.`;
  if (opts?.through && sr.games.length === 1) return `${a} vs ${b}: their first ever meeting, won by ${sr.w ? a : sr.l ? b : 'nobody (a tie)'}.`;
  const bits = [`all-time ${a} ${sr.w}-${sr.l}${sr.t ? `-${sr.t}` : ''} against ${b} over ${sr.games.length} game${sr.games.length === 1 ? '' : 's'}`];
  if (sr.games.length >= 3 && (sr.w === 0 || sr.l === 0)) bits.push(`${sr.w === 0 ? a : b} has NEVER beaten ${sr.w === 0 ? b : a}`);
  if (sr.streak >= 3 && sr.kind !== 'T') bits.push(`${sr.kind === 'W' ? a : b} has won the last ${sr.streak} meetings`);
  if (opts?.through && sr.last && same(sr.last.season, season) && sr.last.week === week) {
    const prev = series(model, A, B, season, week);
    const winner = res(sr.last, A) === 'W' ? A : res(sr.last, A) === 'L' ? B : null;
    const loser = winner === A ? B : A;
    const winnerWins = winner === A ? prev.w : prev.l;
    if (winner && prev.games.length >= 2 && winnerWins === 0) bits.push(`this was ${nameOf(winner)}'s FIRST EVER win over ${nameOf(loser)} after ${prev.games.length} tries`);
    else if (winner && prev.streak >= 3 && prev.kind !== (winner === A ? 'W' : 'L')) bits.push(`${nameOf(winner)} snapped a ${prev.streak}-game losing streak to ${nameOf(loser)}`);
  } else if (sr.last) {
    const L = sr.last, w = L.winner === 'tie' ? null : L.winner === 'a' ? L.a : L.b, l = w === L.a ? L.b : L.a;
    bits.push(`last met ${label(L)}: ${w ? `${nameOf(w.owner)} won ${f2(w.pts)}-${f2(l.pts)}` : `tied ${f2(L.a.pts)}-${f2(L.b.pts)}`}`);
  }
  if (sr.blow && sr.games.length >= 2) { const w = sr.blow.winner === 'a' ? sr.blow.a : sr.blow.b; bits.push(`biggest beating in the series: ${nameOf(w.owner)} by ${f2(sr.blow.margin)} in ${label(sr.blow)}`); }
  if (sr.playoffs.length) bits.push(`playoff meetings: ${sr.playoffs.map(p => `${label(p)} won by ${nameOf((p.winner === 'a' ? p.a : p.b).owner)}`).join('; ')}`);
  return `${a} vs ${b}: ${bits.join('; ')}.`;
}

/** Head-to-head history for each of the week's matchups. `through` counts the week's own result (for recaps). */
export function rivalryNotes(model, s, w, { through = false } = {}) {
  const games = s.games.filter(g => g.week === w && g.type !== 'consolation' && (!through || g.final));
  return games.map(g => seriesLine(model, g, s.season, w, { through }));
}

/** Where this week's scores, wins and streaks rank in league history. */
export function oddityNotes(model, s, w) {
  const out = [];
  const all = model.games.filter(g => g.final && g.type !== 'consolation');
  const sides = all.flatMap(g => sidesOf(g).map(x => ({ ...x, g })));
  const rankOf = (arr, v, desc = true) => 1 + arr.filter(x => (desc ? x > v : x < v)).length;
  const scores = sides.map(x => x.pts);
  const week = sides.filter(x => same(x.g.season, s.season) && x.g.week === w);
  for (const x of week) {
    const who = nameOf(x.owner), hi = rankOf(scores, x.pts), lo = rankOf(scores, x.pts, false);
    if (hi <= 10) out.push(`${who}'s ${f2(x.pts)} is the #${hi} score in league history (of ${scores.length}).`);
    if (lo <= 10) out.push(`${who}'s ${f2(x.pts)} is the #${lo} LOWEST score in league history (of ${scores.length}).`);
    const mine = sides.filter(y => y.owner === x.owner);
    if (mine.length >= 10) {
      if (rankOf(mine.map(y => y.pts), x.pts) === 1) out.push(`${who} posted a career-high ${f2(x.pts)}.`);
      if (rankOf(mine.map(y => y.pts), x.pts, false) === 1) out.push(`${who} posted a career-low ${f2(x.pts)}.`);
    }
    const losses = sides.filter(y => y.res === 'L').map(y => y.pts), wins = sides.filter(y => y.res === 'W').map(y => y.pts);
    if (x.res === 'L' && rankOf(losses, x.pts) <= 5) out.push(`${who} lost with ${f2(x.pts)}, the #${rankOf(losses, x.pts)} highest losing score ever. Brutal.`);
    if (x.res === 'W' && rankOf(wins, x.pts, false) <= 5) out.push(`${who} won with just ${f2(x.pts)}, the #${rankOf(wins, x.pts, false)} lowest winning score ever.`);
    // How this week's points would have done against every other team.
    const field = week.filter(y => y.owner !== x.owner);
    if (x.res === 'L' && field.length >= 4 && field.filter(y => y.pts < x.pts).length >= field.length - 1) out.push(`${who} had the second-best score of the week and still lost.`);
    if (x.res === 'W' && field.length >= 4 && field.filter(y => y.pts > x.pts).length >= field.length - 1) out.push(`${who} had the second-worst score of the week and still won.`);
  }
  // Running streaks of 3 or more, with the manager's personal best or worst for context.
  const byOwner = {};
  for (const x of sides.filter(y => y.g.type === 'reg' && before(y.g, s.season, w + 1))) (byOwner[x.owner] ||= []).push(x);
  for (const [owner, list] of Object.entries(byOwner)) {
    if (!list.some(y => same(y.g.season, s.season) && y.g.week === w)) continue;
    let n = 0, k = null;
    for (let i = list.length - 1; i >= 0; i--) { if (k == null) k = list[i].res; if (list[i].res !== k) break; n++; }
    if (n < 3 || k === 'T') continue;
    let best = 0, cur = 0;
    for (const y of list) { cur = y.res === k ? cur + 1 : 0; best = Math.max(best, cur); }
    out.push(`${nameOf(owner)} is on a ${n}-game ${k === 'W' ? 'winning' : 'losing'} streak${best === n && list.length > n ? ` (a career-long streak)` : best > n ? ` (career long: ${best})` : ''}.`);
  }
  // Starters who put up a zero.
  for (const e of Object.values(s.weeks[w] || {})) {
    e.starters?.forEach((id, i) => { if (id && id !== '0' && Number(e.startersPts?.[i] || 0) === 0) out.push(`${nameOf(e.owner)} started ${model.nameOf(id)} (${model.posOf(id)}), who scored 0.`); });
    if (e.optimal && e.optimal.pts - e.pts >= 30) out.push(`${nameOf(e.owner)} left ${f2(e.optimal.pts - e.pts)} points on the bench.`);
  }
  return out;
}

/** What happened in this same week in each past season. */
export function historyNotes(model, s, w) {
  const out = [];
  const seasons = [...new Set(model.games.filter(g => g.final && g.week === w && Number(g.season) < Number(s.season)).map(g => String(g.season)))].sort();
  for (const season of seasons) {
    const gs = model.games.filter(g => g.final && g.week === w && same(g.season, season));
    const sides = gs.flatMap(g => sidesOf(g));
    const hi = [...sides].sort((x, y) => y.pts - x.pts)[0], lo = [...sides].sort((x, y) => x.pts - y.pts)[0];
    const decided = gs.filter(g => g.winner !== 'tie');
    const blow = [...decided].sort((x, y) => y.margin - x.margin)[0], close = [...decided].sort((x, y) => x.margin - y.margin)[0];
    const win = g => (g.winner === 'a' ? g.a : g.b), lose = g => (g.winner === 'a' ? g.b : g.a);
    const bits = [`high ${nameOf(hi.owner)} ${f2(hi.pts)}`, `low ${nameOf(lo.owner)} ${f2(lo.pts)}`];
    if (blow) bits.push(`biggest win ${nameOf(win(blow).owner)} over ${nameOf(lose(blow).owner)} by ${f2(blow.margin)}`);
    if (close && close !== blow) bits.push(`closest ${nameOf(win(close).owner)} over ${nameOf(lose(close).owner)} by ${f2(close.margin)}`);
    const title = gs.find(g => g.type === 'playoff' && g.place === 1);
    if (title && title.winner !== 'tie') bits.push(`CHAMPIONSHIP: ${nameOf(win(title).owner)} beat ${nameOf(lose(title).owner)} ${f2(win(title).pts)}-${f2(lose(title).pts)}`);
    out.push(`${season} week ${w}${Number(s.season) - Number(season) === 1 ? ' (one year ago)' : ` (${Number(s.season) - Number(season)} years ago)`}: ${bits.join('; ')}.`);
  }
  return out;
}

/** The three blocks together, as text for the FACTS sent to the AI. */
export function columnNotes(model, s, w, kind) {
  const recap = kind === 'recap';
  const parts = [];
  const riv = rivalryNotes(model, s, w, { through: recap });
  if (riv.length) parts.push(`HEAD-TO-HEAD HISTORY FOR THIS WEEK'S MATCHUPS${recap ? ' (including this week)' : ''}`, ...riv, '');
  if (recap) { const odd = oddityNotes(model, s, w); if (odd.length) parts.push('ODDITIES AND MILESTONES THIS WEEK', ...odd, ''); }
  const hist = historyNotes(model, s, w);
  parts.push(`THIS WEEK IN LEAGUE HISTORY (week ${w} in past seasons)`, ...(hist.length ? hist : ['No earlier seasons have a finished week with this number.']));
  return parts.join('\n');
}
