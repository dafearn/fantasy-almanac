import { loadAll } from './data.js';
import { prepare } from './stats.js';
import { loadLegacy, loadRivals, loadExtras } from './legacy.js';
import { clearCache, sourceStats, snapshotLeague } from './api.js';
import { setModel, esc, toast, setNavBadge } from './ui.js';
import { logo } from './logo.js';
import * as season from './views/season.js';
import * as league from './views/league.js';
import * as moves from './views/moves.js';
import * as admin from './views/admin.js';
import * as club from './views/clubhouse.js';
import * as lore from './views/lore.js';
import { live } from './views/live.js';
import * as lab from './views/lab.js';
import { chartsPage, scouting } from './views/charts.js';
import { ask } from './views/ask.js';
import { tradingCards } from './views/cards.js';
import { receipts } from './views/receipts.js';
import { account } from './views/account.js';
import { hallOfFamePage } from './views/hof.js';
import { playersPage } from './views/players.js';
import { initServer, attachLeague, SERVER, apiGet, lp, isMember } from './server.js';
import { CONFIG } from './config.js';
import { chosenLeague, rememberLeague, showPicker, switchLeague } from './picker.js';
import { applyLook, lookFromUrl, leagueName } from './look.js';
import { lookPage } from './views/look.js';
import { personaOf } from './persona.js';

const routes = {
  '': season.home, standings: season.standings, power: season.power, reports: season.reports, trends: season.trends,
  rivalries: league.rivalries, records: league.records, managers: league.managers, history: league.history,
  drafts: moves.drafts, transactions: moves.transactions, data: admin.data,
  live, charts: chartsPage, scouting, ask, allplay: lab.allPlay, whatif: lab.whatIf, breakdown: lab.breakdown, block: club.tradeBlock, pickem: club.pickem, cards: tradingCards, look: lookPage, receipts, account,
  hof: hallOfFamePage, luck: lore.scheduleLuck, allleague: lore.allLeaguePage, trophies: lore.trophies, players: playersPage,
};

let model;
const main = document.getElementById('main');

export function params() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

/** Update query params in the hash without adding history noise. */
export function setQuery(patch) {
  const { parts, q } = params();
  const next = { ...q, ...patch };
  for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
  const qs = new URLSearchParams(next).toString();
  const hash = `#/${parts.map(encodeURIComponent).join('/')}${qs ? '?' + qs : ''}`;
  if (hash === location.hash) return;
  keepScroll = true; // a filter changed on the same page: redraw it in place
  location.hash = hash;
}
let keepScroll = false, lastPage = null;

// ---------------------------------------------------------------- sidebar groups
// Groups fold away so the menu shows a handful of choices at a time. The groups you open or close are
// remembered; the group holding the current page always opens.
const NAV_KEY = 'almanac-nav';
const DEFAULT_OPEN = ['season', 'club'];
let navOpen; try { navOpen = new Set(JSON.parse(localStorage.getItem(NAV_KEY)) || DEFAULT_OPEN); } catch { navOpen = new Set(DEFAULT_OPEN); }
function setGroup(g, open, remember = true) {
  const box = document.querySelector(`.navgroup[data-g="${g}"]`); if (!box) return;
  box.classList.toggle('closed', !open);
  box.querySelector('.navh').setAttribute('aria-expanded', String(open));
  box.querySelector('.navg').inert = !open;
  if (remember) { open ? navOpen.add(g) : navOpen.delete(g); try { localStorage.setItem(NAV_KEY, JSON.stringify([...navOpen])); } catch {} }
}
document.querySelectorAll('.navgroup').forEach(box => {
  setGroup(box.dataset.g, navOpen.has(box.dataset.g), false);
  box.querySelector('.navh').onclick = () => setGroup(box.dataset.g, box.classList.contains('closed'));
});

const errorCard = e => `<div class="card err errstate"><div class="ic" aria-hidden="true">🏈💥</div><h3>Fumble! This page hit an error.</h3>
  <p>The rest of the site still works. Try the page again, or head back home.</p>
  <p><button type="button" class="btn primary" data-retry>Try again</button> <a class="btn" href="#/">Go home</a></p>
  <details><summary>Technical details</summary><pre class="copy">${esc(e.stack || e)}</pre></details></div>`;

