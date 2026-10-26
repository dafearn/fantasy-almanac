// Trading cards: every manager's binder of player cards, earned from roster history (rules in js/cards.js).
// Cards tilt and shine under the pointer, open into a flippable inspector, and new pulls arrive as a pack.
import { esc, f1, chip, nameOf, posClass, empty, tile } from '../ui.js';
import { setQuery } from '../app.js';
import { SERVER } from '../server.js';
import { cardCatalog, collectors, cardImage, RARITIES, RARITY, POSITIONS, CAPS } from '../cards.js';
import { sortedManagers } from './common.js';
import { monogram } from '../logo.js';

const SEEN_KEY = owner => `almanac-cards-seen-${owner}`;
const GEM = { legendary: '✦', epic: '◆', rare: '●', uncommon: '▲', common: '■' };
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

function readSeen(owner) { try { const v = localStorage.getItem(SEEN_KEY(owner)); return v ? new Set(JSON.parse(v)) : null; } catch { return null; } }
function writeSeen(owner, keys) { try { localStorage.setItem(SEEN_KEY(owner), JSON.stringify([...keys])); } catch {} }

function heldBy(card) {
  const names = card.printings.map(x => esc(nameOf(x.owner)));
  return names.length ? `Held by ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : 'Nobody has this one';
}

/** The front of a card. `p` is the holder's printing, or null for a card they don't have (a checklist slot). */
export function cardFront(model, card, p, { big = false } = {}) {
  const name = model.nameOf(card.pid);
  const r = RARITY[card.rarity];
  if (!p) return `<div class="tcard missing ${posClass(card.pos)}" data-key="${esc(card.key)}" role="listitem" aria-label="${esc(name)}, not collected">
    <div class="tc-in"><div class="tc-art"><img src="${cardImage(card.pid, card.pos)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><span class="tc-mono">${esc(initials(name))}</span><span class="tc-lock">Not collected</span></div>
      <div class="tc-mname">${esc(name)}</div><div class="tc-mmeta"><span class="gem-${card.rarity}">${GEM[card.rarity]}</span> ${r.label} · ${esc(card.pos)}${card.rank}</div>
      <div class="tc-held">${heldBy(card)}</div></div></div>`;
  const team = model.players[card.pid]?.t;
  return `<button type="button" class="tcard r-${card.rarity} ${posClass(card.pos)}${p.champion ? ' champ' : ''}${big ? ' big' : ''}" data-key="${esc(card.key)}" aria-label="${esc(name)}, ${card.season} ${r.label} ${card.pos}${card.rank}">
    <div class="tc-in">
      <div class="tc-top"><span class="tc-name">${esc(name)}</span><span class="tc-gem" title="${r.label}">${GEM[card.rarity]}</span></div>
      <div class="tc-art"><img src="${cardImage(card.pid, card.pos)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><span class="tc-mono">${esc(initials(name))}</span>
        <span class="tc-stamp">${esc(p.short)}</span>${p.champion ? '<span class="tc-champ" title="Started in the championship win">🏆 Champion</span>' : ''}</div>
      <div class="tc-type"><span class="pb ${posClass(card.pos)}">${esc(card.pos)}</span> <b>${esc(card.pos)}${card.rank}</b> in ${esc(card.season)}${team && card.pos !== 'DEF' ? ` <span class="tc-team">${esc(team)}</span>` : ''}</div>
      <div class="tc-stats"><div><b>${f1(card.pts)}</b><span>PTS</span></div><div><b>${f1(card.ppg)}</b><span>PPG</span></div><div><b>${p.starts}</b><span>STARTS</span></div></div>
      <div class="tc-flavor">${p.starts ? `${f1(p.startedPts)} points started for ${esc(nameOf(p.owner))}${p.best ? `, best week ${f1(p.best)}` : ''}.` : `Rode ${esc(nameOf(p.owner))}'s bench for ${p.weeks} week${p.weeks === 1 ? '' : 's'}.`}</div>
      <div class="tc-foot"><span>${esc(card.season)} Series${card.inProgress ? '*' : ''}</span><span>${r.label}</span><span>No. ${p.no}/${p.of}</span></div>
    </div><span class="tc-shine" aria-hidden="true"></span></button>`;
}

function cardBack(model, card, p) {
  const name = model.nameOf(card.pid), r = RARITY[card.rarity];
  const others = cardCatalog(model).sets.flatMap(st => st.cards).filter(c => c.pid === card.pid && c !== card);
  return `<div class="tcard back r-${card.rarity} ${posClass(card.pos)}"><div class="tc-in">
    <div class="tc-top"><span class="tc-name">${esc(name)}</span><span class="tc-gem">${GEM[card.rarity]}</span></div>
    <dl class="tc-dl">
      <dt>Season</dt><dd>${esc(card.season)}${card.inProgress ? ' (in progress)' : ''}</dd>
      <dt>Finish</dt><dd>${esc(card.pos)}${card.rank} of the ${CAPS[card.pos]} in the set</dd>
      <dt>League points</dt><dd>${f1(card.pts)} over ${card.games} week${card.games === 1 ? '' : 's'} (${f1(card.ppg)} a week)</dd>
      <dt>Rarity</dt><dd>${r.label}${p.champion ? ', champion foil' : ''} · worth ${p.score} point${p.score === 1 ? '' : 's'}</dd>
      <dt>Got him</dt><dd>${esc(p.label)}</dd>
      <dt>With ${esc(nameOf(p.owner))}</dt><dd>${p.weeks} week${p.weeks === 1 ? '' : 's'} on the roster, ${p.starts} start${p.starts === 1 ? '' : 's'}, ${f1(p.startedPts)} points started</dd>
      ${p.best > 0 ? `<dt>Best start</dt><dd>${f1(p.best)} points</dd>` : ''}
      <dt>Printing</dt><dd>No. ${p.no} of ${p.of}: ${card.printings.map(x => esc(nameOf(x.owner))).join(', ')}</dd>
      ${others.length ? `<dt>Other sets</dt><dd>${others.map(c => `${esc(c.season)} ${RARITY[c.rarity].label} (${esc(c.pos)}${c.rank})`).join(', ')}</dd>` : ''}
    </dl>
    <div class="tc-foot"><span>${esc(card.season)} Series</span><span><a href="#/players/${encodeURIComponent(card.pid)}">Player page →</a></span></div>
  </div></div>`;
}

export function tradingCards(model, { q }, el) {
  const { sets, byOwner } = cardCatalog(model);
  const board = collectors(model);
  const meId = SERVER.me?.sleeperUserId && model.managers[SERVER.me.sleeperUserId] ? SERVER.me.sleeperUserId : null;
  const owner = q.m && model.managers[q.m] ? q.m : meId || board[0]?.owner;
  const season = q.season && sets.some(s => String(s.season) === q.season) ? q.season : 'all';
  const pos = POSITIONS.includes(q.pos) ? q.pos : 'all';
  const rar = RARITY[q.rarity] ? q.rarity : 'all';
  const sort = ['rarity', 'rank', 'pts', 'newest'].includes(q.sort) ? q.sort : 'rarity';
  const showMissing = q.missing === '1' && season !== 'all';

  if (!sets.length) { el.innerHTML = `<h1>Trading cards</h1>${empty('🃏', 'No cards printed yet', 'The first set prints once week 1 of a season is final.')}`; return; }

  const mine = (byOwner[owner] || []);
  const me = board.find(b => b.owner === owner);
  const setFor = s => sets.find(x => String(x.season) === String(s));
  const inScope = ({ card }) => (season === 'all' || String(card.season) === season) && (pos === 'all' || card.pos === pos) && (rar === 'all' || card.rarity === rar);
  let items = mine.filter(inScope);
  const sorters = {
    rarity: (a, b) => RARITY[a.card.rarity].order - RARITY[b.card.rarity].order || b.p.champion - a.p.champion || a.card.rank - b.card.rank,
    rank: (a, b) => a.card.rank - b.card.rank || RARITY[a.card.rarity].order - RARITY[b.card.rarity].order,
    pts: (a, b) => b.card.pts - a.card.pts,
    newest: (a, b) => Number(b.card.season) - Number(a.card.season) || b.p.first - a.p.first,
  };
  items.sort(sorters[sort]);
  // Checklist mode: the whole set for one season, with the gaps showing.
  let slots = items.map(x => ({ card: x.card, p: x.p }));
  if (showMissing) {
    const have = new Map(items.map(x => [x.card.key, x.p]));
    slots = setFor(season).cards.filter(c => (pos === 'all' || c.pos === pos) && (rar === 'all' || c.rarity === rar)).map(c => ({ card: c, p: have.get(c.key) || null }));
  }
  const setSize = season === 'all' ? sets.reduce((t, s) => t + s.cards.length, 0) : setFor(season).cards.length;
  const ownedInSeason = season === 'all' ? mine.length : mine.filter(x => String(x.card.season) === season).length;
  const top = [...mine].sort(sorters.rarity)[0];

  const seg = (key, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-q="${key}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  el.innerHTML = `<h1>Trading cards</h1>
    <p class="sub">Every season prints a set of its best players at each position. Have a player on your roster in any week and his card for that season is yours, stamped with how you got him. Rarity comes from where he finished; the champion's starters from the title game get a gold foil.</p>
    <div id="pack"></div>
    <div class="toolbar">
      <label class="inl">Binder <select id="cm">${sortedManagers(model).filter(m => byOwner[m.id]).map(m => `<option value="${esc(m.id)}" ${m.id === owner ? 'selected' : ''}>${esc(m.name)}${m.id === meId ? ' (you)' : ''}</option>`).join('')}</select></label>
      ${seg('season', season, [['all', 'All sets'], ...sets.map(s => [s.season, `${s.season}${s.inProgress ? '*' : ''}`])])}
    </div>
    <div class="toolbar">
      ${seg('pos', pos, [['all', 'All'], ...POSITIONS.map(p => [p, p])])}
      <label class="inl">Rarity <select id="cr"><option value="all">Any</option>${RARITIES.map(r => `<option value="${r.key}" ${rar === r.key ? 'selected' : ''}>${GEM[r.key]} ${r.label}</option>`).join('')}</select></label>
      <label class="inl">Sort <select id="cs">${[['rarity', 'Rarity'], ['rank', 'Finish'], ['pts', 'Points'], ['newest', 'Newest']].map(([v, l]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${season !== 'all' ? `<label class="pickopt inl"><input type="checkbox" id="cmiss" ${showMissing ? 'checked' : ''}> Show cards I'm missing</label>` : ''}
    </div>
    <div class="grid g4 ctiles">
      ${tile('Cards', `${ownedInSeason}<span class="muted small"> / ${setSize}</span>`, season === 'all' ? 'across every set' : `of the ${season} set`)}
      ${tile('Collection score', me ? me.score : 0, me ? `${me.rank}${['st', 'nd', 'rd'][me.rank - 1] || 'th'} of ${board.length} collectors` : '')}
      ${tile('Legendaries', me ? me.counts.legendary : 0, me ? `${me.counts.epic} epic · ${me.counts.rare} rare` : '')}
      ${tile('Prize card', top ? esc(model.nameOf(top.card.pid)) : '–', top ? `${top.card.season} ${RARITY[top.card.rarity].label} ${top.card.pos}${top.card.rank}` : '')}
    </div>
    ${slots.length ? `<div class="binder" role="list" id="binder">${slots.map(x => cardFront(model, x.card, x.p)).join('')}</div>`
      : empty('🃏', 'No cards match', `${esc(nameOf(owner))} doesn't have any cards with these filters.`)}
    ${season !== 'all' && setFor(season).inProgress ? '<p class="muted small">* This set is still being printed: rarities can move until the regular season ends.</p>' : ''}
    <h2>Top collectors</h2><div class="card"><ol class="collectors">${board.map(b => `<li class="${b.owner === owner ? 'on' : ''}"><span class="cl-rank">${b.rank}</span>${chip(b.owner)}
      <span class="cl-gems">${RARITIES.map(r => `<span class="cl-g r-${r.key}" title="${r.label}">${GEM[r.key]} ${b.counts[r.key]}</span>`).join('')}</span>
      <span class="cl-score"><b>${b.score}</b> <span class="muted small">${b.count} cards</span></span>
      <button type="button" class="linkbtn" data-m="${esc(b.owner)}">Open binder</button></li>`).join('')}</ol>
      <details class="small muted"><summary>How cards and scores work</summary><ul>
        <li>The set for each season: the top ${Object.entries(CAPS).map(([p, n]) => `${n} ${p}`).join(', ')} by points scored on league rosters in the regular season.</li>
        <li>Legendary is the No. 1 at each position. Epic, Rare, Uncommon and Common follow by finish (RB and WR: 2–5, 6–15, 16–30, 31–50).</li>
        <li>Anyone who had the player on their roster in a final week that season gets a printing, numbered in the order they got him.</li>
        <li>Score: Common 1, Uncommon 2, Rare 4, Epic 8, Legendary 16. A champion foil counts double.</li></ul></details></div>
    <dialog id="inspect" class="inspect" aria-label="Card"></dialog>`;

  // Filters
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => setQuery({ [b.dataset.q]: b.dataset.v === 'all' ? null : b.dataset.v, ...(b.dataset.q === 'season' && b.dataset.v === 'all' ? { missing: null } : {}) }));
  el.querySelector('#cm').onchange = e => setQuery({ m: e.target.value === meId ? null : e.target.value });
  el.querySelector('#cr').onchange = e => setQuery({ rarity: e.target.value === 'all' ? null : e.target.value });
  el.querySelector('#cs').onchange = e => setQuery({ sort: e.target.value === 'rarity' ? null : e.target.value });
  el.querySelector('#cmiss')?.addEventListener('change', e => setQuery({ missing: e.target.checked ? '1' : null }));
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { setQuery({ m: b.dataset.m === meId ? null : b.dataset.m }); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // Tilt and shine follow the pointer (mouse and pen only; touch scrolls).
  const binder = el.querySelector('#binder');
  if (binder) wireTilt(binder);

  // Inspector: a big card that flips to its back.
  const dlg = el.querySelector('#inspect');
  const byKey = new Map(slots.filter(x => x.p).map(x => [x.card.key, x]));
  const order = slots.filter(x => x.p).map(x => x.card.key);
  function open(key) {
    const x = byKey.get(key); if (!x) return;
    dlg.innerHTML = `<div class="flip" id="flip"><div class="face front">${cardFront(model, x.card, x.p, { big: true })}</div><div class="face rear">${cardBack(model, x.card, x.p)}</div></div>
      <div class="inspect-bar"><button type="button" class="btn" id="iprev" aria-label="Previous card">←</button><button type="button" class="btn primary" id="iflip">Flip</button><button type="button" class="btn" id="inext" aria-label="Next card">→</button><button type="button" class="btn subtle" id="iclose">Close</button></div>`;
    const flip = dlg.querySelector('#flip');
    wireTilt(dlg.querySelector('.face.front'));
    dlg.querySelector('#iflip').onclick = () => flip.classList.toggle('flipped');
    dlg.querySelector('.face.front .tcard').onclick = () => flip.classList.toggle('flipped');
    const step = d => { const i = order.indexOf(key); open(order[(i + d + order.length) % order.length]); };
    dlg.querySelector('#iprev').onclick = () => step(-1);
    dlg.querySelector('#inext').onclick = () => step(1);
    dlg.querySelector('#iclose').onclick = () => dlg.close();
    dlg.onkeydown = e => { if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); else if (e.key === ' ' || e.key === 'f') { e.preventDefault(); flip.classList.toggle('flipped'); } };
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('#iflip').focus();
  }
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  binder?.addEventListener('click', e => { const c = e.target.closest('button.tcard'); if (c) open(c.dataset.key); });

  // New cards for the signed-in manager arrive as a pack.
  if (meId && owner === meId) packs(model, el.querySelector('#pack'), meId, byOwner[meId] || []);
}

function wireTilt(root) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.addEventListener('pointermove', e => {
    const c = e.target.closest('.tcard:not(.missing)'); if (!c) return;
    const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    c.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`); c.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    c.style.setProperty('--rx', `${((0.5 - y) * 14).toFixed(2)}deg`); c.style.setProperty('--ry', `${((x - 0.5) * 18).toFixed(2)}deg`);
    c.classList.add('tilt');
  });
  root.addEventListener('pointerout', e => { const c = e.target.closest('.tcard'); if (c && !c.contains(e.relatedTarget)) { c.classList.remove('tilt'); c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); } });
}

