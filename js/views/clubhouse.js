// Pages backed by the league server: trade block and pick'em.
import { CONFIG } from '../config.js';
import { setQuery, refreshPickBadge } from '../app.js';
import { esc, f1, pct, chip, nameOf, table, tile, record, empty, skeleton, progress } from '../ui.js';
import { playerSeason, winProb, standingsThrough, sidesOf } from '../stats.js';
import { SERVER, apiGet, apiPost, lp, isMember } from '../server.js';
import { serverNeeded } from './account.js';

const latest = model => model.seasons[model.seasons.length - 1];
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const until = t => { const m = Math.round((t - Date.now()) / 60000); return m <= 0 ? 'ended' : m < 60 ? `${m}m left` : m < 1440 ? `${Math.round(m / 60)}h left` : `${Math.round(m / 1440)}d left`; };

/** Points per game this season (falls back to last season before week 1 is final). */
function ppgTable(model) {
  const s = [...model.seasons].reverse().find(x => x.completedThrough >= 1) || latest(model);
  const ps = playerSeason(model, s);
  return { season: s.season, ppg: id => (ps.weeks[id] ? ps.pts[id] / ps.weeks[id] : 0) };
}
function myRoster(model) {
  const s = latest(model);
  const t = Object.values(s.teams).find(t => t.ownerId === SERVER.me?.sleeperUserId);
  return t ? t.roster : [];
}
const playerLabel = (model, id, ppg) => `<b>${esc(model.nameOf(id))}</b> <span class="muted">${esc(model.posOf(id))}${model.players[id]?.t ? ' · ' + esc(model.players[id].t) : ''}${ppg ? ` · ${f1(ppg(id))} ppg` : ''}</span>`;
function errBox(el, e) { el.textContent = e.message; el.className = 'msg neg'; }

