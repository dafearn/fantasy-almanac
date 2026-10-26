// Small rendering helpers shared by every page.
import { SERVER } from './server.js';
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const f2 = x => (x == null || Number.isNaN(x) ? '–' : Number(x).toFixed(2));
export const f1 = x => (x == null || Number.isNaN(x) ? '–' : Number(x).toFixed(1));
export const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(d)}%`);
export const signed = (x, d = 1) => (x > 0 ? '+' : '') + Number(x).toFixed(d);
export const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export const record = r => `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`;

let MODEL = null;
export function setModel(m) { MODEL = m; }

export function initials(name) { return (name || '?').split(/\s+|_/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join(''); }

/** Manager chip with avatar, linking to the profile. `team` optionally shows the team name. */
export function chip(owner, { team, link = true } = {}) {
  const m = MODEL?.managers[owner];
  const name = m?.name || 'Unknown';
  const av = m?.avatar ? `<img src="${esc(m.avatar)}" alt="" loading="lazy">` : `<span class="av">${esc(initials(name))}</span>`;
  // Skip the team name when it only repeats the manager's name ("Bob" / "Bob's Team").
  const plain = t => String(t || '').toLowerCase().replace(/['’]s team$/, '').trim();
  const showTeam = team && plain(team) !== name.toLowerCase();
  const inner = `${av}<span>${esc(name)}${showTeam ? ` <span class="team">${esc(team)}</span>` : ''}</span>`;
  return link ? `<a class="chip" href="#/managers/${encodeURIComponent(owner)}">${inner}</a>` : `<span class="chip">${inner}</span>`;
}
export const nameOf = owner => MODEL?.managers[owner]?.name || 'Unknown';

/**
 * Sortable table. cols: [{key, label, num?, fmt?(row)->html, sort?(row)->value, cls?, strong?, extra?}]
 * Clicking a header sorts by it. `strong` columns carry the number that matters most; `extra` columns
 * stay hidden behind a "More columns" toggle so wide tables open with the essentials. The signed-in
 * manager's row is highlighted.
 */
export function table(el, cols, rows, { sortKey, desc = true, rowClass } = {}) {
  let key = sortKey, dir = desc ? -1 : 1;
  const nExtra = cols.filter(c => c.extra).length;
  let all = false; try { all = localStorage.getItem('almanac-allcols') === '1'; } catch {}
  const me = SERVER.me?.sleeperUserId;
  const render = () => {
    const shown = all ? cols : cols.filter(c => !c.extra);
    const col = cols.find(c => c.key === key);
    const sorted = col ? [...rows].sort((a, b) => {
      const va = col.sort ? col.sort(a) : a[col.key], vb = col.sort ? col.sort(b) : b[col.key];
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    }) : rows;
    const toggle = nExtra ? `<div class="tabletools"><button type="button" class="linkbtn colstoggle" aria-pressed="${all}">${all ? 'Fewer columns' : `More columns (${nExtra})`}</button></div>` : '';
    el.innerHTML = `${toggle}<div class="tablewrap"><table><thead><tr>${shown.map(c => `<th class="sortable ${c.num ? 'num' : ''} ${c.strong ? 'key' : ''}" data-k="${c.key}" aria-sort="${c.key === key ? (dir < 0 ? 'descending' : 'ascending') : 'none'}">${esc(c.label)}${c.key === key ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead><tbody>${
      sorted.map((r, i) => `<tr class="${rowClass ? rowClass(r, i, sorted) : ''}${me && r.owner === me ? ' me' : ''}">${shown.map(c => `<td class="${c.num ? 'num' : ''} ${c.strong ? 'key' : ''} ${c.cls ? c.cls(r) : ''}">${c.fmt ? c.fmt(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
    }</tbody></table></div>`;
    el.querySelector('.colstoggle')?.addEventListener('click', () => { all = !all; try { localStorage.setItem('almanac-allcols', all ? '1' : '0'); } catch {} render(); });
    el.querySelectorAll('th.sortable').forEach(th => th.onclick = () => {
      if (key === th.dataset.k) dir = -dir; else { key = th.dataset.k; dir = cols.find(c => c.key === key).num ? -1 : 1; }
      render();
    });
  };
  render();
}

export function tile(label, value, note = '') {
  return `<div class="card tile"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;
}

export function seasonSelect(model, current, onChange, { includeAll = false } = {}) {
  const opts = [...(includeAll ? ['all'] : []), ...model.seasons.map(s => s.season).reverse()];
  const id = 'sel' + Math.random().toString(36).slice(2, 7);
  setTimeout(() => { const el = document.getElementById(id); if (el) el.onchange = () => onChange(el.value); });
  return `<select id="${id}" aria-label="Season">${opts.map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${o === 'all' ? 'All seasons' : o}</option>`).join('')}</select>`;
}

export function weekSelect(s, current, onChange, maxWeek) {
  const id = 'wk' + Math.random().toString(36).slice(2, 7);
  setTimeout(() => { const el = document.getElementById(id); if (el) el.onchange = () => onChange(Number(el.value)); });
  const weeks = []; for (let w = 1; w <= maxWeek; w++) weeks.push(w);
  return `<select id="${id}" aria-label="Week">${weeks.map(w => `<option value="${w}" ${w === current ? 'selected' : ''}>${w >= s.playoffStart ? `Week ${w} (playoffs)` : `Week ${w}`}</option>`).join('')}</select>`;
}

export function posClass(pos) { return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pos) ? `pos-${pos}` : 'pos-other'; }

/** A friendly empty state: an icon, a short title, a line of help and an optional next step. */
export function empty(icon, title, text = '', action = '') {
  return `<div class="empty"><div class="ic" aria-hidden="true">${icon}</div><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
}

/** Placeholder blocks shaped like the content that is on its way. */
export function skeleton(kind = 'list', n = 3) {
  if (kind === 'cards') return `<div class="skelgrid" aria-hidden="true">${'<div class="skel card-sk"></div>'.repeat(n)}</div><p class="sr-only">Loading…</p>`;
  return `<div class="skelstack" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<div class="skel row-sk" style="width:${92 - (i % 3) * 14}%"></div>`).join('')}</div><p class="sr-only">Loading…</p>`;
}

/** A progress bar with its label: "4 of 6 picked". */
export function progress(done, total, label, doneLabel) {
  const p = total ? Math.round((done / total) * 100) : 0;
  const finished = total && done >= total;
  return `<div class="progress-wrap ${finished ? 'done' : ''}"><div class="prog-head"><span>${finished && doneLabel ? doneLabel : label}</span><b>${done} of ${total}</b></div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${p}%"></i></div></div>`;
}

/** A short message that slides in at the bottom of the screen and leaves on its own. */
export function toast(html, ms = 5000) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html;
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

/** A small count on a sidebar link, e.g. picks still to make. 0 removes it. */
export function setNavBadge(route, n, title = '') {
  const a = document.querySelector(`nav.side a[href="#/${route}"]`); if (!a) return;
  a.querySelector('.navbadge')?.remove();
  if (n > 0) a.insertAdjacentHTML('beforeend', `<span class="navbadge" title="${esc(title)}">${n}</span>`);
}
