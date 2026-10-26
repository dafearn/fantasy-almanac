import { setQuery } from '../app.js';
import { esc, f1, chip, nameOf, table, seasonSelect, posClass, ordinal, empty } from '../ui.js';
import { draftAnalysis, tradeAnalysis, pickupAnalysis } from '../stats.js';
import { pickSeason } from './common.js';

// ---------------------------------------------------------------- Drafts
export function drafts(model, { q }, el) {
  const withDraft = model.seasons.filter(s => s.draft?.picks.length);
  const s = q.season ? model.seasons.find(x => x.season === q.season) : withDraft[withDraft.length - 1];
  if (!s || !s.draft?.picks.length) { el.innerHTML = `<h1>Drafts</h1><div class="toolbar">${seasonSelect(model, s?.season, v => setQuery({ season: v }))}</div>${empty('📋', 'No completed draft for this season', 'Pick another season above.')}`; return; }
  const an = draftAnalysis(model, s);
  const scored = s.completedThrough >= 1;
  const slots = [...new Set(s.draft.picks.map(p => p.slot))].sort((a, b) => a - b);
  const rounds = Math.max(...s.draft.picks.map(p => p.round));
  const slotOwner = Object.fromEntries(s.draft.picks.filter(p => p.round === 1).map(p => [p.slot, p.ownerId]));
  const bySlotRound = Object.fromEntries(an.rows.map(r => [`${r.slot}|${r.round}`, r]));
  el.innerHTML = `
    <h1>Drafts</h1>
    <p class="sub">${s.season} ${esc(s.draft.type || '')} draft, ${rounds} rounds. Each pick shows where the player finished at his position in league scoring${scored ? '' : ' (once games are played)'}. Value = drafted position rank minus finish rank, so +10 means he finished ten spots better than where he went. Points only count weeks a player was on a roster in this league${s.status === 'complete' ? '' : ', and this season is still in progress'}.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))}</div>
    <div class="tablewrap" style="padding:8px"><div class="board" style="grid-template-columns:28px repeat(${slots.length}, minmax(92px,1fr))">
      <div></div>${slots.map(sl => `<div class="hd" title="${esc(nameOf(slotOwner[sl]))}">${esc(nameOf(slotOwner[sl]))}</div>`).join('')}
      ${Array.from({ length: rounds }, (_, i) => i + 1).map(r => `<div class="hd">${r}</div>${slots.map(sl => {
        const p = bySlotRound[`${sl}|${r}`]; if (!p) return '<div></div>';
        const traded = p.ownerId !== slotOwner[sl];
        return `<div class="pk ${posClass(p.pos)}" title="${esc(p.name)} · pick ${p.pickNo} · ${esc(nameOf(p.ownerId))}${p.finishPosRank ? ` · finished ${p.pos}${p.finishPosRank}` : ''}"><div class="pn">${esc(p.name || model.nameOf(p.playerId))}</div><div>${esc(p.pos)}${p.draftPosRank} ${p.finishPosRank ? `→ ${esc(p.pos)}${p.finishPosRank}` : ''}${traded ? ` · ${esc(nameOf(p.ownerId))}` : ''}${p.keeper ? ' · K' : ''}${p.amount ? ` · $${p.amount}` : ''}</div></div>`;
      }).join('')}`).join('')}
    </div></div>
    <div class="legend">${['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `<span><i class="${posClass(p)}" style="height:10px"></i>${p}</span>`).join('')}</div>
    ${scored ? `<h2>Draft grades</h2><p class="sub">Graded on total league points from each team's draft class, like a Draft Analyzer run after the season instead of before it.</p><div id="g"></div>
    <div class="grid g2"><div><h2>Steals</h2><div id="st"></div></div><div><h2>Busts (rounds 1–6)</h2><div id="bu"></div></div></div>` : ''}`;
  if (!scored) return;
  table(el.querySelector('#g'), [
    { key: 'rank', label: '#', num: true },
    { key: 'grade', label: 'Grade', sort: r => r.rank },
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'pts', label: 'Class points', num: true, fmt: r => f1(r.pts) },
    { key: 'started', label: 'Started for them', num: true, fmt: r => f1(r.started) },
    { key: 'value', label: 'Total value', num: true },
    { key: 'best', label: 'Best pick', sort: r => 0, fmt: r => { const b = [...r.picks].sort((x, y) => y.pts - x.pts)[0]; return b ? `${esc(b.name)} <span class="muted">R${b.round}</span>` : ''; } },
  ], an.teams, { sortKey: 'rank', desc: false });
  const pc = [
    { key: 'name', label: 'Player', fmt: r => `${esc(r.name)} <span class="muted">${esc(r.pos)}</span>` },
    { key: 'pickNo', label: 'Pick', num: true, fmt: r => `${r.round}.${String(r.pickNo - (r.round - 1) * slots.length).padStart(2, '0')}` },
    { key: 'owner', label: 'By', fmt: r => esc(nameOf(r.ownerId)) },
    { key: 'fin', label: 'Drafted → finish', fmt: r => `${r.pos}${r.draftPosRank} → ${r.pos}${r.finishPosRank}` },
    { key: 'value', label: 'Value', num: true, fmt: r => `<span class="${r.value > 0 ? 'pos' : r.value < 0 ? 'neg' : ''}">${r.value > 0 ? '+' : ''}${r.value}</span>` },
  ];
  table(el.querySelector('#st'), pc, an.steals, {});
  table(el.querySelector('#bu'), pc, an.busts, {});
}