// ---------------------------------------------------------------- packs
// Cards you haven't seen yet open like a booster pack. The first visit opens a welcome pack of your five
// best cards; after that, each visit opens whatever you've earned since (up to ten at a time).
function packs(model, box, owner, list) {
  const seen = readSeen(owner);
  const all = new Set(list.map(x => x.card.key));
  const rank = (a, b) => RARITY[a.card.rarity].order - RARITY[b.card.rarity].order || a.card.rank - b.card.rank;
  let pull, title;
  if (!seen) { pull = [...list].sort(rank).slice(0, 5); title = 'Your welcome pack is here'; }
  else { pull = list.filter(x => !seen.has(x.card.key)).sort(rank).slice(0, 10); title = `${pull.length} new card${pull.length === 1 ? '' : 's'} to open`; }
  if (!pull.length) { if (!seen) writeSeen(owner, all); return; }
  box.innerHTML = `<div class="card packbar"><div class="pack-icon" aria-hidden="true">🃏</div><div><h3 style="margin:0">${esc(title)}</h3><p class="muted small" style="margin:2px 0 0">${!seen ? 'Every card you\'ve earned is already in your binder. Here are your five best to start.' : 'Earned from your roster since your last visit.'}</p></div>
    <button type="button" class="btn primary" id="openpack">Open pack</button><button type="button" class="linkbtn" id="skippack">Skip</button></div>`;
  const done = () => { writeSeen(owner, all); box.innerHTML = ''; };
  box.querySelector('#skippack').onclick = done;
  box.querySelector('#openpack').onclick = () => {
    const dlg = document.createElement('dialog'); dlg.className = 'inspect packopen';
    dlg.innerHTML = `<h2 class="pack-h">${esc(title)}</h2><p class="muted small pack-sub">Tap each card to flip it.</p>
      <div class="packrow">${pull.map((x, i) => `<div class="flip packcard" style="--i:${i}"><div class="face front cardback-face"><div class="tcard cardback"><div class="tc-in"><span>🏈</span><b>${esc(monogram())}</b><small>Trading cards</small></div></div></div><div class="face rear">${cardFront(model, x.card, x.p)}</div></div>`).join('')}</div>
      <div class="inspect-bar"><button type="button" class="btn" id="flipall">Flip all</button><button type="button" class="btn primary" id="tobinder">Add to binder</button></div>`;
    document.body.appendChild(dlg);
    dlg.querySelectorAll('.packcard').forEach(c => c.onclick = () => c.classList.add('flipped', 'revealed'));
    dlg.querySelector('#flipall').onclick = () => dlg.querySelectorAll('.packcard').forEach((c, i) => setTimeout(() => c.classList.add('flipped', 'revealed'), i * 180));
    const close = () => { dlg.close(); dlg.remove(); done(); };
    dlg.querySelector('#tobinder').onclick = close;
    dlg.addEventListener('cancel', () => setTimeout(close));
    dlg.showModal();
  };
}
