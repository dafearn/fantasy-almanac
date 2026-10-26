// Site-wide settings. The league itself is picked at runtime (see js/picker.js): from ?league=<id> in the
// address, the league this browser opened last, or the league server's default.
export const CONFIG = {
  // Sleeper league id of the season the site was opened with. Newer and older seasons are found from it.
  ROOT_LEAGUE_ID: null,
  // Shown in the sidebar and page titles. Filled from the league's Sleeper name unless the viewer renames it.
  SITE_NAME: 'League Almanac',
  // How long cached API responses for an in-progress season stay fresh (ms).
  LIVE_TTL: 10 * 60 * 1000,
  // Monte Carlo iterations for playoff odds.
  SIMS: 10000,
};
