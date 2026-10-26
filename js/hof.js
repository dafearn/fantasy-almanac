// The Hall of Fame: every manager in league history rated out of 100, with a tier and a title.
//
// Legacy points add up a career:
//   Hardware    30 a title, 14 a runner-up, 7 a third place, 6 a regular-season crown (1st seed),
//               4 a points-for crown
//   Postseason   5 a playoff trip, 4 a playoff win
//   Dominance   (all-play % − 50%) × 60 per season, so a 65% all-play season is worth +9
//   Winning     (win % − 50%) × 24 per season, so a 10-4 season is worth about +5
//   Longevity    2 a season in the league
//   Shame       −8 a last place
// Seasons still in progress count for dominance and winning in proportion to the games played,
// and earn no hardware until they finish. The rating spreads everyone from 45 (fewest legacy
// points) to 99 (most), on a curve that lifts the middle so a good career reads like one.
import { careers, finalPlace } from './stats.js';

export const HOF_WEIGHTS = {
  title: 30, runnerUp: 14, third: 7, crown: 6, pfKing: 4,
  trip: 5, playoffWin: 4, dominance: 60, winning: 24, season: 2, lastPlace: -8,
};
const W = HOF_WEIGHTS;

export const TIERS = [
  { key: 'rushmore', min: 90, label: 'Mount Rushmore', blurb: 'The faces of the league. Rings, rivals and receipts.' },
  { key: 'hof', min: 80, label: 'Hall of Famers', blurb: 'First-ballot careers with hardware to show for it.' },
  { key: 'honor', min: 70, label: 'Ring of Honor', blurb: 'Contenders more years than not.' },
  { key: 'starters', min: 60, label: 'Starters', blurb: 'Solid résumés still waiting on the signature moment.' },
  { key: 'squad', min: 0, label: 'Practice Squad', blurb: 'Rookies, rebuilds and cautionary tales.' },
];
export const tierOf = ovr => TIERS.find(t => ovr >= t.min) || TIERS[TIERS.length - 1];

