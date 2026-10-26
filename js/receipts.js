// The Receipts: the league's arguments settled with numbers. Each function returns plain rows; the
// page (js/views/receipts.js) draws them and writes the jokes. Everything here is computed from
// Sleeper's data or the site's own trade block, so the punchlines are at least accurate.
import { playerSeason, standingsThrough, draftAnalysis, mean, sd } from './stats.js';

const reg = s => Math.min(s.completedThrough, s.regWeeks);
const r2 = x => Math.round(x * 100) / 100;
const real = id => id && id !== '0';

/** Final team-weeks through `through`: [{w, e}]. */
function entries(s, through) {
  const out = [];
  for (let w = 1; w <= through; w++) for (const e of Object.values(s.weeks[w] || {})) if (e.final && s.teams[e.rid]) out.push({ w, e });
  return out;
}

/** The worst start/sit call in a team-week: the best benched player who belonged in the lineup, and the starter he should have replaced. */
function worstCall(model, e) {
  const best = new Set(e.optimal.lineup.map(x => x.id)), started = new Set(e.starters);
  const benched = e.optimal.lineup.filter(x => !started.has(x.id));
  const sat = e.starters.map((id, i) => ({ id, pts: Number(e.startersPts[i] || 0) })).filter(x => real(x.id) && !best.has(x.id));
  let out = null;
  for (const b of benched) for (const st of sat) {
    const bp = model.positionsOf(b.id), sp = model.positionsOf(st.id);
    if (!bp.some(p => sp.includes(p))) continue;
    const diff = b.pts - st.pts;
    if (diff > 0 && (!out || diff > out.diff)) out = { benched: { id: b.id, pts: b.pts }, started: st, diff: r2(diff) };
  }
  return out;
}

/**
 * The Genius-to-Clown Spectrum: where each team finished against where its roster deserved to finish
 * (ranked by points with the best possible lineup every week), plus each manager's worst start/sit call
 * and the losses their own bench would have won.
 */
export function geniusClown(model, s) {
  const through = reg(s);
  const st = standingsThrough(s, through).filter(r => r.games);
  const rows = Object.fromEntries(st.map(r => [r.rid, { rid: r.rid, owner: r.owner, rank: r.rank, w: r.w, l: r.l, t: r.t, pf: r.pf, maxPf: 0, worst: null, benchLosses: [] }]));
  for (const { w, e } of entries(s, through)) {
    const r = rows[e.rid]; if (!r) continue;
    r.maxPf += e.optimal.pts;
    const c = worstCall(model, e);
    if (c && (!r.worst || c.diff > r.worst.diff)) r.worst = { ...c, week: w };
  }
  for (const g of s.games) {
    if (g.type !== 'reg' || !g.final || g.week > through || g.winner === 'tie') continue;
    const lose = g.winner === 'a' ? g.b : g.a, win = g.winner === 'a' ? g.a : g.b;
    const e = s.weeks[g.week]?.[lose.rid];
    if (rows[lose.rid] && e && e.optimal.pts > win.pts) rows[lose.rid].benchLosses.push({ week: g.week, pts: lose.pts, best: e.optimal.pts, opp: win.pts, oppOwner: win.owner });
  }
  const list = Object.values(rows);
  [...list].sort((a, b) => b.maxPf - a.maxPf).forEach((r, i) => (r.rosterRank = i + 1));
  for (const r of list) { r.maxPf = r2(r.maxPf); r.delta = r.rosterRank - r.rank; } // + finished better than the roster
  return list.sort((a, b) => a.delta - b.delta);
}

/**
 * The Regret Ratio: points left on the bench (best lineup minus actual) over points scored.
 * `benchRatio` is the raw version (every bench point over starter points), which punishes deep benches.
 */
export function regretRatio(model, s) {
  const through = reg(s), rows = {};
  for (const { w, e } of entries(s, through)) {
    const r = rows[e.rid] ||= { owner: e.owner, pf: 0, left: 0, bench: 0, weeks: 0, worstWeek: null };
    const roster = e.players.reduce((t, id) => t + Number(e.playersPts[id] || 0), 0);
    const left = Math.max(0, e.optimal.pts - e.pts);
    r.pf += e.pts; r.left += left; r.bench += roster - e.pts; r.weeks++;
    if (!r.worstWeek || left > r.worstWeek.left) r.worstWeek = { week: w, left: r2(left), pts: e.pts, best: e.optimal.pts };
  }
  return Object.values(rows).map(r => ({ ...r, pf: r2(r.pf), left: r2(r.left), bench: r2(r.bench), ratio: r.pf ? r.left / r.pf : 0, benchRatio: r.pf ? r.bench / r.pf : 0 }))
    .sort((a, b) => b.ratio - a.ratio);
}

