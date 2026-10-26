import { esc } from '../ui.js';
import { sourceStats, clearCache } from '../api.js';
import { switchLeague } from '../picker.js';

export function data(model, _, el) {
  const st = sourceStats();
  const leg = model.legacy;
  const first = model.seasons[0]?.leagueId, newest = model.seasons[model.seasons.length - 1]?.leagueId;
  el.innerHTML = `
    <h1>Data &amp; import</h1>
    <h2>Where the numbers come from</h2>
    <div class="card">
      <p>${st.snapshot ? 'This page is reading a saved snapshot (data/snapshot.json). Add <code>?live</code> to the address to ignore it.' : 'Live from the public Sleeper API, cached in your browser. Finished seasons are cached permanently, the current season refreshes every 10 minutes.'}</p>
      <p class="muted">Sleeper seasons found: ${model.seasons.map(s => `${s.season} (${esc(s.status)}, league ${esc(s.leagueId)})`).join(' → ')}</p>
      <p><button type="button" class="btn" id="clr">Clear cache and reload</button> <button type="button" class="btn subtle" id="sw">Switch league</button></p>
    </div>
    <h2>Seasons from before Sleeper</h2>
    <div class="card">
      <p>${leg?.seasons?.length ? `Loaded ${leg.seasons.length} earlier season(s) from <code>${esc(model.extrasFile)}</code>: ${leg.seasons.map(s => s.season).join(', ')}.` : 'No earlier seasons loaded.'}</p>
      <p>If the league played on ESPN, Yahoo, NFL Fantasy or anywhere else before Sleeper, whoever hosts this site can add those seasons by hand. They go in <code>data/leagues/${esc(first)}.json</code>${newest !== first ? ` (or <code>data/leagues/${esc(newest)}.json</code>)` : ''}, next to the site's files. Each season can include final standings, the champion, and (optionally) individual games. Games feed the rivalry matrix and record book; standings feed manager careers, the Hall of Fame and the champions list. Names are matched to Sleeper managers by display name; use <code>managerMap</code> for anyone whose name differs. The same file can name the league's rivalries.</p>
      <details><summary class="linkbtn">Show the file format</summary>
      <p>See <code>data/leagues/example.json</code> for a filled-in example. The shape:</p>
      <pre class="copy">{
  "legacy": {
    "managerMap": { "Name used here": "Sleeper display name" },
    "seasons": [{
      "season": 2021, "platform": "ESPN", "playoffTeams": 6,
      "champion": "Name", "runnerUp": "Name", "lastPlace": "Name",
      "standings": [{ "manager": "Name", "team": "Team name", "wins": 10, "losses": 4, "ties": 0,
                      "pf": 1650.4, "pa": 1500.2, "seed": 1, "rank": 1, "playoffs": true }],
      "games": [{ "week": 1, "type": "reg|playoff|consolation", "home": "Name", "homePts": 120.5,
                  "away": "Name", "awayPts": 110.2 }]
    }]
  },
  "rivalries": [{ "name": "The Rivalry", "managers": ["Name", "Name"], "note": "Optional" }]
}</pre></details>
    </div>`;
  el.querySelector('#clr').onclick = async () => { await clearCache(); location.reload(); };
  el.querySelector('#sw').onclick = switchLeague;
}
