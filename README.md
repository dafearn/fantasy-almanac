# League Almanac

A fantasy football almanac for any Sleeper league: live scoring, standings with playoff odds, power rankings,
automatic weekly reports, rivalries, a record book, a Hall of Fame, manager profiles, draft and trade grades,
The Receipts, trading cards and a what-if lab. Open the site, paste your league ID (or type your Sleeper
username and pick the league), and it builds everything from your league's history on Sleeper.

## Using it

Open the site and enter one of:

- your **league ID** (in the Sleeper app: league, settings gear, General, at the bottom; on sleeper.com it's the
  long number in the league's address),
- a **sleeper.com league link**, or
- your **Sleeper username**, then pick the league from the list.

The site finds every earlier season of the league on its own, and newer ones too. The address then carries the
league (`?league=<id>`), so sending it to the group chat opens everyone on the same league.

**Look & feel** (bottom of the sidebar) lets each person pick a colorway (8 presets or custom colors), light or
dark, a display name for the league, and which team is theirs so it's highlighted everywhere. The page also makes
a share link that includes the colorway, so a commissioner can send the league the site already dressed in its
colors. These settings live in each person's browser.

Everything except the clubhouse runs in the browser from Sleeper's public API: nothing to sign up for, and no
server needed.

## Run it on your computer

You need Python 3 (already on macOS and most Linux machines).

    git clone <this repo>
    cd <the folder>
    python3 serve.py

Then open http://localhost:8000. The first load of a league pulls every season from the Sleeper API (about
50 requests a season plus the player list) and takes a little while; after that it's cached in your browser.
"Refresh data" in the sidebar clears the cache.

Opening index.html straight from disk won't work, because browsers block JavaScript modules on file:// pages.

## Host it

### The easy way: static, for any league

Put the folder on any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages). On Vercel: **Add New →
Project**, import the repo, keep the framework preset as **Other**, deploy. That's it: anyone can open any Sleeper
league on it. Without a database, Vercel's API part answers "not connected" and the site runs browse-only, which
is everything except the clubhouse.

### The clubhouse: accounts, pick'em, trade block, AI

The clubhouse (member accounts, the trade block, pick'em, Sunday Heartburn, Monday Night Miracles and the AI
persona) needs the small Node server (Node 22.5 or newer) and is switched on per league by whoever hosts the site:

    LEAGUE_IDS=1048123456789012345 npm start     # or: node --no-warnings server/server.mjs

Then open http://localhost:8000. On first start it prints an **invite code** for each league. Members create
accounts on the Account page with their Sleeper username, a password and that code; their username has to match
a manager in the league on Sleeper. Whoever runs the league on Sleeper becomes the site's commissioner
automatically and can make a new invite code or reset passwords from the Account page. Anyone without an account
can still browse everything read-only, and leagues not in `LEAGUE_IDS` stay browse-only.

Settings (environment variables, all optional):

| Variable | Default | What it does |
|---|---|---|
| `LEAGUE_IDS` | none | Comma-separated Sleeper league ids that get the clubhouse. Any season's id works. The first one is what the site opens for a visitor with no league picked. |
| `LEAGUES` | unset | Instead of `LEAGUE_IDS`: a JSON list like `[{"key":"sunday","rootLeagueId":"…","name":"…","commissioner":"sleeperusername","persona":"bookie"}]` to set names, a commissioner or a persona per league |
| `INVITE_CODE` | random, printed at start | Sets the first league's invite code. A new code the commissioner makes in the app stays in effect until you change this value. |
| `ASK_PERSONA` | `commish` | The AI's voice: `commish` (The Commish, a power-drunk league historian) or `bookie` (The Bookie, who sets a line on everything) |
| `ANTHROPIC_API_KEY` | unset | Turns on the AI (see below) |
| `ASK_MODEL` | `claude-opus-5-5` | The Claude model; `claude-haiku-5-5` is far cheaper |
| `ASK_DAILY_LIMIT` | no cap | Questions per member per day |
| `PORT` | 8000 | Port to listen on |
| `DATA_DIR` | `./server-data` | Where the SQLite database lives. Back this up. |
| `COOKIE_SECURE` | off | Set to `1` when the site is served over https |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | unset | Use a hosted Turso database instead of the local file |

#### On Vercel (free Hobby plan)