/** The Kicker Dependency Score: the share of a team's points that came from its kicker, and the wins the kicker decided. */
export function kickerDependency(model, s) {
  const through = reg(s), rows = {};
  for (const { w, e } of entries(s, through)) {
    const r = rows[e.rid] ||= { owner: e.owner, pf: 0, k: 0, peak: null, carried: [], byWeek: {} };
    let k = 0, kid = null;
    e.starters.forEach((id, i) => { if (real(id) && model.posOf(id) === 'K') { k += Number(e.startersPts[i] || 0); kid = id; } });
    r.pf += e.pts; r.k += k;
    if (e.pts > 0 && kid && (!r.peak || k / e.pts > r.peak.share)) r.peak = { week: w, id: kid, k, pts: e.pts, share: k / e.pts };
    r.byWeek[w] = { k, kid };
  }
  for (const g of s.games) {
    if (g.type !== 'reg' || !g.final || g.week > through || g.winner === 'tie') continue;
    const win = g.winner === 'a' ? g.a : g.b, lose = g.winner === 'a' ? g.b : g.a;
    const r = rows[win.rid], wk = r?.byWeek[g.week];
    if (r && wk && wk.k > g.margin) r.carried.push({ week: g.week, id: wk.kid, k: wk.k, margin: r2(g.margin), oppOwner: lose.owner });
  }
  return Object.values(rows).map(({ byWeek, ...r }) => ({ ...r, pf: r2(r.pf), k: r2(r.k), share: r.pf ? r.k / r.pf : 0 })).sort((a, b) => b.share - a.share);
}

/**
 * The FAAB Hoarder: waiver and free-agent adds against the weeks those players actually started for the
 * manager who added them, FAAB spent (and how much of it was gone by week 3), and the pickups who never started.
 */
export function faabHoarders(model, s) {
  const budget = Number(s.settings?.waiver_budget) || 0;
  const rows = {};
  for (const o of Object.values(s.teams)) rows[o.ownerId] = { owner: o.ownerId, claims: 0, spent: 0, early: 0, starts: 0, rotted: [], hits: [], biggest: null };
  for (const t of s.transactions) {
    if (t.type !== 'waiver' && t.type !== 'free_agent') continue;
    for (const [id, rid] of Object.entries(t.adds)) {
      const owner = s.owner(rid), r = rows[owner]; if (!r) continue;
      const bid = t.type === 'waiver' ? Number(t.bid) || 0 : 0;
      r.claims++; r.spent += bid; if ((t.week || 1) <= 3) r.early += bid;
      let starts = 0, pts = 0;
      for (let w = Math.max(1, t.week || 1); w <= s.completedThrough; w++) {
        const e = s.weeks[w]?.[rid]; if (!e?.final) continue;
        const i = e.starters.indexOf(id); if (i >= 0) { starts++; pts += Number(e.startersPts[i] || 0); }
      }
      r.starts += starts;
      const add = { id, week: t.week, bid, starts, pts: r2(pts), type: t.type };
      (starts ? r.hits : r.rotted).push(add);
      if (bid && (!r.biggest || bid > r.biggest.bid)) r.biggest = add;
    }
  }
  return { budget, rows: Object.values(rows).filter(r => model.managers[r.owner]).map(r => ({ ...r, startRate: r.claims ? r.starts / r.claims : 0, earlyShare: budget ? r.early / budget : 0 }))
    .sort((a, b) => b.claims - a.claims || b.spent - a.spent) };
}

/**
 * Left on Read: every trade block offer and what became of it. An offer is "ignored" when the listing
 * ended or came down with the offer still standing. The insult score compares the season points of the
 * players offered with the points of the player on the block.
 */
