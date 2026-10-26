// Server-side Sleeper reads (for checking who owns what). Uses data/snapshot.json when present,
// like the browser app, and caches live responses briefly.
import { readFileSync, existsSync } from 'node:fs';
import { newestSeason } from '../js/chain.js';

const BASE = 'https://api.sleeper.app/v1';
export const STATS_BASE = 'https://api.sleeper.app'; // undocumented stats feed lives outside /v1
const cache = new Map();

export function makeSleeper({ snapshotPath, ttl = 5 * 60 * 1000 }) {
  let snapshot = null;
  if (snapshotPath && existsSync(snapshotPath)) {
    try { snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')); } catch { snapshot = null; }
  }
  async function get(p, { base = BASE, maxAge = ttl } = {}) {
    if (snapshot && p in snapshot) return snapshot[p];
    const key = base + p;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < maxAge) return hit.data;
    const res = await fetch(key);
    if (!res.ok) throw new Error(`Sleeper ${res.status} for ${p}`);
    const data = await res.json();
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  /** The newest season's league id, following the league forward from the configured season. */
  async function currentLeagueId(rootId) {
    try {
      const state = await get('/state/nfl');
      return await newestSeason(p => get(p), rootId, state.league_season || state.season);
    } catch { return rootId; }
  }

  async function members(leagueId) { return (await get(`/league/${leagueId}/users`)) || []; }

  /** Map sleeper user id -> Set of player ids on that manager's roster. */
  async function ownership(leagueId) {
    const rosters = (await get(`/league/${leagueId}/rosters`)) || [];
    const out = new Map();
    for (const r of rosters) {
      const ids = new Set([...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])]);
      for (const o of [r.owner_id, ...(r.co_owners || [])]) if (o) out.set(o, { rosterId: r.roster_id, players: ids });
    }
    return out;
  }

  /** Resolve a Sleeper username to a league member, or null. */
  async function findMember(leagueId, username) {
    const list = await members(leagueId);
    let uid = null;
    try { uid = (await get(`/user/${encodeURIComponent(username.toLowerCase())}`))?.user_id || null; } catch {}
    const m = list.find(u => (uid && u.user_id === uid) || (u.display_name || '').toLowerCase() === username.toLowerCase());
    return m ? { userId: m.user_id, displayName: m.display_name, isOwner: !!m.is_owner } : null;
  }

  async function weekStarted(leagueId, week) {
    const ms = (await get(`/league/${leagueId}/matchups/${week}`)) || [];
    return ms.some(m => Number(m.points || 0) > 0);
  }

  return { get, currentLeagueId, members, ownership, findMember, weekStarted };
}