Vercel serves the pages directly and runs the API from `api/index.mjs`. Vercel doesn't keep files, so the data
lives in a free [Turso](https://turso.tech) database instead of the local SQLite file.

1. Deploy the repo as above.
2. In the project, open **Storage → Create Database → Turso** and connect it to the project. That adds
   `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. (Or create a database at turso.tech and add those two variables
   yourself under **Settings → Environment Variables**.)
3. Under **Settings → Environment Variables**, add `LEAGUE_IDS` and `INVITE_CODE` (the code you'll give league members).
4. Redeploy (**Deployments → … → Redeploy**) so the new variables take effect.
5. Optional: under **Settings → Domains**, add your own domain or subdomain.

The database tables are created on the first request.

#### Anywhere else

Any host that runs Node or Docker and keeps a persistent disk works (Render, Railway, Fly.io, a home server). A
`Dockerfile` is included; mount a volume at `/data`. Use https and set `COOKIE_SECURE=1`.

### The AI: Ask the Commish (optional)

With the clubhouse on, the Ask page lets signed-in members ask the site's AI persona (Claude) about the league.
It stays off until the host adds an API key:

1. At console.anthropic.com, buy prepaid credit (e.g. $5) and create an API key. Leave auto-reload off; when the
   credit runs out the AI just stops answering.
2. Add `ANTHROPIC_API_KEY` to the server's environment (on Vercel: Settings → Environment Variables), then redeploy.

The same key writes the persona's columns: a recap on each Weekly reports page and a week-ahead preview on Home
before games start, plus a short take on each scouting report. Each one is written once, by the first signed-in
member to open the page, and saved for everyone, so it costs about one call per week per league. Every number in
it comes from the site's own calculations; the commissioner can have it rewritten.

**Manager profiles.** On the Account page the commissioner keeps a JSON document the AI reads before every answer
and column: the league's default pronouns, notes and running jokes, and for each manager a nickname, pronouns,
personality, inside jokes and off-limits topics. It's stored in the database (table `profiles`, one per league),
not in a public file, so only the commissioner can see it. "Add missing managers" fills in a blank entry for
anyone new in the Sleeper league.

The commissioner can switch the AI off on the Ask page at any time. Each question sends a plain-text digest of the
league (standings, careers, head-to-head, records, rosters, trades, drafts) built by `js/ask-context.js`.

### A frozen snapshot (optional)

    node scripts/snapshot.mjs <league id>     # Node 18+, writes data/snapshot.json

With a snapshot present the site opens on that league and reads from the snapshot instead of calling Sleeper.
Re-run it to pick up new weeks. Add `?live` to the address to bypass the snapshot.

## Seasons from before Sleeper, and named rivalries

If a league played somewhere else before Sleeper (ESPN, Yahoo, NFL Fantasy…), the host can add those seasons by
hand in `data/leagues/<league id>.json`, using the id of the league's first or newest Sleeper season. Those seasons
then show up in history, careers, the Hall of Fame, rivalries and records. The same file can name the league's
rivalries. The format is on the app's "Data & import" page, with a filled-in example in `data/leagues/example.json`.

## Files

- js/config.js: site defaults (simulation count, cache times)
- js/picker.js, js/chain.js: picking the league, and following it across seasons
- js/look.js, js/views/look.js, js/logo.js: colorways, the Look & feel page and the league crest
- js/persona.js: the AI personas (The Commish, The Bookie)
- js/api.js: Sleeper client and caching
- js/data.js: walks the season chain and normalizes the data
- js/stats.js: every calculation (standings, all-play, power rankings, playoff odds, records, drafts, trades)
- js/report.js: weekly report writer
- js/views/: one file per group of pages (clubhouse.js = trade block and pick'em; lore.js = schedule luck, All-League, trophies, players)
- js/server.js: talks to the league server
- js/views/lab.js: All-play tracker, What-if lab (playoff machine, lineup swap) and Team breakdown
- js/views/ask.js, js/ask-context.js: the Ask page and the league digest it sends
- js/columns.js, js/column-notes.js: the AI columns and takes, and the head-to-head histories, oddities and "this week in league history" notes they're handed
- js/views/charts.js: Charts (scoring range, luck quadrant, league scoring by week, points by position) and Scouting reports
- js/views/live.js, js/live-core.js: the Live page (scoreboard, matchup view, games by TV window, week-long scoring ticker)
- js/receipts.js, js/views/receipts.js: The Receipts (Genius-to-Clown, FAAB hoarders, Sunday Heartburn, Regret Ratio, kicker dependency, Left on Read, Monday Night Miracles, draft archetypes)
- js/cards.js, js/views/cards.js: Trading cards (the card sets and who holds what, then the binder, inspector and packs)
- js/legacy.js, data/leagues/: per-league extras (pre-Sleeper seasons, named rivalries)
- server/app.mjs: the league API (accounts, trade block, pick'em, live ticker, AI); server/db.mjs: storage (local SQLite file or Turso)
- server/server.mjs: runs the site on your own machine or any host with a disk
- api/index.mjs, vercel.json: the same API as a Vercel function
- docs/market-research.md: what other league sites do and what this app borrows
- img/: favicon, home-screen icons, and og.png (the 1200×630 picture shown when the link is shared in iMessage, Slack and so on)
- fonts/: Oswald and Graduate (SIL Open Font License, licenses alongside)
- scripts/dev-fixture.mjs: makes a fake league for development only (Sleeper-shaped responses, made-up names and scores)

## How the numbers work

**The Receipts.** Funny charts with real numbers. Where Sleeper doesn't share something, the page uses the closest
thing it can count:
- Genius-to-Clown: preseason projections aren't kept, so each team's finish is compared with where its roster
  deserved to finish (ranked by points with the best possible lineup every week).
- Regret Ratio: points left on the bench (best lineup minus actual) per point scored. Counting every bench point
  would mostly reward deep benches.
- Left on Read (needs the clubhouse): Sleeper doesn't share offers made in its app, so this is the site's trade block. An offer still
  standing when the listing ends or comes down counts as left on read; the insult score compares the season points
  of the players offered with the player on the block.
- Monday Night Miracles (needs the league server): the server asks Sleeper's stats feed (which team each player was on that week) and ESPN's
  scoreboard (kickoffs) who played on each week's last game day, once per finished week, and keeps the answer.
  Weeks whose last day had more than three games don't count.
- Sunday Heartburn (needs the clubhouse): weeks someone watched on the Live page replay its scoring ticker. Any other finished week is
  rebuilt from the box score, with each starter's points spread evenly over his game (kickoffs and that week's
  teams come from the same cached lookup as Monday Night). Win chances use each starter's average and how much of
  his game is left.
- Draft archetypes: tags from the draft picks (Zero-RB, RB Landfill, QB collector, early kicker, one-team fan club,
  the All-IR Team for early picks who sat on the roster scoring zero three or more weeks) and the class's points.


**Trading cards.** Each season prints a set of the top players at each position by points scored on league rosters in
the regular season (QB 24, RB 50, WR 50, TE 24, K 12, DEF 12). A manager owns a player's card for that season if the
player was on their roster in any finished week, playoffs included, so the binder fills itself from roster history.
Rarity comes from the positional finish: Legendary is the No. 1 at the position, then Epic, Rare, Uncommon and Common
(QB/TE: top 3, 8, 15; RB/WR: top 5, 15, 30; K/DEF: top 2, 5, 8). Every holder gets their own printing, numbered in the
order they got him and stamped with how (draft round, trade, waivers, free agency). Starters in the title-game win get
champion foil. Collection score: Common 1, Uncommon 2, Rare 4, Epic 8, Legendary 16, doubled for champion foil. The
current season's cards are marked * because rarities can still move until it ends. Pictures are Sleeper's headshots
and team logos (sleepercdn.com), with a monogram if one doesn't load. Packs are only a reveal: the cards a signed-in
member hasn't seen yet are dealt face down once, remembered in that browser.


**Live page.** Per-player stats come from Sleeper's stats feed (`api.sleeper.app/stats/nfl/<season>/<week>`), which
Sleeper's own app uses but doesn't document, so it could change without notice. Points are scored with the league's
`scoring_settings`; for rostered players Sleeper's own live `players_points` from the matchups endpoint wins when it has
a number. The page checks every 30 seconds; when hosted, the server fetches once per 15 seconds and shares the result
with every viewer. Kickoff times, scores, the game clock and red zone flags come from ESPN's public scoreboard
(`site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`, also undocumented); games are grouped by TV window in
Eastern time (Thursday Night Football, Sunday morning, afternoon, evening, Sunday Night Football, Monday Night Football,
with odd slots like Christmas or Thanksgiving labeled by day). Without ESPN, a game is marked Live when its stats changed
in the last 12 minutes.

The ticker's history is kept on the server (`live_snap`, `live_events`): each poll is compared with the last one stored
for the week and the changes are saved, so everyone sees the whole week. Changes only land while someone has the Live
page open; a stretch with nobody watching shows up as one larger change. The first poll of a week records each player's
total so far, marked "so far".

- All-play: your record if you'd played every team every week. Expected wins come from the same calculation, and luck = actual wins minus expected wins.
- Power score: percentile blend of win % (35%), all-play win % (30%), last-3-week average (15%), season average (10%), lineup efficiency (5%) and consistency (5%).
- Playoff odds: Monte Carlo over the remaining schedule. Each team's scoring is modeled as normal around its average, regressed toward the league mean early in the season. Seeds are by record, then points for.
- Lineup efficiency: points scored ÷ best possible lineup from the same roster that week.
- Draft value: where a player was drafted among his position minus where he finished in league scoring.
- Trade grade: points each side got from received players while they were in its starting lineup.
- Schedule luck: your record replayed against every other team's schedule; luck = actual wins minus the average.
- Win probability (previews and pick'em): each team's scoring as a normal distribution around its season average, regressed toward the league mean.
