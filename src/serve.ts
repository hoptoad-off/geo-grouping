import { createViewerServer } from './viewer-server.js';

const PORT = Number(process.env.PORT) || 8080;
// Bind to loopback only — this is a local viewer and must not be reachable
// from the LAN. Override with HOST=0.0.0.0 only if you knowingly want that.
const HOST = process.env.HOST || '127.0.0.1';

// Standalone batch viewer: no rebuild handler (that lives in the bot process).
createViewerServer().listen(PORT, HOST, () => {
  console.log(`✓ Viewer running at http://${HOST}:${PORT}`);
  console.log('  (Ctrl+C to stop)');
});
