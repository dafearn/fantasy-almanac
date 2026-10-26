import { SERVER } from '../server.js';
import { myOwner } from '../look.js';

/** The season pages default to: the newest season with at least one final week. */
export function pickSeason(model, q) {
  if (q.season) { const s = model.seasons.find(x => x.season === q.season); if (s) return s; }
  const withData = model.seasons.filter(s => s.completedThrough >= 1);
  return withData[withData.length - 1] || model.seasons[model.seasons.length - 1];
}
export function lastFinalWeek(s) { return Math.max(1, Math.min(s.completedThrough, s.lastWeek)); }
/** The team to highlight: the signed-in member's, else the one this viewer picked on Look & feel, else the first. */
export function meOwner(model) {
  const signedIn = SERVER.me?.sleeperUserId;
  if (signedIn && model.managers[signedIn]) return signedIn;
  const picked = myOwner(model.seasons[0]?.leagueId);
  if (picked && model.managers[picked]) return picked;
  const latest = model.seasons[model.seasons.length - 1];
  return Object.values(latest?.teams || {})[0]?.ownerId || Object.keys(model.managers)[0];
}
export function sortedManagers(model, { activeOnly = false } = {}) {
  const latest = model.seasons[model.seasons.length - 1];
  const active = new Set(Object.values(latest?.teams || {}).map(t => t.ownerId));
  return Object.values(model.managers).filter(m => !activeOnly || active.has(m.id)).sort((a, b) => a.name.localeCompare(b.name));
}
export function highlightSelect(model, current, onChange, owners) {
  const id = 'hl' + Math.random().toString(36).slice(2, 7);
  setTimeout(() => { const el = document.getElementById(id); if (el) el.onchange = () => onChange(el.value); });
  const list = (owners || sortedManagers(model).map(m => m.id)).map(o => model.managers[o]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return `<label class="muted">Highlight <select id="${id}">${list.map(m => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>`;
}