// ---------------------------------------------------------------- Trade block
export async function tradeBlock(model, { q }, el) {
  el.innerHTML = `<h1>Trade block</h1><p class="sub">Put a player up for auction and let the league bid. Offers can mix players, picks and FAAB. When the seller accepts, make it official in Sleeper. Each offer shows the points per game going each way, so nobody gets fleeced by accident.</p>`;
  if (!SERVER.available) return serverNeeded(el, 'The trade block');
  const { ppg, season } = ppgTable(model);
  const view = q.show || 'open';
  el.insertAdjacentHTML('beforeend', `<div class="toolbar"><div class="seg">${['open', 'done'].map(v => `<button type="button" data-v="${v}" class="${v === view ? 'on' : ''}">${v === 'open' ? 'On the block' : 'Finished'}</button>`).join('')}</div>
    <span class="muted">Points per game are from ${season}.</span></div><div id="new"></div><div id="list" class="stack">${skeleton('cards', 2)}</div>`);
  el.querySelectorAll('.seg button').forEach(b => b.onclick = () => setQuery({ show: b.dataset.v === 'open' ? null : b.dataset.v }));
  const mine = myRoster(model);
  if (isMember() && view === 'open') {
    el.querySelector('#new').innerHTML = `<details class="listform" id="nfd"><summary class="btn primary">＋ List a player</summary><form class="card form" id="nf"><h3>Put a player on the block</h3>
      <div class="row"><label>Player<select name="playerId" required>${mine.map(id => [id, model.nameOf(id)]).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => `<option value="${esc(id)}">${esc(n)} (${esc(model.posOf(id))}, ${f1(ppg(id))} ppg)</option>`).join('')}</select></label>
      <label>Looking for<input type="text" name="asking" maxlength="200" placeholder="e.g. a WR2, or a 2027 2nd"></label>
      <label>Bidding open for<select name="days">${[1, 2, 3, 5, 7].map(d => `<option value="${d}" ${d === 3 ? 'selected' : ''}>${d} day${d > 1 ? 's' : ''}</option>`).join('')}</select></label></div>
      <label>Sales pitch <span class="hint">optional</span><input type="text" name="note" maxlength="500" placeholder="Why he's worth it"></label>
      <p><button class="btn primary" type="submit">List him</button> <button class="btn subtle" type="button" id="nfx">Cancel</button> <span class="msg"></span></p></form></details>`;
    const f = el.querySelector('#nf');
    el.querySelector('#nfx').onclick = () => { el.querySelector('#nfd').open = false; };
    f.onsubmit = async e => { e.preventDefault(); try { await apiPost(lp('/block'), Object.fromEntries(new FormData(f))); el.querySelector('#nfd').open = false; render(); f.reset(); } catch (err) { errBox(f.querySelector('.msg'), err); } };
  } else if (!SERVER.me) {
    el.querySelector('#new').innerHTML = `<div class="callout"><p>You're browsing as a visitor. Sign in to list players and bid.</p><a class="btn primary" href="#/account">Sign in</a></div>`;
  }
  const list = el.querySelector('#list');
  async function render() {
    let data; try { data = await apiGet(lp('/block')); } catch (e) { list.innerHTML = `<p class="neg">${esc(e.message)}</p>`; return; }
    const rows = data.listings.filter(l => (view === 'open' ? l.status === 'open' : l.status !== 'open'));
    if (!rows.length) {
      list.innerHTML = view === 'open'
        ? empty('🏷️', 'Nobody is on the block right now', 'Got a player you would move? List him and let the league make offers.', isMember() && el.querySelector('#nfd') ? '<button type="button" class="btn primary" id="emptylist">＋ List a player</button>' : '')
        : empty('📦', 'No finished listings yet', 'Deals and pulled listings land here.');
      list.querySelector('#emptylist')?.addEventListener('click', () => { const d = el.querySelector('#nfd'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); d.querySelector('select')?.focus(); });
      return;
    }
    list.innerHTML = rows.map(l => listingCard(model, l, ppg, mine)).join('');
    list.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
      const { act, id, bid } = btn.dataset;
      try {
        if (act === 'accept') await apiPost(lp(`/block/${id}/accept`), { bidId: Number(bid) });
        if (act === 'close') await apiPost(lp(`/block/${id}/close`));
        if (act === 'withdraw') await apiPost(lp(`/bids/${bid}/withdraw`));
        render();
      } catch (e) { alertInline(btn, e); }
    });
    list.querySelectorAll('form.bid').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(f);
      try { await apiPost(lp(`/block/${f.dataset.id}/bids`), { players: fd.getAll('players'), picks: fd.get('picks'), faab: fd.get('faab'), note: fd.get('note') }); render(); }
      catch (err) { errBox(f.querySelector('.msg'), err); }
    });
    list.querySelectorAll('form.cmt').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      try { await apiPost(lp(`/block/${f.dataset.id}/comments`), { text: new FormData(f).get('text') }); render(); }
      catch (err) { errBox(f.querySelector('.msg'), err); }
    });
  }
  render();
  // Keep the block fresh while someone is watching it (skips while they're typing an offer).
  const timer = setInterval(() => {
    if (!document.body.contains(list)) return clearInterval(timer);
    if (!document.hidden && !list.contains(document.activeElement) && !list.querySelector('details[open]')) render();
  }, 45000);
}
function alertInline(btn, e) { const s = document.createElement('span'); s.className = 'msg neg'; s.textContent = ' ' + e.message; btn.after(s); }

