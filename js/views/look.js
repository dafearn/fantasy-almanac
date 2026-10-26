// Look & feel: colorway, light or dark, the league's display name and which team is yours. Saved in this
// browser only; the share link carries the league and the colorway to anyone you send it to.
import { CONFIG } from '../config.js';
import { esc, toast } from '../ui.js';
import { logo } from '../logo.js';
import { COLORWAYS, getLook, setLook, colorsOf, applyLook, lookParam, leagueName, setLeagueName, myOwner, setMyOwner } from '../look.js';
import { setTheme, currentTheme, leagueKey, refreshBrand } from '../app.js';
import { switchLeague } from '../picker.js';
import { sortedManagers } from './common.js';

const swatch = c => `--brand:${c.brand};--trim:${c.trim};--accent-l:${c.accentL};--accent-d:${c.accentD}`;

export function lookPage(model, _, el) {
  const key = leagueKey(model);
  const latest = model.seasons[model.seasons.length - 1];
  const look = getLook(), cur = colorsOf(look);
  const mine = myOwner(key);
  const theme = currentTheme();
  const managers = sortedManagers(model, { activeOnly: true });
  el.innerHTML = `<h1>Look &amp; feel</h1>
    <p class="sub">Make the site yours. These settings stay in this browser; send the share link below to give the league the same colors.</p>
    <h2>Colorway</h2>
    <div class="cw-grid" role="radiogroup" aria-label="Colorway">${COLORWAYS.map(c => `<button type="button" role="radio" aria-checked="${cur.key === c.key}" class="cw${cur.key === c.key ? ' on' : ''}" data-cw="${c.key}" style="${swatch(c)}">
        ${logo('cw-logo', CONFIG.SITE_NAME)}<span class="cw-bar"><i style="background:${c.brand}"></i><i style="background:${c.trim}"></i><i style="background:${c.accentL}"></i></span><b>${esc(c.name)}</b></button>`).join('')}
      <button type="button" role="radio" aria-checked="${cur.key === 'custom'}" class="cw${cur.key === 'custom' ? ' on' : ''}" data-cw="custom" style="${swatch(colorsOf({ ...look, colorway: 'custom' }))}">${logo('cw-logo', CONFIG.SITE_NAME)}<span class="cw-bar"><i></i><i></i><i></i></span><b>Custom</b></button>
    </div>
    <div class="card form cw-custom" id="custom" ${cur.key === 'custom' ? '' : 'hidden'}>
      <h3>Custom colors</h3>
      <div class="cw-pickers">
        <label>Team color <span class="hint">sidebar and banner; pick something dark</span><input type="color" data-k="brand" value="${cur.brand}"></label>
        <label>Stripe color <span class="hint">trim and highlights; pick something bright</span><input type="color" data-k="trim" value="${cur.trim}"></label>
        <label>Links and charts, light mode<input type="color" data-k="accentL" value="${cur.accentL}"></label>
        <label>Links and charts, dark mode<input type="color" data-k="accentD" value="${cur.accentD}"></label>
      </div>
    </div>
    <h2>Light or dark</h2>
    <div class="seg" role="radiogroup" aria-label="Light or dark">${[['auto', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([k, t]) => `<button type="button" role="radio" aria-checked="${theme === k}" class="${theme === k ? 'on' : ''}" data-theme="${k}">${t}</button>`).join('')}</div>
    <div class="grid g2" style="margin-top:22px">
      <form class="card form" id="nameForm"><h3>League name</h3>
        <label>Shown in the sidebar, the crest and page titles<input type="text" id="lname" maxlength="40" value="${esc(leagueName(key, latest.name))}" placeholder="${esc((latest.name || '').trim())}"></label>
        <p><button class="btn primary" type="submit">Save name</button> <button class="btn subtle" type="button" id="lreset">Use the Sleeper name</button></p></form>
      <div class="card form"><h3>Your team</h3>
        <label>Highlight my team in tables and charts<select id="mine"><option value="">Nobody, I'm just looking</option>${managers.map(m => `<option value="${esc(m.id)}" ${m.id === mine ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        <p class="hint">Signed-in members get their own team automatically.</p></div>
    </div>
    <h2>Share with your league</h2>
    <div class="card"><p>This link opens the site on <b>${esc(CONFIG.SITE_NAME)}</b> in your colorway:</p>
      <p class="sharebox"><input type="text" id="share" readonly aria-label="Share link"> <button class="btn" type="button" id="copy">Copy link</button></p>
      <p class="muted small">League names and "your team" aren't in the link; each person sets their own.</p></div>
    <h2>Another league</h2>
    <div class="card"><p>Looking at the wrong league, or want to check a different one?</p><p><button class="btn" type="button" id="switch">Switch league</button></p></div>`;

  const share = el.querySelector('#share');
  const setShare = () => { share.value = `${location.origin}${location.pathname}?league=${encodeURIComponent(CONFIG.ROOT_LEAGUE_ID)}&look=${encodeURIComponent(lookParam())}`; };
  setShare();
  const redraw = () => lookPage(model, _, el);
  el.querySelectorAll('[data-cw]').forEach(b => b.onclick = () => {
    const k = b.dataset.cw;
    if (k === 'custom' && !getLook().custom) { const c = colorsOf(); setLook({ custom: { brand: c.brand, trim: c.trim, accentL: c.accentL, accentD: c.accentD } }); }
    setLook({ colorway: k }); applyLook(); redraw();
  });
  el.querySelectorAll('#custom input[type=color]').forEach(inp => inp.oninput = () => {
    setLook({ colorway: 'custom', custom: { ...colorsOf(), ...(getLook().custom || {}), [inp.dataset.k]: inp.value } });
    applyLook(); setShare();
  });
  el.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => { setTheme(b.dataset.theme); redraw(); });
  el.querySelector('#nameForm').onsubmit = e => {
    e.preventDefault();
    setLeagueName(key, el.querySelector('#lname').value.trim());
    CONFIG.SITE_NAME = leagueName(key, latest.name); refreshBrand(); redraw(); toast('<b>Saved.</b>', 2500);
  };
  el.querySelector('#lreset').onclick = () => { setLeagueName(key, ''); CONFIG.SITE_NAME = leagueName(key, latest.name); refreshBrand(); redraw(); };
  el.querySelector('#mine').onchange = e => { setMyOwner(key, e.target.value); toast('<b>Saved.</b> Your team is highlighted from now on.', 3000); };
  el.querySelector('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(share.value); toast('<b>Link copied.</b> Paste it in the group chat.', 3000); }
    catch { share.select(); }
  };
  el.querySelector('#switch').onclick = switchLeague;
}
