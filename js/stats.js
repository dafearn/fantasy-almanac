// The stats engine: everything the pages show is computed here from the normalized model.

export const r2 = x => Math.round(x * 100) / 100;
export const sum = a => a.reduce((t, x) => t + x, 0);
export const mean = a => (a.length ? sum(a) / a.length : 0);
export function sd(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); }
export function quantile(a, q) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); }

export const BENCH = new Set(['BN', 'IR', 'TAXI']);
export const SLOT_ELIG = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'], WRT: ['WR', 'RB', 'TE'], IDP_FLEX: ['DL', 'LB', 'DB'],
  DL: ['DL', 'DE', 'DT'], LB: ['LB'], DB: ['DB', 'CB', 'S'],
};

/** Prepare derived fields once after loading. Mutates and returns the model. */
export function prepare(model) {
  const P = model.players;
  model.posOf = id => {
    const p = P[id];
    if (p) return p.p;
    return /^[A-Z]{2,3}$/.test(id) ? 'DEF' : '?';
  };
  model.nameOf = id => P[id]?.n || id;
  model.positionsOf = id => P[id]?.fp || [model.posOf(id)];

  for (const s of model.seasons) {
    s.owner = rid => s.teams[rid]?.ownerId;
    for (const g of s.games) {
      g.a.owner = s.owner(g.a.rid); g.b.owner = s.owner(g.b.rid);
      settle(g);
    }
    // Lineup efficiency for every final team-week.
    const slots = s.rosterPositions.filter(p => !BENCH.has(p));
    for (const [w, byRid] of Object.entries(s.weeks)) {
      for (const e of Object.values(byRid)) {
        e.owner = s.owner(e.rid);
        e.season = s.season;
        e.final = Number(w) <= s.completedThrough;
        e.optimal = optimalLineup(e, slots, model);
        e.efficiency = e.optimal.pts > 0 ? e.pts / e.optimal.pts : 1;
      }
    }
    s.regStandings = standingsThrough(s, Math.min(s.completedThrough, s.regWeeks));
  }
  model.games = [...model.seasons.flatMap(s => s.games), ...(model.legacy?.games || [])]
    .sort((x, y) => (x.season - y.season) || (x.week - y.week));
  return model;
}

function settle(g) {
  if (!g.final) { g.winner = null; return; }
  const d = g.a.pts - g.b.pts;
  g.winner = d > 0 ? 'a' : d < 0 ? 'b' : 'tie';
  g.margin = Math.abs(d);
}

export function sidesOf(g) {
  if (g.winner === 'tie') return [{ ...g.a, res: 'T', opp: g.b }, { ...g.b, res: 'T', opp: g.a }];
  return [{ ...g.a, res: g.winner === 'a' ? 'W' : 'L', opp: g.b }, { ...g.b, res: g.winner === 'b' ? 'W' : 'L', opp: g.a }];
}

export function optimalLineup(e, slots, model) {
  const pool = e.players.map(id => ({ id, pts: Number(e.playersPts[id] || 0), pos: model.positionsOf(id) }))
    .sort((a, b) => b.pts - a.pts);
  const order = slots.map((s, i) => ({ s, i, elig: SLOT_ELIG[s] || [s] })).sort((a, b) => a.elig.length - b.elig.length);
  const used = new Set(); const lineup = []; let pts = 0;
  for (const slot of order) {
    const pick = pool.find(p => !used.has(p.id) && p.pos.some(x => slot.elig.includes(x)));
    if (pick) { used.add(pick.id); lineup.push({ slot: slot.s, ...pick }); pts += pick.pts; }
  }
  return { pts: r2(pts), lineup };
}

/** Regular-season standings using final games with week <= w. */
export function standingsThrough(s, w) {
  const rows = {};
  for (const [rid, t] of Object.entries(s.teams)) {
    rows[rid] = { rid: Number(rid), owner: t.ownerId, w: 0, l: 0, t: 0, pf: 0, pa: 0, apw: 0, apl: 0, apt: 0, xw: 0, scores: [], results: [] };
  }
  for (const g of s.games) {
    if (g.type !== 'reg' || !g.final || g.week > w) continue;
    for (const sd_ of sidesOf(g)) {
      const r = rows[sd_.rid]; if (!r) continue;
      if (sd_.res === 'W') r.w++; else if (sd_.res === 'L') r.l++; else r.t++;
      r.pf += sd_.pts; r.pa += sd_.opp.pts; r.results.push({ week: g.week, res: sd_.res });
    }
  }
  // All-play and expected wins from every team's weekly score.
  for (let wk = 1; wk <= w; wk++) {
    const entries = Object.values(s.weeks[wk] || {}).filter(e => rows[e.rid]);
    if (!entries.length) continue;
    for (const e of entries) {
      const r = rows[e.rid]; r.scores.push(e.pts);
      let wins = 0, losses = 0, ties = 0;
      for (const o of entries) if (o !== e) { if (e.pts > o.pts) wins++; else if (e.pts < o.pts) losses++; else ties++; }
      r.apw += wins; r.apl += losses; r.apt += ties;
      r.xw += (wins + ties / 2) / Math.max(1, entries.length - 1);
    }
  }
  const list = Object.values(rows).map(r => {
    r.pf = r2(r.pf); r.pa = r2(r.pa); r.xw = r2(r.xw);
    r.games = r.w + r.l + r.t;
    r.pct = r.games ? (r.w + r.t / 2) / r.games : 0;
    r.apPct = (r.apw + r.apl + r.apt) ? (r.apw + r.apt / 2) / (r.apw + r.apl + r.apt) : 0;
    r.luck = r2(r.w + r.t / 2 - r.xw);
    r.avg = mean(r.scores); r.sd = sd(r.scores);
    r.streak = streakOf(r.results);
    return r;
  });
  list.sort(cmpStanding);
  list.forEach((r, i) => (r.rank = i + 1));
  return list;
}

export function cmpStanding(a, b) { return (b.w + b.t / 2) - (a.w + a.t / 2) || b.pf - a.pf; }

function streakOf(results) {
  if (!results.length) return '';
  const last = results[results.length - 1].res; let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i].res === last; i--) n++;
  return `${last}${n}`;
}

// ---------------------------------------------------------------------------
// Power rankings

