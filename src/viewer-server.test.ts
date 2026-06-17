import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Store } from './store.js';
import type { NewParticipant } from './store.js';
import { createViewerServer } from './viewer-server.js';

function np(lat: number, lng: number, uid: number): NewParticipant {
  return { telegramUserId: uid, chatId: uid, displayName: `u${uid}`, lat, lng };
}

async function listen(server: import('node:http').Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

test('POST /rebuild rebuilds, GET /rebuild is 405, input.json stays 403', async () => {
  const file = path.join(tmpdir(), `state-${randomUUID()}.json`);
  const store = await Store.load(file);
  store.joinAndMatch(np(41.300, 69.280, 1), 5, 3);
  store.joinAndMatch(np(41.301, 69.280, 2), 5, 3);
  store.joinAndMatch(np(41.340, 69.280, 3), 5, 3);
  store.joinAndMatch(np(41.300, 69.2805, 4), 5, 3);

  const server = createViewerServer({
    rebuild: async () => {
      const r = store.rebuild(5, 3);
      await store.save();
      return r;
    },
  });
  const port = await listen(server);
  try {
    const post = await fetch(`http://127.0.0.1:${port}/rebuild`, { method: 'POST' });
    assert.equal(post.status, 200);
    const body = await post.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.changed, 'number');

    const get = await fetch(`http://127.0.0.1:${port}/rebuild`);
    assert.equal(get.status, 405);

    const forbidden = await fetch(`http://127.0.0.1:${port}/data/input.json`);
    assert.equal(forbidden.status, 403);
  } finally {
    server.close();
  }
});

test('without a rebuild handler, /rebuild is 404', async () => {
  const server = createViewerServer();
  const port = await listen(server);
  try {
    const post = await fetch(`http://127.0.0.1:${port}/rebuild`, { method: 'POST' });
    assert.equal(post.status, 404);
  } finally {
    server.close();
  }
});
