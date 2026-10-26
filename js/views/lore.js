// Research-driven history pages: schedule luck, All-League teams, trophy room, players.
import { setQuery } from '../app.js';
import { esc, f1, f2, pct, signed, chip, nameOf, table, seasonSelect, record, skeleton } from '../ui.js';
import { scheduleSwap, medianRecords, allLeague, achievements, playerHistory, playerIndex } from '../stats.js';
import { divergingFill } from '../charts.js';
import { pickSeason } from './common.js';

// ---------------------------------------------------------------- Schedule luck
export function scheduleLuck(model, { q }, el) {
  const s = pickSeason(model, q);
  const sw = scheduleSwap(s);
  const med = medianRecords(s);
  const st = s.regStandings;
  const rids = st.map(r => r.rid);
  const rows = st.map(r => {
    const alt = rids.map(b => sw[r.rid][b].w);
    return { ...r, med: med[r.rid], avgW: alt.reduce((a, b) => a + b, 0) / alt.length, bestW: Math.max(...alt), worstW: Math.min(...alt) };
  });
  el.innerHTML = `<h1>Schedule luck</h1>
    <p class="sub">What if you'd played someone else's schedule? Each row is a team; each column is whose schedule it plays. The diagonal is what actually happened. Blue means more wins than real life, gold means fewer.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))}</div>
    <div class="tablewrap"><table class="matrix"><thead><tr><th class="rowh">Team ↓ / schedule →</th>${rids.map(b => `<th>${esc(nameOf(s.owner(b)).slice(0, 10))}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr><th class="rowh">${chip(r.owner)}</th>${rids.map(b => {
      const x = sw[r.rid][b]; const diff = x.w - r.w;
      return `<td style="background:${b === r.rid ? 'var(--surface-2)' : divergingFill(0.5 + diff / 10)}" title="${esc(nameOf(r.owner))} with ${esc(nameOf(s.owner(b)))}'s schedule: ${x.w}-${x.l}">${b === r.rid ? `<b>${x.w}-${x.l}</b>` : `${x.w}-${x.l}`}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>
    <h2>Summary</h2><div id="t"></div>`;
  table(el.querySelector('#t'), [
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'w', label: 'Actual', num: true, fmt: record },
    { key: 'avgW', label: 'Avg wins, all schedules', num: true, fmt: r => f1(r.avgW) },
    { key: 'range', label: 'Range', num: true, sort: r => r.bestW - r.worstW, fmt: r => `${r.worstW}–${r.bestW}` },
    { key: 'sched', label: 'Schedule luck', num: true, sort: r => r.w - r.avgW, fmt: r => signed(r.w - r.avgW), cls: r => (r.w - r.avgW > 0.5 ? 'pos' : r.w - r.avgW < -0.5 ? 'neg' : '') },
    { key: 'med', label: 'Vs. weekly median', num: true, sort: r => r.med.w, fmt: r => `${r.med.w}-${r.med.l}` },
    { key: 'combo', label: 'With median games', num: true, sort: r => r.w + r.med.w, fmt: r => `${r.w + r.med.w}-${r.l + r.med.l}` },
  ], rows, { sortKey: 'sched' });
}

// ---------------------------------------------------------------- All-League teams
export function allLeaguePage(model, { q }, el) {
  const all = q.season === 'all';
  const s = all ? { season: null, rosterPositions: model.seasons[model.seasons.length - 1].rosterPositions } : pickSeason(model, q);
  const al = allLeague(model, s);
  const cell = (r, when) => (r ? `${esc(model.nameOf(r.id))} <b>${f1(r.pts)}</b><div class="muted" style="font-size:12px">${esc(nameOf(r.owner))}${when ? ` · ${r.season} W${r.week}` : ''}</div>` : '–');
  const slots = al.seasonTeam.map(r => r.slot);
  const at = (list, i) => list.filter(r => r.slot === slots[i])[slots.slice(0, i).filter(x => x === slots[i]).length];
  el.innerHTML = `<h1>All-League teams</h1><p class="sub">The best lineup the league fielded, slot by slot, and the Bush League: the worst performances anyone actually started. Regular season only.</p>
    <div class="toolbar">${seasonSelect(model, all ? 'all' : s.season, v => setQuery({ season: v }), { includeAll: true })}</div>
    <div class="tablewrap"><table><thead><tr><th>Slot</th><th>${all ? 'All-time All-League' : `${s.season} All-League`}<div class="muted" style="font-weight:400">most started points</div></th><th>Best single game</th><th>Bush League<div class="muted" style="font-weight:400">worst non-zero start</div></th></tr></thead><tbody>
    ${slots.map((sl, i) => `<tr><td><span class="pill">${esc(sl)}</span></td><td>${cell(at(al.seasonTeam, i))}</td><td>${cell(at(al.best, i), true)}</td><td>${cell(at(al.worst, i), true)}</td></tr>`).join('')}
    </tbody></table></div>
    ${al.zeros.length ? `<h2>Started a zero</h2><p class="sub">Starters who put up exactly 0, usually a bye or an injury nobody swapped out.</p><div id="z"></div>` : ''}`;
  if (al.zeros.length) table(el.querySelector('#z'), [
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'n', label: 'Zeros started', num: true },
  ], al.zeros, { sortKey: 'n' });
}

// ---------------------------------------------------------------- Trophy room
export async function trophies(model, _, el) {
  el.innerHTML = `<h1>Trophy room</h1>${skeleton('cards', 6)}`;
  const ach = achievements(model);
  const order = Object.entries(ach).map(([owner, list]) => ({ owner, list, champs: list.find(x => x.key === 'champ')?.count || 0, total: list.reduce((t, x) => t + x.count, 0) }))
    .sort((a, b) => b.champs - a.champs || b.total - a.total);
  const ORDER = ['champ', 'runner', 'regcrown', 'pfking', 'berth', 'topweek', 'blowout', '150', 'perfect', 'streak', 'escape', 'stolen', 'steady', 'baron', 'hawk', 'lucky', 'cakewalk', 'coaster', 'gauntlet', 'cursed', 'robbed', 'heartbreak', 'benched', 'skid', 'sub60', 'pooper', 'last'];
  const short = b => b.title.replace(/ \(.*\)$/, '');
  const why = b => { const w = (b.title.match(/\((.*)\)$/) || [])[1] || ''; return w && w[0].toUpperCase() + w.slice(1); };
  el.innerHTML = `<h1>Trophy room</h1><p class="sub">Every manager's cabinet: titles, crowns and the badges nobody wants. Hover or tap a badge for when it happened; the guide below says what each one means.</p>
    <div class="grid g3">${order.map(o => `<div class="card"><div style="margin-bottom:8px">${chip(o.owner)}</div><div class="badges">${o.list.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)).map(b => `<span class="badge" tabindex="0" title="${esc(b.title)}: ${esc(b.details.join(', '))}">${b.icon} ${esc(short(b))}${b.count > 1 ? ` <b>×${b.count}</b>` : ''}</span>`).join('')}</div></div>`).join('')}</div>
    <h2>Badge guide</h2><div id="guide"></div>`;
  const kinds = {};
  for (const o of order) for (const b of o.list) {
    const k = kinds[b.key] ||= { key: b.key, icon: b.icon, title: b.title, total: 0, best: [] };
    k.total += b.count;
    if (!k.best.length || b.count > k.best[0].count) k.best = [{ owner: o.owner, count: b.count }];
    else if (b.count === k.best[0].count) k.best.push({ owner: o.owner, count: b.count });
  }
  table(el.querySelector('#guide'), [
    { key: 'title', label: 'Badge', sort: r => ORDER.indexOf(r.key), fmt: r => `<span class="badge">${r.icon} ${esc(short(r))}</span>` },
    { key: 'why', label: 'Earned by', sort: r => why(r), fmt: r => esc(why(r) || DEFAULT_WHY[r.key] || '') },
    { key: 'leader', label: 'Most', sort: r => r.best[0]?.count || 0, fmt: r => `${r.best.slice(0, 3).map(x => chip(x.owner)).join(' ')} <span class="muted">×${r.best[0]?.count}</span>` },
    { key: 'total', label: 'Times earned', num: true },
  ], Object.values(kinds), { sortKey: 'title', desc: false });
}