// ---------------------------------------------------------------- Trades & waivers
export function transactions(model, { q }, el) {
  const s = pickSeason(model, q);
  const trades = tradeAnalysis(model, s);
  const pickups = pickupAnalysis(model, s);
  const leaders = {};
  for (const p of pickups) { const x = leaders[p.owner] ||= { owner: p.owner, adds: 0, faab: 0, pts: 0 }; x.adds++; x.faab += p.bid || 0; x.pts += p.startedPts; }
  el.innerHTML = `
    <h1>Trades &amp; waivers</h1>
    <p class="sub">Trades are graded after the fact: points each side got from the players it received, counting only weeks those players were in its starting lineup. Draft picks are listed but not scored.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))}</div>
    <h2>Trades (${trades.length})</h2>
    <div id="tr">${trades.length ? '' : empty('🤝', 'No trades this season', 'Nobody has pulled the trigger yet. The <a href="#/block">trade block</a> is open.')}</div>
    <div class="grid g2">
      <div><h2>Waiver &amp; free-agent activity</h2><div id="wl"></div></div>
      <div><h2>Best pickups</h2><div id="bp"></div></div>
    </div>`;
  el.querySelector('#tr').innerHTML += trades.slice().reverse().map(t => `
    <div class="card" style="margin-bottom:10px">
      <div class="muted" style="font-size:12px;margin-bottom:6px">Week ${t.week} · ${new Date(t.created).toLocaleDateString()}${t.winner ? ` · edge ${f1(t.edge)} pts to ${esc(nameOf(t.winner))}` : ''}</div>
      <div class="grid g${Math.min(t.sides.length, 3)}">${t.sides.map(sd => `
        <div>${chip(sd.owner)} ${t.winner === sd.owner ? '<span class="pill gold">won</span>' : ''}
          <div style="margin-top:6px;font-size:13px">Got: ${[...sd.got.map(id => `${esc(model.nameOf(id))} <span class="muted">${esc(model.posOf(id))} · ${f1(sd.per[id] || 0)}</span>`), ...sd.picks.map(p => `<span class="pill">${esc(p)} pick</span>`)].join(', ') || '–'}</div>
          <div class="muted" style="font-size:13px">Gave: ${sd.gave.map(id => esc(model.nameOf(id))).join(', ') || '–'}</div>
          <div class="muted" style="font-size:13px">Started points from it: ${f1(sd.startedPts)}</div>
        </div>`).join('')}</div>
    </div>`).join('');
  table(el.querySelector('#wl'), [
    { key: 'owner', label: 'Manager', fmt: r => chip(r.owner), sort: r => nameOf(r.owner) },
    { key: 'adds', label: 'Adds', num: true },
    { key: 'faab', label: 'FAAB spent', num: true, fmt: r => `$${r.faab}` },
    { key: 'pts', label: 'Started pts from adds', num: true, fmt: r => f1(r.pts) },
  ], Object.values(leaders), { sortKey: 'pts' });
  table(el.querySelector('#bp'), [
    { key: 'id', label: 'Player', fmt: r => `${esc(model.nameOf(r.id))} <span class="muted">${esc(model.posOf(r.id))}</span>`, sort: r => model.nameOf(r.id) },
    { key: 'owner', label: 'By', fmt: r => esc(nameOf(r.owner)), sort: r => nameOf(r.owner) },
    { key: 'week', label: 'Wk', num: true },
    { key: 'bid', label: 'Bid', num: true, fmt: r => (r.type === 'waiver' && r.bid != null ? `$${r.bid}` : 'FA') },
    { key: 'startedPts', label: 'Started pts', num: true, fmt: r => f1(r.startedPts) },
  ], pickups.slice(0, 15), { sortKey: 'startedPts' });
}