export function powerRankings(s, w) {
  const st = standingsThrough(s, Math.min(w, s.regWeeks));
  const weeks = [];
  for (let k = 1; k <= w; k++) if (s.weeks[k]) weeks.push(k);
  const rows = Object.keys(s.teams).map(rid => {
    const es = weeks.map(k => s.weeks[k][rid]).filter(Boolean);
    const pts = es.map(e => e.pts);
    const recent = pts.slice(-3);
    const row = st.find(x => x.rid === Number(rid));
    // all-play across every week played so far (including playoff weeks)
    let apw = 0, apn = 0;
    for (const k of weeks) {
      const all = Object.values(s.weeks[k]);
      const me = s.weeks[k][rid]; if (!me) continue;
      for (const o of all) if (o !== me) { apn++; if (me.pts > o.pts) apw++; else if (me.pts === o.pts) apw += 0.5; }
    }
    return {
      rid: Number(rid), owner: s.teams[rid].ownerId, record: row ? `${row.w}-${row.l}${row.t ? '-' + row.t : ''}` : '',
      apPct: apn ? apw / apn : 0, recent: mean(recent), avg: mean(pts), winPct: row ? row.pct : 0,
      eff: mean(es.map(e => e.efficiency)), consistency: -sd(pts),
    };
  });
  const comps = { winPct: 0.35, apPct: 0.3, recent: 0.15, avg: 0.1, eff: 0.05, consistency: 0.05 };
  for (const [k, wgt] of Object.entries(comps)) {
    const sorted = [...rows].sort((a, b) => a[k] - b[k]);
    rows.forEach(r => {
      const lo = sorted.findIndex(x => x[k] === r[k]);
      const hi = sorted.length - 1 - [...sorted].reverse().findIndex(x => x[k] === r[k]);
      const pctile = rows.length > 1 ? ((lo + hi) / 2) / (rows.length - 1) : 1;
      r.score = (r.score || 0) + wgt * pctile * 100;
    });
  }
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; r.score = r2(r.score); });
  return rows;
}

