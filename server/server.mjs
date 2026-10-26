// League server for running on your own machine or any host with a disk: serves the
// static app plus the JSON API from server/app.mjs. (On Vercel, api/index.mjs does the API part.)
//
//   node --no-warnings server/server.mjs        (Node 22.5+)
//
// Environment (all optional):
//   PORT=8000  DATA_DIR=./server-data  SNAPSHOT=./data/snapshot.json  COOKIE_SECURE=1 (behind https)
//   LEAGUE_IDS=123…,456…   (Sleeper league ids that get accounts and the clubhouse; or LEAGUES=JSON, see README)
//   INVITE_CODE=…   (shortcut for the first league's invite code)
//   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=…   (use a hosted Turso database instead of a local file)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createApi, ROOT } from './app.mjs';

const PORT = Number(process.env.PORT || 8000);
const api = createApi({ dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'server-data')) });

const STATIC_OK = /^\/(index\.html|manifest\.webmanifest|css\/[\w.-]+|js\/[\w./-]+|img\/[\w.-]+|fonts\/[\w.-]+|data\/(leagues\/)?[\w.-]+\.json)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
async function serveStatic(res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (!STATIC_OK.test(pathname) || pathname.includes('..')) return api.send(res, 404, { error: 'Not found' });
  const file = path.join(ROOT, pathname);
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': pathname.startsWith('/data/') ? 'no-store' : 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(await readFile(file));
  } catch { api.send(res, 404, { error: 'Not found' }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api.handle(req, res, url.pathname, url.searchParams);
  if (req.method !== 'GET' && req.method !== 'HEAD') return api.send(res, 405, { error: 'Method not allowed' });
  return serveStatic(res, url.pathname);
});
await api.ready();
server.listen(PORT, () => console.log(`League almanac server: http://localhost:${PORT}`));
