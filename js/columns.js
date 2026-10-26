// The persona's columns: an AI-written recap of each finished week and a preview of the next one. The site's
// own numbers go in as FACTS (so every stat stays deterministic); the persona adds the storylines. Each column
// is written once, by the first member to open the page, and stored on the server for everyone.
import { esc, skeleton } from './ui.js';
import { SERVER, apiGet, apiPost, lp } from './server.js';
import { leagueDigest } from './ask-context.js';
import { render } from './views/ask.js';
import { personaOf, personaBadge } from './persona.js';

const P = () => personaOf(SERVER.persona);
const LABEL = { recap: () => `${P().name}'s column`, preview: () => `${P().name}'s week ahead` };

/** Fill `el` with the column for this week, writing it first if nobody has yet. */
export async function personaColumn(el, model, { kind, season, week, facts }) {
  if (!SERVER.available || !el) return;
  let st;
  try { st = await apiGet(lp(`/columns?kind=${kind}&season=${encodeURIComponent(season)}&week=${week}`)); } catch { return; }
  if (!document.body.contains(el)) return;
  const shell = (inner, foot = '') => `<article class="card tycol"><div class="tyhead">${personaBadge(P(), 'pface')}<div><div class="tykick">${LABEL[kind]()} · ${esc(season)} week ${week}</div>${inner}</div></div>${foot}</article>`;
  const show = col => {
    const [first, ...rest] = col.body.split('\n');
    const when = new Date(col.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    el.innerHTML = shell(`<h3 class="tyline">${esc(first.replace(/^#+\s*|\*\*/g, ''))}</h3>`,
      `<div class="tybody">${sections(rest.join('\n').trim())}</div><div class="tyfoot muted small"><span>Written by ${esc(P().name)} (AI) on ${esc(when)}. Every number comes from the league data; the opinions are the AI's.</span>${st.commissioner ? '<button type="button" class="linkbtn" id="tyre">Have ${esc(P().the)} rewrite it</button>' : ''}</div>`);
    el.querySelector('#tyre')?.addEventListener('click', () => write(true));
  };
  async function write(rewrite = false) {
    el.innerHTML = shell(`<h3 class="tyline">${esc(P().name)} is writing ${kind === 'recap' ? 'up the week' : 'the preview'}…</h3><p class="muted small"><span class="thinking"></span> Checking the books. This takes about half a minute.</p>`, `<div class="tybody">${skeleton('list', 4)}</div>`);
    try {
      const r = await apiPost(lp('/columns'), { kind, season, week, rewrite, facts: facts(), context: leagueDigest(model) });
      if (document.body.contains(el)) show(r.column);
    } catch (e) {
      el.innerHTML = shell(`<h3 class="tyline">${esc(P().name)} couldn't finish this one</h3><p class="muted">${esc(e.message)}</p>`, '<p><button type="button" class="btn" id="tyagain">Try again</button></p>');
      el.querySelector('#tyagain').onclick = () => write(rewrite);
    }
  }
  if (st.column) return show(st.column);
  if (!st.configured || !st.enabled) return;
  if (st.member) return write();
  el.innerHTML = `<p class="muted small">${P().icon} ${LABEL[kind]()} for week ${week} hasn't been written yet. It appears once a league member opens this page.</p>`;
}

// A line that is only a bold label ("Odds & ends", "This week in league history") starts a closing section.
function sections(text) {
  const marked = text.replace(/^\s*\*\*([^*\n]{2,60})\*\*:?\s*$/gm, '\n\n\u00a7\u00a7$1\n\n');
  return render(marked.replace(/\n{3,}/g, '\n\n').trim()).replace(/<p>\u00a7\u00a7([^<]*)<\/p>/g, '<p class="tysec">$1</p>');
}

// ---------------------------------------------------------------- the persona's takes on the scouting reports
// One call writes a take on every team; each tile on the page gets its own manager's part.

/** Split the persona's "@@ Name" blocks into {lowercased name: text}. */
export function splitTakes(body) {
  const out = {};
  const parts = String(body || '').split(/^@@\s*/m).slice(1);
  for (const p of parts) {
    const [head, ...rest] = p.split('\n');
    const name = head.replace(/\*\*/g, '').replace(/[:\s]+$/, '').trim().toLowerCase();
    const text = rest.join('\n').trim();
    if (name && text) out[name] = text;
  }
  return out;
}

/**
 * Fill each `[data-take="<owner id>"]` slot inside `root` with the persona's take, writing them first if nobody
 * has yet. `bar` shows the byline and, for the commissioner, the rewrite link.
 */
export async function personaTakes(root, bar, model, { season, week, facts }) {
  if (!SERVER.available || !root) return;
  const slots = [...root.querySelectorAll('[data-take]')];
  if (!slots.length) return;
  let st;
  try { st = await apiGet(lp(`/columns?kind=scouting&season=${encodeURIComponent(season)}&week=${week}`)); } catch { return; }
  if (!document.body.contains(root)) return;
  const nameOf = id => (model.managers[id]?.name || '').toLowerCase();
  const head = `<span class="tykick">${personaBadge(P(), 'pface')} ${esc(P().name)}'s take</span>`;
  const show = col => {
    const takes = splitTakes(col.body);
    for (const s of slots) {
      const t = takes[nameOf(s.dataset.take)];
      s.innerHTML = t ? `${head}<div class="tybody">${render(t)}</div>` : '';
      s.hidden = !t;
    }
    const when = new Date(col.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    bar.innerHTML = `<p class="muted small">${P().icon} ${esc(P().name)}'s takes (AI) written ${esc(when)}, through week ${week}. The reports are the site's numbers; the takes are opinions.${st.commissioner ? ` <button type="button" class="linkbtn" id="tyre">Have ${esc(P().the)} rewrite them</button>` : ''}</p>`;
    bar.querySelector('#tyre')?.addEventListener('click', () => write(true));
  };
  async function write(rewrite = false) {
    for (const s of slots) { s.hidden = false; s.innerHTML = `${head}<p class="muted small"><span class="thinking"></span> Reading the report…</p>`; }
    bar.innerHTML = `<p class="muted small">${P().icon} ${esc(P().name)} is reading every report. This takes about half a minute.</p>`;
    try {
      const r = await apiPost(lp('/columns'), { kind: 'scouting', season, week, rewrite, facts: facts(), context: leagueDigest(model) });
      if (document.body.contains(root)) show(r.column);
    } catch (e) {
      for (const s of slots) { s.hidden = true; s.innerHTML = ''; }
      bar.innerHTML = `<p class="muted small">${P().icon} ${esc(P().name)} couldn't finish the takes: ${esc(e.message)} <button type="button" class="linkbtn" id="tyagain">Try again</button></p>`;
      bar.querySelector('#tyagain').onclick = () => write(rewrite);
    }
  }
  if (st.column) return show(st.column);
  if (!st.configured || !st.enabled) return;
  if (st.member) return write();
  bar.innerHTML = `<p class="muted small">${P().icon} ${esc(P().name)} hasn't weighed in on week ${week} yet. The takes appear once a league member opens this page.</p>`;
}
