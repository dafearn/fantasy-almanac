// Trading cards. Each Sleeper season prints a set of the season's best players at every position, and a
// manager earns a player's card for that season by having him on their roster in any final week.
// Everything comes from roster history, so the collection builds itself and nobody can game it.
//
// Rules
//   - The set: the top players at each position by points scored on league rosters in the regular season
//     (QB 24, RB 50, WR 50, TE 24, K 12, DEF 12).
//   - Rarity comes from that positional finish: Legendary is the position's No. 1, then Epic, Rare,
//     Uncommon and Common (thresholds below). Until the season ends, rarities can still move.
//   - Every manager who rostered the player gets their own printing, numbered in the order they got him
//     ("No. 2 of 3"), stamped with how they got him (draft round, waivers, free agency or trade).
//   - Champion foil: the title winner's cards for players who started in the championship game.
//   - Collection score: Common 1, Uncommon 2, Rare 4, Epic 8, Legendary 16; champion foil doubles a card.
import { playerSeason } from './stats.js';

export const CAPS = { QB: 24, RB: 50, WR: 50, TE: 24, K: 12, DEF: 12 };
// Best rank (inclusive) for each rarity, by position.
const TIERS = {
  QB: [1, 3, 8, 15], TE: [1, 3, 8, 15], RB: [1, 5, 15, 30], WR: [1, 5, 15, 30], K: [1, 2, 5, 8], DEF: [1, 2, 5, 8],
};
export const RARITIES = [
  { key: 'legendary', label: 'Legendary', pts: 16 },
  { key: 'epic', label: 'Epic', pts: 8 },
  { key: 'rare', label: 'Rare', pts: 4 },
  { key: 'uncommon', label: 'Uncommon', pts: 2 },
  { key: 'common', label: 'Common', pts: 1 },
];
export const RARITY = Object.fromEntries(RARITIES.map((r, i) => [r.key, { ...r, order: i }]));
export const POSITIONS = Object.keys(CAPS);

function rarityFor(pos, rank) {
  const t = TIERS[pos];
  const i = t.findIndex(x => rank <= x);
  return RARITIES[i < 0 ? 4 : i].key;
}

/** Headshot (or team logo for a defense) from Sleeper's image CDN. */
export function cardImage(id, pos) {
  return pos === 'DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${String(id).toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/${encodeURIComponent(id)}.jpg`;
}

/** How a manager first got a player in a season. */
function acquired(s, owner, pid) {
  const pick = s.draft?.picks.find(p => p.playerId === pid && (p.ownerId === owner || s.owner(p.rid) === owner));
  if (pick) return { how: 'draft', label: `Drafted, round ${pick.round}`, short: `Rd ${pick.round}` };
  const moves = [...s.transactions].filter(t => t.adds?.[pid] != null && s.owner(t.adds[pid]) === owner).sort((a, b) => (a.created || 0) - (b.created || 0));
  const t = moves[0];
  if (t?.type === 'trade') return { how: 'trade', label: `Traded for, week ${t.week}`, short: 'Trade' };
  if (t?.type === 'waiver') return { how: 'waiver', label: `Waiver claim, week ${t.week}${t.bid ? ` ($${t.bid})` : ''}`, short: 'Waivers' };
  if (t?.type === 'free_agent') return { how: 'fa', label: `Free agent pickup, week ${t.week}`, short: 'Free agent' };
  return { how: 'roster', label: 'On the roster', short: 'Roster' };
}

let cache = null;
/**
 * Every set and every manager's printings: { sets: [{season, inProgress, cards}], byOwner: {owner: [printing]} }.
 * A card is {key, season, pid, pos, rank, pts, ppg, games, rarity, printings}; a printing adds the holder's details.
 */
export function cardCatalog(model) {
  if (cache?.model === model) return cache.out;
  const sets = [], byOwner = {};
  for (const s of model.seasons) {
    const through = Math.min(s.completedThrough, s.regWeeks);
    if (through < 1) continue;
    const ps = playerSeason(model, s);
    const pool = new Map();
    for (const [pid, rank] of Object.entries(ps.posRank)) {
      const pos = model.posOf(pid);
      if (!CAPS[pos] || rank > CAPS[pos] || !(ps.pts[pid] > 0)) continue;
      pool.set(pid, { key: `${s.season}:${pid}`, season: s.season, inProgress: s.status !== 'complete', pid, pos, rank, pts: ps.pts[pid], games: ps.weeks[pid], ppg: ps.pts[pid] / Math.max(1, ps.weeks[pid]), rarity: rarityFor(pos, rank), printings: [] });
    }
    // Who held each card: every final week, playoffs included.
    const held = new Map();
    const weeks = Object.keys(s.weeks).map(Number).sort((a, b) => a - b);
    for (const w of weeks) for (const e of Object.values(s.weeks[w])) {
      if (!e.final) continue;
      for (const pid of e.players) {
        if (!pool.has(pid)) continue;
        const k = `${pid}|${e.owner}`;
        const h = held.get(k) || held.set(k, { pid, owner: e.owner, rid: e.rid, first: w, weeks: 0, starts: 0, startedPts: 0, best: 0 }).get(k);
        h.weeks++;
        const i = e.starters.indexOf(pid);
        if (i >= 0) { const p = Number(e.startersPts[i] || 0); h.starts++; h.startedPts += p; h.best = Math.max(h.best, p); }
      }
    }
    const title = s.games.find(g => g.type === 'playoff' && g.place === 1 && g.final && g.winner && g.winner !== 'tie');
    const champ = title ? (title.winner === 'a' ? title.a : title.b) : null;
    const champStarters = champ ? new Set(s.weeks[title.week]?.[champ.rid]?.starters || []) : new Set();
    for (const h of held.values()) {
      const card = pool.get(h.pid);
      card.printings.push({ ...h, ...acquired(s, h.owner, h.pid), champion: !!champ && champ.owner === h.owner && champStarters.has(h.pid) });
    }
    const cards = [...pool.values()];
    for (const c of cards) {
      c.printings.sort((a, b) => a.first - b.first);
      c.printings.forEach((p, i) => {
        p.no = i + 1; p.of = c.printings.length;
        p.score = RARITY[c.rarity].pts * (p.champion ? 2 : 1);
        (byOwner[p.owner] ||= []).push({ card: c, p });
      });
    }
    cards.sort((a, b) => RARITY[a.rarity].order - RARITY[b.rarity].order || POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || a.rank - b.rank);
    sets.push({ season: s.season, inProgress: s.status !== 'complete', through, cards });
  }
  sets.reverse(); // newest first
  const out = { sets, byOwner };
  cache = { model, out };
  return out;
}

/** Collectors ranked by score, with how many of each rarity they hold. */
export function collectors(model) {
  const { byOwner } = cardCatalog(model);
  return Object.entries(byOwner).filter(([o]) => model.managers[o]).map(([owner, list]) => {
    const counts = Object.fromEntries(RARITIES.map(r => [r.key, 0]));
    let score = 0, champ = 0;
    for (const { card, p } of list) { counts[card.rarity]++; score += p.score; if (p.champion) champ++; }
    return { owner, count: list.length, score, counts, champ };
  }).sort((a, b) => b.score - a.score || b.count - a.count).map((r, i) => ({ ...r, rank: i + 1 }));
}
