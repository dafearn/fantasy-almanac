import { esc } from '../ui.js';
import { SERVER, apiGet, apiPost, refreshMe, isCommish, lp } from '../server.js';
import { CONFIG } from '../config.js';
import { personaOf } from '../persona.js';

export function serverNeeded(el, what) {
  // A server is running but hosts other leagues: say how to get the clubhouse for this one.
  if (SERVER.api) {
    el.insertAdjacentHTML('beforeend', `<div class="card"><p><b>${esc(what)} isn't switched on for this league.</b> Everything else on the site works for any Sleeper league, but the clubhouse (accounts, pick'em, the trade block and the AI) only runs for leagues the host has added.</p><p class="muted">Ask whoever runs this site to add league <code>${esc(CONFIG.ROOT_LEAGUE_ID || '')}</code> to its <code>LEAGUE_IDS</code> setting, or host your own copy (it's free on Vercel; the README walks through it).</p></div>`);
    return;
  }
  el.insertAdjacentHTML('beforeend', `<div class="card"><p><b>${esc(what)} needs the league server.</b> This copy of the site is running as static files, so there's nowhere to save shared data.</p><p class="muted">Start it with <code>npm start</code> (or <code>node --no-warnings server/server.mjs</code>) instead of <code>serve.py</code>. The README's "Host it for your league" section has the details.</p></div>`);
}

export function account(model, _, el) {
  const P = personaOf(SERVER.persona);
  el.innerHTML = `<h1>Account</h1>`;
  if (!SERVER.available) return serverNeeded(el, 'Signing in');
  if (SERVER.me) {
    const role = SERVER.memberships.find(m => m.league === SERVER.league)?.role;
    el.innerHTML += `<div class="card"><p>Signed in as <b>${esc(SERVER.me.displayName)}</b> (${esc(SERVER.me.username)})${role ? `, ${esc(role)} of ${esc(CONFIG.SITE_NAME)}` : ', visiting this league'}.</p>
      <p class="muted">Jump back in: <a href="#/pickem">make your pick'em picks</a>, <a href="#/block">check the trade block</a> or <a href="#/ask">${esc(P.ask.replace(/^A/, 'a'))}</a>.</p>
      <button class="btn subtle" id="out" type="button">Sign out</button></div>
      ${isCommish() ? `<h2>Commissioner tools</h2><div class="grid g2">
        <div class="card form"><h3>Invite code</h3><p class="muted">Members create accounts with the league invite code. Making a new code stops the old one from working.</p><p><button class="btn" id="inv" type="button">Make a new invite code</button></p><p id="invout" aria-live="polite"></p></div>
        <form class="card form" id="rf"><h3>Reset a member's password</h3><label>Sleeper username<input type="text" id="ru" autocomplete="off" required></label><p><button class="btn" id="rb" type="submit">Reset password</button></p><p id="rout" aria-live="polite"></p></form></div>
        <form class="card form" id="pf"><h3>Manager profiles for ${esc(P.the)}</h3>
          <p class="muted">Tell ${esc(P.the)} who everyone is: pronouns, nicknames, personalities and inside jokes. The AI reads this before every answer and column. It's stored on the server and only you can see or edit it, so the jokes stay in the league.</p>
          <details><summary>What goes in it</summary><ul class="small">
            <li><code>league.pronouns</code>: the default for everyone, like <code>he/him</code>.</li>
            <li><code>league.notes</code>, <code>league.history</code>, <code>league.traditions</code> and <code>league.jokes</code>: the league's vibe, its past seasons, its rituals and its running jokes. <code>league.persona</code> is anything you want ${esc(P.the)} to know about itself, and <code>league.offLimits</code> applies to everyone.</li>
            <li>Under <code>managers</code>, one entry per Sleeper name: <code>name</code> (first name), <code>nickname</code>, <code>pronouns</code> (only if different from the default), <code>personality</code>, and lists for <code>about</code> (job, family, hometown), <code>teams</code> (who they root for), <code>history</code> (league moments), <code>rivals</code>, <code>quotes</code> (catchphrases), <code>jokes</code> and <code>offLimits</code> (topics the AI must never joke about).</li>
            <li>Leave anything blank you don't need. Managers missing from the file just get the defaults.</li></ul></details>
          <label>Profiles (JSON)<textarea id="pfbody" rows="16" spellcheck="false" class="mono" placeholder="Loading…"></textarea></label>
          <p><button class="btn primary" id="pfsave" type="submit">Save profiles</button> <button class="btn subtle" id="pftpl" type="button">Add missing managers</button></p>
          <p id="pfout" class="small" aria-live="polite"></p></form>` : ''}`;
    el.querySelector('#out').onclick = async () => { await apiPost('/api/auth/logout'); await refreshMe(); location.hash = '#/'; location.reload(); };
    if (isCommish()) {
      el.querySelector('#inv').onclick = async () => { try { const r = await apiPost(lp('/invite')); el.querySelector('#invout').innerHTML = `New code: <code>${esc(r.inviteCode)}</code>`; } catch (e) { el.querySelector('#invout').textContent = e.message; } };
      profilesForm(el.querySelector('#pf'));
      el.querySelector('#rf').onsubmit = async e => { e.preventDefault(); try { const r = await apiPost(lp('/reset-account'), { username: el.querySelector('#ru').value }); el.querySelector('#rout').innerHTML = `Temporary password: <code>${esc(r.temporaryPassword)}</code>`; } catch (e) { el.querySelector('#rout').textContent = e.message; } };
    }
    return;
  }
  const pw = (name, auto, extra = '') => `<span class="pwwrap"><input type="password" name="${name}" autocomplete="${auto}" required ${extra}><button type="button" class="linkbtn pwshow" aria-label="Show password">Show</button></span>`;
  el.innerHTML += `<p class="sub">Anyone can browse the site. League members sign in to post on the trade block, make pick'em picks and ${esc(P.ask.replace(/^A/, 'a'))}.</p>
    <p class="muted" id="joined"></p>
    <div class="grid g2">
      <form class="card form" id="login"><h3>Sign in</h3>
        <label>Sleeper username<input type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label>Password${pw('password', 'current-password')}</label>
        <p><button class="btn primary" type="submit">Sign in</button></p><p class="msg" aria-live="polite"></p>
        <p class="hint">Forgot it? The commissioner can reset your password.</p></form>
      <form class="card form" id="reg"><h3>New here? Create your account</h3>
        <label>Sleeper username <span class="hint">the name you use on Sleeper</span><input type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label>Password <span class="hint">8 or more characters</span>${pw('password', 'new-password', 'minlength="8"')}</label>
        <label>League invite code <span class="hint">the commissioner has it</span><input type="text" name="inviteCode" autocapitalize="none" spellcheck="false" required></label>
        <p><button class="btn" type="submit">Create account</button></p><p class="msg" aria-live="polite"></p></form>
    </div>`;
  el.querySelectorAll('.pwshow').forEach(b => b.onclick = () => {
    const i = b.previousElementSibling, show = i.type === 'password';
    i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  // How many managers are already in, as a nudge to join them.
  apiGet(lp('/members')).then(({ members }) => {
    const total = Object.keys(model.seasons[model.seasons.length - 1].teams).length;
    if (members.length) el.querySelector('#joined').innerHTML = `<b>${members.length} of ${total}</b> ${esc(CONFIG.SITE_NAME)} managers have joined so far.`;
  }).catch(() => {});
  const wire = (id, path, extra = {}, hello = 'back') => {
    const f = el.querySelector(id);
    f.onsubmit = async e => {
      e.preventDefault();
      const body = { ...Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, k === 'password' ? v : String(v).trim()])), ...extra };
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true; const label = btn.textContent; btn.textContent = 'One moment…';
      f.querySelector('.msg').textContent = '';
      try {
        await apiPost(path, body); await refreshMe();
        // The server said yes but the browser didn't keep the sign-in cookie (usually an http:// address
        // or blocked cookies). Say so instead of silently landing back on "Visiting".
        if (!SERVER.me) throw new Error(`You're signed in, but this browser didn't keep the sign-in. Make sure the address starts with https:// and that cookies are allowed for ${location.host}, then try again.`);
        try { sessionStorage.setItem('almanac-hello', hello); } catch {}
        location.hash = '#/'; location.reload();
      }
      catch (err) { const m = f.querySelector('.msg'); m.className = 'msg neg'; m.textContent = err.message; btn.disabled = false; btn.textContent = label; }
    };
  };
  wire('#login', '/api/auth/login');
  wire('#reg', '/api/auth/register', { league: SERVER.league }, 'new');
}