/** Rate every manager. Returns rows sorted best first: {id, ovr, raw, tier, title, parts, ...career}. */
export function hallOfFame(model) {
  const skip = model.legacy?.hofSkip?.size ? model.legacy.hofSkip : null;
  const car = careers(model, skip);
  const latest = model.seasons[model.seasons.length - 1];
  const active = new Set(Object.values(latest?.teams || {}).map(t => t.ownerId));
  const rows = {};
  const get = id => rows[id] ||= {
    id, thirds: [], crowns: [], pfKings: [], dominance: 0, winning: 0, seasons: new Set(), timeline: {},
    apw: 0, apl: 0, apt: 0, legacyTrips: 0,
  };

  for (const s of model.seasons) {
    if (s.completedThrough < 1) continue;
    const done = s.status === 'complete';
    const reg = s.regStandings;
    for (const r of reg) {
      if (skip?.has(`${r.owner}|${s.season}`)) { get(r.owner).timeline[s.season] = { skipped: true }; continue; }
      const x = get(r.owner);
      const weight = Math.min(1, r.games / Math.max(1, s.regWeeks));
      x.dominance += (r.apPct - 0.5) * W.dominance * weight;
      x.winning += (r.pct - 0.5) * W.winning * weight;
      x.apw += r.apw; x.apl += r.apl; x.apt += r.apt;
      x.seasons.add(s.season);
      const place = done ? finalPlace(s, r.rid) : null;
      x.timeline[s.season] = done
        ? { place, last: r.rank === reg.length, champ: place === 1 }
        : { seed: r.rank, live: true };
      if (done && place === 3) x.thirds.push(s.season);
    }
    if (done && reg.length) {
      const credit = (id, key) => { if (!skip?.has(`${id}|${s.season}`)) get(id)[key].push(s.season); };
      credit(reg[0].owner, 'crowns');
      credit([...reg].sort((a, b) => b.pf - a.pf)[0].owner, 'pfKings');
    }
  }
  for (const ls of model.legacy?.seasons || []) {
    const mark = (id, patch) => { if (!id) return; const x = get(id); x.seasons.add(ls.season); x.timeline[ls.season] = { ...x.timeline[ls.season], legacy: true, ...patch }; };
    for (const r of ls.standings || []) { mark(r.owner, { place: r.rank ?? null }); if (r.rank === 3) get(r.owner).thirds.push(ls.season); }
    mark(ls.champion, { place: 1, champ: true });
    mark(ls.runnerUp, { place: 2 });
    mark(ls.lastPlace, { last: true });
    // A title or a final with no standings row on file still means a playoff trip.
    for (const id of [ls.champion, ls.runnerUp]) if (id && !(ls.standings || []).some(r => r.owner === id && r.playoffs)) get(id).legacyTrips++;
  }

  const list = [];
  for (const x of Object.values(rows)) {
    const c = car[x.id]; const m = model.managers[x.id];
    if (!c || !m) continue;
    const trips = c.playoffs + x.legacyTrips;
    const parts = {
      hardware: W.title * c.titles.length + W.runnerUp * c.runnerUps.length + W.third * x.thirds.length + W.crown * x.crowns.length + W.pfKing * x.pfKings.length,
      postseason: W.trip * trips + W.playoffWin * c.pw,
      dominance: x.dominance,
      winning: x.winning,
      longevity: W.season * x.seasons.size,
      shame: W.lastPlace * c.lastPlaces,
    };
    const raw = Object.values(parts).reduce((a, b) => a + b, 0);
    const ap = x.apw + x.apl + x.apt;
    list.push({
      id: x.id, name: m.name, avatar: m.avatar, active: active.has(x.id), raw, parts,
      titles: c.titles, runnerUps: c.runnerUps, thirds: x.thirds, crowns: x.crowns, pfKings: x.pfKings,
      lastPlaces: c.lastPlaces, trips, pw: c.pw, pl: c.pl, w: c.w, l: c.l, t: c.t, pct: c.pct, luck: c.luck,
      apPct: ap ? (x.apw + x.apt / 2) / ap : null, trades: c.trades, adds: c.adds,
      seasons: [...x.seasons].sort(), timeline: x.timeline, sleeperGames: c.games,
    });
  }

  // Spread raw points over 45-99, lifting the middle (t^0.7) so a decent career isn't buried.
  const hi = Math.max(...list.map(r => r.raw)), lo = Math.min(...list.map(r => r.raw));
  for (const r of list) {
    const t = hi > lo ? (r.raw - lo) / (hi - lo) : 0.5;
    r.ovr = Math.round(45 + 54 * t ** 0.7);
    r.tier = tierOf(r.ovr);
  }
  list.sort((a, b) => b.raw - a.raw || b.titles.length - a.titles.length);
  list.forEach((r, i) => (r.rank = i + 1));

  // Each bar on a card: that part of the career against the league's best at it (0-100).
  for (const k of ['hardware', 'postseason', 'dominance', 'winning', 'longevity']) {
    const vals = list.map(r => r.parts[k]);
    const top = Math.max(...vals), bot = Math.min(0, ...vals);
    for (const r of list) (r.bars ||= {})[k] = top > bot ? Math.round(100 * (r.parts[k] - bot) / (top - bot)) : 0;
  }
  assignTitles(list);
  return list;
}