/** {rid: [rank at week 1, rank at week 2, ...]} for weeks with final scores. */
export function powerHistory(s) {
  const out = {};
  const last = Math.min(s.completedThrough, s.lastWeek);
  for (let w = 1; w <= last; w++) {
    for (const r of powerRankings(s, w)) (out[r.rid] ||= []).push(r.rank);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Playoff odds (Monte Carlo over the remaining regular-season schedule)

function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export function byesFor(n) { if (n <= 2) return 0; const p = 2 ** Math.ceil(Math.log2(n)); return p - n; }

/** Key for one game in the playoff machine's picks. */
export const gameKey = g => `${g.week}:${g.a.rid}:${g.b.rid}`;

/**
 * Monte Carlo playoff odds from standings after week `through`. `forced` maps gameKey -> 'a' | 'b'
 * to fix a game's winner (the playoff machine); the rest are simulated.
 */
export function playoffOdds(s, through, sims = 5000, forced = {}) {
  const st = standingsThrough(s, through);
  const all = st.flatMap(r => r.scores);
  const lgMean = mean(all) || 100, lgSd = sd(all) || 25;
  const K = 3; // regress early-season averages toward the league mean
  const model = {};
  for (const r of st) {
    const n = r.scores.length;
    model[r.rid] = { mu: (n * (r.avg || 0) + K * lgMean) / (n + K), sigma: n >= 4 ? (r.sd * n + lgSd * K) / (n + K) : lgSd };
  }
  const remaining = s.games.filter(g => g.type === 'reg' && g.week > through);
  const byes = byesFor(s.playoffTeams);
  const tally = Object.fromEntries(st.map(r => [r.rid, { playoff: 0, bye: 0, top: 0, last: 0, wins: 0, seedSum: 0 }]));
  for (let i = 0; i < sims; i++) {
    const cur = Object.fromEntries(st.map(r => [r.rid, { rid: r.rid, w: r.w, l: r.l, t: r.t, pf: r.pf }]));
    for (const g of remaining) {
      const A = cur[g.a.rid], B = cur[g.b.rid]; if (!A || !B) continue;
      const pa = model[g.a.rid].mu + model[g.a.rid].sigma * randn();
      const pb = model[g.b.rid].mu + model[g.b.rid].sigma * randn();
      A.pf += pa; B.pf += pb;
      const f = forced[gameKey(g)];
      if (f ? f === 'a' : pa > pb) { A.w++; B.l++; } else { B.w++; A.l++; }
    }
    const order = Object.values(cur).sort(cmpStanding);
    order.forEach((r, idx) => {
      const t = tally[r.rid];
      t.wins += r.w; t.seedSum += idx + 1;
      if (idx < s.playoffTeams) t.playoff++;
      if (idx < byes) t.bye++;
      if (idx === 0) t.top++;
      if (idx === order.length - 1) t.last++;
    });
  }
  const out = {};
  for (const [rid, t] of Object.entries(tally)) {
    out[rid] = { playoff: t.playoff / sims, bye: t.bye / sims, top: t.top / sims, last: t.last / sims, projWins: t.wins / sims, avgSeed: t.seedSum / sims };
  }
  return out;
}

/** Playoff odds after each completed regular-season week (for the odds-over-time chart). */
export function oddsHistory(s, sims = 1500) {
  const out = {};
  const last = Math.min(s.completedThrough, s.regWeeks);
  for (let w = 0; w <= last; w++) {
    const o = playoffOdds(s, w, sims);
    for (const [rid, v] of Object.entries(o)) (out[rid] ||= []).push(v.playoff);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Head-to-head, records, careers

export function headToHead(model, { includeConsolation = false } = {}) {
  const pairs = {};
  for (const g of model.games) {
    if (!g.final || (!includeConsolation && g.type === 'consolation')) continue;
    for (const sd_ of sidesOf(g)) {
      const key = `${sd_.owner}|${sd_.opp.owner}`;
      const p = pairs[key] ||= { w: 0, l: 0, t: 0, pf: 0, pa: 0, games: [] };
      if (sd_.res === 'W') p.w++; else if (sd_.res === 'L') p.l++; else p.t++;
      p.pf += sd_.pts; p.pa += sd_.opp.pts; p.games.push(g);
    }
  }
  return pairs;
}

export function finalPlace(s, rid) {
  if (s.place[rid]) return s.place[rid];
  const placed = Object.keys(s.place).length;
  const unplaced = s.regStandings.filter(r => !s.place[r.rid]);
  const i = unplaced.findIndex(r => r.rid === Number(rid));
  return i >= 0 ? placed + i + 1 : null;
}

export function careers(model, skip = null) {
  const out = {};
  const sink = { pw: 0, pl: 0, trades: 0, adds: 0, faab: 0, weeks: [], titles: [], runnerUps: [] };
  // Seasons left out for one manager (skip holds "ownerId|season"): their numbers go nowhere.
  const pick = (id, season) => (skip?.has(`${id}|${season}`) ? sink : get(id));
  const get = id => out[id] ||= {
    id, w: 0, l: 0, t: 0, pf: 0, pa: 0, pw: 0, pl: 0, titles: [], runnerUps: [], playoffs: 0, seasons: [],
    xw: 0, weeks: [], trades: 0, adds: 0, faab: 0, lastPlaces: 0,
  };
  for (const s of model.seasons) {
    const finished = s.status === 'complete';
    for (const r of s.regStandings) {
      if (skip?.has(`${r.owner}|${s.season}`)) continue;
      const c = get(r.owner);
      c.w += r.w; c.l += r.l; c.t += r.t; c.pf += r.pf; c.pa += r.pa; c.xw += r.xw;
      const madePlayoffs = r.rank <= s.playoffTeams && s.completedThrough >= s.regWeeks;
      if (madePlayoffs) c.playoffs++;
      const place = finished ? finalPlace(s, r.rid) : null;
      if (finished && r.rank === s.regStandings.length) c.lastPlaces++;
      c.seasons.push({ season: s.season, rid: r.rid, team: s.teams[r.rid].teamName, record: `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`, w: r.w, l: r.l, t: r.t, pf: r.pf, pa: r.pa, seed: r.rank, place, madePlayoffs, luck: r.luck, apPct: r.apPct, inProgress: !finished });
    }
    if (s.champion != null) pick(s.owner(s.champion), s.season).titles.push(s.season);
    const final = s.winners.find(b => b.p === 1 && b.l != null);
    if (final) pick(s.owner(final.l), s.season).runnerUps.push(s.season);
    for (const g of s.games) if (g.type === 'playoff' && g.final) for (const x of sidesOf(g)) { const c = pick(x.owner, s.season); if (x.res === 'W') c.pw++; else if (x.res === 'L') c.pl++; }
    for (const [w, byRid] of Object.entries(s.weeks)) for (const e of Object.values(byRid)) if (e.final) pick(e.owner, s.season).weeks.push({ season: s.season, week: Number(w), pts: e.pts, eff: e.efficiency });
    for (const t of s.transactions) {
      for (const rid of t.rids) {
        const c = pick(s.owner(rid), s.season); if (!c) continue;
        if (t.type === 'trade') c.trades++;
      }
      if (t.type === 'waiver' || t.type === 'free_agent') {
        for (const rid of new Set(Object.values(t.adds))) { const c = pick(s.owner(rid), s.season); c.adds++; if (t.type === 'waiver' && t.bid) c.faab += t.bid; }
      }
    }
  }
  for (const ls of model.legacy?.seasons || []) {
    for (const r of ls.standings || []) {
      const c = get(r.owner);
      c.w += r.wins || 0; c.l += r.losses || 0; c.t += r.ties || 0; c.pf += r.pf || 0; c.pa += r.pa || 0;
      if (r.playoffs) c.playoffs++;
      c.seasons.push({ season: ls.season, team: r.team || '', record: r.wins != null ? `${r.wins}-${r.losses}${r.ties ? '-' + r.ties : ''}` : '', w: r.wins, l: r.losses, t: r.ties || 0, pf: r.pf, pa: r.pa, seed: r.seed ?? null, place: r.rank ?? null, madePlayoffs: !!r.playoffs, legacy: true });
    }
    if (ls.champion) get(ls.champion).titles.push(ls.season);
    if (ls.runnerUp) get(ls.runnerUp).runnerUps.push(ls.season);
    if (ls.lastPlace) get(ls.lastPlace).lastPlaces++;
  }
  for (const c of Object.values(out)) {
    c.seasons.sort((a, b) => a.season - b.season);
    c.games = c.w + c.l + c.t; c.pct = c.games ? (c.w + c.t / 2) / c.games : 0;
    c.pf = r2(c.pf); c.pa = r2(c.pa); c.luck = r2(c.w + c.t / 2 - c.xw);
    const pts = c.weeks.map(x => x.pts);
    c.avg = mean(pts); c.best = [...c.weeks].sort((a, b) => b.pts - a.pts)[0]; c.worst = [...c.weeks].sort((a, b) => a.pts - b.pts)[0];
    c.eff = mean(c.weeks.map(x => x.eff));
  }
  return out;
}

/** Streaks over every final game in chronological order (regular season and playoffs). */
export function streaks(model) {
  const seq = {};
  for (const g of model.games) {
    if (!g.final || g.type === 'consolation') continue;
    for (const x of sidesOf(g)) (seq[x.owner] ||= []).push({ res: x.res, season: g.season, week: g.week });
  }
  const out = [];
  for (const [owner, list] of Object.entries(seq)) {
    for (const want of ['W', 'L']) {
      let best = { n: 0 }, cur = 0, start = null;
      list.forEach((x, i) => {
        if (x.res === want) { if (!cur) start = x; cur++; if (cur > best.n) best = { n: cur, start, end: x }; }
        else cur = 0;
      });
      if (best.n) out.push({ owner, kind: want, ...best });
    }
  }
  return out;
}

export function recordBook(model) {
  const games = model.games.filter(g => g.final);
  const sides = games.flatMap(g => sidesOf(g).map(x => ({ ...x, g })));
  const top = (arr, key, n = 10, asc = false) => [...arr].sort((a, b) => asc ? key(a) - key(b) : key(b) - key(a)).slice(0, n);
  const playerGames = [];
  for (const s of model.seasons) for (const [w, byRid] of Object.entries(s.weeks)) for (const e of Object.values(byRid)) {
    if (!e.final) continue;
    e.starters.forEach((id, i) => { if (id && id !== '0') playerGames.push({ season: s.season, week: Number(w), owner: e.owner, id, pts: Number(e.startersPts[i] || 0) }); });
  }
  const seasonRows = model.seasons.filter(s => s.completedThrough >= 1).flatMap(s => s.regStandings.map(r => ({ ...r, season: s.season, inProgress: s.status !== 'complete' })));
  const st = streaks(model);
  return {
    highScore: top(sides, x => x.pts),
    lowScore: top(sides.filter(x => x.g.type !== 'consolation'), x => x.pts, 10, true),
    blowouts: top(games.filter(g => g.winner !== 'tie'), g => g.margin),
    closest: top(games, g => g.margin, 10, true),
    highLoss: top(sides.filter(x => x.res === 'L'), x => x.pts),
    lowWin: top(sides.filter(x => x.res === 'W'), x => x.pts, 10, true),
    combined: top(games, g => g.a.pts + g.b.pts),
    seasonPF: top(seasonRows, r => r.pf / Math.max(1, r.games)),
    seasonWins: top(seasonRows.filter(r => !r.inProgress), r => r.pct),
    luckiest: top(seasonRows.filter(r => !r.inProgress), r => r.luck),
    unluckiest: top(seasonRows.filter(r => !r.inProgress), r => r.luck, 10, true),
    winStreaks: top(st.filter(x => x.kind === 'W'), x => x.n),
    lossStreaks: top(st.filter(x => x.kind === 'L'), x => x.n),
    playerGames: top(playerGames, x => x.pts),
  };
}

// ---------------------------------------------------------------------------
// Players, drafts, trades, waivers

/** Season points per player (regular season, any roster in the league) and positional ranks. */
export function playerSeason(model, s) {
  const pts = {}, weeks = {}, startedBy = {};
  for (let w = 1; w <= Math.min(s.completedThrough, s.regWeeks); w++) {
    for (const e of Object.values(s.weeks[w] || {})) {
      for (const [id, p] of Object.entries(e.playersPts)) { pts[id] = (pts[id] || 0) + Number(p); weeks[id] = (weeks[id] || 0) + 1; }
      e.starters.forEach((id, i) => { const k = `${id}|${e.owner}`; startedBy[k] = (startedBy[k] || 0) + Number(e.startersPts[i] || 0); });
    }
  }
  const byPos = {};
  for (const id of Object.keys(pts)) (byPos[model.posOf(id)] ||= []).push(id);
  const posRank = {};
  for (const ids of Object.values(byPos)) ids.sort((a, b) => pts[b] - pts[a]).forEach((id, i) => (posRank[id] = i + 1));
  return { pts, weeks, posRank, startedBy };
}

const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'];
export function gradeFor(rank, n) { return GRADES[Math.min(GRADES.length - 1, Math.floor((rank - 1) * GRADES.length / Math.max(1, n)))]; }

export function draftAnalysis(model, s) {
  if (!s.draft || !s.draft.picks.length) return null;
  const ps = playerSeason(model, s);
  const picks = [...s.draft.picks].sort((a, b) => a.pickNo - b.pickNo);
  const posOrder = {};
  const rows = picks.map(p => {
    const pos = p.pos || model.posOf(p.playerId);
    posOrder[pos] = (posOrder[pos] || 0) + 1;
    const finish = ps.posRank[p.playerId] ?? null;
    return { ...p, pos, draftPosRank: posOrder[pos], finishPosRank: finish, pts: r2(ps.pts[p.playerId] || 0),
      startedPts: r2(ps.startedBy[`${p.playerId}|${p.ownerId}`] || 0),
      value: finish == null ? null : posOrder[pos] - finish };
  });
  const byOwner = {};
  for (const r of rows) {
    const o = byOwner[r.ownerId] ||= { owner: r.ownerId, pts: 0, started: 0, value: 0, picks: [] };
    o.pts += r.pts; o.started += r.startedPts; o.value += r.value || 0; o.picks.push(r);
  }
  const teams = Object.values(byOwner).sort((a, b) => b.pts - a.pts);
  teams.forEach((t, i) => { t.rank = i + 1; t.grade = gradeFor(i + 1, teams.length); t.pts = r2(t.pts); t.started = r2(t.started); });
  const valued = rows.filter(r => r.value != null && r.round <= Math.max(...rows.map(x => x.round)));
  return {
    rows, teams,
    steals: [...valued].sort((a, b) => b.value - a.value || b.pts - a.pts).slice(0, 8),
    busts: [...valued].filter(r => r.round <= 6).sort((a, b) => a.value - b.value || a.pts - b.pts).slice(0, 8),
  };
}

/** Positions taken by round, per manager across all Sleeper drafts. */
export function draftTendencies(model, owner) {
  const byRound = {};
  for (const s of model.seasons) for (const p of s.draft?.picks || []) {
    if (p.ownerId !== owner) continue;
    const pos = p.pos || model.posOf(p.playerId);
    (byRound[p.round] ||= {})[pos] = (byRound[p.round][pos] || 0) + 1;
  }
  return byRound;
}

function startedAfter(s, owner, ids, fromWeek) {
  let pts = 0; const per = {};
  for (let w = fromWeek; w <= s.completedThrough; w++) {
    const e = Object.values(s.weeks[w] || {}).find(x => x.owner === owner); if (!e) continue;
    e.starters.forEach((id, i) => { if (ids.includes(id)) { const v = Number(e.startersPts[i] || 0); pts += v; per[id] = (per[id] || 0) + v; } });
  }
  return { pts: r2(pts), per };
}

export function tradeAnalysis(model, s) {
  return s.transactions.filter(t => t.type === 'trade').map(t => {
    const sides = t.rids.map(rid => {
      const owner = s.owner(rid);
      const got = Object.entries(t.adds).filter(([, r]) => r === rid).map(([id]) => id);
      const gave = Object.entries(t.drops).filter(([, r]) => r === rid).map(([id]) => id);
      const picks = t.picks.filter(p => p.owner_id === rid).map(p => `${p.season} R${p.round}`);
      const res = startedAfter(s, owner, got, Math.max(1, t.week || 1));
      return { rid, owner, got, gave, picks, startedPts: res.pts, per: res.per };
    });
    const best = [...sides].sort((a, b) => b.startedPts - a.startedPts);
    const edge = best.length > 1 ? r2(best[0].startedPts - best[1].startedPts) : 0;
    return { ...t, sides, winner: edge > 0 ? best[0].owner : null, edge };
  });
}

export function pickupAnalysis(model, s) {
  const rows = [];
  for (const t of s.transactions) {
    if (t.type !== 'waiver' && t.type !== 'free_agent') continue;
    for (const [id, rid] of Object.entries(t.adds)) {
      const owner = s.owner(rid);
      const res = startedAfter(s, owner, [id], Math.max(1, t.week || 1));
      rows.push({ season: s.season, week: t.week, owner, id, type: t.type, bid: t.bid, startedPts: res.pts });
    }
  }
  return rows.sort((a, b) => b.startedPts - a.startedPts);
}

/** Per-manager scoring profile for one season (FantasyPros-style boom/bust and quality starts). */
export function consistency(s) {
  const all = [];
  for (let w = 1; w <= s.completedThrough; w++) for (const e of Object.values(s.weeks[w] || {})) all.push(e.pts);
  const p75 = quantile(all, 0.75), p25 = quantile(all, 0.25), med = quantile(all, 0.5);
  return Object.keys(s.teams).map(rid => {
    const pts = [];
    for (let w = 1; w <= s.completedThrough; w++) { const e = s.weeks[w]?.[rid]; if (e) pts.push(e.pts); }
    return { rid: Number(rid), owner: s.teams[rid].ownerId, avg: mean(pts), sd: sd(pts), min: Math.min(...pts), max: Math.max(...pts),
      boom: pts.filter(x => x >= p75).length / (pts.length || 1), bust: pts.filter(x => x <= p25).length / (pts.length || 1),
      aboveMedian: pts.filter(x => x > med).length, n: pts.length };
  }).sort((a, b) => b.avg - a.avg);
}

// ---------------------------------------------------------------------------
// Round 2: schedule luck, median record, All-League, achievements, win odds, players

/** wins[a][b] = team a's regular-season wins if it had played team b's schedule. */
export function scheduleSwap(s) {
  const through = Math.min(s.completedThrough, s.regWeeks);
  const rids = Object.keys(s.teams).map(Number);
  const opp = {}; // week -> rid -> opponent rid
  for (const g of s.games) if (g.type === 'reg' && g.final && g.week <= through) { (opp[g.week] ||= {})[g.a.rid] = g.b.rid; opp[g.week][g.b.rid] = g.a.rid; }
  const pts = (w, rid) => s.weeks[w]?.[rid]?.pts ?? 0;
  const out = {};
  for (const a of rids) {
    out[a] = {};
    for (const b of rids) {
      let w = 0, l = 0, t = 0;
      for (const [wk, map] of Object.entries(opp)) {
        let o = map[b]; if (o == null) continue;
        if (o === a) o = b; // a would face b where b faced a
        const d = pts(wk, a) - pts(wk, o);
        if (d > 0) w++; else if (d < 0) l++; else t++;
      }
      out[a][b] = { w, l, t };
    }
  }
  return out;
}

/** Record against the weekly league median (a second "game" every week, as many leagues play). */
export function medianRecords(s) {
  const through = Math.min(s.completedThrough, s.regWeeks);
  const out = Object.fromEntries(Object.keys(s.teams).map(r => [r, { w: 0, l: 0 }]));
  for (let w = 1; w <= through; w++) {
    const es = Object.values(s.weeks[w] || {}); if (!es.length) continue;
    const med = quantile(es.map(e => e.pts), 0.5);
    for (const e of es) if (out[e.rid]) { if (e.pts > med) out[e.rid].w++; else out[e.rid].l++; }
  }
  return out;
}

const SLOT_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
/** Every started player-game, optionally limited to one season. */
export function startedGames(model, season) {
  const out = [];
  for (const s of model.seasons) {
    if (season && s.season !== season) continue;
    for (const [w, byRid] of Object.entries(s.weeks)) for (const e of Object.values(byRid)) {
      if (!e.final) continue;
      e.starters.forEach((id, i) => { if (id && id !== '0') out.push({ season: s.season, week: Number(w), owner: e.owner, id, pos: model.posOf(id), pts: Number(e.startersPts[i] || 0), playoff: Number(w) >= s.playoffStart }); });
    }
  }
  return out;
}

/** All-League (best) and Bush League (worst) lineups: one entry per starting slot. */
export function allLeague(model, s) {
  const slots = s.rosterPositions.filter(p => !['BN', 'IR', 'TAXI'].includes(p));
  const games = startedGames(model, s?.season).filter(g => !g.playoff);
  // Season All-League: most started points at the position
  const totals = {};
  for (const g of games) { const k = g.id; const t = totals[k] ||= { id: g.id, pos: g.pos, pts: 0, starts: 0, owners: {} }; t.pts += g.pts; t.starts++; t.owners[g.owner] = (t.owners[g.owner] || 0) + 1; }
  const pickSlots = (pool, better) => {
    const used = new Set(); const out = [];
    const order = slots.map(sl => ({ sl, elig: ({ FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['WR', 'RB'] })[sl] || [sl] })).sort((a, b) => a.elig.length - b.elig.length);
    for (const { sl, elig } of order) {
      const pick = pool.filter(x => elig.includes(x.pos) && !used.has(x.key)).sort(better)[0];
      if (pick) { used.add(pick.key); out.push({ slot: sl, ...pick }); }
    }
    return out.sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot));
  };
  const seasonTeam = pickSlots(Object.values(totals).map(t => ({ ...t, key: t.id, owner: Object.entries(t.owners).sort((a, b) => b[1] - a[1])[0][0] })), (a, b) => b.pts - a.pts);
  const best = pickSlots(games.map((g, i) => ({ ...g, key: g.id })), (a, b) => b.pts - a.pts);
  // Zeros are usually byes or injuries, so the Bush League skips them and they're counted separately.
  const worst = pickSlots(games.filter(g => SLOT_POS.includes(g.pos) && g.pts !== 0).map(g => ({ ...g, key: `${g.id}|${g.season}|${g.week}` })), (a, b) => a.pts - b.pts);
  const zeros = {}; for (const g of games) if (g.pts === 0) zeros[g.owner] = (zeros[g.owner] || 0) + 1;
  return { seasonTeam, best, worst, zeros: Object.entries(zeros).map(([owner, n]) => ({ owner, n })).sort((a, b) => b.n - a.n) };
}

/** Win probability for the first team, from season scoring so far (normal model, regressed to league mean). */
export function winProb(s, ridA, ridB, through) {
  const st = standingsThrough(s, through);
  const all = st.flatMap(r => r.scores); const lm = mean(all) || 100, lsd = sd(all) || 25;
  const m = rid => { const r = st.find(x => x.rid === Number(rid)); const n = r?.scores.length || 0; return { mu: (n * (r?.avg || 0) + 3 * lm) / (n + 3), sig: n >= 4 ? (r.sd * n + lsd * 3) / (n + 3) : lsd }; };
  const A = m(ridA), B = m(ridB);
  const z = (A.mu - B.mu) / Math.sqrt(A.sig ** 2 + B.sig ** 2);
  return { p: normCdf(z), muA: A.mu, muB: B.mu };
}
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }

/** Everything the league knows about one player. */
export function playerHistory(model, id) {
  const seasons = [];
  for (const s of model.seasons) {
    const by = {};
    for (const [w, byRid] of Object.entries(s.weeks)) for (const e of Object.values(byRid)) {
      if (!e.final || !e.players.includes(id)) continue;
      const o = by[e.owner] ||= { owner: e.owner, weeks: 0, starts: 0, pts: 0, startedPts: 0 };
      o.weeks++; o.pts += Number(e.playersPts[id] || 0);
      const i = e.starters.indexOf(id); if (i >= 0) { o.starts++; o.startedPts += Number(e.startersPts[i] || 0); }
    }
    const pick = s.draft?.picks.find(p => p.playerId === id) || null;
    const moves = s.transactions.filter(t => id in t.adds || id in t.drops).map(t => ({ ...t, to: t.adds[id] != null ? s.owner(t.adds[id]) : null, from: t.drops[id] != null ? s.owner(t.drops[id]) : null }));
    if (Object.keys(by).length || pick || moves.length) seasons.push({ season: s.season, owners: Object.values(by), pick, moves });
  }
  return seasons;
}

/** League-wide player list with career league points (any roster). */
export function playerIndex(model) {
  const out = {};
  for (const s of model.seasons) for (const byRid of Object.values(s.weeks)) for (const e of Object.values(byRid)) {
    if (!e.final) continue;
    for (const [id, p] of Object.entries(e.playersPts)) { const x = out[id] ||= { id, pts: 0, weeks: 0, managers: new Set(), started: 0 }; x.pts += Number(p); x.weeks++; x.managers.add(e.owner); }
    e.starters.forEach((id, i) => { if (out[id]) out[id].started += Number(e.startersPts[i] || 0); });
  }
  return Object.values(out).map(x => ({ ...x, managers: x.managers.size }));
}

/** Trophy-room badges per manager, computed from league history. */
export function achievements(model) {
  const out = {};
  const give = (owner, key, title, detail, icon) => { if (!owner) return; const list = out[owner] ||= []; const ex = list.find(x => x.key === key); if (ex) { ex.count++; ex.details.push(detail); } else list.push({ key, title, icon, count: 1, details: [detail] }); };
  for (const s of model.seasons) {
    if (s.champion != null) give(s.owner(s.champion), 'champ', 'Champion', s.season, '🏆');
    const fin = s.winners.find(b => b.p === 1 && b.l != null); if (fin) give(s.owner(fin.l), 'runner', 'Runner-up', s.season, '🥈');
    const done = s.status === 'complete';
    if (done && s.regStandings[0]) give(s.regStandings[0].owner, 'regcrown', 'Regular-season crown', s.season, '👑');
    if (done) { const pf = [...s.regStandings].sort((a, b) => b.pf - a.pf)[0]; give(pf.owner, 'pfking', 'Points king', s.season, '💰'); }
    if (done) { const last = s.regStandings[s.regStandings.length - 1]; give(last.owner, 'last', 'Last place', s.season, '🚽'); }
    if (done) for (const r of s.regStandings) { if (r.luck >= 2) give(r.owner, 'lucky', 'Horseshoe (2+ wins of luck)', s.season, '🍀'); if (r.luck <= -2) give(r.owner, 'cursed', 'Cursed (2+ wins of bad luck)', s.season, '🌧️'); }
    for (const [w, byRid] of Object.entries(s.weeks)) for (const e of Object.values(byRid)) {
      if (!e.final) continue;
      if (e.pts >= 150) give(e.owner, '150', '150 Club', `${s.season} W${w}`, '🔥');
      if (e.pts < 60) give(e.owner, 'sub60', 'Sub-60 Club', `${s.season} W${w}`, '🧊');
      if (e.optimal.pts > 0 && e.efficiency >= 0.999) give(e.owner, 'perfect', 'Perfect lineup', `${s.season} W${w}`, '🎯');
    }
    for (const g of s.games) {
      if (!g.final || g.winner === 'tie' || g.type === 'consolation') continue;
      const W = g.winner === 'a' ? g.a : g.b, L = g.winner === 'a' ? g.b : g.a;
      if (g.margin >= 50) give(W.owner, 'blowout', 'Blowout (won by 50+)', `${s.season} W${g.week}`, '💥');
      if (g.margin < 1) give(L.owner, 'heartbreak', 'Heartbreak (lost by under 1)', `${s.season} W${g.week}`, '💔');
    }
    const trades = {}; for (const t of s.transactions) if (t.type === 'trade') for (const rid of t.rids) trades[s.owner(rid)] = (trades[s.owner(rid)] || 0) + 1;
    const top = Object.entries(trades).sort((a, b) => b[1] - a[1])[0]; if (top && top[1] >= 2) give(top[0], 'baron', 'Trade baron (most trades)', s.season, '🤝');
    const adds = {}; for (const t of s.transactions) if (t.type === 'waiver' || t.type === 'free_agent') for (const rid of Object.values(t.adds)) adds[s.owner(rid)] = (adds[s.owner(rid)] || 0) + 1;
    const hawk = Object.entries(adds).sort((a, b) => b[1] - a[1])[0]; if (hawk && hawk[1] >= 5) give(hawk[0], 'hawk', 'Waiver hawk (most pickups)', `${s.season}: ${hawk[1]} adds`, '🦅');

    // Weekly honors and game-by-game oddities, regular season only (every team plays every week).
    const place = {}; // week -> rid -> place among that week's scores (1 = top)
    for (const [w, byRid] of Object.entries(s.weeks)) {
      const es = Object.values(byRid).filter(e => e.final);
      if (Number(w) > s.regWeeks || es.length < 4) continue;
      const by = [...es].sort((a, b) => b.pts - a.pts);
      place[w] = { n: by.length }; by.forEach((e, i) => (place[w][e.rid] = i + 1));
      give(by[0].owner, 'topweek', 'Top score of the week', `${s.season} W${w}`, '⭐');
      give(by[by.length - 1].owner, 'pooper', 'Pooper of the week', `${s.season} W${w}`, '💩');
    }
    for (const g of s.games) {
      if (g.type !== 'reg' || !g.final || g.winner === 'tie' || !place[g.week]) continue;
      const W = g.winner === 'a' ? g.a : g.b, L = g.winner === 'a' ? g.b : g.a, pl = place[g.week];
      const at = `${s.season} W${g.week}`;
      if (pl[L.rid] <= 2) give(L.owner, 'robbed', 'Robbed (top-2 score and still lost)', at, '😤');
      if (pl[W.rid] >= pl.n - 2) give(W.owner, 'stolen', 'Stole one (bottom-3 score and still won)', at, '🦹');
      if (g.margin < 2) give(W.owner, 'escape', 'Escape artist (won by under 2)', at, '😅');
      const le = s.weeks[g.week]?.[L.rid];
      if (le && le.optimal.pts > W.pts) give(L.owner, 'benched', 'Benched the win (best lineup would have won)', at, '🪑');
    }

    if (done) {
      const reg = s.regStandings;
      for (const r of reg.slice(0, s.playoffTeams)) give(r.owner, 'berth', 'Playoff berth', s.season, '🎟️');
      const full = reg.filter(r => r.games >= 6);
      if (full.length > 2) {
        const bySd = [...full].sort((a, b) => a.sd - b.sd), byPa = [...full].sort((a, b) => a.pa - b.pa);
        give(bySd[0].owner, 'steady', 'Mr. Consistent (steadiest scorer)', s.season, '📏');
        give(bySd[bySd.length - 1].owner, 'coaster', 'Rollercoaster (least consistent)', s.season, '🎢');
        give(byPa[0].owner, 'cakewalk', 'Cakewalk (fewest points against)', s.season, '🛋️');
        give(byPa[byPa.length - 1].owner, 'gauntlet', 'Gauntlet (most points against)', s.season, '🥊');
      }
    }
  }
  for (const st of streaks(model)) {
    if (st.kind === 'W' && st.n >= 5) give(st.owner, 'streak', '5+ game win streak', `${st.n} straight`, '📈');
    if (st.kind === 'L' && st.n >= 5) give(st.owner, 'skid', '5+ game losing streak', `${st.n} straight`, '📉');
  }
  return out;
}


// ---------------------------------------------------------------------------
// All-play tracker, team breakdown

/**
 * Week-by-week all-play: for every team-week, how many of the other teams it outscored, plus the
 * real result that week. {weeks, n, cells: {rid: {week: {wins, losses, ties, of, pts, res}}}}
 */
export function allPlayWeeks(s) {
  const through = Math.min(s.completedThrough, s.regWeeks);
  const res = {};
  for (const g of s.games) if (g.type === 'reg' && g.final && g.week <= through) for (const x of sidesOf(g)) (res[g.week] ||= {})[x.rid] = x.res;
  const cells = Object.fromEntries(Object.keys(s.teams).map(r => [r, {}]));
  const weeks = [];
  for (let w = 1; w <= through; w++) {
    const es = Object.values(s.weeks[w] || {}).filter(e => cells[e.rid]);
    if (!es.length) continue;
    weeks.push(w);
    for (const e of es) {
      let wins = 0, losses = 0, ties = 0;
      for (const o of es) if (o !== e) { if (e.pts > o.pts) wins++; else if (e.pts < o.pts) losses++; else ties++; }
      cells[e.rid][w] = { wins, losses, ties, of: es.length - 1, pts: e.pts, res: res[w]?.[e.rid] || null };
    }
  }
  return { weeks, n: Object.keys(s.teams).length, cells };
}

/** Career all-play by manager across every Sleeper season. */
export function careerAllPlay(model) {
  const out = {};
  for (const s of model.seasons) {
    if (Math.min(s.completedThrough, s.regWeeks) < 1) continue;
    for (const r of s.regStandings) {
      const c = out[r.owner] ||= { owner: r.owner, apw: 0, apl: 0, apt: 0, w: 0, l: 0, t: 0, xw: 0, seasons: {} };
      c.apw += r.apw; c.apl += r.apl; c.apt += r.apt; c.w += r.w; c.l += r.l; c.t += r.t; c.xw += r.xw;
      c.seasons[s.season] = { apPct: r.apPct, pct: r.pct, rank: r.rank };
    }
  }
  return Object.values(out).map(c => {
    const ap = c.apw + c.apl + c.apt, g = c.w + c.l + c.t;
    return { ...c, apPct: ap ? (c.apw + c.apt / 2) / ap : 0, pct: g ? (c.w + c.t / 2) / g : 0, luck: r2(c.w + c.t / 2 - c.xw) };
  });
}

const POS6 = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
/**
 * Per-team season profile: starter points per game by position, bench and lineup numbers, close
 * games, blowouts, and how much of the team's scoring came from its best player.
 */
export function teamBreakdown(model, s) {
  const through = Math.min(s.completedThrough, s.regWeeks);
  const rows = {};
  for (const r of s.regStandings) rows[r.rid] = { rid: r.rid, owner: r.owner, pf: r.pf, pa: r.pa, games: 0, pos: Object.fromEntries(POS6.map(p => [p, 0])), bench: 0, left: 0, maxPf: 0, close: { w: 0, l: 0 }, blow: { w: 0, l: 0 }, byPlayer: {} };
  for (let w = 1; w <= through; w++) for (const e of Object.values(s.weeks[w] || {})) {
    const r = rows[e.rid]; if (!r) continue;
    r.games++;
    e.starters.forEach((id, i) => {
      if (!id || id === '0') return;
      const pts = Number(e.startersPts[i] || 0), pos = model.posOf(id);
      if (pos in r.pos) r.pos[pos] += pts;
      r.byPlayer[id] = (r.byPlayer[id] || 0) + pts;
    });
    const rosterPts = e.players.reduce((t, id) => t + Number(e.playersPts[id] || 0), 0);
    r.bench += rosterPts - e.pts; r.left += Math.max(0, e.optimal.pts - e.pts); r.maxPf += e.optimal.pts;
  }
  for (const g of s.games) {
    if (g.type !== 'reg' || !g.final || g.week > through || g.winner === 'tie') continue;
    for (const x of sidesOf(g)) {
      const r = rows[x.rid]; if (!r) continue;
      const bucket = g.margin < 10 ? r.close : g.margin >= 40 ? r.blow : null;
      if (bucket) bucket[x.res === 'W' ? 'w' : 'l']++;
    }
  }
  const list = Object.values(rows).map(r => {
    const top = Object.entries(r.byPlayer).sort((a, b) => b[1] - a[1])[0];
    const per = r.games || 1;
    return { ...r, posPg: Object.fromEntries(POS6.map(p => [p, r.pos[p] / per])), benchPg: r.bench / per, left: r2(r.left), maxPf: r2(r.maxPf), eff: r.maxPf ? r.pf / r.maxPf : 1,
      mvp: top ? { id: top[0], pts: r2(top[1]), share: r.pf ? top[1] / r.pf : 0 } : null };
  });
  const lg = Object.fromEntries(POS6.map(p => [p, mean(list.map(r => r.posPg[p]))]));
  const paRank = [...list].sort((a, b) => b.pa - a.pa);
  list.forEach(r => (r.paRank = paRank.indexOf(r) + 1));
  return { rows: list, league: lg, positions: POS6, through };
}

// ---------------------------------------------------------------------------
// Scouting reports

const ORD = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const P0 = x => `${Math.round(x * 100)}%`;
const r1 = x => Number(x).toFixed(1);

/**
 * A short written scouting report for every team in a season, built from standings, all-play,
 * lineups, positional scoring, form and (while the regular season is on) playoff odds and the
 * remaining schedule. Returns [{rid, owner, tag, lines: [{k, text}]}] in power-ranking order.
 */
export function scoutingReports(model, s) {
  const through = Math.min(s.completedThrough, s.regWeeks);
  if (through < 1) return [];
  const name = o => model.managers[o]?.name || 'Unknown';
  const st = s.regStandings, n = st.length;
  const pr = powerRankings(s, Math.min(s.completedThrough, s.lastWeek));
  const prRank = Object.fromEntries(pr.map(r => [r.rid, r.rank]));
  const b = teamBreakdown(model, s);
  const br = Object.fromEntries(b.rows.map(r => [r.rid, r]));
  const rankBy = (key, desc = true) => { const o = [...st].sort((x, y) => (desc ? y[key] - x[key] : x[key] - y[key])); return Object.fromEntries(o.map((r, i) => [r.rid, i + 1])); };
  const pfRank = rankBy('pf'), apRank = rankBy('apPct');
  const effOrder = [...b.rows].sort((x, y) => y.eff - x.eff), effRank = Object.fromEntries(effOrder.map((r, i) => [r.rid, i + 1]));
  const inSeason = s.completedThrough < s.regWeeks;
  const odds = inSeason ? playoffOdds(s, through, 2000) : null;
  // Remaining regular-season opponents and how hard they've been to play.
  const avgOf = Object.fromEntries(st.map(r => [r.rid, r.avg]));
  const left = {};
  for (const g of s.games) if (g.type === 'reg' && g.week > through) { (left[g.a.rid] ||= []).push(g.b.rid); (left[g.b.rid] ||= []).push(g.a.rid); }
  const sosVal = Object.fromEntries(st.map(r => [r.rid, left[r.rid]?.length ? mean(left[r.rid].map(o => avgOf[o] || 0)) : null]));
  const sosRank = Object.fromEntries(Object.entries(sosVal).filter(([, v]) => v != null).sort((x, y) => y[1] - x[1]).map(([rid], i) => [rid, i + 1]));

  return st.map(r => {
    const who = name(r.owner), t = br[r.rid], lines = [];
    lines.push({ k: 'Résumé', text: `${r.w}-${r.l}${r.t ? '-' + r.t : ''} and ${ORD(r.rank)} in the standings, with ${r1(r.pf)} points (${ORD(pfRank[r.rid])} in the league). No. ${prRank[r.rid]} in the power rankings.` });
    if (r.luck >= 1) lines.push({ k: 'Luck', text: `The schedule has been kind. ${who} has ${r1(r.luck)} more wins than their weekly scores deserve; against everyone every week they'd be ${P0(r.apPct)} (${ORD(apRank[r.rid])}).` });
    else if (r.luck <= -1) lines.push({ k: 'Luck', text: `Better than the record says. ${who} has ${r1(-r.luck)} fewer wins than their scores deserve; against everyone every week they'd be ${P0(r.apPct)} (${ORD(apRank[r.rid])}).` });
    else lines.push({ k: 'Luck', text: `The record is about what the scores have earned (all-play ${P0(r.apPct)}, ${ORD(apRank[r.rid])}).` });
    const recent = r.scores.slice(-3), ra = mean(recent);
    if (r.scores.length >= 5 && r.avg) {
      const d = (ra - r.avg) / r.avg;
      if (d >= 0.1) lines.push({ k: 'Form', text: `Heating up: ${r1(ra)} a week over the last three, against ${r1(r.avg)} for the season.` });
      else if (d <= -0.1) lines.push({ k: 'Form', text: `Cooling off: ${r1(ra)} a week over the last three, down from ${r1(r.avg)} for the season.` });
      else lines.push({ k: 'Form', text: `Steady: ${r1(ra)} a week over the last three, close to the ${r1(r.avg)} season average.` });
    }
    if (t) {
      const rel = b.positions.filter(p => b.league[p] > 1).map(p => ({ p, v: t.posPg[p], d: (t.posPg[p] - b.league[p]) / b.league[p] })).sort((x, y) => y.d - x.d);
      if (rel.length >= 2) {
        const hi = rel[0], lo = rel[rel.length - 1];
        const sg = d => `${d >= 0 ? '+' : ''}${P0(d)}`;
        lines.push({ k: 'Roster', text: lo.d >= 0 ? `Above the league average at every position. Best at ${hi.p} (${r1(hi.v)} a game, ${sg(hi.d)}); closest to average at ${lo.p} (${sg(lo.d)}).`
          : hi.d <= 0 ? `Below the league average at every position. Closest at ${hi.p} (${sg(hi.d)}); furthest behind at ${lo.p} (${r1(lo.v)} a game, ${sg(lo.d)}).`
          : `Strongest at ${hi.p} (${r1(hi.v)} a game, ${sg(hi.d)} vs the league). Weakest at ${lo.p} (${r1(lo.v)}, ${sg(lo.d)}).` });
      }
      const er = effRank[r.rid];
      lines.push({ k: 'Coaching', text: er <= 3 ? `One of the sharpest lineup setters: ${P0(t.eff)} of the best possible points (${ORD(er)}).`
        : er > n - 3 ? `Points are being left on the bench: ${r1(t.left)} so far, ${P0(t.eff)} of the best possible (${ORD(er)} of ${n}).`
        : `${P0(t.eff)} of the best possible points from their lineups (${ORD(er)}), leaving ${r1(t.left)} on the bench.` });
      const cg = t.close.w + t.close.l;
      if (cg >= 2) lines.push({ k: 'Clutch', text: `${t.close.w}-${t.close.l} in games decided by under 10${t.close.w > t.close.l ? ', winning the coin flips' : t.close.w < t.close.l ? ', losing the coin flips' : ''}.` });
      if (t.mvp && t.mvp.share >= 0.15) lines.push({ k: 'Carry', text: `${model.nameOf(t.mvp.id)} has supplied ${P0(t.mvp.share)} of the team's points (${r1(t.mvp.pts)}).` });
    }
    let tag = r.rank <= s.playoffTeams ? 'Playoff team' : 'Outside the bracket';
    if (odds) {
      const o = odds[r.rid];
      tag = o.playoff >= 0.8 ? 'Contender' : o.playoff >= 0.35 ? 'On the bubble' : o.playoff >= 0.05 ? 'Long shot' : 'Playing for pride';
      const sr = sosRank[r.rid];
      const chance = o.playoff > 0.99 ? 'All but certain to make the playoffs' : o.playoff < 0.01 ? 'Under a 1% chance of making the playoffs' : `${P0(o.playoff)} to make the playoffs`;
      lines.push({ k: 'Outlook', text: `${chance}, with about ${Math.round(o.projWins)} projected wins.${sr ? ` The remaining schedule is the ${ORD(sr)} toughest of ${Object.keys(sosRank).length} (opponents average ${r1(sosVal[r.rid])}).` : ''}` });
    }
    return { rid: r.rid, owner: r.owner, tag, power: prRank[r.rid], lines };
  }).sort((x, y) => x.power - y.power);
}
