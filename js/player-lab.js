// Player lab: every NFL player's weekly fantasy points and rest-of-season projections under the league's
// own scoring, plus the numbers trade tools show (positional tiers, value over replacement, floor and
// ceiling, boom and bust rates, and what a trade does to each starting lineup).
import { SERVER, apiGet } from './server.js';
import { SLOT_ELIG, BENCH, quantile, mean, sum } from './stats.js';

export const LAB_POS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const REAL_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const FLEX_POS = ['RB', 'WR', 'TE'];

const memo = new Map();

/** Weekly points and projections for one season. Cached per season and week. */
export function loadLab(model, s) {
  const done = s.status === 'complete';
  const through = Math.min(s.completedThrough, 18);
  const last = done ? through : Math.max(through, Math.min(s.lastWeek || 17, 18));
  const key = `${s.leagueId}:${through}:${last}`;
  if (!memo.has(key)) memo.set(key, fetchLab(s, through, last).catch(e => { memo.delete(key); throw e; }));
  return memo.get(key);
}

async function fetchLab(s, through, last) {
  let srv = null, problem = '';
  if (SERVER.api) {
    try { srv = await apiGet(`/api/lab?league=${encodeURIComponent(s.leagueId)}&season=${s.season}&through=${through}&last=${last}`); }
    catch (e) { problem = e.message; }
  }
  const pts = {};
  if (srv) for (const [id, a] of Object.entries(srv.pts || {})) pts[id] = a.slice();
  // Rostered players: the league's own numbers win, since they're exactly what Sleeper scored.
  for (let w = 1; w <= through; w++) {
    for (const e of Object.values(s.weeks[w] || {})) {
      for (const id of e.players || []) {
        const v = e.playersPts?.[id]; if (v == null) continue;
        const row = pts[id];
        if (row?.[w - 1] != null || Number(v) !== 0) (pts[id] ||= Array(through).fill(null))[w - 1] = Number(v);
      }
    }
  }
  return { season: s.season, through, last, pts, proj: srv?.proj || {}, full: !!srv, errors: srv?.errors || [], problem };
}

/** Starters each position supplies league-wide, filling flex spots with the best leftovers by `val`. */
export function starterCounts(s, rows, val) {
  const teams = Object.keys(s.teams).length || 12;
  const slots = (s.rosterPositions || []).filter(p => !BENCH.has(p));
  const out = Object.fromEntries(REAL_POS.map(p => [p, 0]));
  for (const p of slots) if (p in out) out[p] += teams;
  const flex = slots.filter(p => !(p in out)).map(p => SLOT_ELIG[p] || []).filter(e => e.length);
  const pool = rows.filter(r => val(r) != null).sort((a, b) => val(b) - val(a));
  const taken = Object.fromEntries(REAL_POS.map(p => [p, 0]));
  const left = [];
  for (const r of pool) { if (taken[r.pos] < out[r.pos]) taken[r.pos]++; else left.push(r); }
  for (let i = 0; i < teams; i++) {
    for (const elig of flex) {
      const k = left.findIndex(r => elig.includes(r.pos));
      if (k >= 0) { out[left[k].pos]++; left.splice(k, 1); }
    }
  }
  return out;
}

/**
 * One row per player with any points or projection. range = how many recent weeks count (0 = all).
 * Returns { rows, byPos, starters, repl, weeks: [w...], boomLine, bustLine, teams }.
 */
