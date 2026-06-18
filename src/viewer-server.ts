import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPointDoc, buildPointsDoc } from './word-export.js';
import type { Participant } from './types.js';

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

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Routes that require authentication when adminToken is configured. */
const PROTECTED = new Set([
  '/data/state.json', '/export/point', '/export/points', '/rebuild',
]);

/** Writes a generated docx Buffer as a download response. */
function sendDocx(res: import('node:http').ServerResponse, buf: Buffer, filename: string): void {
  res.writeHead(200, {
    'Content-Type': DOCX_MIME,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

/** Options for the viewer HTTP server. */
export interface ViewerServerOptions {
  /**
   * When provided, enables `POST /rebuild`, which calls this handler and returns
   * its result as JSON. When omitted, `/rebuild` responds 404 (batch viewer).
   */
  rebuild?: () => Promise<{ changed: number }>;
  /**
   * When set, protects data + action routes (state.json, exports, rebuild) with
   * `Authorization: Bearer <token>`. When omitted, those routes are open.
   */
  adminToken?: string;
  /** Path to the bot state JSON. Defaults to `<root>/data/state.json`. */
  statePath?: string;
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
  const statePath = options.statePath ?? path.join(ROOT, 'data', 'state.json');
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // Token guard: when adminToken is configured, data + action routes require
    // a bearer token. Static assets (the page shell, scripts, output.json) stay
    // open — they carry no participant data.
    if (options.adminToken && PROTECTED.has(url.pathname)) {
      if (req.headers['authorization'] !== `Bearer ${options.adminToken}`) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized');
        return;
      }
    }

    if (url.pathname === '/rebuild') {
      if (!options.rebuild) {
        res.writeHead(404).end('Not found');
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' }).end('Method Not Allowed');
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

    if (url.pathname === '/export/point' || url.pathname === '/export/points') {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' }).end('Method Not Allowed');
        return;
      }
      let participants: Participant[];
      try {
        const state = JSON.parse(await readFile(statePath, 'utf8'));
        participants = (state.participants ?? []) as Participant[];
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'state unavailable' }));
        return;
      }

      if (url.pathname === '/export/point') {
        const id = url.searchParams.get('id');
        if (!id) {
          res.writeHead(400).end('Missing id');
          return;
        }
        const p = participants.find((x) => x.id === id);
        if (!p) {
          res.writeHead(404).end('Not found');
          return;
        }
        sendDocx(res, await buildPointDoc(p), `point-${id}.docx`);
        return;
      }

      // /export/points
      const idsParam = url.searchParams.get('ids');
      if (!idsParam || !idsParam.trim()) {
        res.writeHead(400).end('Missing ids');
        return;
      }
      const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
      const byId = new Map(participants.map((p) => [p.id, p]));
      const selected = ids
        .map((id) => byId.get(id))
        .filter((p): p is Participant => Boolean(p));
      sendDocx(res, await buildPointsDoc(selected), `points-${selected.length}.docx`);
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
