import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

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
  let filePath = url.pathname === '/' ? '/viewer/index.html' : url.pathname;

  // only expose viewer/ and data/, and forbid path traversal
  const resolved = path.resolve(ROOT, '.' + filePath);
  const allowed =
    resolved.startsWith(path.join(ROOT, 'viewer') + path.sep) ||
    resolved.startsWith(path.join(ROOT, 'data') + path.sep);
  if (!allowed) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const content = await readFile(resolved);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`✓ Viewer running at http://localhost:${PORT}`);
  console.log('  (Ctrl+C to stop)');
});