const DEFAULT_WHY = {
  champ: 'Winning the title', runner: 'Losing the final', regcrown: 'Best regular-season record', pfking: 'Most regular-season points',
  berth: 'Making the playoffs', topweek: 'Highest score of a regular-season week', pooper: 'Lowest score of a regular-season week',
  perfect: 'Starting the best possible lineup', last: 'Finishing last in the regular season',
  '150': 'Scoring 150 or more', sub60: 'Scoring under 60', streak: 'Winning 5 or more in a row', skid: 'Losing 5 or more in a row',
};

// ---------------------------------------------------------------- Players
export function players(model, { parts, q }, el) {
  if (parts[0]) return playerPage(model, parts[0], el);
  const idx = playerIndex(model);
  const term = (q.q || '').toLowerCase();
  const rows = idx.filter(p => !term || model.nameOf(p.id).toLowerCase().includes(term)).sort((a, b) => b.pts - a.pts).slice(0, term ? 100 : 50);
  el.innerHTML = `<h1>Players</h1><p class="sub">Every player who has been on a roster in this league: league points, how often he was started, and how many managers have owned him.</p>
    <div class="toolbar"><input type="text" id="s" placeholder="Search players" value="${esc(q.q || '')}"></div><div id="t"></div>`;
  const inp = el.querySelector('#s');
  inp.onchange = () => setQuery({ q: inp.value || null });
  table(el.querySelector('#t'), [
    { key: 'id', label: 'Player', fmt: r => `<a href="#/players/${encodeURIComponent(r.id)}">${esc(model.nameOf(r.id))}</a> <span class="muted">${esc(model.posOf(r.id))}</span>`, sort: r => model.nameOf(r.id) },
    { key: 'pts', label: 'League pts', num: true, fmt: r => f1(r.pts) },
    { key: 'started', label: 'Started pts', num: true, fmt: r => f1(r.started) },
    { key: 'weeks', label: 'Weeks rostered', num: true },
    { key: 'managers', label: 'Managers', num: true, fmt: r => `${r.managers}${r.managers >= 4 ? ' 🧳' : ''}` },
  ], rows, { sortKey: 'pts' });
}

