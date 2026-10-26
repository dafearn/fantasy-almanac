// Ask the Commish (or the Bookie): members ask the site's AI persona (Claude) about the league. The page builds a
// plain-text digest of the league from the loaded data and the server forwards it with the question.
import { esc, skeleton } from '../ui.js';
import { personaOf, personaBadge } from '../persona.js';
import { SERVER, apiGet, apiPost, lp } from '../server.js';
import { leagueDigest } from '../ask-context.js';
import { serverNeeded } from './account.js';

const EXAMPLES = [
  "Who's the unluckiest manager in league history?",
  'Who has my number head-to-head?',
  'Rank the best trades of the season',
  'Who needs a win most this week?',
  'Roast the last-place team',
];

// Escape first, then allow **bold** and "- " bullets, the only formatting the prompt asks for.
export function render(text) {
  const blocks = esc(text).split(/\n{2,}/);
  return blocks.map(b => {
    const lines = b.split('\n');
    const bold = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (lines.every(l => /^\s*[-•*] /.test(l))) return `<ul>${lines.map(l => `<li>${bold(l.replace(/^\s*[-•*] /, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(bold).join('<br>')}</p>`;
  }).join('');
}

export async function ask(model, _, el) {
  const P = personaOf(SERVER.persona);
  el.innerHTML = `<div class="persona-head">${personaBadge(P, 'pface')}<div><h1>${esc(P.ask)}</h1>
    <p class="sub">${esc(P.blurb)}</p></div></div>
    <div id="askBody">${skeleton('list', 3)}</div>`;
  const body = el.querySelector('#askBody');
  if (!SERVER.available) { body.innerHTML = ''; serverNeeded(body, P.ask); return; }
  let st;
  try { st = await apiGet(lp('/ask')); } catch (e) { body.innerHTML = `<p class="err card">${esc(e.message)}</p>`; return; }

  const commishBox = st.commissioner ? `<div class="card" style="margin-top:14px"><h3>Commissioner controls</h3>
    <p class="muted">${st.configured ? `Using ${esc(st.model)}. ${st.limit ? `Each member gets ${st.limit} questions a day.` : 'No daily question cap.'}` : 'No Anthropic API key yet: add ANTHROPIC_API_KEY to the server settings (in Vercel: Settings, Environment Variables), then redeploy.'} Spending is capped by the credit you buy at console.anthropic.com.</p>
    <label class="pickopt" style="justify-content:flex-start"><input type="checkbox" id="askOn" ${st.enabled ? 'checked' : ''}> ${esc(P.name)} is taking questions from members</label></div>` : '';

  if (!st.configured || !st.enabled) {
    body.innerHTML = `<div class="card"><p>${!st.configured ? `${esc(P.name)} isn't switched on for this league yet.` : `The commissioner has sent ${esc(P.the)} home for now.`}</p></div>${commishBox}`;
    wireCommish(); return;
  }
  if (!st.member) {
    body.innerHTML = `<div class="callout"><p>${esc(P.name)} only talks to league members. Sign in and ask anything.</p><a class="btn primary" href="#/account">Sign in to ask</a></div>`;
    return;
  }

  const history = [];
  body.innerHTML = `<div class="card ask">
      <div id="askLog" class="asklog"><div class="msg-a">${esc(P.hello)}</div></div>
      <form id="askForm" class="askform"><label class="sr-only" for="askQ">Your question</label><textarea id="askQ" rows="2" maxlength="600" placeholder="Who has the worst luck this season?"></textarea>
      <span class="count" id="askCount" aria-live="polite">0 / 600</span><button class="btn primary" type="submit">Ask</button></form>
      <div class="askchips">${EXAMPLES.map(x => `<button type="button" class="pill">${esc(x)}</button>`).join('')}</div>
      <div class="muted small" id="askLeft">${st.limit ? `${st.limit - st.used} of ${st.limit} questions left today` : ''}</div>
    </div>${commishBox}`;
  wireCommish();
  const log = body.querySelector('#askLog'), form = body.querySelector('#askForm'), q = body.querySelector('#askQ'), left = body.querySelector('#askLeft');
  let digest = null;
  body.querySelectorAll('.askchips button').forEach(b => b.onclick = () => { q.value = b.textContent; q.dispatchEvent(new Event('input')); q.focus(); });
  const count = body.querySelector('#askCount');
  q.addEventListener('input', () => { count.textContent = `${q.value.length} / 600`; count.classList.toggle('near', q.value.length > 540); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = async e => {
    e.preventDefault();
    const question = q.value.trim(); if (!question) return;
    const btn = form.querySelector('button'); btn.disabled = true; q.value = ''; q.dispatchEvent(new Event('input'));
    log.insertAdjacentHTML('beforeend', `<div class="msg-q">${esc(question)}</div><div class="msg-a pending"><span class="thinking"></span> ${esc(P.thinking)}</div>`);
    const pending = log.lastElementChild; pending.scrollIntoView({ block: 'nearest' });
    try {
      digest ||= leagueDigest(model);
      const r = await apiPost(lp('/ask'), { question, context: digest, history });
      history.push({ role: 'user', text: question }, { role: 'assistant', text: r.answer });
      pending.classList.remove('pending'); pending.innerHTML = render(r.answer);
      if (r.limit) left.textContent = `${r.limit - r.used} of ${r.limit} questions left today`;
    } catch (err) {
      pending.classList.remove('pending'); pending.classList.add('err'); pending.textContent = err.message;
    }
    btn.disabled = false; q.focus();
  };

  function wireCommish() {
    const box = body.querySelector('#askOn'); if (!box) return;
    box.onchange = async () => {
      try { await apiPost(lp('/ask/settings'), { enabled: box.checked }); ask(model, _, el); } catch (e) { box.checked = !box.checked; alertInline(e.message); }
    };
  }
  function alertInline(m) { body.insertAdjacentHTML('beforeend', `<p class="err card">${esc(m)}</p>`); }
}
