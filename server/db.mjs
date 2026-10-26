// Storage, keyed by league so one server can host several leagues later. Two interchangeable
// backends with the same async interface:
//   - a local SQLite file (node:sqlite, built into Node 22.5+) for running on your own machine
//   - Turso (hosted SQLite, free tier) over its HTTP API, for Vercel or anywhere without a disk
// Interface: all(sql, args) -> rows, get(sql, args) -> row|undefined,
//            run(sql, args) -> { changes, lastInsertRowid }, batch([[sql, args], ...]).

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leagues (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, root_league_id TEXT NOT NULL,
    invite_hash TEXT, invite_src TEXT, commissioner TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, sleeper_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memberships (
    user_id INTEGER NOT NULL REFERENCES users(id), league_key TEXT NOT NULL REFERENCES leagues(key),
    role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY (user_id, league_key))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY, league_key TEXT NOT NULL, seller_id INTEGER NOT NULL REFERENCES users(id),
    player_id TEXT NOT NULL, note TEXT, asking TEXT, status TEXT NOT NULL DEFAULT 'open',
    accepted_bid_id INTEGER, created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id), bidder_id INTEGER NOT NULL REFERENCES users(id),
    players TEXT NOT NULL, picks TEXT, faab INTEGER, note TEXT, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id), user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS picks (
    league_key TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), season TEXT NOT NULL, week INTEGER NOT NULL,
    matchup_id INTEGER NOT NULL, roster_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (league_key, user_id, season, week, matchup_id))`,
  `CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS attempts_ip ON attempts (ip, at)`,
  `CREATE TABLE IF NOT EXISTS asks (id INTEGER PRIMARY KEY AUTOINCREMENT, league_key TEXT NOT NULL, user_id INTEGER NOT NULL,
    at INTEGER NOT NULL, question TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER)`,
  `CREATE INDEX IF NOT EXISTS asks_user ON asks (league_key, user_id, at)`,
  // The AI persona's written columns: one recap per finished week and one preview per upcoming week, written once and shared.
  `CREATE TABLE IF NOT EXISTS columns (league_key TEXT NOT NULL, season TEXT NOT NULL, week INTEGER NOT NULL, kind TEXT NOT NULL,
    body TEXT NOT NULL, model TEXT, created_by INTEGER, created_at INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
    PRIMARY KEY (league_key, season, week, kind))`,
  // Live ticker: the last poll of the week's stats, and every scoring change found between polls, so the
  // ticker keeps the whole week's history for everyone rather than only what one open page saw.
  `CREATE TABLE IF NOT EXISTS live_snap (league_key TEXT NOT NULL, season TEXT NOT NULL, week INTEGER NOT NULL, type TEXT NOT NULL,
    body TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (league_key, season, week, type))`,
  `CREATE TABLE IF NOT EXISTS live_events (id INTEGER PRIMARY KEY AUTOINCREMENT, league_key TEXT NOT NULL, season TEXT NOT NULL,
    week INTEGER NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL, player_id TEXT NOT NULL, delta REAL NOT NULL, pts REAL NOT NULL,
    what TEXT NOT NULL, roster_id INTEGER, starter INTEGER, catchup INTEGER NOT NULL DEFAULT 0)`,
  // The commissioner's notes on each manager for the AI persona (pronouns, nicknames, personalities, inside jokes), as JSON.
  // Kept on the server, not in a public file, so the jokes stay inside the league.
  `CREATE TABLE IF NOT EXISTS profiles (league_key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by INTEGER)`,
  `CREATE INDEX IF NOT EXISTS live_events_week ON live_events (league_key, season, week, type, id)`,
  // Each finished NFL week's last game day (usually Monday night): which teams and players played it. Never changes once the week is over.
  // Player lab: one league's fantasy points (or projections) for every NFL player in one week, as {playerId: pts}.
  `CREATE TABLE IF NOT EXISTS lab_cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nfl_finale (season TEXT NOT NULL, week INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (season, week))`,
];

/** Pick a backend from the environment: Turso when its URL is set, otherwise a local file. */
export async function openDb({ dir, tursoUrl = process.env.TURSO_DATABASE_URL, tursoToken = process.env.TURSO_AUTH_TOKEN } = {}) {
  const db = tursoUrl ? tursoDb(tursoUrl, tursoToken) : await sqliteDb(dir);
  for (const sql of SCHEMA) await db.run(sql);
  // Databases created before invite_src existed.
  try { await db.run('ALTER TABLE leagues ADD COLUMN invite_src TEXT'); } catch { /* already there */ }
  try { await db.run('ALTER TABLE leagues ADD COLUMN ask_enabled INTEGER NOT NULL DEFAULT 1'); } catch { /* already there */ }
  return db;
}

async function sqliteDb(dir) {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdirSync } = await import('node:fs');
  const path = await import('node:path');
  mkdirSync(dir, { recursive: true });
  const raw = new DatabaseSync(path.join(dir, 'league.db'));
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const run = async (sql, args = []) => {
    const r = raw.prepare(sql).run(...args);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  };
  return {
    kind: 'sqlite',
    all: async (sql, args = []) => raw.prepare(sql).all(...args),
    get: async (sql, args = []) => raw.prepare(sql).get(...args),
    run,
    batch: async stmts => { for (const [sql, args] of stmts) await run(sql, args); },
  };
}

// Turso's HTTP API ("Hrana over HTTP"): POST /v2/pipeline with a list of statements.
// No client library needed, so the project stays dependency-free.
export function tursoDb(url, token) {
  const base = url.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
  const enc = v => v == null ? { type: 'null' }
    : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v })
    : typeof v === 'boolean' ? { type: 'integer', value: v ? '1' : '0' }
    : { type: 'text', value: String(v) };
  const dec = c => c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.type === 'blob' ? c.base64 : c.value;

  async function pipeline(stmts) {
    const requests = [...stmts.map(([sql, args = []]) => ({ type: 'execute', stmt: { sql, args: args.map(enc) } })), { type: 'close' }];
    const res = await fetch(`${base}/v2/pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ requests }),
    });
    if (!res.ok) throw new Error(`Database request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const out = await res.json();
    return out.results.slice(0, stmts.length).map(r => {
      if (r.type !== 'ok') throw new Error(`Database error: ${r.error?.message || 'unknown'}`);
      const { cols, rows, affected_row_count, last_insert_rowid } = r.response.result;
      return {
        rows: rows.map(row => Object.fromEntries(cols.map((c, i) => [c.name, dec(row[i])]))),
        changes: affected_row_count, lastInsertRowid: last_insert_rowid == null ? null : Number(last_insert_rowid),
      };
    });
  }
  const one = async (sql, args) => (await pipeline([[sql, args]]))[0];
  return {
    kind: 'turso',
    all: async (sql, args) => (await one(sql, args)).rows,
    get: async (sql, args) => (await one(sql, args)).rows[0],
    run: async (sql, args) => { const r = await one(sql, args); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; },
    batch: async stmts => { if (stmts.length) await pipeline(stmts); },
  };
}