// The commissioner's JSON of manager profiles for the AI persona.
async function profilesForm(form) {
  const box = form.querySelector('#pfbody'), out = form.querySelector('#pfout');
  let tpl = null;
  try {
    const r = await apiGet(lp('/profiles'));
    tpl = JSON.parse(r.template);
    box.value = r.profiles || r.template;
    box.placeholder = '';
    out.textContent = r.updatedAt ? `Last saved ${new Date(r.updatedAt).toLocaleString()}.` : 'Not saved yet. This is a starting template with every manager in the league.';
  } catch (e) { out.textContent = `Couldn't load the profiles: ${e.message}`; }
  // Add a blank entry for any manager the current text is missing (new members, a fresh season).
  form.querySelector('#pftpl').onclick = () => {
    if (!tpl) return;
    let cur; try { cur = JSON.parse(box.value || '{}'); } catch (e) { out.textContent = `Fix the JSON first: ${e.message}`; return; }
    cur.league ||= tpl.league; cur.managers ||= {};
    const have = new Set(Object.keys(cur.managers).map(k => k.toLowerCase()));
    let added = 0;
    for (const [k, v] of Object.entries(tpl.managers)) if (!have.has(k.toLowerCase())) { cur.managers[k] = v; added++; }
    box.value = JSON.stringify(cur, null, 2);
    out.textContent = added ? `Added ${added} manager${added === 1 ? '' : 's'}. Save to keep them.` : 'Everyone in the league is already listed.';
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('#pfsave'); btn.disabled = true; out.textContent = 'Saving…';
    try {
      const r = await apiPost(lp('/profiles'), { profiles: box.value });
      out.innerHTML = r.cleared ? 'Cleared. The AI is back to knowing nobody.' : `Saved. The AI will use this from its next answer or column.${r.preview ? `<details><summary>What the AI reads</summary><pre class="copy">${esc(r.preview)}</pre></details>` : ''}`;
    } catch (err) { out.textContent = err.message; }
    btn.disabled = false;
  };
}
