// Thin Sleeper API client with three sources, tried in order:
//   1. data/snapshot.json (written by scripts/snapshot.mjs) when present
//   2. the browser Cache API (completed seasons never expire, live ones use CONFIG.LIVE_TTL)
//   3. the network (https://api.sleeper.app/v1)
import { CONFIG } from './config.js';

const BASE = 'https://api.sleeper.app/v1';
const CACHE_NAME = 'almanac-sleeper-v1';
let snapshot = null;
let snapshotTried = false;
let forceLive = new URLSearchParams(location.search).has('live');
const stats = { network: 0, cache: 0, snapshot: 0 };

/** The league a saved snapshot was made for, if there is one. */
export async function snapshotLeague() { const s = forceLive ? null : await loadSnapshot(); return s?.__leagueId || null; }

export function sourceStats() { return { ...stats, snapshot: !!snapshot && !forceLive }; }

async function loadSnapshot() {
  if (snapshotTried) return snapshot;
  snapshotTried = true;
  try {
    const r = await fetch('data/snapshot.json', { cache: 'no-store' });
    if (r.ok) snapshot = await r.json();
  } catch { /* no snapshot: fine */ }
  return snapshot;
}

async function openCache() {
  try { return 'caches' in self ? await caches.open(CACHE_NAME) : null; } catch { return null; }
}

/** GET a Sleeper path such as `/league/123/users`. `ttl` = Infinity for immutable data. */
export async function sget(path, { ttl = CONFIG.LIVE_TTL } = {}) {
  const snap = forceLive ? null : await loadSnapshot();
  if (snap && path in snap) { stats.snapshot++; return snap[path]; }

  const url = BASE + path;
  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      const at = Number(hit.headers.get('x-fetched-at') || 0);
      if (ttl === Infinity || Date.now() - at < ttl) { stats.cache++; return hit.json(); }
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper ${res.status} for ${path}`);
  const body = await res.text();
  stats.network++;
  if (cache) {
    await cache.put(url, new Response(body, {
      headers: { 'content-type': 'application/json', 'x-fetched-at': String(Date.now()) },
    })).catch(() => {});
  }
  return body ? JSON.parse(body) : null;
}

export async function clearCache() {
  try { await caches.delete(CACHE_NAME); } catch {}
  try { localStorage.removeItem('almanac-players'); } catch {}
}

/**
 * Slim player directory {id: {n, p, t}}. The full /players/nfl dump is ~5 MB, so it is
 * fetched at most once a day and stored slimmed in localStorage.
 */
export async function players() {
  const snap = forceLive ? null : await loadSnapshot();
  if (snap && snap.__players) return snap.__players;
  try {
    const raw = localStorage.getItem('almanac-players');
    if (raw) {
      const { at, data } = JSON.parse(raw);
      if (Date.now() - at < 24 * 3600 * 1000) return data;
    }
  } catch {}
  const res = await fetch(BASE + '/players/nfl');
  if (!res.ok) throw new Error('Could not load the Sleeper player list');
  const full = await res.json();
  stats.network++;
  const data = slimPlayers(full);
  try { localStorage.setItem('almanac-players', JSON.stringify({ at: Date.now(), data })); } catch {}
  return data;
}

export function slimPlayers(full) {
  const out = {};
  for (const [id, p] of Object.entries(full)) {
    const n = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || id;
    out[id] = { n, p: p.position || (p.fantasy_positions || [])[0] || '?', t: p.team || '' , fp: p.fantasy_positions || undefined };
  }
  return out;
}