// Long page intros fold to two lines with a "More" link.
function foldIntro() {
  const sub = main.querySelector('p.sub'); if (!sub || sub.dataset.fold) return;
  sub.dataset.fold = '1'; sub.classList.add('clamp');
  if (sub.scrollHeight <= sub.clientHeight + 2) { sub.classList.remove('clamp'); return; }
  const b = document.createElement('button'); b.type = 'button'; b.className = 'linkbtn morebtn'; b.textContent = 'More'; b.setAttribute('aria-expanded', 'false');
  b.onclick = () => { const open = sub.classList.toggle('clamp'); b.textContent = open ? 'More' : 'Less'; b.setAttribute('aria-expanded', String(!open)); };
  sub.after(b);
}

function render() {
  const { parts, q } = params();
  const view = routes[parts[0] || ''] || season.home;
  let title = CONFIG.SITE_NAME, group = null;
  document.querySelectorAll('nav.side a').forEach(a => {
    const target = a.getAttribute('href').replace(/^#\/?/, '');
    const on = target === (parts[0] || '');
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (on && target) {
      title = a.closest('#acct') ? 'Account' : a.firstChild.textContent.trim();
      const g = a.closest('.navgroup');
      if (g) { group = g.querySelector('.navh').firstChild.textContent.trim(); if (g.classList.contains('closed')) setGroup(g.dataset.g, true, false); }
    }
  });
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === (parts[0] || '')));
  document.getElementById('tbTitle').textContent = title;
  document.title = parts[0] ? `${title} · ${CONFIG.SITE_NAME}` : CONFIG.SITE_NAME;
  setMenu(false);
  // A breadcrumb above the page title, so you always know where you are.
  const decorate = () => {
    if (!parts[0]) return;
    if (!main.querySelector('.strip')) main.insertAdjacentHTML('afterbegin', '<div class="strip" aria-hidden="true"></div>');
    if (!main.querySelector('.crumbs')) {
      const h = main.querySelector('.persona-head, h1');
      h?.insertAdjacentHTML('beforebegin', `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a>${group ? `<span>${esc(group)}</span>` : ''}<span aria-current="page">${esc(title)}</span></nav>`);
    }
    foldIntro();
  };
  const fail = e => { console.error(e); main.innerHTML = errorCard(e); main.querySelector('[data-retry]').onclick = render; };
  // Changing a filter (setQuery) redraws the same page where you are: hold the page's height while it
  // refills so the scroll position survives. A new page starts at the top with the entrance animation.
  const keep = keepScroll && lastPage === (parts[0] || ''), y = window.scrollY;
  keepScroll = false; lastPage = parts[0] || '';
  if (keep) main.style.minHeight = `${main.offsetHeight}px`;
  else { main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter'); }
  const settle = () => { if (keep) window.scrollTo(0, y); };
  try {
    main.innerHTML = '';
    const out = view(model, { parts: parts.slice(1), q }, main);
    decorate();
    if (out && out.then) out.then(() => { decorate(); settle(); }, fail);
  } catch (e) { fail(e); }
  if (keep) { settle(); setTimeout(() => { main.style.minHeight = ''; }, 2500); } else window.scrollTo(0, 0);
}

// Pick'em picks still to make this week, shown as a count on the sidebar link.
export async function refreshPickBadge() {
  if (!isMember()) return;
  try {
    const s = model.seasons[model.seasons.length - 1];
    const week = Math.min(s.currentWeek, s.lastWeek);
    const games = s.games.filter(g => g.week === week && g.matchupId != null);
    if (!games.length || games.some(g => g.final || g.a.pts > 0 || g.b.pts > 0)) return setNavBadge('pickem', 0);
    const data = await apiGet(lp(`/pickem?season=${s.season}`));
    if (data.locked[week]) return setNavBadge('pickem', 0);
    const mine = data.picks.filter(p => p.week === week && p.picker === SERVER.me.sleeperUserId).length;
    const left = Math.max(0, games.length - mine);
    setNavBadge('pickem', left, `${left} pick${left === 1 ? '' : 's'} left for week ${week}`);
  } catch {}
}

/** The id that names this league in the viewer's saved settings: its first Sleeper season. */
export const leagueKey = m => (m || model)?.seasons[0]?.leagueId || CONFIG.ROOT_LEAGUE_ID;

/** Redraw the crest and league name in the sidebar and top bar. */
export function refreshBrand() {
  document.getElementById('brandlogo').innerHTML = logo();
  document.getElementById('tblogo').innerHTML = logo();
  const bn = document.getElementById('brandname');
  bn.textContent = CONFIG.SITE_NAME; bn.classList.toggle('long', CONFIG.SITE_NAME.length > 14);
  const P = personaOf(SERVER.persona);
  const ask = document.querySelector('nav.side a[href="#/ask"]'); if (ask) ask.textContent = P.ask;
}

