// Optional extras a league can keep in a file next to the site: seasons from before Sleeper (another
// platform), entered by hand, and named rivalries. The file is data/leagues/<league id>.json, named for the
// league id of either the league's first Sleeper season or its newest one, so a site hosting several
// leagues keeps each league's extras apart. See the "Data & import" page and data/leagues/example.json.
// Names are matched to Sleeper managers by display name, username or user id via `managerMap`; anyone
// unmatched gets a legacy-only profile.

/** The league's extras file, or null. */
export async function loadExtras(model) {
  const ids = [...new Set([model.seasons[0]?.leagueId, model.seasons[model.seasons.length - 1]?.leagueId].filter(Boolean))];
  for (const id of ids) {
    try {
      const r = await fetch(`data/leagues/${encodeURIComponent(id)}.json`, { cache: 'no-store' });
      if (r.ok) { const raw = await r.json(); if (raw && typeof raw === 'object') return { ...raw, file: `data/leagues/${id}.json` }; }
    } catch { /* no file: fine */ }
  }
  return null;
}

export function loadLegacy(model, extras) {
  const raw = extras?.legacy || null;
  if (!raw || !Array.isArray(raw.seasons) || !raw.seasons.length) return { seasons: [], games: [], raw };

  const byName = {};
  for (const m of Object.values(model.managers)) byName[m.name.toLowerCase()] = m.id;
  const resolve = name => {
    if (name == null) return null;
    const mapped = raw.managerMap?.[name] ?? name;
    if (model.managers[mapped]) return mapped;
    const hit = byName[String(mapped).toLowerCase()];
    if (hit) return hit;
    const id = `legacy:${name}`;
    model.managers[id] ||= { id, name, avatar: null, teamNames: {}, seasons: [], legacyOnly: true };
    return id;
  };

  const seasons = raw.seasons.map(s => ({
    ...s, season: String(s.season), legacy: true,
    champion: resolve(s.champion), runnerUp: resolve(s.runnerUp), lastPlace: resolve(s.lastPlace),
    standings: (s.standings || []).map(r => ({ ...r, owner: resolve(r.manager) })),
  }));
  const games = [];
  for (const s of raw.seasons) for (const g of s.games || []) {
    const a = { owner: resolve(g.home), pts: Number(g.homePts) }, b = { owner: resolve(g.away), pts: Number(g.awayPts) };
    const d = a.pts - b.pts;
    games.push({ season: String(s.season), week: g.week, type: g.type || 'reg', final: true, legacy: true, a, b,
      winner: d > 0 ? 'a' : d < 0 ? 'b' : 'tie', margin: Math.abs(d) });
  }
  for (const s of seasons) for (const r of s.standings) {
    const m = model.managers[r.owner]; if (m && r.team) m.teamNames[s.season] = r.team;
  }
  // Seasons the Hall of Fame leaves out for a manager, e.g. a team they took over mid-season.
  // Only matches managers who already exist, so a typo never creates a phantom manager.
  const hofSkip = new Set();
  for (const x of raw.hofSkip || []) {
    const name = raw.managerMap?.[x.manager] ?? x.manager;
    const id = model.managers[name] ? name : byName[String(name).toLowerCase()];
    if (id) hofSkip.add(`${id}|${x.season}`);
  }
  return { seasons, games, raw, hofSkip };
}

/**
 * Named rivalries from the extras file: {"rivalries": [{"name": "...", "managers": ["a", "b"], "note": "..."}]}.
 * Managers can be Sleeper display names or user ids.
 */
export function loadRivals(model, extras) {
  const byName = {}; for (const m of Object.values(model.managers)) byName[m.name.toLowerCase()] = m.id;
  const resolve = x => (model.managers[x] ? x : byName[String(x).toLowerCase()] || null);
  return (extras?.rivalries || []).map(r => ({ name: r.name, note: r.note || '', a: resolve(r.managers?.[0]), b: resolve(r.managers?.[1]) })).filter(r => r.a && r.b);
}