export function leftOnRead(model, listings = []) {
  const s = model.seasons[model.seasons.length - 1];
  const ps = playerSeason(model, s);
  const val = id => ps.pts[id] || 0;
  const rows = {}, offers = [];
  const row = o => (rows[o] ||= { owner: o, made: 0, accepted: 0, declined: 0, ignored: 0, withdrawn: 0, pending: 0, ghosted: 0 });
  for (const l of listings) {
    for (const b of l.bids || []) {
      if (b.status === 'replaced') continue;
      const fate = b.status === 'active' ? (['ended', 'closed', 'accepted'].includes(l.status) ? 'ignored' : 'pending') : b.status;
      const r = row(b.bidder); r.made++; if (r[fate] != null) r[fate]++;
      if (fate === 'ignored' && l.seller) row(l.seller).ghosted++;
      const offered = (b.players || []).reduce((t, id) => t + val(id), 0), asked = val(l.playerId);
      offers.push({ bidder: b.bidder, seller: l.seller, playerId: l.playerId, players: b.players || [], faab: b.faab, picks: b.picks, fate,
        ratio: (b.players || []).length && asked >= 20 ? offered / asked : null, offered: r2(offered), asked: r2(asked) });
    }
  }
  const list = Object.values(rows).filter(r => model.managers[r.owner]).map(r => ({ ...r, readRate: r.made ? (r.accepted + r.declined) / Math.max(1, r.made - r.pending) : 0 }));
  const insults = offers.filter(o => o.ratio != null).sort((a, b) => a.ratio - b.ratio);
  return { rows: list.sort((a, b) => b.made - a.made || b.ignored - a.ignored), offers, insults, season: s.season };
}

/**
 * Monday Night Miracles and Tragedies. `finale` is the server's answer for each week: the players whose
 * games were on the week's last game day. A miracle is a team that went into that day behind and won;
 * a tragedy is a team that went in ahead and lost. Weeks whose last day had more than three games
 * (a full Sunday slate) don't count.
 */
export function mondayMiracles(model, s, finale = {}) {
  const events = [], tally = {};
  const t = o => (tally[o] ||= { owner: o, miracles: 0, tragedies: 0, survived: 0, sweats: 0 });
  for (const g of s.games) {
    if (!g.final || g.type === 'consolation' || g.winner === 'tie') continue;
    const f = finale[g.week]; if (!f || !f.pids || f.games > 3) continue;
    const late = new Set([...f.pids, ...(f.teams || [])]);
    const side = x => {
      const e = s.weeks[g.week]?.[x.rid]; if (!e) return null;
      const players = []; let pts = 0;
      e.starters.forEach((id, i) => { if (late.has(id)) { const p = Number(e.startersPts[i] || 0); pts += p; players.push({ id, pts: p }); } });
      return { owner: x.owner, final: x.pts, late: r2(pts), before: r2(x.pts - pts), players };
    };
    const A = side(g.a), B = side(g.b); if (!A || !B || (!A.players.length && !B.players.length)) continue;
    const win = g.winner === 'a' ? A : B, lose = g.winner === 'a' ? B : A;
    t(A.owner); t(B.owner);
    const base = { season: s.season, week: g.week, type: g.type, day: f.day, weekday: f.weekday, win, lose };
    if (win.before < lose.before) {
      t(win.owner).miracles++; t(lose.owner).tragedies++;
      events.push({ ...base, kind: 'miracle', deficit: r2(lose.before - win.before), margin: r2(win.final - lose.final) });
    } else if (win.before - lose.before < lose.late + 15 && lose.players.length) {
      // Led going in, and the other side still had players to come: a sweat, even if it held.
      t(win.owner).survived++; t(lose.owner).sweats++;
      events.push({ ...base, kind: 'sweat', lead: r2(win.before - lose.before), margin: r2(win.final - lose.final) });
    }
  }
  return { events: events.sort((a, b) => (b.kind === 'miracle') - (a.kind === 'miracle') || (b.deficit || 0) - (a.deficit || 0) || a.margin - b.margin), tally: Object.values(tally).filter(r => model.managers[r.owner]) };
}

/**
 * Sunday Heartburn: win probability through the week for one matchup. At each moment a team has its
 * points so far plus, for every starter, his season average times the share of his game still to play;
 * the spread grows with the same share. Points so far come from the Live page's scoring ticker, or with
 * `box` (a week the ticker never saw) from each starter's final points spread evenly over his game.
 * `teamOf` gives each player's team that week (else his current team), and the line stops at `until` (now,
 * for a week still being played). Returns [{t, p, a, b, ev}] where p is team A's chance to win and ev the
 * scoring play that moved it.
 */
