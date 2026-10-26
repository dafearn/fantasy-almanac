// The site's look, chosen by each viewer and kept in their browser: a colorway (or custom colors), light or
// dark, the league's display name and which team is theirs. A shared link can carry a look (?look=...), so a
// commissioner can send the league the site already dressed in its colors.

export const COLORWAYS = [
  { key: 'classic', name: 'Classic', brand: '#16284a', trim: '#d4a72c', accentL: '#2563c9', accentD: '#5b9cf0' },
  { key: 'turf', name: 'Turf', brand: '#123d2a', trim: '#a3d65c', accentL: '#1d7a46', accentD: '#4fc47f' },
  { key: 'crimson', name: 'Crimson', brand: '#5a1020', trim: '#c3c9d1', accentL: '#b3253d', accentD: '#ef6f84' },
  { key: 'blaze', name: 'Blaze', brand: '#17181d', trim: '#f26a21', accentL: '#c9501a', accentD: '#ff8b4d' },
  { key: 'royal', name: 'Royal', brand: '#35195f', trim: '#e8b923', accentL: '#6a3fc1', accentD: '#a684f0' },
  { key: 'tide', name: 'Tide', brand: '#0b4650', trim: '#ff7a59', accentL: '#0f7d8c', accentD: '#3fc2d1' },
  { key: 'volt', name: 'Volt', brand: '#111312', trim: '#c8f031', accentL: '#4a7d0f', accentD: '#b5e33a' },
  { key: 'steel', name: 'Steel', brand: '#2b3440', trim: '#9fb4c8', accentL: '#3b6894', accentD: '#7fb0de' },
];

const KEY = 'almanac-look';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
const HEX = /^#[0-9a-f]{6}$/i;

/** The saved look: { colorway, custom: {brand, trim, accentL, accentD}, names: {leagueId: name}, me: {leagueId: ownerId} }. */
export function getLook() { return read(); }
export function setLook(patch) { const next = { ...read(), ...patch }; write(next); return next; }

/** The colors in effect: a preset, or custom colors on top of one. */
export function colorsOf(look = read()) {
  const base = COLORWAYS.find(c => c.key === look.colorway) || COLORWAYS[0];
  if (look.colorway !== 'custom' || !look.custom) return base;
  const c = look.custom, pick = (k, d) => (HEX.test(c[k] || '') ? c[k] : d);
  return { key: 'custom', name: 'Custom', brand: pick('brand', base.brand), trim: pick('trim', base.trim), accentL: pick('accentL', base.accentL), accentD: pick('accentD', base.accentD) };
}

/** Paint the colorway onto the page, and keep the colors where index.html can paint them before the scripts load. */
export function applyLook(look = read()) {
  const c = colorsOf(look), st = document.documentElement.style;
  st.setProperty('--brand', c.brand); st.setProperty('--trim', c.trim);
  st.setProperty('--accent-l', c.accentL); st.setProperty('--accent-d', c.accentD);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.brand);
  try { localStorage.setItem('almanac-colors', JSON.stringify({ brand: c.brand, trim: c.trim, accentL: c.accentL, accentD: c.accentD })); } catch {}
}

/** A look shared through the address (?look=turf or ?look=custom.16284a.d4a72c.2563c9.5b9cf0) wins once and is saved. */
export function lookFromUrl() {
  const v = new URLSearchParams(location.search).get('look'); if (!v) return;
  const [key, ...hex] = v.split('.');
  if (key === 'custom' && hex.length >= 2 && hex.every(h => /^[0-9a-f]{6}$/i.test(h))) {
    const [brand, trim, accentL, accentD] = hex.map(h => `#${h}`);
    setLook({ colorway: 'custom', custom: { brand, trim, accentL: accentL || trim, accentD: accentD || accentL || trim } });
  } else if (COLORWAYS.some(c => c.key === key)) setLook({ colorway: key });
}
export function lookParam(look = read()) {
  const c = colorsOf(look);
  return c.key === 'custom' ? ['custom', c.brand, c.trim, c.accentL, c.accentD].map(x => x.replace('#', '')).join('.') : c.key;
}

/** The league's display name: the viewer's own name for it, else Sleeper's. */
export function leagueName(leagueId, sleeperName) {
  return read().names?.[leagueId] || String(sleeperName || '').trim() || 'League Almanac';
}
export function setLeagueName(leagueId, name) {
  const names = { ...(read().names || {}) };
  if (name) names[leagueId] = name; else delete names[leagueId];
  setLook({ names });
}

/** The viewer's own team in this league (an owner id), for highlights. */
export function myOwner(leagueId) { return read().me?.[leagueId] || null; }
export function setMyOwner(leagueId, owner) {
  const me = { ...(read().me || {}) };
  if (owner) me[leagueId] = owner; else delete me[leagueId];
  setLook({ me });
}
