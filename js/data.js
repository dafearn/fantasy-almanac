// Loads every Sleeper season of the league and normalizes it into one model.
import { CONFIG } from './config.js';
import { sget, players as loadPlayers } from './api.js';
import { ESPN_SCOREBOARD, parseScoreboard } from './live-core.js';
import { newestSeason } from './chain.js';

const FOREVER = { ttl: Infinity };

function playoffRounds(teams) { return teams <= 1 ? 0 : Math.ceil(Math.log2(teams)); }

// If newer seasons were created from the league that was opened, start from the newest one.
async function findHeadLeague(state) {
  return newestSeason(p => sget(p), CONFIG.ROOT_LEAGUE_ID, state.league_season || state.season);
}

/**
 * Sleeper moves on to the next week a day or two after Monday night. When ESPN's scoreboard already shows
 * every game of Sleeper's current week as final, treat that week as done now, so recaps, reports and the
 * week pickers move on the moment the last game ends.
 */
async function finishSlate(state) {
  const week = Number(state.display_week || state.week);
  if (state.season_type !== 'regular' || !(week >= 1 && week < 18)) return state;
  try {
    const res = await fetch(`${ESPN_SCOREBOARD}?seasontype=2&week=${week}&dates=${state.season}`, { cache: 'no-store' });
    const games = res.ok ? parseScoreboard(await res.json()) : [];
    if (!games.length || games.some(g => g.state !== 'post')) return state;
    return { ...state, week: week + 1, display_week: week + 1 };
  } catch { return state; } // ESPN unreachable: wait for Sleeper like before
}

/** Returns the full normalized model. `onProgress(text)` reports loading steps. */
export async function loadAll(onProgress = () => {}) {
  onProgress('Checking the NFL calendar…');
  const state = await finishSlate(await sget('/state/nfl'));
  const head = await findHeadLeague(state);

  // Walk previous_league_id back to the first Sleeper season.
  const leagues = [];
  let id = head;
  while (id && id !== '0') {
    onProgress(`Finding seasons… (${leagues.length + 1})`);
    const lg = await sget(`/league/${id}`, { ttl: leagues.length ? Infinity : CONFIG.LIVE_TTL });
    if (!lg) break;
    leagues.push(lg);
    id = lg.previous_league_id;
  }
  leagues.reverse(); // oldest first

  onProgress('Loading player directory…');
  const playerDir = await loadPlayers();

  const seasons = [];
  for (const lg of leagues) {
    onProgress(`Loading ${lg.season} season…`);
    seasons.push(await loadSeason(lg, state));
  }
  return buildModel(seasons, state, playerDir);
}

async function loadSeason(lg, state) {
  const done = lg.status === 'complete';
  const opt = done ? FOREVER : {};
  const s = lg.settings || {};
  const playoffStart = s.playoff_week_start || 15;
  const playoffTeams = s.playoff_teams || 6;
  const lastWeek = playoffStart + playoffRounds(playoffTeams) - 1;
  let currentWeek;
  if (done) currentWeek = lastWeek + 1;
  else if (String(state.season) !== String(lg.season) || state.season_type === 'pre' || lg.status === 'pre_draft' || lg.status === 'drafting') currentWeek = 1;
  else currentWeek = Math.max(1, Number(state.display_week || state.week || 1));
  // completedThrough: last week whose games are final.
  const completedThrough = done ? lastWeek : Math.min(currentWeek - 1, lastWeek);
  const fetchThrough = done ? lastWeek : Math.min(lastWeek, Math.max(playoffStart - 1, currentWeek));

  const [users, rosters, winners, losers, drafts] = await Promise.all([
    sget(`/league/${lg.league_id}/users`, opt),
    sget(`/league/${lg.league_id}/rosters`, opt),
    sget(`/league/${lg.league_id}/winners_bracket`, opt).catch(() => []),
    sget(`/league/${lg.league_id}/losers_bracket`, opt).catch(() => []),
    sget(`/league/${lg.league_id}/drafts`, opt).catch(() => []),
  ]);

  const weekNums = Array.from({ length: fetchThrough }, (_, i) => i + 1);
  // The latest finished week keeps refreshing for a while: stat corrections land during the week, and it may
  // have been read the night it ended, before Sleeper closed it.
  const settled = w => (done ? w <= completedThrough : w < completedThrough);
  const matchups = await Promise.all(weekNums.map(w =>
    sget(`/league/${lg.league_id}/matchups/${w}`, settled(w) ? FOREVER : {}).catch(() => [])));
  const txWeeks = Array.from({ length: Math.max(1, Math.min(fetchThrough, currentWeek) + 1) }, (_, i) => i + 1);
  const txs = (await Promise.all(txWeeks.map(w =>
    sget(`/league/${lg.league_id}/transactions/${w}`, w < currentWeek - 1 || done ? FOREVER : {}).catch(() => [])))).flat();

  const draftData = [];
  for (const d of drafts || []) {
    const [detail, picks] = await Promise.all([
      sget(`/draft/${d.draft_id}`, d.status === 'complete' ? FOREVER : {}).catch(() => d),
      sget(`/draft/${d.draft_id}/picks`, d.status === 'complete' ? FOREVER : {}).catch(() => []),
    ]);
    draftData.push({ ...d, ...detail, picks: picks || [] });
  }

  return { league: lg, users: users || [], rosters: rosters || [], winners: winners || [], losers: losers || [],
    matchups, txs, drafts: draftData, playoffStart, playoffTeams, lastWeek, currentWeek, completedThrough };
}

// ---------------------------------------------------------------------------
// Normalization

function teamKey(season, rid) { return `${season}:${rid}`; }

