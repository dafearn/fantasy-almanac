// Live scoring helpers with no DOM or app imports, so the server (to trim Sleeper's stats feed)
// and the browser (to score and diff it) share them.

const DROP = /^(pos_rank|rank_|pts_(ppr|half_ppr|std)_rank)/;

/** Slim Sleeper's /stats/nfl/<season>/<week> array to what the live page needs. */
export function trimStats(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([player_id, stats]) => ({ player_id, stats })) : [];
  const out = [];
  for (const e of list) {
    if (!e || !e.player_id || !e.stats) continue;
    const s = {};
    for (const [k, v] of Object.entries(e.stats)) if (typeof v === 'number' && v !== 0 && !DROP.test(k)) s[k] = v;
    if (!Object.keys(s).length) continue;
    const pl = e.player || {};
    out.push({
      id: String(e.player_id), team: e.team || pl.team || '', opp: e.opponent || '', game: e.game_id ? String(e.game_id) : `${e.team || ''}-${e.opponent || ''}`,
      date: e.date || '', upd: Number(e.updated_at || e.last_modified || 0),
      pos: pl.position || (pl.fantasy_positions || [])[0] || '', name: [pl.first_name, pl.last_name].filter(Boolean).join(' '), s,
    });
  }
  return out;
}

/** Fantasy points under a league's scoring settings. Sleeper's scoring keys match its stat keys. */
export function leaguePoints(s, scoring) {
  let t = 0;
  for (const [k, v] of Object.entries(s)) { const w = scoring[k]; if (typeof w === 'number') t += w * v; }
  return Math.round(t * 100) / 100;
}

const n = x => (x ? Math.round(x * 10) / 10 : 0);
/** Short box-score line, e.g. "18/27 241 yd 2 TD · 4-22 rush". */
export function statLine(pos, s) {
  const parts = [];
  if (pos === 'DEF') {
    if (s.pts_allow != null) parts.push(`${n(s.pts_allow)} pts allowed`);
    if (s.sack) parts.push(`${n(s.sack)} sk`);
    if (s.int) parts.push(`${n(s.int)} INT`);
    if (s.fum_rec) parts.push(`${n(s.fum_rec)} FR`);
    if (s.def_td || s.def_st_td) parts.push(`${n((s.def_td || 0) + (s.def_st_td || 0))} TD`);
    return parts.join(' · ');
  }
  if (pos === 'K') {
    if (s.fga || s.fgm) parts.push(`${n(s.fgm)}/${n(s.fga)} FG${s.fgm_lng ? ` (long ${n(s.fgm_lng)})` : ''}`);
    if (s.xpa || s.xpm) parts.push(`${n(s.xpm)}/${n(s.xpa)} XP`);
    return parts.join(' · ');
  }
  if (s.pass_att) parts.push(`${n(s.pass_cmp)}/${n(s.pass_att)} ${n(s.pass_yd)} yd${s.pass_td ? ` ${n(s.pass_td)} TD` : ''}${s.pass_int ? ` ${n(s.pass_int)} INT` : ''}`);
  if (s.rush_att) parts.push(`${n(s.rush_att)}-${n(s.rush_yd)} rush${s.rush_td ? ` ${n(s.rush_td)} TD` : ''}`);
  if (s.rec || s.rec_tgt) parts.push(`${n(s.rec)}/${n(s.rec_tgt)} ${n(s.rec_yd)} rec yd${s.rec_td ? ` ${n(s.rec_td)} TD` : ''}`);
  if (s.fum_lost) parts.push(`${n(s.fum_lost)} fum lost`);
  return parts.join(' · ');
}

const WATCH = [['pass_yd', 'pass yd'], ['pass_td', 'pass TD'], ['pass_int', 'INT thrown'], ['rush_yd', 'rush yd'], ['rush_td', 'rush TD'],
  ['rec', 'catch'], ['rec_yd', 'rec yd'], ['rec_td', 'rec TD'], ['fum_lost', 'fumble lost'], ['fgm', 'FG'], ['xpm', 'XP'],
  ['sack', 'sack'], ['int', 'INT'], ['fum_rec', 'fumble rec'], ['def_td', 'D TD'], ['pts_allow', 'pts allowed']];

/**
 * Compare two polls ({playerId: {pts, s}}) and return one event per player whose points moved,
 * biggest swing first: {id, delta, pts, what: ['+12 rec yd', '+1 catch']}.
 */
