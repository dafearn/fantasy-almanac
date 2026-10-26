// Development only: writes a SYNTHETIC snapshot (made-up teams, players and scores) shaped
// exactly like Sleeper API responses, for testing the app without network access.
//   node scripts/dev-fixture.mjs <out.json>
// Never copy its output to data/snapshot.json for real use.
import { writeFile } from 'node:fs/promises';

let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const norm = (m, s) => { let u = rnd() || 1e-9, v = rnd(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const out = {};
const ROOT = '1000000000000002026';
const leagueIds = { 2024: '1000000000000002024', 2025: '1000000000000002025', 2026: ROOT };
const NAME = 'Sunday Funday League ';
const names = ['CommishCarl', 'TacoTuesday', 'GridironGreg', 'TDTommy', 'WaiverWendy', 'PuntGod', 'KickerKyle', 'SackMaster', 'FlexFrank', 'BenchBob', 'RedZoneRay', 'HailMaryHank', 'LateJoinerLou'];
const users = names.map((n, i) => ({ user_id: String(900000000000000000n + BigInt(i)), display_name: n, avatar: null, is_owner: i === 0 ? true : null, metadata: { team_name: `${n}'s Team` } }));
// 2024-2025: users 0..11. 2026: user 11 replaced by user 12.
const ownersFor = season => season === 2026 ? [...users.slice(0, 11), users[12]] : users.slice(0, 12);

const POS = [['QB', 40, 19, 4], ['RB', 70, 13, 6], ['WR', 80, 13, 6], ['TE', 30, 9, 4], ['K', 32, 8, 3], ['DEF', 32, 8, 4]];
const players = {};
let pid = 1000;
const NFL = ['KC', 'BUF', 'PHI', 'SF', 'DAL', 'MIA', 'DET', 'BAL', 'CIN', 'GB', 'LAR', 'MIN', 'NYJ', 'SEA', 'HOU', 'PIT', 'LV', 'DEN', 'CHI', 'ATL', 'NO', 'TB', 'ARI', 'NYG', 'WAS', 'CLE', 'IND', 'JAX', 'TEN', 'CAR', 'NE', 'LAC'];
for (const [pos, n, base] of POS) for (let i = 0; i < n; i++) {
  const id = pos === 'DEF' ? NFL[i] : String(pid++);
  players[id] = { n: pos === 'DEF' ? `${NFL[i]} Defense` : `${pos} Player ${i + 1}`, p: pos, t: NFL[i % 32], mu: Math.max(2, base - i * (base / n) * 0.9 + norm(0, 1.5)) };
}
const byPos = p => Object.entries(players).filter(([, x]) => x.p === p).sort((a, b) => b[1].mu - a[1].mu).map(([id]) => id);

out['/state/nfl'] = { season: '2026', league_season: '2026', season_type: 'regular', week: 7, display_week: 7 };
out['/user/commishcarl'] = users[0];
// Each season's league is found from the season before it through a member's league list.
out[`/user/${users[0].user_id}/leagues/nfl/2025`] = [{ league_id: leagueIds[2025], previous_league_id: leagueIds[2024], name: NAME, season: '2025', total_rosters: 12 }];
out[`/user/${users[0].user_id}/leagues/nfl/2026`] = [{ league_id: ROOT, previous_league_id: leagueIds[2025], name: NAME, season: '2026', total_rosters: 12 }];

for (const season of [2024, 2025, 2026]) {
  const lid = leagueIds[season];
  const owners = ownersFor(season);
  const playoffTeams = season === 2026 ? 7 : 6;
  const status = season === 2026 ? 'in_season' : 'complete';
  const completed = season === 2026 ? 6 : 17;
  out[`/league/${lid}`] = { league_id: lid, name: NAME, season: String(season), status, total_rosters: 12, previous_league_id: season === 2024 ? null : leagueIds[season - 1], draft_id: `d${season}`,
    settings: { playoff_week_start: 15, playoff_teams: playoffTeams, last_scored_leg: completed }, scoring_settings: { rec: 1 },
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'] };
  out[`/league/${lid}/users`] = owners;

  // Snake draft: 15 rounds by need.
  const order = [...owners.keys()].sort(() => rnd() - 0.5);
  const taken = new Set(); const rosters = owners.map(() => []); const picks = [];
  const need = { QB: 2, RB: 5, WR: 5, TE: 1, K: 1, DEF: 1 };
  const pools = Object.fromEntries(POS.map(([p]) => [p, byPos(p)]));
  for (let r = 1; r <= 15; r++) for (let k = 0; k < 12; k++) {
    const slot = r % 2 ? k : 11 - k; const t = order[slot];
    const have = p => rosters[t].filter(id => players[id].p === p).length;
    const choices = POS.map(([p]) => p).filter(p => have(p) < need[p] && (r > 12 || !['K', 'DEF'].includes(p)));
    const cands = choices.map(p => pools[p].find(id => !taken.has(id))).filter(Boolean);
    // ADP noise: take the best by perceived value
    const id = cands.sort((a, b) => (players[b].mu + norm(0, 4)) - (players[a].mu + norm(0, 4)))[0];
    taken.add(id); rosters[t].push(id);
    picks.push({ round: r, pick_no: (r - 1) * 12 + k + 1, draft_slot: slot + 1, roster_id: t + 1, picked_by: owners[t].user_id, player_id: id, is_keeper: null,
      metadata: { first_name: players[id].n.split(' ')[0], last_name: players[id].n.split(' ').slice(1).join(' '), position: players[id].p, team: players[id].t } });
  }
  out[`/league/${lid}/drafts`] = [{ draft_id: `d${season}`, status: 'complete', type: 'snake', season: String(season) }];
  out[`/draft/d${season}`] = { draft_id: `d${season}`, status: 'complete', type: 'snake', settings: { rounds: 15, teams: 12 } };
  out[`/draft/d${season}/picks`] = picks;

  // Transactions: a waiver per week and a trade every 4 weeks.
  const txByWeek = {};
  const free = Object.keys(players).filter(id => !taken.has(id) && !['K', 'DEF'].includes(players[id].p));
  for (let w = 1; w <= Math.min(completed + 1, 17); w++) {
    const list = txByWeek[w] = [];
    const t = Math.floor(rnd() * 12); const add = free.splice(Math.floor(rnd() * free.length), 1)[0];
    const drop = rosters[t].filter(id => !['QB', 'K', 'DEF'].includes(players[id].p)).sort((a, b) => players[a].mu - players[b].mu)[0];
    rosters[t] = rosters[t].filter(id => id !== drop).concat(add); free.push(drop);
    list.push({ transaction_id: `w${season}${w}`, type: rnd() < 0.7 ? 'waiver' : 'free_agent', status: 'complete', leg: w, created: Date.UTC(season, 8, 1) + w * 7 * 864e5, roster_ids: [t + 1], adds: { [add]: t + 1 }, drops: { [drop]: t + 1 }, draft_picks: [], waiver_budget: [], settings: { waiver_bid: Math.floor(rnd() * 30) } });
    if (w % 4 === 2) {
      const a = Math.floor(rnd() * 12); let b = (a + 1 + Math.floor(rnd() * 11)) % 12;
      const pa = rosters[a].find(id => players[id].p === 'WR'), pb = rosters[b].find(id => players[id].p === 'RB');
      if (pa && pb) {
        rosters[a] = rosters[a].filter(x => x !== pa).concat(pb); rosters[b] = rosters[b].filter(x => x !== pb).concat(pa);
        list.push({ transaction_id: `t${season}${w}`, type: 'trade', status: 'complete', leg: w, created: Date.UTC(season, 8, 2) + w * 7 * 864e5, roster_ids: [a + 1, b + 1], adds: { [pb]: a + 1, [pa]: b + 1 }, drops: { [pa]: a + 1, [pb]: b + 1 }, draft_picks: [{ season: String(season + 1), round: 3, roster_id: a + 1, previous_owner_id: a + 1, owner_id: b + 1 }], waiver_budget: [] });
      }
    }
    // weekly matchups use the roster as of this week
    const sched = [];
    const teams = [...Array(12).keys()];
    if (w <= 14) { const rot = [teams[0], ...teams.slice(1).slice((w - 1) % 11), ...teams.slice(1).slice(0, (w - 1) % 11)]; for (let i = 0; i < 6; i++) sched.push([rot[i], rot[11 - i]]); }
    const mids = {}; sched.forEach(([x, y], i) => { mids[x] = i + 1; mids[y] = i + 1; });
    txByWeek[w].rosterSnapshot = rosters.map(r => [...r]);
    txByWeek[w].mids = mids;
  }
  for (let w = 1; w <= 17; w++) out[`/league/${lid}/transactions/${w}`] = (txByWeek[w] || []).map(({ ...t }) => t);

  // Scores
  const score = {}; // week -> team -> entry
  const lastSnap = rosters.map(r => [...r]);
  for (let w = 1; w <= 17; w++) {
    const roster = txByWeek[w]?.rosterSnapshot || lastSnap;
    score[w] = roster.map((ids, t) => {
      const pts = Object.fromEntries(ids.map(id => [id, w <= completed ? Math.max(0, Math.round(norm(players[id].mu * (0.85 + (t % 5) * 0.05), players[id].mu * 0.45 + 2) * 100) / 100) : 0]));
      const pick = (p, n, exclude) => ids.filter(id => players[id].p === p && !exclude.has(id)).sort((a, b) => (players[b].mu + norm(0, 3)) - (players[a].mu + norm(0, 3))).slice(0, n);
      const used = new Set(); const starters = [];
      for (const [p, n] of [['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1]]) for (const id of pick(p, n, used)) { used.add(id); starters.push(id); }
      const flex = ids.filter(id => ['RB', 'WR', 'TE'].includes(players[id].p) && !used.has(id)).sort((a, b) => players[b].mu - players[a].mu)[0];
      if (flex) { used.add(flex); starters.push(flex); }
      for (const p of ['K', 'DEF']) for (const id of pick(p, 1, used)) { used.add(id); starters.push(id); }
      const startersPts = starters.map(id => pts[id]);
      return { roster_id: t + 1, matchup_id: null, points: w <= completed ? Math.round(startersPts.reduce((a, b) => a + b, 0) * 100) / 100 : 0, starters, starters_points: startersPts, players: ids, players_points: pts, custom_points: null };
    });
  }
  // regular season matchup ids
  for (let w = 1; w <= 14; w++) { const mids = txByWeek[w]?.mids; if (!mids) { // weeks after completed+1: build schedule
      const teams = [...Array(12).keys()]; const rot = [teams[0], ...teams.slice(1).slice((w - 1) % 11), ...teams.slice(1).slice(0, (w - 1) % 11)];
      for (let i = 0; i < 6; i++) { score[w][rot[i]].matchup_id = i + 1; score[w][rot[11 - i]].matchup_id = i + 1; } continue; }
    for (const [t, m] of Object.entries(mids)) score[w][t].matchup_id = m; }

  // Brackets for completed seasons (6 teams).
  let winners = [], losers = [];
  if (status === 'complete') {
    const rec = Array.from({ length: 12 }, (_, t) => ({ t, w: 0, pf: 0 }));
    for (let w = 1; w <= 14; w++) { const by = {}; score[w].forEach((e, t) => (by[e.matchup_id] ||= []).push(t)); for (const [x, y] of Object.values(by)) { rec[x].pf += score[w][x].points; rec[y].pf += score[w][y].points; rec[score[w][x].points > score[w][y].points ? x : y].w++; } }
    const seeds = rec.sort((a, b) => b.w - a.w || b.pf - a.pf).map(r => r.t + 1);
    const play = (w, t1, t2) => (score[w][t1 - 1].points >= score[w][t2 - 1].points ? [t1, t2] : [t2, t1]);
    const [w1, l1] = play(15, seeds[2], seeds[5]), [w2, l2] = play(15, seeds[3], seeds[4]);
    const [w3, l3] = play(16, seeds[0], w2), [w4, l4] = play(16, seeds[1], w1), [w5, l5] = play(16, l1, l2);
    const [w6, l6] = play(17, w3, w4), [w7, l7] = play(17, l3, l4);
    winners = [
      { r: 1, m: 1, t1: seeds[2], t2: seeds[5], w: w1, l: l1 }, { r: 1, m: 2, t1: seeds[3], t2: seeds[4], w: w2, l: l2 },
      { r: 2, m: 3, t1: seeds[0], t2: w2, w: w3, l: l3, t2_from: { w: 2 } }, { r: 2, m: 4, t1: seeds[1], t2: w1, w: w4, l: l4, t2_from: { w: 1 } },
      { r: 2, m: 5, t1: l1, t2: l2, w: w5, l: l5, p: 5 },
      { r: 3, m: 6, t1: w3, t2: w4, w: w6, l: l6, p: 1 }, { r: 3, m: 7, t1: l3, t2: l4, w: w7, l: l7, p: 3 },
    ];
    const [a1, b1] = play(15, seeds[8], seeds[11]), [a2, b2] = play(15, seeds[9], seeds[10]);
    losers = [{ r: 1, m: 1, t1: seeds[8], t2: seeds[11], w: a1, l: b1 }, { r: 1, m: 2, t1: seeds[9], t2: seeds[10], w: a2, l: b2 }];
  }
  for (let w = 1; w <= 17; w++) out[`/league/${lid}/matchups/${w}`] = score[w];
  out[`/league/${lid}/winners_bracket`] = winners;
  out[`/league/${lid}/losers_bracket`] = losers;
  const finalRoster = score[Math.max(1, completed)];
  out[`/league/${lid}/rosters`] = owners.map((u, t) => ({ roster_id: t + 1, owner_id: u.user_id, co_owners: null, players: finalRoster[t].players, starters: finalRoster[t].starters, settings: {} }));
}
out.__players = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { n: p.n, p: p.p, t: p.t }]));
out.__savedAt = 'synthetic fixture';
await writeFile(process.argv[2] || 'fixture.json', JSON.stringify(out));
console.log('fixture written', Object.keys(out).length, 'paths');