async function boot() {
  const progress = t => { const el = document.getElementById('progress'); if (el) el.textContent = t; };
  let leagueId = null;
  try {
    const serverDefault = await initServer();
    leagueId = chosenLeague(serverDefault || await snapshotLeague());
    if (!leagueId) { document.body.classList.add('picking'); showPicker(main); return; }
    CONFIG.ROOT_LEAGUE_ID = leagueId;
    model = await loadAll(progress);
    const extras = await loadExtras(model);
    model.legacy = loadLegacy(model, extras);
    model.rivals = loadRivals(model, extras);
    model.extrasFile = extras?.file || null;
    await attachLeague(model);
    const latest = model.seasons[model.seasons.length - 1];
    CONFIG.SITE_NAME = leagueName(leagueKey(), latest.name);
    rememberLeague(leagueId, (latest.name || '').trim());
    refreshBrand();
    prepare(model);
    setModel(model);
    window.__model = model; // handy for poking around in the console
    const st = sourceStats();
    document.getElementById('source').textContent = st.snapshot ? 'Data: saved snapshot' : `Data: live from Sleeper`;
    const acct = document.getElementById('acct');
    const tb = document.getElementById('tbAcct');
    if (!SERVER.available) tb.hidden = true;
    else if (SERVER.me) { tb.textContent = SERVER.me.displayName.slice(0, 2).toUpperCase(); tb.title = `Signed in as ${SERVER.me.displayName}`; tb.classList.add('me'); }
    acct.innerHTML = SERVER.available ? (SERVER.me ? `Signed in as <a href="#/account">${esc(SERVER.me.displayName)}</a>` : `Visiting · <a href="#/account">Member sign in</a>`) : '';
    window.addEventListener('hashchange', render);
    render();
    refreshPickBadge();
    // Celebrate a fresh sign-in or a new account once the page has reloaded.
    let hello = null; try { hello = sessionStorage.getItem('almanac-hello'); sessionStorage.removeItem('almanac-hello'); } catch {}
    if (hello && SERVER.me) toast(hello === 'new'
      ? `<b>🎉 Welcome to the clubhouse, ${esc(SERVER.me.displayName)}!</b><span>Your account is ready. Start with this week's <a href="#/pickem">pick'em</a>.</span>`
      : `<b>👋 Welcome back, ${esc(SERVER.me.displayName)}.</b>`, hello === 'new' ? 9000 : 4000);
  } catch (e) {
    console.error(e);
    // A league id that Sleeper doesn't know (a typo in a shared link, a deleted league): back to the picker.
    if (leagueId && /Sleeper 404|Sleeper 400/.test(e.message)) { try { localStorage.removeItem('almanac-league'); } catch {} showPicker(main, { error: `Sleeper couldn't find league ${leagueId}. Check the ID or pick another league.` }); return; }
    main.innerHTML = `<div class="loading"><div class="card err errstate" style="max-width:560px"><div class="ic" aria-hidden="true">📡</div><h3>Couldn't load the league</h3><p>${esc(e.message)}</p><p class="muted">The app talks to api.sleeper.app from your browser. Check your connection and try again. If you opened index.html straight from disk, run <code>python3 serve.py</code> and use http://localhost:8000 instead.</p><p><button type="button" class="btn primary" onclick="location.reload()">Try again</button> <button type="button" class="btn" id="pickOther">Pick another league</button></p></div></div>`;
    main.querySelector('#pickOther').onclick = switchLeague;
  }
}

lookFromUrl();
applyLook();
document.getElementById('brandlogo').innerHTML = logo();
document.getElementById('tblogo').innerHTML = logo();

// Phone layout: the sidebar becomes a slide-in menu, opened from the top bar or the tab bar's "More".
function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  document.getElementById('backdrop').hidden = !open;
  document.getElementById('menuBtn').setAttribute('aria-expanded', String(open));
}
document.getElementById('menuBtn').onclick = () => setMenu(!document.body.classList.contains('menu-open'));
document.getElementById('moreBtn').onclick = () => setMenu(!document.body.classList.contains('menu-open'));
document.getElementById('backdrop').onclick = () => setMenu(false);
document.getElementById('nav').addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
document.getElementById('refresh').onclick = async () => { await clearCache(); location.reload(); };
// Light, dark or match the device ('auto'), remembered in this browser.
export function currentTheme() { try { return localStorage.getItem('almanac-theme') || 'auto'; } catch { return 'auto'; } }
export function setTheme(t) {
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  try { if (t === 'auto') localStorage.removeItem('almanac-theme'); else localStorage.setItem('almanac-theme', t); } catch {}
}
document.getElementById('theme').onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(dark ? 'light' : 'dark');
};
boot();