const GAME_MS = 3.25 * 3600e3;
export function heartburn(model, s, week, ridA, ridB, events, schedule, { teamOf = null, box = false, until = Infinity } = {}) {
  const kick = {};
  for (const g of schedule || []) { const k = Date.parse(g.kickoff); if (Number.isFinite(k)) { if (g.home) kick[g.home] = k; if (g.away) kick[g.away] = k; } }
  const team = id => (model.posOf(id) === 'DEF' ? id : teamOf?.[id] || model.players[id]?.t);
  // Each starter's prior: his average as a starter before this week, else his position's average.
  const posPts = {}, own = {};
  for (let w = 1; w < week; w++) for (const e of Object.values(s.weeks[w] || {})) e.starters.forEach((id, i) => {
    if (!real(id)) return; const p = Number(e.startersPts[i] || 0);
    (posPts[model.posOf(id)] ||= []).push(p); (own[id] ||= []).push(p);
  });
  const prior = id => { const o = own[id] || [], pp = posPts[model.posOf(id)] || [8]; const n = o.length; return { mu: (n * mean(o) + 2 * mean(pp)) / (n + 2) || mean(pp), sig: Math.max(3, sd(pp) || 6) }; };
  // A starter whose game can't be placed (no team, no kickoff) is counted as a Sunday 1 PM game.
  const ks0 = Object.values(kick).sort((x, y) => x - y), fallback = ks0[Math.floor(ks0.length / 2)];
  const side = rid => { const e = s.weeks[week]?.[rid]; return (e?.starters || []).map((id, i) => ({ id, fin: Number(e.startersPts[i] || 0), done: !!e.final })).filter(x => real(x.id)).map(x => ({ ...x, rid, k: kick[team(x.id)] ?? fallback, ...prior(x.id) })); };
  const A = side(ridA), B = side(ridB);
  const ids = new Set([...A, ...B].map(x => x.id));
  const evs = (events || []).filter(e => ids.has(e.pid)).sort((x, y) => x.at - y.at);
  const now = {}; // pid -> points so far
  const frac = (p, t) => (!Number.isFinite(p.k) ? 1 : t <= p.k ? 1 : Math.max(0, 1 - (t - p.k) / GAME_MS));
  const state = t => {
    // The ticker can miss the end of a game nobody was watching; once a finished week's game is over, use the final.
    const so = (p, f) => (box ? p.fin * (1 - f) : f === 0 && p.done ? p.fin : now[p.id] || 0);
    const tot = list => list.reduce((o, p) => { const f = frac(p, t); o.cur += so(p, f); o.mu += f * p.mu; o.v += f * p.sig ** 2; return o; }, { cur: 0, mu: 0, v: 0 });
    const a = tot(A), b = tot(B), v = a.v + b.v, d = a.cur + a.mu - b.cur - b.mu;
    return { a: r2(a.cur), b: r2(b.cur), p: v < 1e-6 ? (d > 0 ? 1 : d < 0 ? 0 : 0.5) : ncdf(d / Math.sqrt(v)) };
  };
  // Moments to plot: every kickoff, every play, and every 10 minutes while a game is on.
  const ks = [...new Set([...A, ...B].map(p => p.k).filter(Number.isFinite))].sort((x, y) => x - y);
  const times = new Set();
  for (const k of ks) for (let t = k; t <= k + GAME_MS; t += 600e3) times.add(t);
  const byT = new Map();
  for (const e of evs) { times.add(e.at); (byT.get(e.at) || byT.set(e.at, []).get(e.at)).push(e); }
  const out = [];
  let first = true;
  if (Number.isFinite(until)) { for (const t of times) if (t > until) times.delete(t); if (ks.some(k => k <= until && until <= k + GAME_MS)) times.add(until); }
  for (const t of [...times].sort((x, y) => x - y)) {
    if (first) { out.push({ t: t - 1, ...state(t - 1), ev: null }); first = false; }
    let ev = null;
    for (const e of byT.get(t) || []) { now[e.pid] = e.pts; if (!ev || Math.abs(e.delta) > Math.abs(ev.delta)) ev = e; }
    out.push({ t, ...state(t), ev });
  }
  return out;
}
function ncdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }

/** How much a win-probability line swung: total movement, lead changes and the biggest single drop. */
export function heartburnScore(line) {
  let move = 0, flips = 0, peak = { drop: 0 };
  for (let i = 1; i < line.length; i++) {
    const d = line[i].p - line[i - 1].p; move += Math.abs(d);
    if ((line[i].p - 0.5) * (line[i - 1].p - 0.5) < 0) flips++;
    if (Math.abs(d) > Math.abs(peak.drop)) peak = { drop: d, at: line[i] };
  }
  const ps = line.map(x => x.p);
  return { move, flips, hi: Math.max(...ps), lo: Math.min(...ps), peak };
}