function listingCard(model, l, ppg, mine) {
  const active = l.bids.filter(b => b.status === 'active' || b.status === 'accepted');
  const value = b => b.players.reduce((t, id) => t + ppg(id), 0);
  const statusPill = { open: `<span class="pill">${until(l.endsAt)}</span>`, accepted: '<span class="pill gold">Deal agreed</span>', closed: '<span class="pill">Pulled</span>', ended: '<span class="pill">Bidding ended</span>' }[l.status];
  const canBid = isMember() && !l.mine && l.status === 'open';
  return `<div class="card listing">
    <div class="lhead"><div>${playerLabel(model, l.playerId, ppg)}<div class="muted" style="font-size:13px">Listed by ${esc(nameOf(l.seller))} · ${ago(l.createdAt)}</div></div><div>${statusPill}</div></div>
    ${l.asking ? `<p><span class="muted">Looking for:</span> ${esc(l.asking)}</p>` : ''}${l.note ? `<p>“${esc(l.note)}”</p>` : ''}
    ${l.status === 'accepted' ? `<p class="pos">Accepted. ${esc(nameOf(l.seller))} and ${esc(nameOf(l.bids.find(b => b.id === l.acceptedBidId)?.bidder))} still need to make it official in Sleeper.</p>` : ''}
    <h3 style="margin-top:12px">Bids (${active.length})</h3>
    ${active.length ? `<div class="tablewrap"><table><thead><tr><th>Bidder</th><th>Offer</th><th class="num">Offer ppg</th><th></th></tr></thead><tbody>${active.map(b => `<tr>
      <td>${chip(b.bidder)}<div class="muted" style="font-size:12px">${ago(b.createdAt)}</div></td>
      <td style="white-space:normal">${[...b.players.map(id => playerLabel(model, id, ppg)), b.picks ? `<span class="pill">${esc(b.picks)}</span>` : '', b.faab ? `<span class="pill">$${b.faab} FAAB</span>` : ''].filter(Boolean).join('<br>')}${b.note ? `<div class="muted">“${esc(b.note)}”</div>` : ''}</td>
      <td class="num">${f1(value(b))} <span class="muted">vs ${f1(ppg(l.playerId))}</span></td>
      <td>${b.status === 'accepted' ? '<span class="pill gold">Accepted</span>' : ''}${l.mine && ['open', 'ended'].includes(l.status) && b.status === 'active' ? `<button class="btn" data-act="accept" data-id="${l.id}" data-bid="${b.id}" type="button">Accept</button>` : ''}${b.mine && b.status === 'active' && l.status === 'open' ? `<button class="btn" data-act="withdraw" data-id="${l.id}" data-bid="${b.id}" type="button">Withdraw</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No bids yet.</p>'}
    ${l.mine && l.status === 'open' ? `<p style="text-align:right"><button class="btn subtle" data-act="close" data-id="${l.id}" type="button">Take him off the block</button></p>` : ''}
    ${canBid ? `<details><summary>Make an offer</summary><form class="form bid" data-id="${l.id}">
      <fieldset><legend>Players from your roster</legend><div class="checks">${mine.map(id => [id, model.nameOf(id)]).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => `<label><input type="checkbox" name="players" value="${esc(id)}"> <span>${esc(n)} <span class="muted">${esc(model.posOf(id))} · ${f1(ppg(id))} ppg</span></span></label>`).join('')}</div></fieldset>
      <fieldset><legend>Sweeteners</legend><div class="row"><label>Draft picks<input type="text" name="picks" maxlength="120" placeholder="e.g. 2027 R2"></label><label>FAAB<input type="number" name="faab" min="0" max="1000" inputmode="numeric" placeholder="$0"></label></div></fieldset>
      <label>Note <span class="hint">optional</span><input type="text" name="note" maxlength="300"></label>
      <button class="btn primary" type="submit">Place bid</button> <span class="msg"></span></form></details>` : ''}
    <div class="comments">${l.comments.map(c => `<div class="cmt"><b>${esc(nameOf(c.author))}</b> <span class="muted">${ago(c.createdAt)}</span><div>${esc(c.text)}</div></div>`).join('')}</div>
    ${isMember() ? `<form class="form cmt row" data-id="${l.id}"><input type="text" name="text" maxlength="500" placeholder="Talk some trash…" required><button class="btn" type="submit">Post</button><span class="msg"></span></form>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- Pick'em
export async function pickem(model, { q }, el) {
  const s = latest(model);
  const through = Math.min(s.completedThrough, s.regWeeks);
  const week = Number(q.week) || Math.min(s.currentWeek, s.lastWeek);
  el.innerHTML = `<h1>Pick'em</h1><p class="sub">Pick the winner of every ${esc(CONFIG.SITE_NAME)} matchup before the week starts. Picks lock once the week's first points come in, and stay hidden until then. "The Model" picks the favorite each week, so you can see who beats the computer.</p>`;
  if (!SERVER.available) return serverNeeded(el, "Pick'em");
  const weeks = []; for (let w = 1; w <= s.lastWeek; w++) if (s.games.some(g => g.week === w)) weeks.push(w);
  el.insertAdjacentHTML('beforeend', `<div class="toolbar"><select id="wk">${weeks.map(w => `<option value="${w}" ${w === week ? 'selected' : ''}>Week ${w}</option>`).join('')}</select></div><div id="pk">${skeleton('cards', 6)}</div><h2>${s.season} standings</h2><div id="lb"></div>`);
  el.querySelector('#wk').onchange = e => setQuery({ week: e.target.value });
  let data; try { data = await apiGet(lp(`/pickem?season=${s.season}`)); } catch (e) { el.querySelector('#pk').innerHTML = `<p class="neg">${esc(e.message)}</p>`; return; }
  const games = s.games.filter(g => g.week === week && g.matchupId != null);
  const locked = data.locked[week] || games.some(g => g.final || g.a.pts > 0 || g.b.pts > 0);
  const mineNow = Object.fromEntries(data.picks.filter(p => p.week === week && p.picker === SERVER.me?.sleeperUserId).map(p => [p.matchupId, p.rosterId]));
  const counts = {}; for (const p of data.picks.filter(p => p.week === week)) counts[`${p.matchupId}|${p.rosterId}`] = (counts[`${p.matchupId}|${p.rosterId}`] || 0) + 1;
  const asOf = Math.min(week - 1, through);
  const canPick = isMember() && !locked;
  const head = canPick ? '<div id="pprog"></div>'
    : !SERVER.me && !locked ? `<div class="callout"><p>Think you can beat the model? Sign in to make your picks for week ${week}.</p><a class="btn primary" href="#/account">Sign in to pick</a></div>`
    : locked ? `<p class="muted">🔒 Picks are locked for week ${week}. Everyone's picks are shown.</p>` : '';
  el.querySelector('#pk').innerHTML = games.length ? `${head}<form id="pf"><div class="matchups">${games.map(g => {
    const wp = winProb(s, g.a.rid, g.b.rid, asOf);
    const opt = (x, p) => `<label class="pickopt ${g.final && ((g.winner === 'a' && x === g.a) || (g.winner === 'b' && x === g.b)) ? 'won' : ''}"><input type="radio" name="m${g.matchupId}" value="${x.rid}" ${mineNow[g.matchupId] === x.rid ? 'checked' : ''} ${canPick ? '' : 'disabled'}>
      ${chip(x.owner, { link: false })}<span class="muted">${pct(p)}${locked ? ` · ${counts[`${g.matchupId}|${x.rid}`] || 0} picks` : ''}${g.final ? ` · ${f1(x.pts)}` : ''}</span></label>`;
    return `<div class="card matchup">${opt(g.a, wp.p)}${opt(g.b, 1 - wp.p)}</div>`;
  }).join('')}</div>
  ${canPick ? '<p class="muted small">Each pick saves as soon as you make it. You can change picks until the first game kicks off.</p><p class="msg" aria-live="polite"></p>' : ''}</form>` : empty('🗓️', `No matchups in week ${week}`, 'Pick another week above.');
  const pf = el.querySelector('#pf');
  // Picks save the moment they are made: no save button to forget.
  const showProgress = () => {
    const n = games.filter(g => new FormData(pf).get(`m${g.matchupId}`)).length;
    el.querySelector('#pprog').innerHTML = progress(n, games.length, `Week ${week} picks · ${games.length - n} to go`, `🎉 All ${games.length} picks are in for week ${week}. Good luck!`);
  };
  if (pf && canPick) {
    showProgress();
    pf.addEventListener('change', async e => {
      const g = games.find(x => e.target.name === `m${x.matchupId}`); if (!g) return;
      const msg = pf.querySelector('.msg');
      showProgress();
      try {
        await apiPost(lp('/pickem'), { season: s.season, week, picks: { [g.matchupId]: Number(e.target.value) } });
        msg.className = 'msg saved'; msg.textContent = `✓ Saved your pick: ${nameOf(s.owner(Number(e.target.value)))}`;
        refreshPickBadge();
      } catch (err) { errBox(msg, err); }
    });
  }
  // Leaderboard over final weeks, plus the model's favorite-pick record.
  const board = {};
  const model0 = { picker: '__model', right: 0, wrong: 0 };
  for (const g of s.games) {
    if (!g.final || g.matchupId == null || g.winner === 'tie') continue;
    const winRid = g.winner === 'a' ? g.a.rid : g.b.rid;
    const wp = winProb(s, g.a.rid, g.b.rid, Math.min(g.week - 1, through));
    if ((wp.p >= 0.5 ? g.a.rid : g.b.rid) === winRid) model0.right++; else model0.wrong++;
    for (const p of data.picks.filter(p => p.week === g.week && p.matchupId === g.matchupId)) {
      const b = board[p.picker] ||= { picker: p.picker, right: 0, wrong: 0 };
      if (p.rosterId === winRid) b.right++; else b.wrong++;
    }
  }
  const rows = [...Object.values(board), model0].map(r => ({ ...r, pct: r.right + r.wrong ? r.right / (r.right + r.wrong) : 0 }));
  table(el.querySelector('#lb'), [
    { key: 'picker', label: 'Picker', fmt: r => (r.picker === '__model' ? '🤖 The Model <span class="muted">(always picks the favorite)</span>' : chip(r.picker)), sort: r => (r.picker === '__model' ? 'zzz' : nameOf(r.picker)) },
    { key: 'right', label: 'Right', num: true },
    { key: 'wrong', label: 'Wrong', num: true },
    { key: 'pct', label: 'Hit rate', num: true, fmt: r => pct(r.pct) },
  ], rows, { sortKey: 'right' });
}