export function diffPolls(prev, next) {
  if (!prev) return [];
  const events = [];
  for (const [id, cur] of Object.entries(next)) {
    const old = prev[id] || { pts: 0, s: {} };
    const delta = Math.round((cur.pts - old.pts) * 100) / 100;
    if (!delta) continue;
    const what = [];
    for (const [k, label] of WATCH) {
      const d = n((cur.s[k] || 0) - (old.s[k] || 0));
      if (d) what.push(`${d > 0 ? '+' : ''}${d} ${label}${Math.abs(d) !== 1 && /^(catch|sack|FG|XP|INT)$/.test(label) ? (label === 'catch' ? 'es' : 's') : ''}`);
    }
    events.push({ id, delta, pts: cur.pts, what });
  }
  return events.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** player id -> {rid, starter, pts} from Sleeper's matchups for the week. */
export function rosterIndex(matchups) {
  const byPlayer = {};
  for (const m of matchups || []) {
    const starters = new Set((m.starters || []).filter(x => x && x !== '0'));
    for (const id of m.players || []) byPlayer[id] = { rid: m.roster_id, starter: starters.has(id), pts: m.players_points?.[id] };
  }
  return byPlayer;
}

/** Score every player in the stats feed. Rostered players use Sleeper's own number when it has one. */
export function scoreRows(stats, matchups, scoring) {
  const own = rosterIndex(matchups);
  return (stats || []).map(e => ({ ...e, own: own[e.id], pts: own[e.id]?.pts ? own[e.id].pts : leaguePoints(e.s, scoring) }));
}

/** What the ticker diff needs to remember about each player between polls. */
export function snapOf(rows) {
  const out = {};
  for (const r of rows) {
    const s = {};
    for (const [k] of WATCH) if (r.s[k]) s[k] = r.s[k];
    out[r.id] = { pts: r.pts, s };
  }
  return out;
}

// ---------------------------------------------------------------- NFL schedule (ESPN's public scoreboard)
// ESPN's abbreviations, where they differ from Sleeper's.
const ESPN_TEAM = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
export const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** Slim ESPN's scoreboard to one row per game: kickoff, teams, score, clock and red zone. */
export function parseScoreboard(raw) {
  const out = [];
  for (const ev of raw?.events || []) {
    const c = ev.competitions?.[0]; if (!c) continue;
    const side = ha => c.competitors?.find(x => x.homeAway === ha) || {};
    const ab = t => { const a = t?.team?.abbreviation || ''; return ESPN_TEAM[a] || a; };
    const home = side('home'), away = side('away'), st = c.status || ev.status || {}, sit = c.situation || {};
    const poss = sit.possession ? [home, away].find(x => String(x.team?.id) === String(sit.possession)) : null;
    out.push({
      id: String(ev.id), kickoff: ev.date || c.date || '', home: ab(home), away: ab(away),
      hs: Number(home.score) || 0, as: Number(away.score) || 0,
      state: st.type?.state || 'pre', // pre | in | post
      detail: st.type?.shortDetail || st.type?.detail || '',
      redzone: !!sit.isRedZone, poss: poss ? ab(poss) : '', down: sit.shortDownDistanceText || sit.downDistanceText || '',
    });
  }
  return out;
}

const ET = 'America/New_York';
function etParts(iso) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'long', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { weekday: p.weekday, month: +p.month, day: +p.day, year: +p.year, hour: +p.hour % 24 };
}

/**
 * Which TV window a kickoff falls in, by Eastern time: Thursday Night Football, Sunday morning
 * (London and other early games), Sunday afternoon, Sunday evening, Sunday Night Football, Monday
 * Night Football, and so on. Anything off the usual pattern (Christmas, Thanksgiving, Saturdays
 * late in the season, Black Friday) gets its own day-and-time label, so odd weeks still sort right.
 * Returns {key, label, at} where `at` is the window's earliest kickoff (for ordering).
 */
export function tvWindow(iso) {
  if (!iso) return { key: 'tbd', label: 'Kickoff time not set', at: Infinity };
  const t = etParts(iso), at = new Date(iso).getTime();
  const part = t.hour < 12 ? 'morning' : t.hour < 16 ? 'afternoon' : t.hour < 19 ? 'evening' : 'night';
  const thanksgiving = t.month === 11 && t.weekday === 'Thursday' && t.day >= 22 && t.day <= 28;
  const christmas = t.month === 12 && t.day === 25;
  let label;
  if (christmas) label = `Christmas ${part}`;
  else if (thanksgiving) label = `Thanksgiving ${part}`;
  else if (part === 'night' && t.weekday === 'Thursday') label = 'Thursday Night Football';
  else if (part === 'night' && t.weekday === 'Sunday') label = 'Sunday Night Football';
  else if (part === 'night' && t.weekday === 'Monday') label = 'Monday Night Football';
  else label = `${t.weekday} ${part}`;
  return { key: `${t.year}-${t.month}-${t.day}-${part}`, label, at };
}

const GAME_LENGTH = 3.25 * 3600e3;
/**
 * When to place a catch-up ("so far") ticker entry. Sleeper restamps finished stat lines the next
 * morning, so a game from last night would land at breakfast; use roughly when the game ended instead.
 */
export function catchupTime(at, game) {
  const k = game?.kickoff ? Date.parse(game.kickoff) : NaN;
  if (!Number.isFinite(k) || game.state === 'pre') return at;
  return Math.min(at, k + GAME_LENGTH);
}