// ---------------------------------------------------------------- titles
// Every manager gets one title, and no two share one. Managers pick in rating order, each taking the
// first title on their list that's still free, so the best careers claim the best titles.
function assignTitles(list) {
  const most = key => Math.max(...list.map(r => r[key] || 0));
  const mostTrades = most('trades'), mostAdds = most('adds');
  const bestAp = Math.max(...list.filter(r => !r.titles.length && r.apPct != null && r.sleeperGames >= 10).map(r => r.apPct), 0);
  const worstLuck = Math.min(...list.map(r => r.luck || 0)), bestLuck = Math.max(...list.map(r => r.luck || 0));
  const taken = new Set();
  for (const r of list) {
    const T = r.titles.length, R = r.runnerUps.length, L = r.lastPlaces;
    const options = [
      r.rank === 1 && T && ['The G.O.A.T.', 'Nobody in league history has stacked a résumé like this one.'],
      T >= 3 && ['The Dynasty', `${T} titles. The trophy has a reserved spot on the mantel.`],
      T === 2 && ['Two-Ring Royalty', 'Won it twice, and never lets anyone forget it.'],
      L >= 2 && !T && ['Basement Landlord', `${L} last-place finishes. Pays rent down there.`],
      R >= 2 && !T && ['Always the Bridesmaid', `${R} trips to the final and still no ring.`],
      T && R && ['Big-Game Regular', 'Shows up in the final like it’s an annual reservation.'],
      T && L && ['Riches to Rags', 'A champion who has also seen the bottom of the standings.'],
      !T && r.apPct === bestAp && bestAp >= 0.53 && ['Ringless Juggernaut', 'Outscores the league week after week. The ring keeps dodging.'],
      T && r.ovr >= 80 && ['Proven Champion', 'Got the ring and the résumé to back it up.'],
      T && ['One-Ring Wonder', 'One magical December. Still dining out on it.'],
      T && ['Banner Raiser', 'Hung a banner in the rafters. Nobody can take it down.'],
      T && ['December Hero', 'Got hot at exactly the right time.'],
      T && ['The Closer', 'When it mattered most, they finished the job.'],
      r.trades === mostTrades && mostTrades >= 6 && ['Trade Machine', `${r.trades} trades and counting. Can stop whenever.`],
      R === 1 && !T && ['So Close', 'One win from a ring. It still keeps them up at night.'],
      R && !T && ['Heartbreak Kid', 'Made the final and watched someone else lift the trophy.'],
      R && !T && ['Silver Lining', 'A runner-up finish is still a runner-up finish.'],
      r.luck <= -1.5 && r.luck === worstLuck && ['Cursed by the Fantasy Gods', 'Scores enough to win and loses anyway. The schedule hates them.'],
      r.luck >= 1.5 && r.luck === bestLuck && ['Horseshoe Merchant', 'Wins games their lineup had no business winning.'],
      r.adds === mostAdds && mostAdds >= 20 && ['Waiver Wire Hawk', `${r.adds} pickups. Knows the free-agent pool better than their own roster.`],
      r.crowns.length >= 2 && ['Regular-Season King', 'Owns the regular season. December is another story.'],
      r.trips >= 3 && !T && ['Perennial Contender', `${r.trips} playoff trips and no ring yet.`],
      L === 1 && !T && ['Toilet Bowl Alumnus', 'Has a last-place finish on the permanent record.'],
      L && ['Rock Bottom Survivor', 'Hit the floor once and lived to tell about it.'],
      r.seasons.length <= 1 && ['The Rookie', 'Fresh blood. The résumé starts now.'],
      !r.active && ['Gone But Not Forgotten', 'Hung up the cleats. The league remembers.'],
      r.pct >= 0.55 && ['Winning Culture', 'Wins more than they lose, year after year.'],
      r.apPct != null && r.apPct >= 0.5 && ['Quiet Assassin', 'Scores like a contender without the headlines.'],
      ['The Journeyman', 'Every league needs one. This is ours.'],
      ['Middle of the Pack', 'Never the hammer, rarely the nail.'],
      ['Waiting on the Breakout', 'The best season is always next season.'],
      r.trips >= 1 && ['Bubble Team', 'Squeaks into the playoffs, then makes everyone nervous.'],
      ['The Grinder', 'Sets a lineup every week and never goes away.'],
      ['Coin Flip Coach', 'Win one, lose one. Repeat.'],
      ['Spoiler Alert', 'Not winning it, but happy to wreck your season.'],
      ['Sleeper Agent', 'Quiet résumé. Dangerous anyway.'],
      ['Building Something', 'The rebuild is a process. Trust it.'],
      ['The Wildcard', 'Nobody knows what this team does next, including them.'],
      ['Mr. Irrelevant', 'Last pick in the Hall. Somebody has to be.'],
    ].filter(Boolean);
    const pick = options.find(([t]) => !taken.has(t)) || [`Old Ball No. ${r.rank}`, ''];
    taken.add(pick[0]);
    r.title = pick[0]; r.titleNote = pick[1];
  }
}

/** One plain sentence or two about the career, for the card's plaque. */
export function plaque(r) {
  const yrs = a => a.join(', ');
  const bits = [];
  if (r.titles.length) bits.push(`Champion in ${yrs(r.titles)}.`);
  if (r.runnerUps.length) bits.push(`Runner-up in ${yrs(r.runnerUps)}.`);
  if (r.trips) bits.push(`${r.trips} playoff trip${r.trips === 1 ? '' : 's'}${r.pw + r.pl ? `, ${r.pw}-${r.pl} in playoff games` : ''}.`);
  else bits.push('No playoff trips yet.');
  if (r.apPct != null) bits.push(`Beats ${Math.round(r.apPct * 100)}% of the league in an average week.`);
  if (r.lastPlaces) bits.push(`${r.lastPlaces} last-place finish${r.lastPlaces === 1 ? '' : 'es'}.`);
  return bits.join(' ');
}

/** A short block for the AI's league data. */
export function hofDigest(model) {
  const list = hallOfFame(model);
  return ['HALL OF FAME (the site\'s all-time rating out of 100; titles are the site\'s nicknames):',
    ...list.map(r => `${r.rank}. ${r.name} ${r.ovr} (${r.tier.label}) "${r.title}"${r.active ? '' : ', former member'}`)].join('\n');
}

