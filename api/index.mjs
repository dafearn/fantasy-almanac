// Vercel serverless entry point for the league API. vercel.json rewrites every /api/... request
// here (passing the original path as ?__p=...); static files are served by Vercel directly.
// Needs a Turso database: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project.
import { createApi } from '../server/app.mjs';

let api = null;

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const sub = url.searchParams.get('__p');
  url.searchParams.delete('__p');
  const pathname = url.pathname === '/api/index' || url.pathname === '/api/index.mjs' ? `/api/${sub || ''}` : url.pathname;
  if (!process.env.TURSO_DATABASE_URL) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ error: 'The league database is not connected yet. Add a Turso database to the Vercel project.' }));
  }
  api ||= createApi({ cookieSecure: true }) /* Secure is still decided per request from x-forwarded-proto */;
  return api.handle(req, res, pathname, url.searchParams);
}
