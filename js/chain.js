// Follows a Sleeper league forward to its newest season. Sleeper links each season to the one before it
// (previous_league_id) but not to the one after, so the next season is found in a member's league list.
// Shared by the browser (js/data.js) and the league server (server/sleeper.mjs); `get(path)` reads Sleeper.
export async function newestSeason(get, startId, targetSeason) {
  let id = String(startId);
  for (let hop = 0; hop < 6; hop++) {
    let next = null;
    try {
      const lg = await get(`/league/${id}`);
      if (!lg || Number(lg.season) >= Number(targetSeason)) break;
      const users = (await get(`/league/${id}/users`)) || [];
      // The commissioner first, then a couple of others in case the commissioner left.
      const order = [...users.filter(u => u.is_owner), ...users.filter(u => !u.is_owner)].slice(0, 3);
      for (const u of order) {
        const mine = await get(`/user/${u.user_id}/leagues/nfl/${Number(lg.season) + 1}`).catch(() => []);
        next = (mine || []).find(l => String(l.previous_league_id) === id);
        if (next) break;
      }
    } catch { break; }
    if (!next) break;
    id = String(next.league_id);
  }
  return id;
}

/** A Sleeper league id from whatever was pasted: the id itself or a sleeper.com link. */
export function leagueIdFrom(text) {
  const m = String(text || '').match(/(\d{15,24})/);
  return m ? m[1] : null;
}
