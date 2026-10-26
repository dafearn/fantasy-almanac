// The league API (member accounts, trade block, pick'em, the AI persona), shared by
// the local server (server/server.mjs) and the Vercel function (api/index.mjs).
// Visitors can read everything without an account; writing needs a member account.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { makeSleeper, STATS_BASE } from './sleeper.mjs';
import { trimStats, leaguePoints, scoreRows, snapOf, diffPolls, parseScoreboard, catchupTime, ESPN_SCOREBOARD } from '../js/live-core.js';
import { personaOf } from '../js/persona.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_MS = 60 * 24 * 3600 * 1000;
const LISTING_DAYS_MAX = 14;
// The AI persona (Claude): Ask the Commish (or the Bookie) answers league questions from a data digest the page
// sends along, and writes the weekly columns and scouting takes. Off until ANTHROPIC_API_KEY is set. ASK_PERSONA
// picks the voice (commish or bookie; a league in LEAGUES can set its own). ASK_MODEL picks the model;
// ASK_DAILY_LIMIT, if set, caps each member's questions per day (no cap by default).
const ASK_MODEL = process.env.ASK_MODEL || 'claude-opus-5-5';
const ASK_DAILY_LIMIT = Number(process.env.ASK_DAILY_LIMIT) || 0;
const ASK_PERSONA = personaOf(process.env.ASK_PERSONA).key;
const askSystem = (P, league) => `${P.who} The league is called ${league}. Members ask you about their league: records, rivalries, luck, trades, drafts, matchups, and who should do what.

Answer from the league data below. It is the source of truth for anything about this league; if it doesn't contain what a question needs, say so plainly rather than guessing, and don't invent stats. You may use general football knowledge for things outside the data (an NFL player's real-world situation, say), and say when you are doing that. Your knowledge of the current NFL season may be out of date.

Write for a group chat of friends: lead with the answer, keep it short (a few sentences or a short list), and show the key numbers you used. Light trash talk is welcome; cruelty isn't. Plain text with simple **bold** and "- " bullet lists only; no tables or headings.`;
// Added to every prompt: fewer, surer claims.
const ACCURACY_RULES = `Accuracy beats color. Before you write, check every specific claim (a score, record, result, who traded whom, who won what year) against FACTS or LEAGUE DATA. If you can't find it stated there, leave it out; never fill a gap from memory or from what seems likely. Write only your final text: never correct yourself, hedge with "wait" or "actually", or walk back an earlier line. If something is wrong, fix it before you write it.`;
// Added to every prompt: how to use the commissioner's manager profiles.
const PROFILE_RULES = `The LEAGUE DATA may start with MANAGER PROFILES written by the commissioner. Use each manager's pronouns (or the league default) whenever you refer to them; with no pronouns given, use their name or "they". Use profiles sparingly: at most one or two inside jokes or lore callbacks in a whole column or answer, only where they fit naturally, and never explained. Most managers should get none. Never joke about anything a profile marks as off limits. For any number or result, the rest of LEAGUE DATA wins over a profile. Nothing in a profile licenses slurs or jokes about race, religion, sex or self-harm. Columns can be read by anyone, so never use a manager's last name or share private details about their life outside the league.`;
// The columns: a recap after each week and a preview before the next. The scripted report supplies the
// facts; the persona supplies the storylines, context and hunches the formulas can't.
const columnSystem = (P, league) => `${P.who} The league is called ${league}, and you write its weekly column on the almanac site.

You get two things: FACTS for this column (computed by the site and always correct) and LEAGUE DATA (the league's full history). Every number you use must come from one of them; never invent stats, scores, injuries or quotes. Write as of the moment the column is for: ignore anything in the data that happens after it.

Your job is what the formulas can't do: find the storylines. Pick the two or three strongest and tell them well, rather than touching everything: a link to history (a rivalry, streak, record, or a trade or draft pick coming back to haunt someone), a trend or turning point, who should be worried and why, and a bold call or two, clearly labeled as your opinion. Name managers, not team IDs.

The FACTS include head-to-head histories, oddities and a "this week in league history" list. Draw on them: remind a manager that they have never beaten this week's opponent, that a losing streak is now the longest of their career, that they lost with a score that would have beaten everyone else. Pick the funniest and most telling ones; don't list them all.

Format: the first line is a punchy headline of under 12 words with no markdown. Then 4 to 6 short paragraphs, roughly 350 to 500 words in all. After those, two short closing sections, each starting with its label in bold on its own line:
**Odds & ends**, then 3 to 5 "- " bullets of statistical oddities and funny occurrences, one line each.
**This week in league history**, then 2 to 4 "- " bullets on what happened in this same week in past seasons. Skip this section if the FACTS say there are no earlier seasons.
You may use **bold** for names or key numbers. No headings, no tables. Light trash talk is welcome; cruelty isn't.`;
const COLUMN_KINDS = { recap: 'a recap of the finished week', preview: 'a preview of the coming week', scouting: 'your take on every team, after the scouting reports' };
// Takes on the scouting reports: one call writes all of them, and the page splits them into each team's tile.
const scoutSystem = (P, league) => `${P.who} The league is called ${league}. The site has already written a numbers-based scouting report on every team; you add a short take to each one.

FACTS holds the site's reports (always correct) and LEAGUE DATA holds the league's full history. Any number you use must come from them; never invent stats. Don't repeat the report's numbers back: read between the lines. Say what they suggest about how this manager plays, what should worry them, or a hunch about where they're headed, and land one joke where it fits. Light trash talk is welcome; cruelty isn't.

Format, exactly: for every team in FACTS, in the same order, a line "@@ " followed by the manager's name exactly as FACTS writes it, then 2 or 3 sentences (40 to 70 words) on the next line. Plain text with **bold** allowed. Nothing before the first @@ line and nothing after the last take.`;

/**
 * The leagues this server hosts accounts and the clubhouse for. Either LEAGUE_IDS (comma-separated Sleeper
 * league ids; names and commissioners come from Sleeper) or LEAGUES, a JSON list of
 * {key, rootLeagueId, name?, commissioner?, inviteCode?, persona?}. With neither, the server still serves the
 * site and its shared helpers, and every league is browse-only.
 */
function configuredLeagues() {
  if (process.env.LEAGUES) return JSON.parse(process.env.LEAGUES);
  return String(process.env.LEAGUE_IDS || process.env.LEAGUE_ID || '').split(/[\s,]+/).filter(x => /^\d{6,24}$/.test(x))
    .map(id => ({ key: id, rootLeagueId: id }));
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };
const now = () => Date.now();

