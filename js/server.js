// Talks to the league server (server/server.mjs) when the app is hosted with it. Two levels:
//  - SERVER.api: a server answered, so the shared helpers work for any league (live ticker cache,
//    player lab, Monday-night lookups).
//  - SERVER.available: the server also hosts the league being viewed, so accounts and the clubhouse
//    (trade block, pick'em, Ask the Commish, columns) work. On plain static hosting both stay false and
//    those pages explain what they need.

export const SERVER = { api: false, available: false, me: null, memberships: [], league: null, leagues: [], persona: null };

async function call(method, path, body) {
  const res = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: body ? { 'content-type': 'application/json', 'x-requested-with': 'almanac' } : { 'x-requested-with': 'almanac' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
export const apiGet = p => call('GET', p);
export const apiPost = (p, body = {}) => call('POST', p, body);
export const lp = p => `/api/l/${encodeURIComponent(SERVER.league)}${p}`;

/** Detect the server. Returns the league id it opens by default, if it hosts any. */
export async function initServer() {
  try {
    const cfg = await apiGet('/api/config');
    SERVER.api = true;
    SERVER.leagues = cfg.leagues || [];
    SERVER.persona = cfg.persona || null;
    return SERVER.leagues.find(l => l.key === cfg.defaultLeague)?.rootLeagueId || SERVER.leagues[0]?.rootLeagueId || null;
  } catch { SERVER.api = false; return null; }
}

/** After the league loads: switch the clubhouse on if this server hosts it, and load who is signed in. */
export async function attachLeague(model) {
  if (!SERVER.api) return;
  const ids = new Set(model.seasons.map(s => String(s.leagueId)));
  const L = SERVER.leagues.find(l => ids.has(String(l.rootLeagueId)));
  if (!L) return;
  SERVER.league = L.key;
  if (L.persona) SERVER.persona = L.persona;
  SERVER.available = true;
  try { await refreshMe(); } catch { /* signed out */ }
}
export async function refreshMe() {
  const me = await apiGet('/api/auth/me');
  SERVER.me = me.user; SERVER.memberships = me.memberships;
}
export function isMember() { return !!SERVER.me && SERVER.memberships.some(m => m.league === SERVER.league); }
export function isCommish() { return SERVER.memberships.some(m => m.league === SERVER.league && m.role === 'commissioner'); }