/**
 * Draft archetypes: tags for each team's draft built from the picks (and how the players held up).
 * Returns [{owner, tags: [{key, icon, label, why}], rank, grade}].
 */
export function draftArchetypes(model, s) {
  const da = draftAnalysis(model, s); if (!da) return null;
  const rounds = Math.max(...da.rows.map(r => r.round));
  const qbSlots = s.rosterPositions.filter(p => p === 'QB' || p === 'SUPER_FLEX').length;
  const weeks = s.completedThrough;
  const out = [];
  for (const t of da.teams) {
    const picks = [...t.picks].sort((a, b) => a.pickNo - b.pickNo), tags = [];
    const tag = (key, icon, label, why) => tags.push({ key, icon, label, why });
    const early = n => picks.filter(p => p.round <= n);
    const name = p => model.nameOf(p.playerId);
    if (rounds >= 8 && !early(4).some(p => p.pos === 'RB')) {
      const bottom = t.rank > da.teams.length * 2 / 3;
      tag('zero-rb', bottom ? '🫥' : '🧪', bottom ? 'The Zero-RB / Zero-Points Build' : 'Zero-RB Scientist',
        `No running back in the first four rounds${bottom ? `, and the draft class ranks ${t.rank} of ${da.teams.length} in points. The experiment failed` : ''}.`);
    }
    const rbs = picks.filter(p => p.round <= 6 && p.pos === 'RB');
    if (rbs.length >= 4) tag('rb-landfill', '🚛', 'The RB Landfill', `${rbs.length} running backs in the first six rounds: ${rbs.map(name).join(', ')}.`);
    const qbs = picks.filter(p => p.pos === 'QB');
    if (qbSlots <= 1 && qbs.length >= 3) tag('qb-collector', '🎓', `Drafted ${qbs.length} Quarterbacks in a 1-QB League`, `${qbs.map(name).join(', ')}. Only one can play.`);
    const tes = picks.filter(p => p.round <= 6 && p.pos === 'TE');
    if (tes.length >= 2) tag('te-truther', '📐', 'Tight End Truther', `Two tight ends by round 6: ${tes.map(name).join(' and ')}.`);
    const kd = picks.filter(p => (p.pos === 'K' || p.pos === 'DEF') && p.round <= rounds - 3);
    if (kd.length) tag('kicker-truther', '🦵', `Took a ${kd[0].pos === 'K' ? 'Kicker' : 'Defense'} in Round ${kd[0].round}`, `${name(kd[0])}, with ${rounds - kd[0].round} rounds still to go. Bold.`);
    const byTeam = {};
    for (const p of picks) if (p.nflTeam && p.pos !== 'DEF') (byTeam[p.nflTeam] ||= []).push(p);
    const fan = Object.entries(byTeam).sort((a, b) => b[1].length - a[1].length)[0];
    if (fan && fan[1].length >= 4) tag('homer', '📣', `The ${fan[0]} Fan Club`, `${fan[1].length} players from one NFL team: ${fan[1].map(name).join(', ')}.`);
    // Early picks who sat on this manager's roster scoring zero for three or more weeks.
    if (weeks >= 6) {
      const zeros = early(8).filter(p => {
        let z = 0;
        for (let w = 1; w <= Math.min(weeks, s.regWeeks); w++) { const e = Object.values(s.weeks[w] || {}).find(x => x.owner === t.owner); if (e?.players.includes(p.playerId) && !Number(e.playersPts[p.playerId])) z++; }
        return z >= 3;
      });
      if (zeros.length >= 3) tag('all-ir', '🩼', 'The All-IR Team', `${zeros.length} of the first eight picks spent three or more weeks on the roster scoring zero: ${zeros.map(name).join(', ')}.`);
    }
    if (t.rank === da.teams.length) tag('zero-hope', '🕳️', 'Zero-Hope Draft', `This draft class has scored the fewest points in the league (${t.pts.toFixed(1)}).`);
    if (t.rank === 1) tag('heist', '💰', 'The Heist', `This draft class has scored the most points in the league (${t.pts.toFixed(1)}).`);
    out.push({ owner: t.owner, rank: t.rank, grade: t.grade, pts: t.pts, tags });
  }
  return { teams: out, rounds, size: da.teams.length };
}
