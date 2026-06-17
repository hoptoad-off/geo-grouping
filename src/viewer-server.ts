import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Options for the viewer HTTP server. */
export interface ViewerServerOptions {
  /**
   * When provided, enables `POST /rebuild`, which calls this handler and returns
   * its result as JSON. When omitted, `/rebuild` responds 404 (batch viewer).
   */
  rebuild?: () => Promise<{ changed: number }>;
}

/**
 * Builds the viewer HTTP server. Serves viewer/index.html at "/", viewer/live.html
 * at "/live", files under viewer/, and only output.json + state.json from data/.
 * Optionally exposes POST /rebuild.
 *
 * @param options - Optional rebuild handler.
 * @returns An http.Server (not yet listening — caller calls .listen).
 */
export function createViewerServer(options: ViewerServerOptions = {}): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/rebuild') {
      if (!options.rebuild) {
        res.writeHead(404).end('Not found');
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }
      try {
        const result = await options.rebuild();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ ok: true, changed: result.changed }));
      } catch (err) {
        console.error('Rebuild failed:', err instanceof Error ? err.message : err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false }));
      }
      return;
    }

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
}