export function analyze(model, s, lab, { range = 0 } = {}) {
  const { through } = lab;
  const teams = Object.keys(s.teams).length || 12;
  const from = range ? Math.max(1, through - range + 1) : 1;
  const weeks = []; for (let w = from; w <= through; w++) weeks.push(w);
  const owner = {};
  for (const t of Object.values(s.teams)) for (const id of t.roster || []) owner[id] = t.ownerId;

  const rows = [];
  for (const id of new Set([...Object.keys(lab.pts), ...Object.keys(lab.proj)])) {
    const pos = model.posOf(id);
    if (!REAL_POS.includes(pos)) continue;
    const all = lab.pts[id] || [];
    const wk = weeks.map(w => all[w - 1] ?? null);
    const played = wk.filter(v => v != null);
    const pr = lab.proj[id] || [];
    const prv = pr.filter(v => v != null);
    const recent = all.slice(Math.max(0, through - 3), through).filter(v => v != null);
    rows.push({
      id, pos, name: model.nameOf(id), team: model.players[id]?.t || '', owner: owner[id] || null,
      wk, gp: played.length, total: sum(played), ppg: played.length ? mean(played) : null,
      recent: recent.length ? mean(recent) : null,
      lo: played.length ? quantile(played, 0.25) : null, med: played.length ? quantile(played, 0.5) : null,
      hi: played.length ? quantile(played, 0.75) : null, min: played.length ? Math.min(...played) : null, max: played.length ? Math.max(...played) : null,
      proj: pr, rosPts: sum(prv), rosGames: prv.length, rosPpg: prv.length ? mean(prv) : null, next: pr.length ? pr[0] : null,
    });
  }

  // Per-week lines: a "boom" week is a top-`teams` finish at the position (an RB1 week in a 12-team
  // league); a "bust" is finishing outside the league's starters at the position.
  const minGames = Math.max(1, Math.ceil(weeks.length * 0.4));
  const starters = starterCounts(s, rows.filter(r => r.gp >= minGames), r => r.ppg);
  const boomLine = {}, bustLine = {};
  for (const p of REAL_POS) {
    boomLine[p] = {}; bustLine[p] = {};
    for (const [i, w] of weeks.entries()) {
      const sc = rows.filter(r => r.pos === p && r.wk[i] != null).map(r => r.wk[i]).sort((a, b) => b - a);
      boomLine[p][w] = sc[Math.min(sc.length, teams) - 1] ?? null;
      bustLine[p][w] = sc[Math.min(sc.length, Math.max(1, starters[p])) - 1] ?? null;
    }
  }
  for (const r of rows) {
    let boom = 0, bust = 0;
    weeks.forEach((w, i) => { const v = r.wk[i]; if (v == null) return; if (boomLine[r.pos][w] != null && v >= boomLine[r.pos][w]) boom++; if (bustLine[r.pos][w] != null && v < bustLine[r.pos][w]) bust++; });
    r.boom = r.gp ? boom / r.gp : null; r.bust = r.gp ? bust / r.gp : null;
  }

  // Replacement level: the first player past the league's starters at each position.
  const rosStarters = starterCounts(s, rows.filter(r => r.rosGames), r => r.rosPpg);
  const repl = {}, replRos = {};
  for (const p of REAL_POS) {
    const byPpg = rows.filter(r => r.pos === p && r.gp >= minGames).map(r => r.ppg).sort((a, b) => b - a);
    repl[p] = byPpg[Math.min(byPpg.length - 1, starters[p])] ?? 0;
    const byRos = rows.filter(r => r.pos === p && r.rosGames).map(r => r.rosPpg).sort((a, b) => b - a);
    replRos[p] = byRos.length ? byRos[Math.min(byRos.length - 1, rosStarters[p])] : null;
  }
  for (const r of rows) {
    r.vor = r.ppg != null && r.gp >= minGames ? r.ppg - repl[r.pos] : null;
    r.rosVor = r.rosGames && replRos[r.pos] != null ? sum(r.proj.filter(v => v != null).map(v => v - replRos[r.pos])) : null;
  }
  return { rows, weeks, teams, starters, repl, replRos, boomLine, bustLine, minGames, hasProj: rows.some(r => r.rosGames) };
}

export const METRICS = {
  total: { label: 'Total points', short: 'Pts', get: r => (r.gp ? r.total : null) },
  ppg: { label: 'Points per game', short: 'PPG', get: (r, a) => (r.gp >= a.minGames ? r.ppg : null) },
  vor: { label: 'Points per game over replacement', short: 'VOR', get: r => r.vor },
  ros: { label: 'Rest-of-season projection, per game', short: 'ROS', proj: true, get: r => r.rosPpg },
  rosVor: { label: 'Rest-of-season value over replacement', short: 'ROS VOR', proj: true, get: r => r.rosVor },
  next: { label: 'Next week projection', short: 'Next', proj: true, get: r => r.next },
};

