// The Receipts: charts that settle the league's arguments (the numbers are in js/receipts.js).
// Season-based sections draw straight from the model; Left on Read reads the site's trade block,
// Monday Night Miracles asks the server who played on each week's last game day, and Sunday Heartburn
// replays the Live page's scoring ticker.
import { setQuery, params } from '../app.js';
import { esc, f1, pct, chip, nameOf, ordinal as ordinalOf, seasonSelect, empty, skeleton } from '../ui.js';
import { SERVER, apiGet, lp } from '../server.js';
import { tvWindow } from '../live-core.js';
import { pickSeason, meOwner, highlightSelect } from './common.js';
import { geniusClown, regretRatio, kickerDependency, faabHoarders, leftOnRead, mondayMiracles, heartburn, heartburnScore, draftArchetypes } from '../receipts.js';
import { scatter, lineChart } from '../charts.js';

const SECTIONS = [
  ['clown', 'Genius to Clown'], ['faab', 'FAAB Hoarders'], ['heartburn', 'Sunday Heartburn'],
  ['regret', 'Regret Ratio'], ['kicker', 'Kicker Dependency'], ['read', 'Left on Read'], ['monday', 'Monday Night'],
  ['drafts', 'Draft archetypes'],
];
const P = x => model0.nameOf(x); // player name
let model0;
const who = o => `<b>${esc(nameOf(o))}</b>`;
const pl = id => `<b>${esc(P(id))}</b>`;
const regThrough = s => Math.min(s.completedThrough, s.regWeeks);
const widthOf = el => { const cs = getComputedStyle(el); return Math.max(300, Math.round(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) || 760); };