function buildModel(raw, state, playerDir) {
  const managers = {}; // user_id -> {id, name, avatar, teamNames: {season: name}}
  const seasons = [];

  for (const r of raw) {
    const lg = r.league;
    const season = String(lg.season);
    const userById = Object.fromEntries(r.users.map(u => [u.user_id, u]));
    const teams = {};
    for (const ro of r.rosters) {
      const ownerId = ro.owner_id || `orphan-${season}-${ro.roster_id}`;
      const u = userById[ro.owner_id] || {};
      const teamName = (u.metadata && u.metadata.team_name) || u.display_name || `Team ${ro.roster_id}`;
      teams[ro.roster_id] = {
        rid: ro.roster_id, ownerId, coOwners: ro.co_owners || [], teamName,
        avatar: (u.metadata && u.metadata.avatar) || (u.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null),
        roster: ro.players || [], settings: ro.settings || {},
      };
      const m = managers[ownerId] ||= { id: ownerId, name: u.display_name || teamName, avatar: null, teamNames: {}, seasons: [] };
      if (u.display_name) m.name = u.display_name; // latest season wins (oldest-first loop)
      if (u.avatar) m.avatar = `https://sleepercdn.com/avatars/thumbs/${u.avatar}`;
      m.teamNames[season] = teamName;
      m.seasons.push(season);
    }

    // Per-team weekly entries straight from the matchups endpoint.
    const weeks = {}; // week -> rid -> entry
    r.matchups.forEach((list, i) => {
      const week = i + 1;
      weeks[week] = {};
      for (const m of list || []) {
        weeks[week][m.roster_id] = {
          rid: m.roster_id, week, matchupId: m.matchup_id,
          pts: Number(m.custom_points ?? m.points ?? 0),
          starters: m.starters || [], startersPts: m.starters_points || [],
          players: m.players || [], playersPts: m.players_points || {},
        };
      }
    });

    const isFinal = w => w <= r.completedThrough;
    const games = [];
    // Regular season: pair by matchup_id.
    for (let w = 1; w < r.playoffStart; w++) {
      const byM = {};
      for (const e of Object.values(weeks[w] || {})) if (e.matchupId != null) (byM[e.matchupId] ||= []).push(e);
      for (const [mid, pair] of Object.entries(byM)) {
        if (pair.length !== 2) continue;
        games.push(makeGame(season, w, 'reg', pair[0], pair[1], isFinal(w), { matchupId: Number(mid) }));
      }
    }
    // Playoffs from the brackets: round r is played in week playoffStart + r - 1.
    const addBracket = (bracket, type) => {
      for (const b of bracket) {
        if (b.t1 == null || b.t2 == null) continue;
        const w = r.playoffStart + b.r - 1;
        const e1 = weeks[w]?.[b.t1], e2 = weeks[w]?.[b.t2];
        if (!e1 || !e2) continue;
        const g = makeGame(season, w, type, e1, e2, isFinal(w) && b.w != null, { round: b.r, place: b.p || null, bracketMatch: b.m });
        if (type === 'playoff' && b.p && b.p > 1) g.type = 'placement';
        games.push(g);
      }
    };
    addBracket(r.winners, 'playoff');
    addBracket(r.losers, 'consolation');

    // Final placements from the winners bracket (p = place decided by that game).
    const place = {};
    for (const b of r.winners) if (b.p && b.w != null) { place[b.w] = b.p; place[b.l] = b.p + 1; }
    const champion = r.winners.find(b => b.p === 1 && b.w != null)?.w ?? null;

    const draft = r.drafts.find(d => d.picks.length) || r.drafts[0] || null;
    const draftPicks = draft ? draft.picks.map(p => ({
      season, round: p.round, pickNo: p.pick_no, slot: p.draft_slot, rid: p.roster_id,
      ownerId: p.picked_by || teams[p.roster_id]?.ownerId, playerId: p.player_id,
      name: p.metadata ? `${p.metadata.first_name || ''} ${p.metadata.last_name || ''}`.trim() : playerDir[p.player_id]?.n,
      pos: p.metadata?.position || playerDir[p.player_id]?.p, nflTeam: p.metadata?.team || '',
      keeper: !!p.is_keeper, amount: p.metadata?.amount ? Number(p.metadata.amount) : null,
    })) : [];

    const transactions = r.txs.filter(t => t.status === 'complete').map(t => ({
      season, id: t.transaction_id, type: t.type, week: t.leg, created: t.created,
      rids: t.roster_ids || [], adds: t.adds || {}, drops: t.drops || {},
      picks: t.draft_picks || [], faab: t.waiver_budget || [], bid: t.settings?.waiver_bid ?? null,
    })).sort((a, b) => a.created - b.created);

    seasons.push({
      season, leagueId: lg.league_id, name: (lg.name || '').trim(), status: lg.status, settings: lg.settings || {},
      scoring: lg.scoring_settings || {}, rosterPositions: lg.roster_positions || [],
      playoffStart: r.playoffStart, playoffTeams: r.playoffTeams, regWeeks: r.playoffStart - 1,
      lastWeek: r.lastWeek, currentWeek: r.currentWeek, completedThrough: r.completedThrough,
      teams, weeks, games, place, champion, draft: draft ? { type: draft.type, settings: draft.settings || {}, picks: draftPicks } : null,
      transactions, winners: r.winners, losers: r.losers,
    });
  }
  return { seasons, managers, state, players: playerDir, legacy: null };
}

function makeGame(season, week, type, e1, e2, final, extra) {
  return { season, week, type, final, a: { rid: e1.rid, pts: e1.pts }, b: { rid: e2.rid, pts: e2.pts }, ...extra };
}

export { teamKey };
