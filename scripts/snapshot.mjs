// Saves every Sleeper response the app needs for one league into data/snapshot.json, so the site can be
// hosted as plain static files for that league (or browsed offline). Requires Node 18+.
//   node scripts/snapshot.mjs <sleeper league id>
// Re-run it whenever you want the snapshot to pick up new weeks. The site opens on this league by default.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

globalThis.location = { search: '?live' };
const BASE = 'https://api.sleeper.app/v1';
const recorded = {};
let fullPlayers = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const res = await realFetch(url, init);
  const u = String(url);
  if (u.startsWith(BASE) && res.ok) {
    const body = await res.clone().json();
    const p = u.slice(BASE.length);
    if (p === '/players/nfl') fullPlayers = body; else recorded[p] = body;
  }
  return res;
};

const leagueId = (process.argv[2] || '').match(/\d{6,24}/)?.[0];
if (!leagueId) { console.error('Usage: node scripts/snapshot.mjs <sleeper league id>'); process.exit(1); }
const { CONFIG } = await import('../js/config.js');
CONFIG.ROOT_LEAGUE_ID = leagueId;
const { loadAll } = await import('../js/data.js');
const { slimPlayers } = await import('../js/api.js');
const model = await loadAll(msg => console.log(msg));

// Keep only players who appear anywhere in league data.
const ids = new Set();
for (const s of model.seasons) {
  for (const byRid of Object.values(s.weeks)) for (const e of Object.values(byRid)) e.players.forEach(id => ids.add(id));
  for (const p of s.draft?.picks || []) ids.add(p.playerId);
  for (const t of s.transactions) [...Object.keys(t.adds), ...Object.keys(t.drops)].forEach(id => ids.add(id));
}
const slim = slimPlayers(fullPlayers || {});
recorded.__players = Object.fromEntries([...ids].filter(id => slim[id]).map(id => [id, slim[id]]));
recorded.__savedAt = new Date().toISOString();
recorded.__leagueId = leagueId;

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'snapshot.json');
await writeFile(out, JSON.stringify(recorded));
console.log(`Saved ${Object.keys(recorded).length} responses and ${Object.keys(recorded.__players).length} players to ${out}`);