export function receipts(model, { q }, el) {
  model0 = model;
  const s = pickSeason(model, q);
  const hl = q.hl || meOwner(model);
  const through = regThrough(s);
  const owners = Object.values(s.teams).map(t => t.ownerId);
  const sec = (id, title, sub) => `<section class="rcpt" id="r-${id}"><h2>${title}</h2><p class="sub">${sub}</p><div class="card" id="${id}">${skeleton('list', 3)}</div></section>`;
  el.innerHTML = `<h1>The Receipts</h1>
    <p class="sub">Charts that settle the group chat's arguments. The numbers come from Sleeper and this site. The insults are free.</p>
    <div class="toolbar">${seasonSelect(model, s.season, v => setQuery({ season: v }))} ${highlightSelect(model, hl, v => setQuery({ hl: v }), owners)}</div>
    <nav class="rjump" aria-label="Sections">${SECTIONS.map(([id, t]) => `<button type="button" class="pill" data-jump="r-${id}">${t}</button>`).join('')}</nav>
    ${through < 1 ? empty('🧾', `No receipts for ${s.season} yet`, 'They print after week 1 is final.') : `
    ${sec('clown', 'The Genius-to-Clown Spectrum', 'Where each team finished against where its roster deserved to finish (ranked by points with the best possible lineup every week). Left of center, you out-thought yourself.')}
    ${sec('faab', 'The FAAB Hoarder Report', 'Waiver claims made against the weeks those players actually started. For the manager who spends the budget by week 3 on third-string running backs who live on the bench forever.')}
    ${sec('heartburn', 'Sunday Heartburn', 'Win probability through the week for any matchup. Weeks someone watched on the Live page replay the real scoring; older weeks are rebuilt from the box score. A jagged line means somebody needed antacids.')}
    ${sec('regret', 'The Regret Ratio', 'Points left on the bench for every 100 scored. High numbers mean a habit of benching the eruption for the "safe floor."')}
    ${sec('kicker', 'The Kicker Dependency Score', 'The share of a team’s points that came from its kicker. If the kicker outscored the margin, you didn’t win. Your kicker carried your corpse across the finish line.')}
    ${sec('read', 'The “Left on Read” Trade Index', 'Every trade block offer and what became of it, plus the most insulting offer ever made. Sleeper doesn’t share offers made in its app, so this is the site’s trade block only.')}
    ${sec('monday', 'Monday Night Miracles and Tragedies', 'Games that flipped on the week’s last game day: who went into Monday night behind and stole it, and who had it won and blew it.')}
    ${sec('drafts', 'Zero-Hope Draft Archetypes', `Every ${esc(s.season)} draft class, tagged by its cursed strategy.`)}`}`;
  // In-page jumps: the hash is the router's, so scroll instead of linking.
  el.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => document.getElementById(b.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  if (through < 1) return;
  const box = id => el.querySelector(`#${id}`);
  const safe = (id, fn) => { try { fn(box(id)); } catch (e) { console.error(e); box(id).innerHTML = `<p class="err">${esc(e.message)}</p>`; } };
  safe('clown', b => clownSection(b, model, s, hl));
  safe('faab', b => faabSection(b, model, s, hl));
  safe('regret', b => regretSection(b, model, s, hl));
  safe('kicker', b => kickerSection(b, model, s, hl));
  safe('drafts', b => draftSection(b, model, s, hl));
  const needs = what => `<p class="muted">${what}</p>`;
  if (SERVER.api) mondaySection(box('monday'), model, s, hl);
  else box('monday').innerHTML = needs('This one needs the league server (it asks the NFL schedule who played on each week’s last night), and this copy of the site is running as plain files.');
  if (!SERVER.available) {
    for (const id of ['read', 'heartburn']) box(id).innerHTML = needs(SERVER.api ? 'This one needs the clubhouse, which this site has switched on for its own leagues only. Host your own copy to get it for yours.' : 'This one needs the league server, and this copy of the site is running as plain files.');
    return;
  }
  apiGet(lp('/block')).catch(() => ({ listings: [] })).then(b => safe('read', x => readSection(x, model, hl, b.listings || [])));
  heartburnSection(box('heartburn'), model, q, hl);
}

// ---------------------------------------------------------------- sections

function clownSection(el, model, s, hl) {
  const rows = geniusClown(model, s);
  if (!rows.length) { el.innerHTML = empty('🤡', 'No finished games yet'); return; }
  el.innerHTML = `<div id="clownbars"></div><div class="verdicts" id="clownv"></div><h3 class="rh">Losses the bench would have won, and the worst call</h3><div class="rlist">${
    [...rows].sort((a, b) => b.benchLosses.length - a.benchLosses.length || (b.worst?.diff || 0) - (a.worst?.diff || 0)).map(r => `<div class="rl-row${r.owner === hl ? ' me' : ''}"><div class="rl-who">${chip(r.owner)}<span class="pill${r.benchLosses.length ? ' bad' : ''}">${r.benchLosses.length} bench loss${r.benchLosses.length === 1 ? '' : 'es'}</span></div>
      <div class="rl-what">${r.worst ? `Week ${r.worst.week}: benched ${esc(P(r.worst.benched.id))} (${f1(r.worst.benched.pts)}) for ${esc(P(r.worst.started.id))} (${f1(r.worst.started.pts)})` : '<span class="muted">Never got one wrong</span>'}</div></div>`).join('')}</div>`;
  el.querySelector('#clownbars').innerHTML = rbars([...rows].reverse().map(r => ({
    label: nameOf(r.owner), html: `${r.delta > 0 ? '🧠' : r.delta < 0 ? '🤡' : '😐'} ${chip(r.owner)}`, value: r.delta,
    note: `Roster ${ordinalOf(r.rosterRank)}, finished ${ordinalOf(r.rank)}`,
  })), { format: v => (v > 0 ? `+${v}` : `${v}`) });
  const clown = rows[0], genius = rows[rows.length - 1];
  const worst = [...rows].filter(r => r.worst).sort((a, b) => b.worst.diff - a.worst.diff)[0];
  const v = [];
  if (clown.delta < 0) v.push(`🤡 Chief clown: ${who(clown.owner)}. The roster was good enough for ${ordinalOf(clown.rosterRank)}; the manager got it to ${ordinalOf(clown.rank)}.`);
  if (genius.delta > 0) v.push(`🧠 Resident genius: ${who(genius.owner)}, finishing ${ordinalOf(genius.rank)} with the ${ordinalOf(genius.rosterRank)}-best roster. Witchcraft, or a very soft schedule.`);
  if (worst) v.push(`🪑 Worst call of the year: ${who(worst.owner)} benched ${pl(worst.worst.benched.id)} (${f1(worst.worst.benched.pts)}) in week ${worst.worst.week} to start ${pl(worst.worst.started.id)} (${f1(worst.worst.started.pts)}). That’s ${f1(worst.worst.diff)} points of “safe floor.”`);
  el.querySelector('#clownv').innerHTML = v.map(x => `<p>${x}</p>`).join('');
}

function faabSection(el, model, s, hl) {
  const { budget, rows } = faabHoarders(model, s);
  if (!rows.some(r => r.claims)) { el.innerHTML = empty('💸', 'No waiver claims yet', 'The hoarding starts after the first waiver run.'); return; }
  const max = Math.max(...rows.map(r => Math.max(r.claims, r.starts)), 1);
  el.innerHTML = `<div class="duo">${rows.map(r => `<div class="duo-row${r.owner === hl ? ' me' : ''}"><div class="duo-name">${chip(r.owner)}</div>
      <div class="duo-bars"><div class="duo-bar claims" style="width:${(r.claims / max) * 100}%"><span>${r.claims}</span></div><div class="duo-bar starts" style="width:${(r.starts / max) * 100}%"><span>${r.starts}</span></div></div>
      <div class="duo-note">${r.spent ? `$${r.spent}${budget ? ` of $${budget}` : ''} spent` : 'No FAAB spent'}${budget && r.early ? `, ${pct(r.earlyShare)} by week 3` : ''}</div></div>`).join('')}</div>
    <div class="legend"><span><i class="duo-key claims"></i>Claims made</span><span><i class="duo-key starts"></i>Weeks those players started</span></div>
    <div class="verdicts" id="faabv"></div>`;
  const v = [];
  const hoarder = [...rows].filter(r => r.claims >= 2).sort((a, b) => a.startRate - b.startRate || b.claims - a.claims)[0];
  if (hoarder) v.push(`🐿️ Chief hoarder: ${who(hoarder.owner)} made ${hoarder.claims} claims, and those players have started ${hoarder.starts} time${hoarder.starts === 1 ? '' : 's'} combined. ${hoarder.rotted.length} never started at all.`);
  const blower = budget ? [...rows].sort((a, b) => b.early - a.early)[0] : null;
  if (blower?.early) v.push(`🔥 Spent it all early: ${who(blower.owner)} burned $${blower.early} (${pct(blower.earlyShare)} of the budget) by week 3.`);
  const waste = rows.flatMap(r => r.rotted.filter(x => x.bid).map(x => ({ ...x, owner: r.owner }))).sort((a, b) => b.bid - a.bid)[0];
  if (waste) v.push(`🪦 Most expensive bench decoration: ${who(waste.owner)} paid $${waste.bid} for ${pl(waste.id)} in week ${waste.week}. Starts since: zero.`);
  const hit = rows.flatMap(r => r.hits.map(x => ({ ...x, owner: r.owner }))).sort((a, b) => b.pts - a.pts)[0];
  if (hit) v.push(`💎 Best pickup: ${who(hit.owner)} grabbed ${pl(hit.id)}${hit.bid ? ` for $${hit.bid}` : ''} in week ${hit.week}: ${f1(hit.pts)} points in ${hit.starts} start${hit.starts === 1 ? '' : 's'}.`);
  el.querySelector('#faabv').innerHTML = v.map(x => `<p>${x}</p>`).join('');
}

function regretSection(el, model, s, hl) {
  const rows = regretRatio(model, s);
  if (!rows.length) { el.innerHTML = empty('😩', 'Nothing to regret yet'); return; }
  el.innerHTML = `<div id="regbars"></div><div class="verdicts" id="regv"></div>`;
  el.querySelector('#regbars').innerHTML = rbars(rows.map((r, i) => ({
    label: nameOf(r.owner), html: `${chip(r.owner)}${i === 0 ? ' <span class="pill bad">Football terrorist</span>' : i === rows.length - 1 ? ' <span class="pill good">Lineup savant</span>' : ''}`,
    value: r.ratio * 100, color: r.owner === hl ? 'var(--gold)' : i === 0 ? 'var(--bad)' : 'var(--accent)', note: `${f1(r.left)} left on the bench`,
  })), { format: v => `${v.toFixed(1)}%` });
  const top = rows[0], wk = [...rows].sort((a, b) => (b.worstWeek?.left || 0) - (a.worstWeek?.left || 0))[0];
  const v = [`😩 ${who(top.owner)} leaves ${f1(top.ratio * 100)} points on the bench for every 100 scored. That’s ${f1(top.left)} points this season that were on the roster and not in the lineup.`];
  if (wk?.worstWeek?.left > 0) v.push(`📉 Worst single week: ${who(wk.owner)} in week ${wk.worstWeek.week}, scoring ${f1(wk.worstWeek.pts)} with ${f1(wk.worstWeek.best)} available. ${f1(wk.worstWeek.left)} points, just sitting there.`);
  v.push(`<span class="muted">Counting every bench point instead (the raw version), the leader is ${esc(nameOf([...rows].sort((a, b) => b.benchRatio - a.benchRatio)[0].owner))}, but that mostly rewards a deep bench.</span>`);
  el.querySelector('#regv').innerHTML = v.map(x => `<p>${x}</p>`).join('');
}

function kickerSection(el, model, s, hl) {
  const rows = kickerDependency(model, s).filter(r => r.pf > 0);
  if (!rows.length) { el.innerHTML = empty('🦵', 'No kicks yet'); return; }
  el.innerHTML = `<div id="kbars"></div><div class="verdicts" id="kv"></div>`;
  el.querySelector('#kbars').innerHTML = rbars(rows.map(r => ({
    label: nameOf(r.owner), html: chip(r.owner), value: r.share * 100, color: r.owner === hl ? 'var(--gold)' : 'var(--accent)',
    note: r.carried.length ? `${r.carried.length} win${r.carried.length === 1 ? '' : 's'} carried by the kicker` : '',
  })), { format: v => `${v.toFixed(1)}%` });
  const top = rows[0];
  const peak = [...rows].filter(r => r.peak).sort((a, b) => b.peak.share - a.peak.share)[0];
  const carried = rows.flatMap(r => r.carried.map(c => ({ ...c, owner: r.owner }))).sort((a, b) => b.k - b.margin - (a.k - a.margin));
  const v = [`🦵 Most kicker-dependent: ${who(top.owner)}, with ${pct(top.share, 1)} of all points coming off one guy’s foot.`];
  if (peak) v.push(`🏋️ Heaviest lift: in week ${peak.peak.week}, ${pl(peak.peak.id)} scored ${f1(peak.peak.k)} of ${who(peak.owner)}’s ${f1(peak.peak.pts)} (${pct(peak.peak.share)}).`);
  if (carried.length) v.push(`⚰️ Corpses carried across the line: ${carried.slice(0, 4).map(c => `${who(c.owner)} beat ${esc(nameOf(c.oppOwner))} by ${f1(c.margin)} in week ${c.week} with ${f1(c.k)} from ${esc(P(c.id))}`).join('; ')}.`);
  else v.push('⚰️ No kicker has outscored a winning margin yet. Everyone has earned their wins, allegedly.');
  el.querySelector('#kv').innerHTML = v.map(x => `<p>${x}</p>`).join('');
}

function readSection(el, model, hl, listings) {
  const r = leftOnRead(model, listings);
  if (!r.offers.length) { el.innerHTML = empty('📭', 'No offers yet', 'Once someone makes an offer on the <a href="#/block">trade block</a>, this is where it gets judged.'); return; }
  el.innerHTML = `<div class="tablewrap"><table class="rtable"><thead><tr><th>Manager</th><th class="num">Offers made</th><th class="num">Accepted</th><th class="num">Declined</th><th class="num">Left on read</th><th class="num">Withdrawn</th><th class="num">Offers they ignored</th></tr></thead><tbody>${
    r.rows.map(x => `<tr${x.owner === hl ? ' class="me"' : ''}><td>${chip(x.owner)}</td><td class="num">${x.made}</td><td class="num">${x.accepted}</td><td class="num">${x.declined}</td><td class="num"><b>${x.ignored}</b></td><td class="num">${x.withdrawn}</td><td class="num">${x.ghosted}</td></tr>`).join('')}</tbody></table></div>
    <div class="verdicts" id="readv"></div>`;
  const v = [];
  const ins = r.insults[0];
  if (ins && ins.ratio < 0.6) v.push(`🤌 Most insulting offer: ${who(ins.bidder)} offered ${ins.players.map(id => esc(P(id))).join(' and ')} (${f1(ins.offered)} points this season) for ${esc(nameOf(ins.seller))}’s ${pl(ins.playerId)} (${f1(ins.asked)}). That’s ${pct(ins.ratio)} of the value. ${({ ignored: 'It was left on read, deservedly.', pending: 'It’s still waiting on an answer. Don’t hold your breath.', accepted: 'It was accepted, somehow.', declined: 'It was declined.', withdrawn: 'It was withdrawn, presumably in shame.' })[ins.fate] || ''}`);
  const ignored = [...r.rows].sort((a, b) => b.ignored - a.ignored)[0];
  if (ignored?.ignored) v.push(`📵 Most ignored: ${who(ignored.owner)}, left on read ${ignored.ignored} time${ignored.ignored === 1 ? '' : 's'}.`);
  const ghost = [...r.rows].sort((a, b) => b.ghosted - a.ghosted)[0];
  if (ghost?.ghosted) v.push(`👻 Biggest ghost: ${who(ghost.owner)} let ${ghost.ghosted} offer${ghost.ghosted === 1 ? '' : 's'} expire without a word.`);
  if (!v.length) v.push('🤝 Every offer so far got an answer. Suspiciously civil.');
  el.querySelector('#readv').innerHTML = v.map(x => `<p>${x}</p>`).join('');
}

async function mondaySection(el, model, s, hl) {
  const last = Math.min(s.completedThrough, 18);
  if (last < 1) { el.innerHTML = empty('🌙', 'No finished weeks yet'); return; }
  el.innerHTML = `<p class="muted"><span class="thinking"></span> Checking who played on each week’s last night. The first look at a season takes a moment.</p>`;
  let finale;
  try { finale = (await apiGet(`/api/nfl/finale?season=${encodeURIComponent(s.season)}&weeks=${Array.from({ length: last }, (_, i) => i + 1).join(',')}`)).weeks; }
  catch (e) { el.innerHTML = `<p class="err">Couldn’t load the NFL schedule: ${esc(e.message)}</p>`; return; }
  const { events, tally } = mondayMiracles(model, s, finale);
  const counted = Object.values(finale).filter(f => f && f.games <= 3).length;
  if (!counted) { el.innerHTML = empty('🌙', 'No schedule to check', 'The NFL schedule for this season didn’t come back. Try again later.'); return; }
  const rows = [...tally].sort((a, b) => b.miracles - a.miracles || a.tragedies - b.tragedies || b.survived - a.survived);
  const mir = events.filter(e => e.kind === 'miracle');
  const dayName = e => (e.weekday === 'Monday' ? 'Monday night' : e.weekday);
  el.innerHTML = `<div class="tablewrap"><table class="rtable"><thead><tr><th>Manager</th><th class="num">Miracles</th><th class="num">Tragedies</th><th class="num">Held on</th><th class="num">Almost stole</th></tr></thead><tbody>${
    rows.map(r => `<tr${r.owner === hl ? ' class="me"' : ''}><td>${chip(r.owner)}</td><td class="num">${r.miracles ? `<b class="good">${r.miracles}</b>` : 0}</td><td class="num">${r.tragedies ? `<b class="bad">${r.tragedies}</b>` : 0}</td><td class="num">${r.survived}</td><td class="num">${r.sweats}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small">“Held on” means you led going into the last night while the other side still had players who could catch you; “almost stole” is the other side of that sweat. ${counted} week${counted === 1 ? '' : 's'} checked.</p>
    <div class="verdicts">${mir.length ? mir.slice(0, 6).map(e => `<p>${e.deficit >= 15 ? '🙏' : '😱'} Week ${e.week}${e.type === 'playoff' ? ' (playoffs)' : ''}: ${who(e.win.owner)} went into ${dayName(e)} down ${f1(e.deficit)} to ${esc(nameOf(e.lose.owner))}, got ${f1(e.win.late)} from ${e.win.players.map(p => esc(P(p.id))).join(' and ')}, and won by ${f1(e.margin)}. ${esc(nameOf(e.lose.owner))} would like a word with ${e.lose.players.length ? esc(e.lose.players.map(p => P(p.id)).join(' and ')) : 'the schedule'}.</p>`).join('')
      : '<p>🌙 No Monday night miracles yet this season. Every game was decided by Sunday night, like adults.</p>'}</div>`;
}

async function heartburnSection(el, model, q, hl) {
  // Every week with final scores can be rebuilt from the box score; weeks the Live ticker saw (including
  // one in progress) replay the real scoring. Newest first.
  let recorded;
  try { recorded = (await apiGet(lp('/heartburn'))).recorded; } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const taped = new Set(recorded.map(r => `${r.season}|${r.week}`));
  const finals = model.seasons.flatMap(x => Array.from({ length: Math.min(x.completedThrough, 18) }, (_, i) => ({ season: x.season, week: i + 1 })));
  const weeks = [...new Map([...recorded, ...finals].map(w => [`${w.season}|${w.week}`, { season: w.season, week: w.week, taped: taped.has(`${w.season}|${w.week}`) }])).values()]
    .filter(w => model.seasons.some(x => x.season === w.season)).sort((a, b) => b.season - a.season || b.week - a.week);
  if (!weeks.length) { el.innerHTML = empty('🔥', 'No weeks to replay yet', 'The heartburn chart starts after the first week is final.'); return; }
  const playing = w => (model.seasons.find(x => x.season === w.season)?.completedThrough ?? 0) < w.week;
  // Open on the newest finished week; a week still being played is there to pick.
  const pick = weeks.find(w => w.season === q.hbs && String(w.week) === String(q.hbw)) || weeks.find(w => !playing(w)) || weeks[0];
  const weekPicker = `<label class="muted">Week <select id="hbw">${[...new Set(weeks.map(w => w.season))].map(ss => `<optgroup label="${ss}">${weeks.filter(w => w.season === ss).map(w => `<option value="${w.season}|${w.week}" ${w === pick ? 'selected' : ''}>${w.season} week ${w.week}${playing(w) ? ' (in progress)' : w.taped ? ' (live ticker)' : ''}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  // Redraw just this card (and note the choice in the address) so the page stays put.
  const redraw = patch => { el.style.minHeight = `${el.offsetHeight}px`; el.classList.add('busy'); heartburnSection(el, model, quietQuery(patch), hl).finally(() => { el.style.minHeight = ''; el.classList.remove('busy'); }); };
  const wire = () => { el.querySelector('#hbw').onchange = e => { const [ss, ww] = e.target.value.split('|'); redraw({ hbs: ss, hbw: ww, hbm: null }); }; };
  const stuck = msg => { el.innerHTML = `<div class="toolbar">${weekPicker}</div>${msg}`; wire(); };
  let d;
  try { d = await apiGet(lp(`/heartburn?season=${encodeURIComponent(pick.season)}&week=${pick.week}`)); }
  catch (e) { stuck(`<p class="err">Couldn’t load ${esc(pick.season)} week ${pick.week}: ${esc(e.message)}</p>`); return; }
  const s = model.seasons.find(x => x.season === d.season);
  const games = (s?.games || []).filter(g => g.week === d.week && g.type !== 'consolation');
  // A week still being played stops at now (and has nothing to draw before its first kickoff).
  const live = !!s && d.week > s.completedThrough;
  const lines = games.map(g => { const line = heartburn(model, s, d.week, g.a.rid, g.b.rid, d.events, d.schedule, { teamOf: d.teamOf, box: d.source === 'box', until: live ? Date.now() : Infinity }); return { g, line, sc: heartburnScore(line) }; }).filter(x => x.line.length > 2);
  if (!lines.length) { stuck(live ? empty('🔥', 'Nothing to replay yet', 'This week’s games haven’t started. Check back after kickoff.') : empty('🔥', 'Nothing to replay for this week', 'Its kickoff times didn’t come back. Try another week.')); return; }
  lines.sort((a, b) => b.sc.move - a.sc.move);
  const key = x => String(x.g.matchupId ?? x.g.bracketMatch);
  const cur = (q.hbm && lines.find(x => key(x) === q.hbm)) || lines[0];
  el.innerHTML = `<div class="toolbar">${weekPicker}
      <label class="muted">Matchup <select id="hbm">${lines.map((x, i) => `<option value="${key(x)}" ${x === cur ? 'selected' : ''}>${i === 0 ? '🔥 ' : ''}${esc(nameOf(x.g.a.owner))} vs ${esc(nameOf(x.g.b.owner))}</option>`).join('')}</select></label></div>
    <div id="hbchart"></div><div class="verdicts" id="hbv"></div>`;
  wire();
  el.querySelector('#hbm').onchange = e => redraw({ hbs: d.season, hbw: String(d.week), hbm: e.target.value });
  drawHeartburn(el.querySelector('#hbchart'), cur.line, cur.g);
  const { sc, g, line } = cur, A = nameOf(g.a.owner), B = nameOf(g.b.owner);
  const fin = line[line.length - 1], won = g.final ? (g.winner === 'a' ? A : g.winner === 'b' ? B : null) : null;
  const v = [];
  v.push(`🔥 ${esc(A)}’s chances went as high as ${pct(sc.hi)} and as low as ${pct(sc.lo)}, and ${sc.flips ? `the lead changed hands ${sc.flips} time${sc.flips === 1 ? '' : 's'}` : 'the lead never changed hands'}.${won ? ` ${esc(won)} won ${f1(Math.max(g.a.pts, g.b.pts))}-${f1(Math.min(g.a.pts, g.b.pts))}.` : ` It’s ${f1(fin.a)}-${f1(fin.b)} so far.`}`);
  const pk = sc.peak;
  if (pk.at?.ev && Math.abs(pk.drop) >= 0.1) {
    const ev = pk.at.ev, hurt = pk.drop < 0 ? A : B;
    v.push(`💥 Gut punch: ${pl(ev.pid)} ${ev.delta >= 0 ? `+${f1(ev.delta)}` : f1(ev.delta)} at ${timeLabel(pk.at.t)} moved ${esc(A)} from ${pct(pk.at.p - pk.drop)} to ${pct(pk.at.p)}. ${esc(hurt)} felt that one.`);
  }
  if (lines.length > 1 && cur !== lines[0]) v.push(`<span class="muted">The week’s most stressful game was ${esc(nameOf(lines[0].g.a.owner))} vs ${esc(nameOf(lines[0].g.b.owner))}.</span>`);
  v.push(d.source === 'box'
    ? '<span class="muted">Nobody watched this week on the Live page, so it’s rebuilt from the box score: each starter’s points are spread evenly over his game. The swings between time slots are real; the plays inside a game are smoothed out. Chances use each starter’s average and how much of his game is left.</span>'
    : '<span class="muted">Replayed from the Live page’s ticker. Chances use each starter’s average and how much of his game is left. Stretches where nobody had the Live page open show as one big jump.</span>');
  el.querySelector('#hbv').innerHTML = v.map(x => `<p>${x}</p>`).join('');
}

function draftSection(el, model, s, hl) {
  const r = draftArchetypes(model, s);
  if (!r) { el.innerHTML = empty('📋', `No ${esc(s.season)} draft on record`); return; }
  const teams = [...r.teams].sort((a, b) => b.tags.length - a.tags.length || a.rank - b.rank);
  el.innerHTML = `<div class="grid g3 archetypes">${teams.map(t => `<div class="arch${t.owner === hl ? ' me' : ''}"><div class="arch-h">${chip(t.owner)}<span class="pill">${esc(t.grade)} · class ranks ${t.rank} of ${r.size}</span></div>
      ${t.tags.length ? t.tags.map(x => `<div class="arch-tag"><span class="arch-ic" aria-hidden="true">${x.icon}</span><div><b>${esc(x.label)}</b><div class="muted small">${esc(x.why)}</div></div></div>`).join('')
        : '<div class="arch-tag"><span class="arch-ic" aria-hidden="true">📎</span><div><b>Drafted Like a Spreadsheet</b><div class="muted small">No curses, no crimes, no fun. Nothing to see here.</div></div></div>'}</div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- heartburn chart

/** Update the address's query without a hashchange (so the router doesn't redraw the page); returns the new query. */
function quietQuery(patch) {
  const { parts, q } = params();
  const next = { ...q, ...patch };
  for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
  const qs = new URLSearchParams(next).toString();
  history.replaceState(history.state, '', `#/${parts.map(encodeURIComponent).join('/')}${qs ? '?' + qs : ''}`);
  return next;
}

function timeLabel(t) { return new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
const SHORT = { 'Thursday Night Football': 'TNF', 'Sunday Night Football': 'SNF', 'Monday Night Football': 'MNF' };

/** Win probability over the week's game time: quiet stretches between windows are squeezed out. */
function drawHeartburn(el, line, g) {
  const W = widthOf(el), H = W < 520 ? 240 : 300, m = { t: 14, r: 12, b: 34, l: 40 };
  // Live segments: runs of points no more than 30 minutes apart.
  const segs = [];
  for (const p of line) { const s = segs[segs.length - 1]; if (s && p.t - s.end <= 30 * 60e3) { s.end = p.t; s.pts.push(p); } else segs.push({ start: p.t, end: p.t, pts: [p] }); }
  const gap = Math.max(10, (W - m.l - m.r) * 0.02), live = segs.reduce((t, s) => t + Math.max(60e3, s.end - s.start), 0);
  const scale = (W - m.l - m.r - gap * (segs.length - 1)) / live;
  let off = m.l; for (const s of segs) { s.x0 = off; off += Math.max(60e3, s.end - s.start) * scale + gap; }
  const X = p => { const s = segs.find(x => p.t >= x.start && p.t <= x.end) || segs[0]; return s.x0 + (p.t - s.start) * scale; };
  const Y = v => m.t + (1 - v) * (H - m.t - m.b);
  const A = nameOf(g.a.owner), B = nameOf(g.b.owner);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(A)}'s win probability against ${esc(B)}"><defs>
    <clipPath id="hbtop"><rect x="0" y="0" width="${W}" height="${Y(0.5)}"/></clipPath><clipPath id="hbbot"><rect x="0" y="${Y(0.5)}" width="${W}" height="${H}"/></clipPath></defs>`;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0.5 ? 'var(--axis)' : 'var(--grid)'}" ${v === 0.5 ? 'stroke-dasharray="4 4"' : ''}/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v * 100}%</text>`;
  let area = '', path = '';
  for (const s of segs) {
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)},${Y(p.p).toFixed(1)}`).join('');
    path += d;
    area += `${d}L${X(s.pts[s.pts.length - 1]).toFixed(1)},${Y(0.5)}L${X(s.pts[0]).toFixed(1)},${Y(0.5)}Z`;
    const lab = SHORT[tvWindow(new Date(s.start).toISOString()).label] || tvWindow(new Date(s.start).toISOString()).label.replace(/ (morning|afternoon|evening|night)$/, m0 => ({ ' morning': ' AM', ' afternoon': ' PM', ' evening': ' eve', ' night': ' night' })[m0]);
    svg += `<line x1="${s.x0}" x2="${s.x0}" y1="${m.t}" y2="${H - m.b}" stroke="var(--grid)"/>`;
    if (Math.max(60e3, s.end - s.start) * scale > 34) svg += `<text x="${s.x0 + 3}" y="${H - m.b + 14}" font-size="11" fill="var(--muted)">${esc(lab)}</text>`;
  }
  svg += `<path d="${area}" fill="var(--accent)" fill-opacity=".28" clip-path="url(#hbtop)"/><path d="${area}" fill="var(--bad)" fill-opacity=".24" clip-path="url(#hbbot)"/>`;
  svg += `<path d="${path}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`;
  svg += `<text x="${W - m.r - 4}" y="${m.t + 14}" text-anchor="end" font-size="12" font-weight="650" fill="var(--accent)">${esc(A)} winning ↑</text><text x="${W - m.r - 4}" y="${H - m.b - 6}" text-anchor="end" font-size="12" font-weight="650" fill="var(--bad)">${esc(B)} winning ↓</text>`;
  svg += `<line class="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-dasharray="3 3" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" class="hit"/></svg>`;
  el.innerHTML = `<div class="chart">${svg}<div class="tip"></div></div>`;
  const root = el.querySelector('.chart'), tip = root.querySelector('.tip'), xh = root.querySelector('.xh'), svgEl = root.querySelector('svg');
  const xs = line.map(X);
  const show = clientX => {
    const r = svgEl.getBoundingClientRect(), sx = (clientX - r.left) * (W / r.width);
    let i = 0; for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - sx) < Math.abs(xs[i] - sx)) i = k;
    const p = line[i];
    xh.setAttribute('x1', xs[i]); xh.setAttribute('x2', xs[i]); xh.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${esc(timeLabel(p.t))}</b><div class="r"><span>${esc(A)}</span><span>${pct(p.p)} · ${f1(p.a)}</span></div><div class="r"><span>${esc(B)}</span><span>${pct(1 - p.p)} · ${f1(p.b)}</span></div>${p.ev ? `<div class="muted small">${esc(model0.nameOf(p.ev.pid))} ${p.ev.delta >= 0 ? '+' : ''}${f1(p.ev.delta)}</div>` : ''}`;
    tip.style.display = 'block';
    const px = (xs[i] / W) * r.width; tip.style.left = `${px + 14 + tip.offsetWidth > r.width ? px - tip.offsetWidth - 14 : px + 14}px`; tip.style.top = '8px';
  };
  const hit = root.querySelector('.hit');
  hit.addEventListener('mousemove', e => show(e.clientX));
  hit.addEventListener('touchstart', e => show(e.touches[0].clientX), { passive: true });
  hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); });
}

/** Labeled bars that keep their numbers on screen at phone width. Negative values grow left from a center line. */
function rbars(items, { format = v => Math.round(v) } = {}) {
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1), div = items.some(i => i.value < 0);
  return `<div class="rbars${div ? ' div' : ''}">${items.map(i => {
    const w = (Math.abs(i.value) / max) * (div ? 50 : 100);
    const bar = div ? `<span class="rb-fill" style="${i.value >= 0 ? `left:50%;width:${w}%;background:var(--div-pos)` : `right:50%;width:${w}%;background:var(--div-neg)`}"></span>`
      : `<span class="rb-fill" style="left:0;width:${w}%;background:${i.color || 'var(--accent)'}"></span>`;
    return `<div class="rb-row" title="${esc(i.label)}: ${esc(format(i.value))}"><div class="rb-name">${i.html || esc(i.label)}</div><div class="rb-track">${bar}</div><div class="rb-val">${esc(format(i.value))}</div>${i.note ? `<div class="rb-note">${esc(i.note)}</div>` : ''}</div>`;
  }).join('')}</div>`;
}