/** Players at a position (FLEX = RB/WR/TE), ranked by metric, best first. */
export function ranked(a, pos, metric) {
  const m = METRICS[metric];
  return a.rows.filter(r => (pos === 'FLEX' ? FLEX_POS.includes(r.pos) : r.pos === pos)).map(r => ({ r, v: m.get(r, a) }))
    .filter(x => x.v != null).sort((x, y) => y.v - x.v).map((x, i) => ({ ...x, rank: i + 1 }));
}

/**
 * Natural tiers (Jenks / Fisher breaks): split the sorted values into groups that are as tight as possible.
 * About one tier per six players, between 3 and 8. Returns the index where each tier starts.
 */
export function tiers(values) {
  const n = values.length; if (n < 4) return [0];
  const k = Math.min(8, Math.max(3, Math.round(n / 6)), n);
  const pre = [0], pre2 = [0];
  for (const v of values) { pre.push(pre[pre.length - 1] + v); pre2.push(pre2[pre2.length - 1] + v * v); }
  const cost = (i, j) => { const c = j - i, s = pre[j] - pre[i]; return pre2[j] - pre2[i] - (s * s) / c; }; // values[i..j)
  const best = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity)), cut = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let g = 1; g <= k; g++) {
    for (let j = g; j <= n; j++) {
      for (let i = g - 1; i < j; i++) {
        const c = best[g - 1][i] + cost(i, j);
        if (c < best[g][j]) { best[g][j] = c; cut[g][j] = i; }
      }
    }
  }
  const starts = []; let j = n;
  for (let g = k; g >= 1; g--) { const i = cut[g][j]; starts.unshift(i); j = i; }
  return starts;
}

/** Best weekly starting lineup from a set of players, valued per game by `val`. */
export function lineupPoints(s, ids, val, model) {
  const slots = (s.rosterPositions || []).filter(p => !BENCH.has(p));
  const pool = ids.map(id => ({ id, v: val(id) ?? 0, pos: model.positionsOf(id) })).sort((a, b) => b.v - a.v);
  const order = slots.map(x => SLOT_ELIG[x] || [x]).sort((a, b) => a.length - b.length);
  const used = new Set(); let total = 0; const lineup = [];
  for (const elig of order) {
    const p = pool.find(x => !used.has(x.id) && x.pos.some(q => elig.includes(q)));
    if (p) { used.add(p.id); total += p.v; lineup.push(p.id); }
  }
  return { total, lineup };
}

/**
 * What a trade does: each side's value over replacement, and each lineup's points per week before and after.
 * give/get are player ids; me is the owner id making the trade.
 */
export function tradeLens(model, s, a, me, give, get) {
  const byId = Object.fromEntries(a.rows.map(r => [r.id, r]));
  const useRos = a.hasProj;
  const val = id => { const r = byId[id]; return r ? (useRos ? r.rosPpg : r.gp >= a.minGames ? r.ppg : null) : null; };
  const value = id => { const r = byId[id]; return r ? (useRos ? r.rosVor : r.vor != null ? r.vor * Math.max(1, r.gp) : null) : null; };
  const rosterOf = o => Object.values(s.teams).find(t => t.ownerId === o)?.roster || [];
  const mine = rosterOf(me);
  const partners = {};
  for (const id of get) { const o = byId[id]?.owner; if (o && o !== me) partners[o] = (partners[o] || 0) + 1; }
  const partner = Object.entries(partners).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  const theirs = partner ? rosterOf(partner) : [];
  const gs = new Set(give), ts = new Set(get);
  const myBefore = lineupPoints(s, mine, val, model).total, myAfter = lineupPoints(s, [...mine.filter(id => !gs.has(id)), ...get], val, model).total;
  const theirBefore = partner ? lineupPoints(s, theirs, val, model).total : null;
  const theirAfter = partner ? lineupPoints(s, [...theirs.filter(id => !ts.has(id)), ...give], val, model).total : null;
  const side = ids => sum(ids.map(id => Math.max(0, value(id) ?? 0)));
  return {
    useRos, partner, partners: Object.keys(partners).length,
    giveValue: side(give), getValue: side(get),
    myBefore, myAfter, theirBefore, theirAfter,
    rosterGap: get.length - give.length,
  };
}
