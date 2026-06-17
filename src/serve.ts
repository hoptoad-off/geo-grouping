import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
// Bind to loopback only — this is a local viewer and must not be reachable
// from the LAN. Override with HOST=0.0.0.0 only if you knowingly want that.
const HOST = process.env.HOST || '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Static file server for the map viewer. Serves viewer/index.html at "/"
 * and files under viewer/ and data/ (so the page can fetch output.json).
 *
 * @returns Nothing; runs until interrupted (Ctrl+C).
 */
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  let filePath =
    url.pathname === '/'
      ? '/viewer/index.html'
      : url.pathname === '/live'
        ? '/viewer/live.html'
        : url.pathname;

  // Expose all of viewer/ but only output.json and state.json from data/ — the
  // raw input.json and any other data files stay private. The URL parser
  // already normalizes "../" and "%2e%2e/", and the path.sep suffix on each
  // prefix prevents sibling-directory bypass (e.g. ROOT/viewer-secret).
  const resolved = path.resolve(ROOT, '.' + filePath);
  const allowed =
    resolved.startsWith(path.join(ROOT, 'viewer') + path.sep) ||
    resolved === path.join(ROOT, 'data', 'output.json') ||
    resolved === path.join(ROOT, 'data', 'state.json');
  if (!allowed) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const content = await readFile(resolved);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      // Harden the static viewer: block MIME sniffing and constrain what the
      // page may load/execute (mitigates impact of any data-driven injection).
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; " +
        "img-src 'self' https://tile.openstreetmap.org https://*.basemaps.cartocdn.com data:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; " +
        "connect-src 'self'; " +
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(content);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`✓ Viewer running at http://${HOST}:${PORT}`);
  console.log('  (Ctrl+C to stop)');
});
