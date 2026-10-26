// Which Sleeper league the site shows. In order: ?league=<id> in the address, the league this browser
// opened last, then the league server's default. With none of those, the visitor gets the league picker:
// paste a league id or link, or type a Sleeper username and pick from that person's leagues.
import { sget } from './api.js';
import { esc } from './ui.js';
import { leagueIdFrom } from './chain.js';
import { logo } from './logo.js';

const KEY = 'almanac-league';
const RECENT = 'almanac-recent';
const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** The league id to open, or null when the visitor has to pick one. */
export function chosenLeague(serverDefault = null) {
  const fromUrl = leagueIdFrom(new URLSearchParams(location.search).get('league'));
  if (fromUrl) { write(KEY, fromUrl); return fromUrl; }
  return read(KEY, null) || serverDefault || null;
}

/** Remember a league that loaded, for the "recent leagues" list. */
export function rememberLeague(id, name) {
  write(KEY, id);
  const list = read(RECENT, []).filter(x => x.id !== id);
  write(RECENT, [{ id, name }, ...list].slice(0, 6));
}

/** Open a league: a full reload with ?league=<id>, so the address is shareable. */
export function openLeague(id) {
  write(KEY, id);
  location.href = `${location.pathname}?league=${encodeURIComponent(id)}#/`;
}

/** Forget the league this browser opens by default and show the picker. */
export function switchLeague() {
  try { localStorage.removeItem(KEY); } catch {}
  location.href = `${location.pathname}#/`;
}

const yearNow = () => new Date().getFullYear();

/** The picker: fills `el`. `error` explains why it's showing (a bad id, say). */
export function showPicker(el, { error = '' } = {}) {
  const recent = read(RECENT, []);
  el.innerHTML = `<div class="picker">
    <div class="picker-head">${logo('picker-logo', '')}
      <h1>Open your Sleeper league</h1>
      <p class="sub">Standings and playoff odds, power rankings, weekly reports, rivalries, a record book, a Hall of Fame and a lot more, built from your league's own history on Sleeper. Nothing to install and nothing to sign up for.</p></div>
    ${error ? `<p class="card err">${esc(error)}</p>` : ''}
    <form class="card form" id="pkForm">
      <label>League ID, Sleeper link or your Sleeper username
        <input type="text" id="pkIn" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. 1048123456789012345 or your username" required></label>
      <p class="hint">In the Sleeper app, open the league, tap the settings gear, and the League ID is at the bottom of General. On sleeper.com it's the long number in the league's address.</p>
      <p><button class="btn primary" type="submit">Find my league</button></p>
      <div id="pkOut" aria-live="polite"></div>
    </form>
    ${recent.length ? `<h2>Recently opened</h2><div class="pk-list">${recent.map(r => `<button type="button" class="card pk-row" data-id="${esc(r.id)}"><b>${esc(r.name || 'League')}</b><span class="muted small">${esc(r.id)}</span></button>`).join('')}</div>` : ''}
    <p class="muted small">Everything loads straight from Sleeper's public API into your browser. Send the address to your league and it opens on the same league.</p>
  </div>`;
  const out = el.querySelector('#pkOut');
  el.querySelectorAll('.pk-row').forEach(b => b.onclick = () => openLeague(b.dataset.id));
  el.querySelector('#pkForm').onsubmit = async e => {
    e.preventDefault();
    const raw = el.querySelector('#pkIn').value.trim();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    out.innerHTML = '<p class="muted">Looking…</p>';
    try {
      const id = leagueIdFrom(raw);
      if (id) {
        const lg = await sget(`/league/${id}`).catch(() => null);
        if (!lg) throw new Error("Sleeper doesn't know a league with that ID. Check the number and try again.");
        openLeague(id); return;
      }
      const user = await sget(`/user/${encodeURIComponent(raw.toLowerCase())}`).catch(() => null);
      if (!user?.user_id) throw new Error(`No Sleeper user called "${raw}". Try the league ID instead.`);
      const seasons = [yearNow(), yearNow() - 1];
      const lists = await Promise.all(seasons.map(y => sget(`/user/${user.user_id}/leagues/nfl/${y}`).catch(() => [])));
      // Newest season first; a league that rolled over shows once, as its newest season.
      const seen = new Set(), leagues = [];
      for (const l of lists.flat()) {
        if (!l || seen.has(l.league_id)) continue;
        seen.add(l.league_id); if (l.previous_league_id) seen.add(String(l.previous_league_id));
        leagues.push(l);
      }
      if (!leagues.length) throw new Error(`${user.display_name || raw} isn't in any Sleeper NFL leagues for ${seasons.join(' or ')}.`);
      out.innerHTML = `<p>${esc(user.display_name || raw)}'s leagues:</p><div class="pk-list">${leagues.map(l => `<button type="button" class="card pk-row" data-id="${esc(l.league_id)}"><b>${esc((l.name || 'League').trim())}</b><span class="muted small">${esc(l.season)} · ${l.total_rosters || '?'} teams</span></button>`).join('')}</div>`;
      out.querySelectorAll('.pk-row').forEach(b => b.onclick = () => openLeague(b.dataset.id));
    } catch (err) {
      out.innerHTML = `<p class="neg">${esc(err.message)}</p>`;
    }
    btn.disabled = false;
  };
}