function playerPage(model, id, el) {
  const hist = playerHistory(model, id);
  const p = model.players[id];
  el.innerHTML = `<p><a href="#/players">← All players</a></p><h1>${esc(model.nameOf(id))}</h1><p class="sub">${esc(p?.p || model.posOf(id))}${p?.t ? ` · ${esc(p.t)}` : ''}</p>
    ${hist.length ? hist.slice().reverse().map(h => `<h2>${h.season}</h2>
      ${h.pick ? `<p>Drafted in round ${h.pick.round} (pick ${h.pick.pickNo}) by ${chip(h.pick.ownerId)}.</p>` : ''}
      ${h.moves.length ? `<p>${h.moves.map(m => `Week ${m.week}: ${m.type === 'trade' ? 'traded' : m.to ? 'added' : 'dropped'}${m.to ? ` to ${esc(nameOf(m.to))}` : ''}${m.from ? ` from ${esc(nameOf(m.from))}` : ''}${m.bid ? ` ($${m.bid})` : ''}`).join(' · ')}</p>` : ''}
      <div class="tablewrap"><table><thead><tr><th>Manager</th><th class="num">Weeks</th><th class="num">Starts</th><th class="num">Pts</th><th class="num">Started pts</th></tr></thead><tbody>${h.owners.sort((a, b) => b.weeks - a.weeks).map(o => `<tr><td>${chip(o.owner)}</td><td class="num">${o.weeks}</td><td class="num">${o.starts}</td><td class="num">${f1(o.pts)}</td><td class="num">${f1(o.startedPts)}</td></tr>`).join('')}</tbody></table></div>`).join('') : '<p class="muted">Never rostered in this league.</p>'}`;
}
