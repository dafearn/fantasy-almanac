// Live: a Redzone-style dashboard for the week. The scoreboard shows every league matchup (click one to
// tune into it), a ticker keeps every scoring change of the week, and the NFL games are grouped by TV
// window (Thursday night, Sunday morning, afternoon, evening, Sunday night, Monday night, and any odd
// slot like Christmas). Refreshes every 30 seconds while the page is open.
import { esc, f2, chip, nameOf, posClass, empty } from '../ui.js';
import { sget } from '../api.js';
import { SERVER, apiGet, lp } from '../server.js';
import { trimStats, scoreRows, statLine, diffPolls, snapOf, parseScoreboard, tvWindow, catchupTime, ESPN_SCOREBOARD } from '../live-core.js';
import { BENCH } from '../stats.js';

const POLL_MS = 30000;
const LIVE_WINDOW = 12 * 60000; // without ESPN's clock, a game counts as live if its stats changed in the last 12 minutes
const TICK_PAGE = 100;
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${Math.max(0, s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = t => new Date(t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
const kick = iso => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const SLOT = { FLEX: 'FLX', SUPER_FLEX: 'SF', REC_FLEX: 'RWF', WRRB_FLEX: 'W/R', IDP_FLEX: 'IDP' };

async function fetchLive(state, leagueId, since) {
  const season = state.season, week = state.week, type = state.season_type === 'post' ? 'post' : 'regular';
  if (SERVER.available) return apiGet(lp(`/live?season=${season}&week=${week}&type=${type}&since=${since || 0}`));
  // Static hosting: go straight to Sleeper and ESPN from the browser. The ticker then only holds what this page sees.
  const [stats, matchups, board] = await Promise.all([
    fetch(`https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=${type}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch(`${ESPN_SCOREBOARD}?seasontype=${type === 'post' ? 3 : 2}&week=${week}&dates=${season}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  return { at: Date.now(), leagueId, stats: stats ? trimStats(stats) : null, matchups, schedule: board ? parseScoreboard(board) : null, events: [], ticker: false };
}

export async function live(model, { q }, el) {
  const focusId = q.m != null && q.m !== '' ? Number(q.m) : null;
  el.innerHTML = `<h1>Live</h1><p class="sub">The whole league at a glance, Redzone style. Click a matchup on the scoreboard to tune into it. The ticker keeps every scoring change of the week, and the games are grouped by TV window. Sleeper updates stats within a minute or two of the play; this page checks every 30 seconds.</p>
    <div class="toolbar"><span id="lstatus" class="muted">Loading…</span><button type="button" class="btn" id="lpause">Pause</button>
    <div class="seg" id="lfilter" aria-label="Which players to show">${[['all', 'All players'], ['rostered', 'Rostered'], ['starters', 'Starters']].map(([v, l]) => `<button type="button" data-v="${v}" class="${(q.show || 'all') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div id="lrz"></div>
    ${focusId != null ? `<div class="toolbar"><h2 style="margin:0">Matchup</h2><a class="btn subtle" href="#/live${q.show ? `?show=${esc(q.show)}` : ''}">← Whole league</a></div><div id="lfocus"></div>` : ''}
    <h2>${focusId != null ? 'Around the league' : 'Scoreboard'}</h2><div id="lboard" class="matchups"></div>
    <h2>Ticker</h2><div id="lticker" class="card ticker"><p class="muted">Scoring changes show up here as they happen.</p></div>
    <h2 id="lgamesh">Games</h2><div id="lgames" class="stack"></div>`;

  const s = model.seasons[model.seasons.length - 1];
  let state;
  try { state = await sget('/state/nfl', { ttl: 60000 }); } catch (e) { el.querySelector('#lstatus').textContent = `Couldn't reach Sleeper: ${e.message}`; return; }
  if (String(state.season) !== String(s.season) || !(state.week >= 1)) {
    el.querySelector('#lstatus').textContent = `No live week right now (Sleeper says ${state.season} ${state.season_type}, week ${state.week}).`;
    return;
  }

  const root = el.querySelector('#lgames');
  const alive = () => document.body.contains(root); // false once another page (or a fresh Live page) replaces this one
  let show = q.show || 'all', paused = false, data = null, events = [], lastId = 0, lastAt = 0, timer = null, prevSnap = null, localId = -1;
  let tickN = TICK_PAGE, lastTotals = {}, pulse = new Set();
  const openWins = new Map(); // TV window key -> open/closed, once someone toggles it
  const filterEl = el.querySelector('#lfilter');
  filterEl.querySelectorAll('button').forEach(b => b.onclick = () => {
    show = b.dataset.v; filterEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); tickN = TICK_PAGE; draw();
  });
  const pauseBtn = el.querySelector('#lpause');
  pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume' : 'Pause'; if (!paused) poll(); status(); };
  const matchupHref = id => `#/live?m=${id}${show !== 'all' ? `&show=${show}` : ''}`;

  function status() {
    const st = el.querySelector('#lstatus'); if (!st || !alive()) return;
    st.innerHTML = `${state.season} week ${state.week} · ${lastAt ? `updated ${ago(lastAt)}` : 'loading'} · ${paused ? 'paused' : '<span class="pos">● checking every 30s</span>'}`;
  }

  // Everything the sections share, worked out once per draw.
  function prepare() {
    const rows = scoreRows(data.stats || [], data.matchups || [], s.scoring).map(r => ({ ...r, pos: r.pos || model.posOf(r.id), name: model.players[r.id]?.n || r.name || r.id }));
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    const groups = {};
    for (const m of data.matchups || []) if (m.matchup_id != null) (groups[m.matchup_id] ||= []).push(m);
    const sched = data.schedule || [];
    const gameOfTeam = {};
    for (const g of sched) { gameOfTeam[g.home] = g; gameOfTeam[g.away] = g; }
    const teamOf = id => byId[id]?.team || model.players[id]?.t || (model.posOf(id) === 'DEF' ? id : '');
    const focus = focusId != null ? groups[focusId] : null;
    const focusRids = new Set((focus || []).map(m => m.roster_id));
    const keep = o => (show === 'all' || (show === 'rostered' && o) || (show === 'starters' && o?.starter)) && (!focus || (o && focusRids.has(o.rid)));
    return { rows, byId, groups, sched, gameOfTeam, teamOf, focus, focusRids, keep };
  }

  // How a player's game stands: kickoff time, live clock (with red zone) or final.
  function gameState(ctx, id) {
    const g = ctx.gameOfTeam[ctx.teamOf(id)];
    if (g) {
      const rz = g.state === 'in' && g.redzone && g.poss === ctx.teamOf(id);
      return { state: g.state, text: g.state === 'pre' ? kick(g.kickoff) : g.detail, rz };
    }
    const r = ctx.byId[id];
    if (!r && ctx.sched.length && ctx.teamOf(id)) return { state: 'bye', text: 'Bye week', rz: false };
    if (!r) return { state: 'pre', text: 'Yet to play', rz: false };
    return { state: r.upd && Date.now() - r.upd < LIVE_WINDOW ? 'in' : 'post', text: r.upd && Date.now() - r.upd < LIVE_WINDOW ? 'Playing' : 'Played', rz: false };
  }

  function sideOf(ctx, m) {
    const starters = (m.starters || []).filter(x => x && x !== '0');
    // Same per-player numbers as the games and ticker, so every part of the page agrees.
    const ptsOf = id => ctx.byId[id]?.pts ?? m.players_points?.[id] ?? 0;
    const total = (m.starters || []).reduce((t, id, i) => t + (id && id !== '0' ? (ctx.byId[id]?.pts ?? m.starters_points?.[i] ?? m.players_points?.[id] ?? 0) : 0), 0);
    const left = starters.filter(id => gameState(ctx, id).state === 'pre').length;
    const playing = starters.filter(id => gameState(ctx, id).state === 'in').length;
    return { m, total, left, playing, ptsOf, owner: s.teams[m.roster_id]?.ownerId, team: s.teams[m.roster_id]?.teamName, rid: m.roster_id };
  }

  function draw() {
    if (!data || !alive()) return;
    const ctx = prepare();
    drawRedzone(ctx);
    drawBoard(ctx);
    if (focusId != null) drawFocus(ctx);
    drawTicker(ctx);
    drawGames(ctx);
  }

  // League starters whose NFL team is in the red zone right now.
  function redzoneHits(ctx, rids) {
    const hits = [];
    for (const g of ctx.sched) {
      if (g.state !== 'in' || !g.redzone || !g.poss) continue;
      const who = [];
      for (const m of ctx.focus || data.matchups || []) {
        if (rids && !rids.has(m.roster_id)) continue;
        for (const id of m.starters || []) if (id && id !== '0' && ctx.teamOf(id) === g.poss && model.posOf(id) !== 'DEF') who.push({ id, rid: m.roster_id });
      }
      hits.push({ g, who });
    }
    return hits;
  }

  function drawRedzone(ctx) {
    const box = el.querySelector('#lrz');
    const hits = redzoneHits(ctx, ctx.focus ? ctx.focusRids : null).filter(h => h.who.length);
    box.innerHTML = hits.length ? `<div class="card rzbar" role="status"><b>🔴 Red zone</b> ${hits.map(({ g, who }) => `<span class="rzgame"><b>${esc(g.poss)}</b> ${g.down ? `<span class="muted">${esc(g.down)}</span>` : ''} · ${who.map(w => `${esc(model.players[w.id]?.n || w.id)} <span class="muted">(${esc(nameOf(s.teams[w.rid]?.ownerId))})</span>`).join(', ')}</span>`).join('')}</div>` : '';
  }

  function drawBoard(ctx) {
    const board = el.querySelector('#lboard');
    const latest = {}; // roster id -> newest starter scoring change
    for (const ev of events) if (!ev.catchup && ev.starter && ev.rid != null && !(ev.rid in latest)) latest[ev.rid] = ev;
    const rzRids = new Set(redzoneHits(ctx, null).flatMap(h => h.who.map(w => w.rid)));
    board.innerHTML = Object.entries(ctx.groups).map(([mid, pair]) => {
      const [a, b] = pair.map(m => sideOf(ctx, m));
      const row = (x, lead) => `<div class="row ${lead ? 'win' : ''}">${x.owner ? chip(x.owner, { team: x.team }) : esc(x.team || 'Team')}<span class="score live-score">${f2(x.total)}<span class="muted small">${x.playing ? `<span class="pos">${x.playing} playing</span>${x.left ? ` · ${x.left} to play` : ''}` : x.left ? `${x.left} to play` : 'all played'}</span></span></div>`;
      const last = [a, b].map(x => x && latest[x.rid]).filter(Boolean).sort((p, q2) => q2.at - p.at)[0];
      const rz = [a, b].some(x => x && rzRids.has(x.rid));
      const hot = [a, b].some(x => x && pulse.has(x.rid));
      return `<div class="card matchup mlink ${Number(mid) === focusId ? 'sel' : ''} ${hot ? 'pulse' : ''}" data-m="${mid}">
        ${rz ? '<span class="pill rz">🔴 Red zone</span>' : ''}${row(a, b && a.total > b.total)}${b ? row(b, b.total > a.total) : ''}
        ${last ? `<p class="lastplay small"><span class="muted">${clock(last.at)}</span> ${esc(evName(ctx, last))} <span class="${last.delta > 0 ? 'pos' : 'neg'}">${last.delta > 0 ? '+' : ''}${f2(last.delta)}</span></p>` : ''}
        <a class="watch small" href="${matchupHref(mid)}">${Number(mid) === focusId ? 'Watching' : 'Watch this matchup'} →</a></div>`;
    }).join('') || empty('🗓️', 'No league matchups this week');
    board.querySelectorAll('.mlink').forEach(c => c.onclick = e => { if (!e.target.closest('a')) location.hash = matchupHref(c.dataset.m); });
  }

  function drawFocus(ctx) {
    const box = el.querySelector('#lfocus');
    if (!ctx.focus) { box.innerHTML = empty('🔍', "That matchup isn't on this week's slate", '', `<a class="btn" href="#/live">See the whole league</a>`); return; }
    const [a, b] = ctx.focus.map(m => sideOf(ctx, m));
    if (!b) { box.innerHTML = `<div class="card"><p>${chip(a.owner, { team: a.team })} has no opponent this week.</p></div>`; return; }
    const slots = s.rosterPositions.filter(p => !BENCH.has(p));
    const cell = (x, id, right) => {
      if (!id || id === '0') return `<div class="h2p ${right ? 'r' : ''} muted">Empty</div>`;
      const r = ctx.byId[id], gs = gameState(ctx, id), pos = r?.pos || model.posOf(id);
      return `<div class="h2p ${right ? 'r' : ''}"><div><span class="pb ${posClass(pos)}">${esc(pos)}</span> <a href="#/players/${encodeURIComponent(id)}">${esc(model.players[id]?.n || r?.name || id)}</a> <span class="muted small">${esc(ctx.teamOf(id))}</span></div>
        <div class="small muted">${gs.rz ? '<b class="rzdot">🔴 Red zone</b> · ' : ''}<span class="${gs.state === 'in' ? 'pos' : ''}">${gs.state === 'in' ? '● ' : ''}${esc(gs.text)}</span>${r ? ` · ${esc(statLine(pos, r.s))}` : ''}</div></div>`;
    };
    const pts = (x, id) => { const st = id && id !== '0' ? gameState(ctx, id).state : ''; return `<div class="h2pts ${st === 'in' ? 'livept' : ''}">${!st ? '' : (st === 'pre' || st === 'bye') && !ctx.byId[id] ? '–' : f2(x.ptsOf(id))}</div>`; };
    const lineup = (ia, ib, labels) => labels.map((lab, i) => `${cell(a, ia[i], false)}${pts(a, ia[i])}<div class="h2slot">${esc(SLOT[lab] || lab)}</div>${pts(b, ib[i])}${cell(b, ib[i], true)}`).join('');
    const benchOf = x => (x.m.players || []).filter(id => !(x.m.starters || []).includes(id));
    const ba = benchOf(a), bb = benchOf(b), bn = Math.max(ba.length, bb.length);
    const lead = a.total + b.total ? a.total / (a.total + b.total) : 0.5;
    box.innerHTML = `<div class="card h2h">
      <div class="h2top"><div>${chip(a.owner, { team: a.team })}<div class="h2tot ${a.total > b.total ? 'win' : ''}">${f2(a.total)}</div><div class="muted small">${a.playing} playing · ${a.left} to play</div></div>
        <div class="h2vs muted">vs</div>
        <div class="r">${chip(b.owner, { team: b.team })}<div class="h2tot ${b.total > a.total ? 'win' : ''}">${f2(b.total)}</div><div class="muted small">${b.playing} playing · ${b.left} to play</div></div></div>
      <div class="h2bar" role="img" aria-label="Share of points scored"><span style="width:${(lead * 100).toFixed(1)}%"></span></div>
      <div class="h2grid">${lineup(a.m.starters || [], b.m.starters || [], slots)}</div>
      ${bn ? `<details class="h2bench"><summary>Bench</summary><div class="h2grid">${lineup(ba, bb, Array(bn).fill('BN'))}</div></details>` : ''}
    </div>`;
  }

  const evName = (ctx, ev) => model.players[ev.pid]?.n || ctx.byId[ev.pid]?.name || ev.pid;

  function drawTicker(ctx) {
    const tick = el.querySelector('#lticker');
    // Catch-up entries recorded before this fix carry Sleeper's next-morning restamp; move them to the game's end.
    const when = ev => (ev.catchup ? catchupTime(ev.at, ctx.gameOfTeam[ctx.teamOf(ev.pid)]) : ev.at);
    const list = events.filter(ev => ctx.keep(ev.rid != null ? { rid: ev.rid, starter: ev.starter } : null))
      .map(ev => ({ ...ev, at: when(ev) })).sort((a, b) => b.at - a.at || b.id - a.id);
    if (!list.length) {
      tick.innerHTML = `<p class="muted">${events.length ? 'No scoring changes match this filter yet.' : data.ticker ? 'No scoring changes yet this week. They show up here as they happen.' : 'Scoring changes show up here as they happen while this page is open.'}</p>`;
      return;
    }
    let day = '';
    const items = list.slice(0, tickN).map(ev => {
      const d = dayOf(ev.at), head = d !== day ? `<li class="tday">${esc(d)}</li>` : ''; day = d;
      const pos = ctx.byId[ev.pid]?.pos || model.posOf(ev.pid);
      return `${head}<li><span class="muted"${ev.catchup ? ' title="About when the game ended"' : ''}>${ev.catchup ? '~' : ''}${clock(ev.at)}</span> <span class="pb ${posClass(pos)}">${esc(pos)}</span> <b>${esc(evName(ctx, ev))}</b>
        <span class="${ev.delta > 0 ? 'pos' : 'neg'}">${ev.delta > 0 ? '+' : ''}${f2(ev.delta)}</span> <span class="muted">(${f2(ev.pts)})</span>
        ${ev.catchup ? '<span class="pill" title="The ticker started recording after this player had already scored, so this is their total so far.">so far</span>' : ''}
        ${ev.what.length ? `<span class="muted"> · ${esc(ev.what.join(', '))}</span>` : ''}
        <span class="who">${ev.rid != null ? `${esc(nameOf(s.teams[ev.rid]?.ownerId))}${ev.starter ? '' : ' <span class="pill">bench</span>'}` : '<span class="muted">free agent</span>'}</span></li>`;
    }).join('');
    tick.innerHTML = `<ul class="feed">${items}</ul>${list.length > tickN ? `<p><button type="button" class="btn subtle" id="tmore">Show ${Math.min(TICK_PAGE, list.length - tickN)} more of ${list.length - tickN}</button></p>` : ''}`;
    tick.querySelector('#tmore')?.addEventListener('click', () => { tickN += TICK_PAGE; draw(); });
  }

  function drawGames(ctx) {
    const gamesEl = el.querySelector('#lgames');
    el.querySelector('#lgamesh').textContent = ctx.focus ? 'Games with players in this matchup' : 'Games';
    if (!data.stats) { gamesEl.innerHTML = `<p class="muted">Sleeper's live player stats couldn't be loaded from this browser. They load when the site runs with its server (npm start or Vercel).</p>`; return; }
    // One card per NFL game. ESPN's scoreboard gives kickoff times, scores and the clock; without it,
    // games come from the stats feed and windows fall back to the game's date.
    const games = new Map();
    const gameFor = r => {
      const g = ctx.gameOfTeam[r.team];
      const key = g ? g.id : r.game;
      if (!games.has(key)) games.set(key, { id: key, sched: g || null, teams: new Set(g ? [g.away, g.home] : []), upd: 0, date: r.date, rows: [] });
      return games.get(key);
    };
    for (const g of ctx.sched) if (!games.has(g.id)) games.set(g.id, { id: g.id, sched: g, teams: new Set([g.away, g.home]), upd: 0, date: '', rows: [] });
    for (const r of ctx.rows) { const g = gameFor(r); g.teams.add(r.team); g.upd = Math.max(g.upd, r.upd); if (ctx.keep(r.own)) g.rows.push(r); }
    // Rostered players who haven't recorded a stat yet, so upcoming games show who to watch.
    for (const m of data.matchups || []) for (const id of m.players || []) {
      if (ctx.byId[id]) continue;
      const g = ctx.gameOfTeam[ctx.teamOf(id)]; if (!g) continue;
      const own = { rid: m.roster_id, starter: (m.starters || []).includes(id) };
      if (ctx.keep(own)) games.get(g.id).rows.push({ id, pos: model.posOf(id), name: model.players[id]?.n || id, team: ctx.teamOf(id), own, pts: 0, s: {}, yet: true });
    }
    let list = [...games.values()];
    if (ctx.focus) list = list.filter(g => g.rows.length);
    const stateOf = g => (g.sched ? g.sched.state : g.upd && Date.now() - g.upd < LIVE_WINDOW ? 'in' : g.upd ? 'post' : 'pre');
    const windowOf = g => (g.sched?.kickoff ? tvWindow(g.sched.kickoff) : g.date ? { key: g.date, label: new Date(`${g.date}T12:00:00`).toLocaleDateString([], { weekday: 'long' }), at: Date.parse(`${g.date}T12:00:00`) } : { key: 'tbd', label: 'Other games', at: Infinity });
    const wins = new Map();
    for (const g of list) { const w = windowOf(g); if (!wins.has(w.key)) wins.set(w.key, { ...w, games: [] }); const W = wins.get(w.key); W.at = Math.min(W.at, w.at); W.games.push(g); }
    const ordered = [...wins.values()].sort((x, y) => x.at - y.at);
    // Open the windows being played now; when nothing is on, open the latest one that has started and the next one up.
    const anyLive = ordered.some(W => W.games.some(g => stateOf(g) === 'in'));
    const started = ordered.filter(W => W.games.some(g => stateOf(g) !== 'pre'));
    const nextUp = ordered.find(W => W.games.every(g => stateOf(g) === 'pre'));
    const openByDefault = W => (anyLive ? W.games.some(g => stateOf(g) === 'in') : W === started[started.length - 1] || W === nextUp);
    gamesEl.innerHTML = ordered.map(W => {
      const live = W.games.filter(g => stateOf(g) === 'in').length, done = W.games.every(g => stateOf(g) === 'post'), pre = W.games.every(g => stateOf(g) === 'pre');
      const open = openWins.has(W.key) ? openWins.get(W.key) : openByDefault(W);
      const first = W.games.map(g => g.sched?.kickoff).filter(Boolean).sort()[0];
      return `<details class="tvwin" data-w="${esc(W.key)}" ${open ? 'open' : ''}><summary><span class="tvname">${esc(W.label)}</span>
        <span class="muted small">${W.games.length} game${W.games.length === 1 ? '' : 's'}${live ? ` · <span class="pill live">● ${live} live</span>` : done ? ' · final' : pre && first ? ` · kicks off ${esc(kick(first))}` : ''}</span></summary>
        <div class="stack">${W.games.sort((x, y) => (x.sched?.kickoff || '').localeCompare(y.sched?.kickoff || '') || y.upd - x.upd).map(g => gameCard(ctx, g, stateOf(g))).join('')}</div></details>`;
    }).join('') || (ctx.focus ? empty('🏈', 'Nobody in this matchup has played yet') : empty('🏈', 'No games have kicked off yet', 'Scores show up here the moment the first game starts. This page checks every 30 seconds, so you can leave it open.'));
    gamesEl.querySelectorAll('details.tvwin').forEach(d => d.addEventListener('toggle', () => openWins.set(d.dataset.w, d.open)));
    gamesEl.querySelectorAll('[data-allp]').forEach(b => b.onclick = () => filterEl.querySelector('button[data-v="all"]').click());
  }

  function gameCard(ctx, g, st) {
    const sc = g.sched;
    const title = sc ? `${esc(sc.away)} <b>${st === 'pre' ? '' : sc.as}</b> @ ${esc(sc.home)} <b>${st === 'pre' ? '' : sc.hs}</b>` : esc([...g.teams].filter(Boolean).join(' vs ') || 'Game');
    const tag = st === 'in' ? `<span class="pill live">● ${esc(sc?.detail || 'Live')}</span>${sc?.redzone && sc.poss ? ` <span class="pill rz">🔴 ${esc(sc.poss)} in the red zone${sc.down ? ` · ${esc(sc.down)}` : ''}</span>` : ''}`
      : `<span class="muted">${sc ? esc(st === 'pre' ? kick(sc.kickoff) : sc.detail || 'Final') : g.upd ? `last update ${ago(g.upd)}` : esc(g.date)}</span>`;
    const rows = g.rows.sort((a, b) => b.pts - a.pts || (a.yet ? 1 : 0) - (b.yet ? 1 : 0));
    return `<div class="card"><div class="toolbar" style="margin:0 0 8px"><h3 style="margin:0">${title}</h3>${tag}</div>
      ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Player</th><th>Manager</th><th>Line</th><th class="num">Pts</th></tr></thead><tbody>${
        rows.map(r => `<tr><td><span class="pb ${posClass(r.pos)}">${esc(r.pos || '?')}</span> <a href="#/players/${encodeURIComponent(r.id)}">${esc(r.name)}</a> <span class="muted">${esc(r.team)}</span></td>
          <td>${r.own ? `${chip(s.teams[r.own.rid]?.ownerId)}${r.own.starter ? '' : ' <span class="pill">bench</span>'}` : '<span class="muted">Free agent</span>'}</td>
          <td class="muted">${r.yet ? 'Yet to play' : esc(statLine(r.pos, r.s))}</td><td class="num"><b>${r.yet ? '–' : f2(r.pts)}</b></td></tr>`).join('')
      }</tbody></table></div>` : `<p class="muted">${st === 'pre' ? 'No players match this filter in this game.' : 'No players match this filter.'} ${show !== 'all' ? '<button type="button" class="linkbtn" data-allp>Show all players</button>' : ''}</p>`}</div>`;
  }

  function addEvents(payload) {
    if (payload.ticker) {
      // Server keeps the week's history; ask only for what's new after the first load.
      const fresh = (payload.events || []).filter(e => e.id > lastId);
      if (fresh.length) { lastId = Math.max(lastId, ...fresh.map(e => e.id)); events = [...fresh, ...events].sort((a, b) => b.at - a.at || b.id - a.id); }
      return;
    }
    // Static hosting: diff polls in the browser, as long as the page stays open.
    const rows = scoreRows(payload.stats || [], payload.matchups || [], s.scoring);
    const next = snapOf(rows), byId = Object.fromEntries(rows.map(r => [r.id, r]));
    const fresh = diffPolls(prevSnap, next).map(ev => ({ id: localId--, pid: ev.id, at: Date.now(), delta: ev.delta, pts: ev.pts, what: ev.what, rid: byId[ev.id].own?.rid ?? null, starter: !!byId[ev.id].own?.starter, catchup: false }));
    events = [...fresh, ...events].slice(0, 1000);
    prevSnap = next;
  }

  async function poll() {
    if (paused || document.hidden || !alive()) return;
    try {
      const payload = await fetchLive(state, s.leagueId, lastId);
      data = payload; lastAt = payload.at || Date.now();
      addEvents(payload);
      // Cards whose score moved since the last poll get a brief highlight.
      const ctx = prepare(), totals = {};
      for (const pair of Object.values(ctx.groups)) for (const m of pair) totals[m.roster_id] = sideOf(ctx, m).total;
      pulse = new Set(Object.keys(totals).filter(rid => rid in lastTotals && Math.abs(totals[rid] - lastTotals[rid]) > 0.001).map(Number));
      lastTotals = totals;
      draw();
    } catch (e) {
      const st = el.querySelector('#lstatus'); if (st) st.textContent = `Couldn't refresh: ${e.message}`;
      return;
    }
    status();
  }

  await poll();
  status();
  timer = setInterval(() => { if (!alive()) return clearInterval(timer); status(); }, 5000);
  const pollTimer = setInterval(() => { if (!alive()) return clearInterval(pollTimer); poll(); }, POLL_MS);
}