// ------------------------------------------------------------------ passwords, tokens
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));
async function hashSecret(pw) { const salt = crypto.randomBytes(16); return `${salt.toString('hex')}:${(await scrypt(pw, salt)).toString('hex')}`; }
async function checkSecret(pw, stored) {
  if (!stored) return false;
  const [salt, key] = stored.split(':');
  const got = await scrypt(pw, Buffer.from(salt, 'hex'));
  return crypto.timingSafeEqual(got, Buffer.from(key, 'hex'));
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ http helpers
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
}
async function readJson(req, max = 32 * 1024) {
  if (!/application\/json/.test(req.headers['content-type'] || '')) bad('Expected JSON');
  // Vercel's Node runtime has already read and parsed the body into req.body.
  let parsed;
  try { parsed = 'body' in req ? req.body : undefined; } catch { bad('Invalid JSON'); }
  if (parsed !== undefined) {
    const raw = typeof parsed === 'string' || Buffer.isBuffer(parsed) ? String(parsed) : JSON.stringify(parsed ?? {});
    if (raw.length > max) bad('Request too large', 413);
    try { return JSON.parse(raw || '{}'); } catch { bad('Invalid JSON'); }
  }
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) bad('Request too large', 413); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { bad('Invalid JSON'); }
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const text = (s, max) => { const t = String(s ?? '').trim(); if (t.length > max) bad(`Text is longer than ${max} characters`); return t; };
const clientIp = req => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

/**
 * Build the API. Returns { handle(req, res, pathname, searchParams), ready(), send } where ready()
 * resolves once the database and leagues are set up.
 */
export function createApi({
  dataDir = path.join(ROOT, 'server-data'),
  cookieSecure = process.env.COOKIE_SECURE === '1',
  leagues = configuredLeagues(),
  snapshotPath = process.env.SNAPSHOT || path.join(ROOT, 'data', 'snapshot.json'),
} = {}) {
  const LEAGUES = leagues.map(L => ({ ...L, key: String(L.key || L.rootLeagueId), rootLeagueId: String(L.rootLeagueId) }));
  if (process.env.INVITE_CODE && LEAGUES[0]) LEAGUES[0].inviteCode = process.env.INVITE_CODE;
  const sleeper = makeSleeper({ snapshotPath });
  let db;

  async function setup() {
    db = await openDb({ dir: dataDir });
    for (const L of LEAGUES) {
      // Fill in the name from Sleeper when the config leaves it out.
      if (!L.name) L.name = (await sleeper.get(`/league/${L.rootLeagueId}`).catch(() => null))?.name?.trim() || 'League';
      const row = await db.get('SELECT * FROM leagues WHERE key = ?', [L.key]);
      if (!row) await db.run('INSERT INTO leagues (key, name, root_league_id, commissioner, created_at) VALUES (?, ?, ?, ?, ?)', [L.key, L.name, L.rootLeagueId, L.commissioner || null, now()]);
      else await db.run('UPDATE leagues SET name = ?, root_league_id = ?, commissioner = ? WHERE key = ?', [L.name, L.rootLeagueId, L.commissioner || null, L.key]);
      const cur = await db.get('SELECT invite_hash, invite_src FROM leagues WHERE key = ?', [L.key]);
      if (L.inviteCode) {
        // Apply the configured code only when it changes, so a code the commissioner made in the
        // app isn't overwritten every time a serverless instance starts.
        if (cur.invite_src !== sha(L.inviteCode)) await db.run('UPDATE leagues SET invite_hash = ?, invite_src = ? WHERE key = ?', [await hashSecret(L.inviteCode), sha(L.inviteCode), L.key]);
      } else if (!cur.invite_hash) {
        const code = crypto.randomBytes(4).toString('hex');
        await db.run('UPDATE leagues SET invite_hash = ? WHERE key = ?', [await hashSecret(code), L.key]);
        console.log(`[${L.key}] New invite code: ${code}  (share it with league members so they can create accounts)`);
      }
    }
  }
  // Set up once per process; if it fails (say the database is briefly unreachable), the next
  // request tries again instead of the instance staying broken.
  let readyP = null;
  const ready = () => (readyP ||= setup().catch(e => { readyP = null; throw e; }));
  ready().catch(() => {});

  const league = key => db.get('SELECT key, name, root_league_id, commissioner FROM leagues WHERE key = ?', [key]);

  async function sessionUser(req) {
    const tok = cookies(req).la_session; if (!tok) return null;
    const row = await db.get('SELECT u.id, u.username, u.sleeper_user_id, u.display_name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha(tok)]);
    if (!row || row.expires_at < now()) return null;
    return row;
  }
  async function requireMember(req, key) {
    const user = await sessionUser(req);
    if (!user) bad('Sign in as a league member to do that', 401);
    const m = await db.get('SELECT role FROM memberships WHERE user_id = ? AND league_key = ?', [user.id, key]);
    if (!m) bad('Only members of this league can do that', 403);
    return { ...user, role: m.role };
  }
  // Mark the cookie Secure whenever the request came in over https. Behind a proxy (Vercel) that's
  // x-forwarded-proto; a browser drops a Secure cookie set over plain http, so don't send one then.
  const secureFor = req => { const proto = req?.headers?.['x-forwarded-proto']; return proto ? proto.split(',')[0].trim() === 'https' : cookieSecure; };
  async function startSession(req, userId) {
    const tok = crypto.randomBytes(32).toString('base64url');
    await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha(tok), userId, now() + SESSION_MS]);
    return `la_session=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secureFor(req) ? '; Secure' : ''}`;
  }

  // Brute-force guard for login/register: 10 attempts per IP per 10 minutes. Kept in the
  // database so it holds across serverless instances.
  async function throttle(req) {
    const ip = clientIp(req), since = now() - 600000;
    await db.run('DELETE FROM attempts WHERE at < ?', [since]);
    const { n } = await db.get('SELECT COUNT(*) AS n FROM attempts WHERE ip = ? AND at >= ?', [ip, since]);
    if (n >= 10) bad('Too many attempts. Try again in a few minutes.', 429);
    await db.run('INSERT INTO attempts (ip, at) VALUES (?, ?)', [ip, now()]);
  }

  async function meJson(user) {
    if (!user) return { user: null, memberships: [] };
    const ms = await db.all('SELECT league_key AS league, role FROM memberships WHERE user_id = ?', [user.id]);
    return { user: { username: user.username, sleeperUserId: user.sleeper_user_id, displayName: user.display_name }, memberships: ms };
  }

  // ---------------------------------------------------------------- trade block
  async function currentOwnership(L) {
    const lid = await sleeper.currentLeagueId(L.root_league_id);
    return sleeper.ownership(lid);
  }
  async function listingsFor(key, viewer) {
    const rows = await db.all('SELECT l.*, u.sleeper_user_id AS seller FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.league_key = ? ORDER BY l.created_at DESC LIMIT 200', [key]);
    if (!rows.length) return [];
    const ids = rows.map(l => l.id), marks = ids.map(() => '?').join(',');
    const bids = await db.all(`SELECT b.*, u.sleeper_user_id AS bidder FROM bids b JOIN users u ON u.id = b.bidder_id WHERE b.listing_id IN (${marks}) ORDER BY b.created_at`, ids);
    const comments = await db.all(`SELECT c.id, c.listing_id, c.text, c.created_at AS createdAt, u.sleeper_user_id AS author FROM comments c JOIN users u ON u.id = c.user_id WHERE c.listing_id IN (${marks}) ORDER BY c.created_at`, ids);
    return rows.map(l => ({
      id: l.id, seller: l.seller, playerId: l.player_id, note: l.note, asking: l.asking,
      status: l.status === 'open' && l.ends_at < now() ? 'ended' : l.status,
      acceptedBidId: l.accepted_bid_id, createdAt: l.created_at, endsAt: l.ends_at, mine: viewer?.id === l.seller_id,
      bids: bids.filter(b => b.listing_id === l.id).map(b => ({ id: b.id, bidder: b.bidder, players: JSON.parse(b.players), picks: b.picks, faab: b.faab, note: b.note, status: b.status, createdAt: b.created_at, mine: viewer?.id === b.bidder_id })),
      comments: comments.filter(c => c.listing_id === l.id).map(({ listing_id, ...c }) => c),
    }));
  }
  async function getListing(key, id) {
    const l = await db.get('SELECT * FROM listings WHERE id = ? AND league_key = ?', [Number(id), key]);
    if (!l) bad('Listing not found', 404);
    if (l.status === 'open' && l.ends_at < now()) l.status = 'ended';
    return l;
  }

  // ---------------------------------------------------------------- routes
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

  route('GET', '/api/config', async () => ({
    leagues: LEAGUES.map(L => ({ key: L.key, name: L.name, rootLeagueId: L.rootLeagueId, persona: personaOf(L.persona || ASK_PERSONA).key })),
    defaultLeague: LEAGUES[0]?.key || null, persona: ASK_PERSONA,
  }));
  route('GET', '/api/auth/me', async ({ req }) => meJson(await sessionUser(req)));

  route('POST', '/api/auth/register', async ({ req }) => {
    await throttle(req);
    const b = await readJson(req);
    const L = (await league(String(b.league || ''))) || bad('Unknown league');
    const username = text(b.username, 40), password = String(b.password || '');
    if (!username) bad('Enter your Sleeper username');
    if (password.length < 8) bad('Use a password of at least 8 characters');
    const row = await db.get('SELECT invite_hash FROM leagues WHERE key = ?', [L.key]);
    if (!(await checkSecret(String(b.inviteCode || '').trim(), row.invite_hash))) bad('That invite code is not right. Ask the commissioner for it.', 403);
    const lid = await sleeper.currentLeagueId(L.root_league_id);
    const member = await sleeper.findMember(lid, username);
    if (!member) bad(`${username} isn't a member of ${L.name} on Sleeper`, 403);
    // The commissioner: the configured Sleeper username, or else whoever runs the league on Sleeper.
    const role = (L.commissioner ? L.commissioner.toLowerCase() === username.toLowerCase() : member.isOwner) ? 'commissioner' : 'member';
    const existing = await db.get('SELECT * FROM users WHERE lower(username) = lower(?) OR sleeper_user_id = ?', [username, member.userId]);
    let uid;
    if (existing) {
      // Someone already signed up through another league on this server: same password joins this one too.
      if (!(await checkSecret(password, existing.pass_hash))) bad('An account already exists for that Sleeper user. Sign in with its password to join this league too, or ask the commissioner to reset it.', 409);
      if (await db.get('SELECT 1 FROM memberships WHERE user_id = ? AND league_key = ?', [existing.id, L.key])) bad('You already have an account in this league. Sign in instead.', 409);
      uid = existing.id;
    } else {
      const info = await db.run('INSERT INTO users (username, sleeper_user_id, display_name, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)', [username, member.userId, member.displayName || username, await hashSecret(password), now()]);
      uid = Number(info.lastInsertRowid);
    }
    await db.run('INSERT INTO memberships (user_id, league_key, role) VALUES (?, ?, ?)', [uid, L.key, role]);
    const cookie = await startSession(req, uid);
    return { status: 201, headers: { 'set-cookie': cookie }, body: await meJson(await sessionUser({ headers: { cookie: cookie.split(';')[0] } })) };
  });

  route('POST', '/api/auth/login', async ({ req }) => {
    await throttle(req);
    const b = await readJson(req);
    // Usernames match regardless of case or stray spaces.
    const u = await db.get('SELECT * FROM users WHERE lower(username) = lower(?)', [String(b.username || '').trim()]);
    if (!u || !(await checkSecret(String(b.password || ''), u.pass_hash))) bad('Wrong username or password', 401);
    const cookie = await startSession(req, u.id);
    return { headers: { 'set-cookie': cookie }, body: await meJson(u) };
  });

  route('POST', '/api/auth/logout', async ({ req }) => {
    const tok = cookies(req).la_session; if (tok) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha(tok)]);
    return { headers: { 'set-cookie': `la_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFor(req) ? '; Secure' : ''}` }, body: { ok: true } };
  });

  // Commissioner tools
  route('POST', '/api/l/:key/invite', async ({ req, p }) => {
    const me = await requireMember(req, p.key); if (me.role !== 'commissioner') bad('Commissioner only', 403);
    const code = crypto.randomBytes(4).toString('hex');
    await db.run('UPDATE leagues SET invite_hash = ? WHERE key = ?', [await hashSecret(code), p.key]);
    return { inviteCode: code };
  });
  route('POST', '/api/l/:key/reset-account', async ({ req, p }) => {
    const me = await requireMember(req, p.key); if (me.role !== 'commissioner') bad('Commissioner only', 403);
    const b = await readJson(req);
    const u = (await db.get('SELECT id FROM users WHERE lower(username) = lower(?)', [String(b.username || '').trim()])) || bad('No such account', 404);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
    const temp = crypto.randomBytes(6).toString('base64url');
    await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', [await hashSecret(temp), u.id]);
    return { temporaryPassword: temp };
  });
  route('GET', '/api/l/:key/members', async ({ p }) => {
    (await league(p.key)) || bad('Unknown league', 404);
    return { members: await db.all('SELECT u.sleeper_user_id AS sleeperUserId, u.display_name AS displayName, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.league_key = ?', [p.key]) };
  });

  // Trade block
  route('GET', '/api/l/:key/block', async ({ req, p }) => {
    (await league(p.key)) || bad('Unknown league', 404);
    return { listings: await listingsFor(p.key, await sessionUser(req)) };
  });
  route('POST', '/api/l/:key/block', async ({ req, p }) => {
    const me = await requireMember(req, p.key); const L = await league(p.key);
    const b = await readJson(req);
    const playerId = text(b.playerId, 12) || bad('Pick a player');
    const own = (await currentOwnership(L)).get(me.sleeper_user_id);
    if (!own?.players.has(playerId)) bad("That player isn't on your roster");
    if (await db.get("SELECT 1 FROM listings WHERE league_key = ? AND player_id = ? AND status = 'open' AND ends_at > ?", [p.key, playerId, now()])) bad('That player is already on the block');
    const days = Math.min(LISTING_DAYS_MAX, Math.max(1, Number(b.days) || 3));
    const info = await db.run('INSERT INTO listings (league_key, seller_id, player_id, note, asking, created_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [p.key, me.id, playerId, text(b.note, 500), text(b.asking, 200), now(), now() + days * 86400000]);
    return { status: 201, body: { id: Number(info.lastInsertRowid) } };
  });
  route('POST', '/api/l/:key/block/:id/bids', async ({ req, p }) => {
    const me = await requireMember(req, p.key); const L = await league(p.key);
    const l = await getListing(p.key, p.id);
    if (l.status !== 'open') bad('Bidding on this listing is closed');
    if (l.seller_id === me.id) bad("You can't bid on your own player");
    const b = await readJson(req);
    const players = Array.isArray(b.players) ? [...new Set(b.players.map(x => text(x, 12)).filter(Boolean))].slice(0, 6) : [];
    const picks = text(b.picks, 120), faab = b.faab == null || b.faab === '' ? null : Math.max(0, Math.min(1000, Math.round(Number(b.faab) || 0)));
    if (!players.length && !picks && !faab) bad('Offer at least one player, pick or FAAB');
    if (players.length) {
      const own = (await currentOwnership(L)).get(me.sleeper_user_id);
      if (players.some(id => !own?.players.has(id))) bad('You can only offer players on your roster');
    }
    await db.run("UPDATE bids SET status = 'replaced' WHERE listing_id = ? AND bidder_id = ? AND status = 'active'", [l.id, me.id]);
    const info = await db.run('INSERT INTO bids (listing_id, bidder_id, players, picks, faab, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [l.id, me.id, JSON.stringify(players), picks, faab, text(b.note, 300), now()]);
    return { status: 201, body: { id: Number(info.lastInsertRowid) } };
  });
  route('POST', '/api/l/:key/block/:id/accept', async ({ req, p }) => {
    const me = await requireMember(req, p.key); const l = await getListing(p.key, p.id);
    if (l.seller_id !== me.id) bad('Only the seller can accept a bid', 403);
    if (!['open', 'ended'].includes(l.status)) bad('This listing is already closed');
    const b = await readJson(req);
    const bid = (await db.get("SELECT * FROM bids WHERE id = ? AND listing_id = ? AND status = 'active'", [Number(b.bidId), l.id])) || bad('Bid not found', 404);
    await db.batch([
      ["UPDATE listings SET status = 'accepted', accepted_bid_id = ? WHERE id = ?", [bid.id, l.id]],
      ["UPDATE bids SET status = CASE WHEN id = ? THEN 'accepted' ELSE 'declined' END WHERE listing_id = ? AND status = 'active'", [bid.id, l.id]],
    ]);
    return { ok: true };
  });
  route('POST', '/api/l/:key/block/:id/close', async ({ req, p }) => {
    const me = await requireMember(req, p.key); const l = await getListing(p.key, p.id);
    if (l.seller_id !== me.id && me.role !== 'commissioner') bad('Only the seller can take a player off the block', 403);
    await db.run("UPDATE listings SET status = 'closed' WHERE id = ? AND status IN ('open')", [l.id]);
    return { ok: true };
  });
  route('POST', '/api/l/:key/bids/:id/withdraw', async ({ req, p }) => {
    const me = await requireMember(req, p.key);
    const r = await db.run("UPDATE bids SET status = 'withdrawn' WHERE id = ? AND bidder_id = ? AND status = 'active'", [Number(p.id), me.id]);
    if (!r.changes) bad('Bid not found', 404);
    return { ok: true };
  });
  route('POST', '/api/l/:key/block/:id/comments', async ({ req, p }) => {
    const me = await requireMember(req, p.key); const l = await getListing(p.key, p.id);
    const b = await readJson(req); const t = text(b.text, 500) || bad('Say something');
    await db.run('INSERT INTO comments (listing_id, user_id, text, created_at) VALUES (?, ?, ?, ?)', [l.id, me.id, t, now()]);
    return { status: 201, body: { ok: true } };
  });

  const getJson = async (url, ms = 8000) => { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`); return r.json(); };

  // Player lab: every NFL player's fantasy points each finished week, plus Sleeper's projections for the weeks
  // still to come, all scored with that season's league settings. Finished weeks are kept (the newest one is
  // re-read for a few days to pick up stat corrections); projections refresh every few hours.
  const LAB_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(x => `position[]=${x}`).join('&');
  async function labWeek(lid, scoring, season, week, kind, fresh) {
    const key = `${lid}:${kind}:${week}`;
    const hit = await db.get('SELECT body, fetched_at FROM lab_cache WHERE key = ?', [key]);
    if (hit && now() - hit.fetched_at < fresh) return JSON.parse(hit.body);
    const url = kind === 's'
      ? `${STATS_BASE}/stats/nfl/${season}/${week}?season_type=regular`
      : `${STATS_BASE}/projections/nfl/${season}/${week}?season_type=regular&${LAB_POS}`;
    const raw = await getJson(url, 20000);
    const out = {};
    const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([player_id, stats]) => ({ player_id, stats })) : [];
    for (const r of rows) {
      const s = r?.stats; if (!r?.player_id || !s) continue;
      const pts = leaguePoints(s, scoring);
      // Stats: anyone who suited up (gp) or scored. Projections: anyone projected to score.
      if (kind === 's' ? s.gp > 0 || pts !== 0 : pts > 0) out[r.player_id] = pts;
    }
    if (Object.keys(out).length) await db.run('INSERT INTO lab_cache (key, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at', [key, JSON.stringify(out), now()]);
    return out;
  }
  route('GET', '/api/lab', async ({ q }) => {
    const lid = String(q.get('league') || ''), season = String(q.get('season') || '');
    const through = Number(q.get('through')), last = Number(q.get('last'));
    if (!/^\d{6,24}$/.test(lid) || !/^\d{4}$/.test(season) || !(through >= 0 && through <= 18) || !(last >= through && last <= 18)) bad('Bad lab request');
    const lg = await sleeper.get(`/league/${lid}`).catch(() => null);
    if (!lg || String(lg.season) !== season) bad('Unknown league season', 404);
    const scoring = lg.scoring_settings || {};
    const jobs = [];
    for (let w = 1; w <= through; w++) jobs.push({ w, kind: 's', fresh: w === through ? 6 * 3600e3 : w >= through - 1 ? 3 * 86400e3 : Infinity });
    for (let w = through + 1; w <= last; w++) jobs.push({ w, kind: 'p', fresh: 6 * 3600e3 });
    const got = {}, errors = [];
    // A few at a time: each uncached week downloads one of Sleeper's full feeds.
    for (let i = 0; i < jobs.length; i += 6) {
      await Promise.all(jobs.slice(i, i + 6).map(async j => {
        try { got[`${j.kind}${j.w}`] = await labWeek(lid, scoring, season, j.w, j.kind, j.fresh); }
        catch (e) { errors.push(`${j.kind === 's' ? 'stats' : 'projections'} week ${j.w}: ${e.message}`); }
      }));
    }
    const pts = {}, proj = {};
    for (let w = 1; w <= through; w++) for (const [id, v] of Object.entries(got[`s${w}`] || {})) (pts[id] ||= Array(through).fill(null))[w - 1] = v;
    for (let w = through + 1; w <= last; w++) for (const [id, v] of Object.entries(got[`p${w}`] || {})) (proj[id] ||= Array(last - through).fill(null))[w - through - 1] = v;
    return { body: { season, through, last, pts, proj, errors }, headers: { 'cache-control': 'private, max-age=600' } };
  });

  // Pick'em: everyone picks each matchup's winner before the week's games start.
  route('GET', '/api/l/:key/pickem', async ({ req, p, q }) => {
    const L = (await league(p.key)) || bad('Unknown league', 404);
    const season = String(q.get('season') || '');
    const rows = await db.all('SELECT p.week, p.matchup_id AS matchupId, p.roster_id AS rosterId, p.user_id AS uid, u.sleeper_user_id AS picker FROM picks p JOIN users u ON u.id = p.user_id WHERE p.league_key = ? AND p.season = ?', [L.key, season]);
    const viewer = await sessionUser(req);
    const lid = await sleeper.currentLeagueId(L.root_league_id);
    const locked = {};
    for (const w of new Set(rows.map(r => r.week))) locked[w] = await sleeper.weekStarted(lid, w).catch(() => false);
    // Hide other members' picks until that week's games have started.
    return { picks: rows.filter(r => locked[r.week] || r.uid === viewer?.id).map(({ uid, ...r }) => r), locked };
  });
  route('POST', '/api/l/:key/pickem', async ({ req, p }) => {
    const me = await requireMember(req, p.key); const L = await league(p.key);
    const b = await readJson(req);
    const lid = await sleeper.currentLeagueId(L.root_league_id);
    const lg = await sleeper.get(`/league/${lid}`);
    const season = String(lg.season), week = Number(b.week);
    if (String(b.season) !== season) bad("Pick'em is only open for the current season");
    if (!(week >= 1 && week <= 18)) bad('Bad week');
    if (await sleeper.weekStarted(lid, week)) bad("This week's games have started, so picks are locked");
    const ms = (await sleeper.get(`/league/${lid}/matchups/${week}`)) || [];
    const valid = new Map(); for (const m of ms) if (m.matchup_id != null) (valid.get(m.matchup_id) || valid.set(m.matchup_id, new Set()).get(m.matchup_id)).add(m.roster_id);
    const stmts = [];
    for (const [mid, rid] of Object.entries(b.picks || {})) {
      if (!valid.get(Number(mid))?.has(Number(rid))) bad('Pick a team that is actually in that matchup');
      stmts.push(['INSERT INTO picks (league_key, user_id, season, week, matchup_id, roster_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (league_key, user_id, season, week, matchup_id) DO UPDATE SET roster_id = excluded.roster_id, created_at = excluded.created_at',
        [L.key, me.id, season, week, Number(mid), Number(rid), now()]]);
    }
    await db.batch(stmts);
    return { ok: true, saved: stmts.length };
  });

  // Live scoring: this week's per-player stats (Sleeper's undocumented stats feed), the league's matchups
  // and ESPN's scoreboard (kickoff times, game clock, red zone), fetched at most once per 15 seconds per
  // server instance and shared by every viewer.
  //
  // Each request also compares the stats with the last poll stored for the week and saves any scoring
  // changes, so the ticker holds the whole week, not just what one open page happened to see. Changes
  // only land when someone has the Live page open: a gap with nobody watching shows as one bigger change.
  // The first poll of a week records each player's total so far as a catch-up entry.
  const LIVE_MIN_GAP = 15000;
  async function recordTicker(key, season, week, type, rows, schedule) {
    const snap = await db.get('SELECT body, at FROM live_snap WHERE league_key = ? AND season = ? AND week = ? AND type = ?', [key, season, week, type]);
    const t = now();
    if (snap && t - snap.at < LIVE_MIN_GAP) return;
    const next = snapOf(rows), body = JSON.stringify(next);
    if (snap && snap.body === body) { await db.run('UPDATE live_snap SET at = ? WHERE league_key = ? AND season = ? AND week = ? AND type = ? AND at = ?', [t, key, season, week, type, snap.at]); return; }
    // Claim this poll first, so two servers polling at once don't both record the same change.
    const claim = snap
      ? await db.run('UPDATE live_snap SET body = ?, at = ? WHERE league_key = ? AND season = ? AND week = ? AND type = ? AND at = ?', [body, t, key, season, week, type, snap.at])
      : await db.run('INSERT INTO live_snap (league_key, season, week, type, body, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [key, season, week, type, body, t]);
    if (claim.changes !== 1) return;
    if (!snap) await db.run('DELETE FROM live_snap WHERE league_key = ? AND NOT (season = ? AND week = ? AND type = ?)', [key, season, week, type]);
    const prev = snap ? JSON.parse(snap.body) : {};
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    // Sleeper stamps each player's stat line when it last changed; that's closer to the play than our poll.
    const when = r => (r?.upd && r.upd <= t && r.upd > (snap?.at || 0) ? r.upd : t);
    const gameOf = Object.fromEntries((schedule || []).flatMap(g => [[g.home, g], [g.away, g]]));
    const at = r => (snap ? when(r) : catchupTime(when(r), gameOf[r?.team]));
    const stmts = diffPolls(prev, next).map(ev => {
      const r = byId[ev.id];
      return ['INSERT INTO live_events (league_key, season, week, type, at, player_id, delta, pts, what, roster_id, starter, catchup) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [key, season, week, type, at(r), ev.id, ev.delta, ev.pts, JSON.stringify(ev.what), r?.own?.rid ?? null, r?.own?.starter ? 1 : 0, snap ? 0 : 1]];
    });
    if (stmts.length) await db.batch(stmts);
  }

  route('GET', '/api/l/:key/live', async ({ p, q }) => {
    const L = (await league(p.key)) || bad('Unknown league', 404);
    const season = String(q.get('season') || ''), week = String(q.get('week') || ''), type = q.get('type') === 'post' ? 'post' : 'regular';
    if (!/^\d{4}$/.test(season) || !/^\d{1,2}$/.test(week)) bad('Bad season or week');
    const since = Math.max(0, Number(q.get('since')) || 0);
    const lid = await sleeper.currentLeagueId(L.root_league_id);
    const [statsRaw, matchups, lg, board] = await Promise.all([
      sleeper.get(`/stats/nfl/${season}/${week}?season_type=${type}`, { base: STATS_BASE, maxAge: 15000 }),
      sleeper.get(`/league/${lid}/matchups/${week}`, { maxAge: 15000 }),
      sleeper.get(`/league/${lid}`).catch(() => null),
      sleeper.get(`?seasontype=${type === 'post' ? 3 : 2}&week=${week}&dates=${season}`, { base: ESPN_SCOREBOARD, maxAge: 15000 }).catch(() => null),
    ]);
    const stats = trimStats(statsRaw), schedule = board ? parseScoreboard(board) : null;
    if (lg && String(lg.season) === season) {
      try { await recordTicker(L.key, season, Number(week), type, scoreRows(stats, matchups, lg.scoring_settings || {}), schedule); }
      catch (e) { console.error('live ticker:', e.message); }
    }
    const events = await db.all(`SELECT id, at, player_id AS pid, delta, pts, what, roster_id AS rid, starter, catchup FROM live_events
      WHERE league_key = ? AND season = ? AND week = ? AND type = ? AND id > ? ORDER BY id DESC LIMIT 5000`, [L.key, season, Number(week), type, since]);
    for (const e of events) { e.what = JSON.parse(e.what); e.starter = !!e.starter; e.catchup = !!e.catchup; }
    return { body: { at: now(), leagueId: lid, stats, matchups: matchups || [], schedule, events, ticker: true } };
  });

  // ---------------------------------------------------------------- The Receipts
  // What the Receipts need to know about a finished NFL week: who played on its last game day (for Monday
  // Night Miracles) and every team's kickoff and every player's team that week (to rebuild Sunday Heartburn
  // for weeks the Live ticker never saw). Kickoffs come from ESPN's scoreboard (Sleeper's stats rows carry a
  // date as a fallback) and teams from Sleeper's stats feed. A finished week never changes, so it's kept.
  const etDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const etWeekday = day => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${day}T12:00:00Z`));
  async function weekInfo(season, week) {
    const hit = await db.get('SELECT body FROM nfl_finale WHERE season = ? AND week = ?', [season, week]);
    const kept = hit ? JSON.parse(hit.body) : null;
    if (kept?.kick) return kept; // rows saved before kickoffs were kept get redone once
    const [raw, board] = await Promise.all([
      getJson(`${STATS_BASE}/stats/nfl/${season}/${week}?season_type=regular`, 20000),
      getJson(`${ESPN_SCOREBOARD}?seasontype=2&week=${week}&dates=${season}`).catch(() => null),
    ]);
    const rows = trimStats(raw), games = board ? parseScoreboard(board).filter(g => g.kickoff) : [];
    let day, teams, n, done;
    const kick = {};
    if (games.length) {
      const days = games.map(g => etDay(g.kickoff));
      day = days.reduce((a, b) => (b > a ? b : a));
      const late = games.filter((g, i) => days[i] === day);
      teams = late.flatMap(g => [g.home, g.away]); n = late.length; done = games.every(g => g.state === 'post');
      for (const g of games) kick[g.home] = kick[g.away] = g.kickoff;
    } else {
      day = rows.reduce((a, r) => (r.date > a ? r.date : a), '');
      if (!day) return null;
      teams = [...new Set(rows.filter(r => r.date === day).map(r => r.team).filter(Boolean))]; n = Math.ceil(teams.length / 2);
      done = Date.parse(`${day}T12:00:00Z`) < now() - 2 * 86400e3;
      // No clock times without ESPN: Sunday afternoon for Sunday games, prime time otherwise.
      for (const r of rows) if (r.team && r.date && !kick[r.team]) kick[r.team] = `${r.date}T${etWeekday(r.date) === 'Sunday' ? '17:00' : '00:15'}:00Z`;
    }
    const set = new Set(teams), teamOf = {};
    for (const r of rows) if (r.team) teamOf[r.id] = r.team;
    const out = { day, weekday: etWeekday(day), games: n, teams, pids: rows.filter(r => set.has(r.team)).map(r => r.id), kick, teamOf };
    if (done) await db.run('INSERT INTO nfl_finale (season, week, body) VALUES (?, ?, ?) ON CONFLICT (season, week) DO UPDATE SET body = excluded.body', [season, week, JSON.stringify(out)]);
    return out;
  }
  route('GET', '/api/nfl/finale', async ({ q }) => {
    const season = String(q.get('season') || '');
    if (!/^\d{4}$/.test(season)) bad('Bad season');
    const weeks = [...new Set(String(q.get('weeks') || '').split(',').map(Number).filter(w => w >= 1 && w <= 18))];
    const out = {};
    // A few at a time: each uncached week downloads Sleeper's full stats feed.
    for (let i = 0; i < weeks.length; i += 6) {
      await Promise.all(weeks.slice(i, i + 6).map(async w => {
        try { const x = await weekInfo(season, w); out[w] = x && { day: x.day, weekday: x.weekday, games: x.games, teams: x.teams, pids: x.pids }; }
        catch (e) { console.error(`finale ${season} w${w}:`, e.message); out[w] = null; }
      }));
    }
    return { weeks: out };
  });

  // Sunday Heartburn: a week's scoring history so the page can redraw each matchup's win probability.
  // Weeks someone watched on the Live page replay the ticker; any other finished week is rebuilt from the
  // kickoffs and each player's team that week (the page spreads each player's final points over his game).
  route('GET', '/api/l/:key/heartburn', async ({ p, q }) => {
    (await league(p.key)) || bad('Unknown league', 404);
    const recorded = (await db.all("SELECT season, week, COUNT(*) AS n FROM live_events WHERE league_key = ? AND type = 'regular' AND roster_id IS NOT NULL GROUP BY season, week ORDER BY season DESC, week DESC", [p.key]))
      .map(r => ({ season: String(r.season), week: Number(r.week), n: Number(r.n) }));
    const season = String(q.get('season') || ''), week = Number(q.get('week'));
    if (!/^\d{4}$/.test(season) || !(week >= 1 && week <= 18)) return { recorded };
    if (recorded.some(r => r.season === season && r.week === week)) {
      const [events, board] = await Promise.all([
        db.all("SELECT at, player_id AS pid, delta, pts, roster_id AS rid FROM live_events WHERE league_key = ? AND season = ? AND week = ? AND type = 'regular' AND roster_id IS NOT NULL ORDER BY at, id", [p.key, season, week]),
        sleeper.get(`?seasontype=2&week=${week}&dates=${season}`, { base: ESPN_SCOREBOARD, maxAge: 60000 }).catch(() => null),
      ]);
      return { recorded, season, week, source: 'ticker', events, schedule: board ? parseScoreboard(board) : [] };
    }
    const info = await weekInfo(season, week);
    if (!info) bad('No NFL schedule for that week', 404);
    return { recorded, season, week, source: 'box', events: [], schedule: Object.entries(info.kick).map(([team, kickoff]) => ({ home: team, away: '', kickoff })), teamOf: info.teamOf };
  });

  // ---------------------------------------------------------------- Manager profiles (for the AI persona)
  // One JSON document per league, edited by the commissioner on the Account page. Shape:
  // { league: { pronouns, notes, history: [], traditions: [], jokes: [], persona, offLimits: [] },
  //   managers: { "<Sleeper name>": { name, nickname, pronouns, personality, about: [], teams: [], history: [], rivals: [], quotes: [], jokes: [], offLimits: [] } } }
  const PROFILE_MAX = 60 * 1024;
  async function loadProfiles(key) {
    const row = await db.get('SELECT body FROM profiles WHERE league_key = ?', [key]);
    try { return row ? JSON.parse(row.body) : null; } catch { return null; }
  }
  const list = v => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x).trim()).filter(Boolean);
  function profilesText(pr) {
    if (!pr || typeof pr !== 'object') return '';
    const lg = pr.league || {}, out = ['MANAGER PROFILES (from the commissioner)'];
    if (lg.pronouns) out.push(`Default pronouns for managers: ${lg.pronouns}.`);
    if (lg.notes) out.push(`About the league: ${lg.notes}`);
    if (list(lg.history).length) out.push(`League history: ${list(lg.history).join('; ')}`);
    if (list(lg.traditions).length) out.push(`Traditions: ${list(lg.traditions).join('; ')}`);
    if (list(lg.jokes).length) out.push(`League running jokes: ${list(lg.jokes).join('; ')}`);
    if (lg.persona) out.push(`About you, the site's AI voice: ${lg.persona}`);
    if (list(lg.offLimits).length) out.push(`OFF LIMITS for everyone: ${list(lg.offLimits).join('; ')}`);
    for (const [who, m] of Object.entries(pr.managers || {})) {
      if (!m || typeof m !== 'object') continue;
      const bits = [];
      if (m.pronouns) bits.push(`pronouns ${m.pronouns}`);
      if (m.personality) bits.push(`personality: ${m.personality}`);
      if (list(m.about).length) bits.push(`life: ${list(m.about).join('; ')}`);
      if (list(m.teams).length) bits.push(`roots for: ${list(m.teams).join(', ')}`);
      if (list(m.history).length) bits.push(`league history: ${list(m.history).join('; ')}`);
      if (list(m.rivals).length) bits.push(`rivals: ${list(m.rivals).join('; ')}`);
      if (list(m.quotes).length) bits.push(`says things like: ${list(m.quotes).map(q => `"${q}"`).join(', ')}`);
      if (list(m.jokes).length) bits.push(`inside jokes: ${list(m.jokes).join('; ')}`);
      if (list(m.offLimits).length) bits.push(`OFF LIMITS: ${list(m.offLimits).join('; ')}`);
      const aka = [m.name, m.nickname && `"${m.nickname}"`].filter(Boolean).join(', ');
      if (bits.length || aka) out.push(`- ${who}${aka ? ` (${aka})` : ''}: ${bits.map(x => x.replace(/[.\s]+$/, '')).join('. ') || 'no notes'}.`);
    }
    return out.length > 1 ? out.join('\n') : '';
  }
  async function profileTemplate(L) {
    const lid = await sleeper.currentLeagueId(L.root_league_id);
    const users = await sleeper.members(lid).catch(() => []);
    const managers = {};
    for (const u of users) managers[u.display_name || u.user_id] = { name: '', nickname: '', pronouns: '', personality: '', about: [], teams: [], history: [], rivals: [], quotes: [], jokes: [], offLimits: [] };
    return { league: { pronouns: '', notes: '', history: [], traditions: [], jokes: [], persona: '', offLimits: [] }, managers };
  }
  route('GET', '/api/l/:key/profiles', async ({ req, p }) => {
    const L = (await league(p.key)) || bad('Unknown league', 404);
    const me = await requireMember(req, p.key); if (me.role !== 'commissioner') bad('Commissioner only', 403);
    const row = await db.get('SELECT body, updated_at FROM profiles WHERE league_key = ?', [p.key]);
    return { profiles: row?.body || null, updatedAt: row?.updated_at || null, template: JSON.stringify(await profileTemplate(L), null, 2) };
  });
  route('POST', '/api/l/:key/profiles', async ({ req, p }) => {
    const me = await requireMember(req, p.key); if (me.role !== 'commissioner') bad('Commissioner only', 403);
    const { profiles } = await readJson(req);
    const raw = typeof profiles === 'string' ? profiles.trim() : '';
    if (raw.length > PROFILE_MAX) bad('That is too long. Keep it under 60 KB.');
    if (!raw) { await db.run('DELETE FROM profiles WHERE league_key = ?', [p.key]); return { ok: true, cleared: true }; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { bad(`That isn't valid JSON: ${e.message}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) bad('The profiles need to be one JSON object, like the template.');
    if (parsed.managers != null && (typeof parsed.managers !== 'object' || Array.isArray(parsed.managers))) bad('"managers" needs to be an object keyed by manager name.');
    await db.run('INSERT INTO profiles (league_key, body, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (league_key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
      [p.key, JSON.stringify(parsed, null, 2), now(), me.id]);
    return { ok: true, preview: profilesText(parsed) };
  });

  // ---------------------------------------------------------------- Ask the persona (AI)
  const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
  async function askState(key, user) {
    const row = await db.get('SELECT ask_enabled FROM leagues WHERE key = ?', [key]);
    const used = user ? (await db.get('SELECT COUNT(*) AS n FROM asks WHERE league_key = ? AND user_id = ? AND at >= ?', [key, user.id, dayStart()])).n : 0;
    return { configured: !!process.env.ANTHROPIC_API_KEY, enabled: !!row?.ask_enabled, limit: ASK_DAILY_LIMIT, used, model: ASK_MODEL };
  }
  route('GET', '/api/l/:key/ask', async ({ req, p }) => {
    (await league(p.key)) || bad('Unknown league', 404);
    const user = await sessionUser(req);
    const m = user && await db.get('SELECT role FROM memberships WHERE user_id = ? AND league_key = ?', [user.id, p.key]);
    return { ...(await askState(p.key, m ? user : null)), member: !!m, commissioner: m?.role === 'commissioner' };
  });
  route('POST', '/api/l/:key/ask/settings', async ({ req, p }) => {
    const me = await requireMember(req, p.key); if (me.role !== 'commissioner') bad('Commissioner only', 403);
    const { enabled } = await readJson(req);
    await db.run('UPDATE leagues SET ask_enabled = ? WHERE key = ?', [enabled ? 1 : 0, p.key]);
    return askState(p.key, me);
  });
  const personaFor = key => personaOf(LEAGUES.find(x => x.key === key)?.persona || ASK_PERSONA);
  const nameFor = key => LEAGUES.find(x => x.key === key)?.name || 'the league';
  /** One call to Claude as the persona. Throws a friendly HttpError when the API says no. */
  // Opus thinks before it writes, and the thinking counts against max_tokens, so leave plenty of room.
  async function callPersona({ key, system, context, messages, maxTokens = 8000 }) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const P = personaFor(key);
    system = `${system}\n\n${ACCURACY_RULES}\n\n${PROFILE_RULES}`;
    const prof = profilesText(await loadProfiles(key));
    if (prof) context = `${prof}\n\n${context}`;
    const client = new Anthropic();
    let resp;
    try {
      resp = await client.beta.messages.create({
        model: ASK_MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'medium' }, // low effort rushed facts and made him correct himself mid-column
        // If the model declines, the API retries on a fallback model (where the model supports it).
        ...(/^claude-(opus-5|fable-5|sonnet-5-5)/.test(ASK_MODEL) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        // The digest is the same for every request until scores change, so cache it.
        system: [{ type: 'text', text: system }, { type: 'text', text: `LEAGUE DATA\n${context}`, cache_control: { type: 'ephemeral' } }],
        messages,
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) bad(`${P.name}'s key was rejected. Whoever hosts the site should check the Anthropic API key.`, 503);
      if (e instanceof Anthropic.RateLimitError) bad(`${P.name} is busy right now. Try again in a minute.`, 503);
      if (e instanceof Anthropic.APIError && /credit|billing|balance/i.test(e.message)) bad(`${P.name} is out of credit for now.`, 503);
      console.error('AI call failed', e);
      bad(`${P.name} couldn't answer just now. Try again in a bit.`, 502);
    }
    const out = resp.stop_reason === 'refusal' ? '' : resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const u = resp.usage || {};
    return { text: out, cut: resp.stop_reason === 'max_tokens', inputTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), outputTokens: u.output_tokens || 0 };
  }

  // Columns: anyone can read one; the first member to open a week without one has the persona write it.
  route('GET', '/api/l/:key/columns', async ({ req, p, q }) => {
    (await league(p.key)) || bad('Unknown league', 404);
    const kind = String(q.get('kind') || ''), season = String(q.get('season') || ''), week = Number(q.get('week'));
    if (!COLUMN_KINDS[kind]) bad('Unknown column');
    const user = await sessionUser(req);
    const m = user && await db.get('SELECT role FROM memberships WHERE user_id = ? AND league_key = ?', [user.id, p.key]);
    const row = await db.get('SELECT body, model, created_at AS createdAt FROM columns WHERE league_key = ? AND season = ? AND week = ? AND kind = ?', [p.key, season, week, kind]);
    const st = await askState(p.key, null);
    return { column: row || null, configured: st.configured, enabled: st.enabled, member: !!m, commissioner: m?.role === 'commissioner' };
  });
  route('POST', '/api/l/:key/columns', async ({ req, p }) => {
    const me = await requireMember(req, p.key);
    const st = await askState(p.key, me);
    const P = personaFor(p.key);
    if (!st.configured) bad(`${P.name} isn't set up yet.`, 503);
    if (!st.enabled) bad(`The commissioner has sent ${P.the} home for now.`, 403);
    const body = await readJson(req, 420 * 1024);
    const kind = String(body.kind || ''), season = text(body.season, 10), week = Number(body.week);
    if (!COLUMN_KINDS[kind] || !season || !(week >= 1 && week <= 18)) bad('Bad column');
    const rewrite = !!body.rewrite;
    if (rewrite && me.role !== 'commissioner') bad(`Only the commissioner can have ${P.the} rewrite a column`, 403);
    const existing = await db.get('SELECT body, model, created_at AS createdAt FROM columns WHERE league_key = ? AND season = ? AND week = ? AND kind = ?', [p.key, season, week, kind]);
    if (existing && !rewrite) return { column: existing };
    const facts = text(body.facts, 30 * 1024); if (!facts) bad('Missing facts');
    const context = text(body.context, 380 * 1024); if (!context) bad('Missing league data');
    const r = await callPersona({ key: p.key, system: (kind === 'scouting' ? scoutSystem : columnSystem)(P, nameFor(p.key)), context, maxTokens: 16000,
      messages: [{ role: 'user', content: `Write ${COLUMN_KINDS[kind]}: ${season} season, ${kind === 'scouting' ? 'through ' : ''}week ${week}.\n\nFACTS\n${facts}` }] });
    if (!r.text) bad(`${P.name} passed on this one. Try again later.`, 502);
    // Never save a column that stopped mid-sentence: the next visitor would be stuck with it.
    if (r.cut) bad(`${P.name} ran long and got cut off. Try again.`, 502);
    await db.run(`INSERT INTO columns (league_key, season, week, kind, body, model, created_by, created_at, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (league_key, season, week, kind) DO UPDATE SET body = excluded.body, model = excluded.model, created_by = excluded.created_by, created_at = excluded.created_at, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens`,
    [p.key, season, week, kind, r.text, ASK_MODEL, me.id, now(), r.inputTokens, r.outputTokens]);
    return { column: { body: r.text, model: ASK_MODEL, createdAt: now() } };
  });

  route('POST', '/api/l/:key/ask', async ({ req, p }) => {
    const me = await requireMember(req, p.key);
    const st = await askState(p.key, me);
    const P = personaFor(p.key);
    if (!st.configured) bad(`${P.name} isn't set up yet. Whoever hosts the site needs to add an Anthropic API key.`, 503);
    if (!st.enabled) bad(`The commissioner has sent ${P.the} home for now.`, 403);
    if (st.limit && st.used >= st.limit) bad(`You've used all ${st.limit} questions for today. More tomorrow.`, 429);
    const body = await readJson(req, 400 * 1024);
    const question = text(body.question, 600); if (!question) bad('Ask a question');
    const context = text(body.context, 380 * 1024); if (!context) bad('Missing league data');
    const history = Array.isArray(body.history) ? body.history.slice(-6).filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string').map(h => ({ role: h.role, content: h.text.slice(0, 4000) })) : [];
    // Count the question before calling out, so parallel requests can't run past the daily cap.
    const { lastInsertRowid } = await db.run('INSERT INTO asks (league_key, user_id, at, question) VALUES (?, ?, ?, ?)', [p.key, me.id, now(), question]);
    let r;
    try {
      r = await callPersona({ key: p.key, system: askSystem(P, nameFor(p.key)), context, messages: [...history, { role: 'user', content: `${me.display_name || me.username} asks: ${question}` }] });
    } catch (e) { await db.run('DELETE FROM asks WHERE id = ?', [lastInsertRowid]); throw e; }
    const answer = !r.text ? 'I came up empty on that one. Try asking it another way.' : r.cut ? `${r.text}…\n\n(I ran out of room there. Ask me for the rest.)` : r.text;
    await db.run('UPDATE asks SET input_tokens = ?, output_tokens = ? WHERE id = ?', [r.inputTokens, r.outputTokens, lastInsertRowid]);
    return { answer, used: st.used + 1, limit: st.limit };
  });

  /** Handle one /api/ request. */
  async function handle(req, res, pathname, searchParams) {
    try {
      await ready();
      if (req.method === 'POST' && req.headers['x-requested-with'] !== 'almanac') bad('Missing request header', 403); // CSRF guard
      for (const r of routes) {
        const m = r.method === req.method && pathname.match(r.re);
        if (!m) continue;
        const out = await r.fn({ req, res, p: Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)])), q: searchParams });
        if (out && out.body !== undefined) return send(res, out.status || 200, out.body, out.headers || {});
        return send(res, 200, out);
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Server error' });
    }
  }

  return { handle, ready, send };
}
