import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { writeFile } from 'node:fs/promises';
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

test('adminToken protects state.json + rebuild; static stays open', async () => {
  const server = createViewerServer({
    adminToken: 'secret123',
    rebuild: async () => ({ changed: 0 }),
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    // No token → 401 on protected routes.
    assert.equal((await fetch(`${base}/data/state.json`)).status, 401);
    assert.equal((await fetch(`${base}/rebuild`, { method: 'POST' })).status, 401);

    // Wrong token → 401.
    assert.equal(
      (await fetch(`${base}/data/state.json`, { headers: { Authorization: 'Bearer nope' } })).status,
      401,
    );

    // Correct token → not 401 (rebuild succeeds).
    const ok = await fetch(`${base}/rebuild`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret123' },
    });
    assert.equal(ok.status, 200);

    // Static asset is reachable without a token.
    const live = await fetch(`${base}/live`);
    assert.equal(live.status, 200);
  } finally {
    server.close();
  }
});

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function writeState(participants: unknown[]): Promise<string> {
  const file = path.join(tmpdir(), `state-${randomUUID()}.json`);
  await writeFile(file, JSON.stringify({
    seq: participants.length, participants, groups: [],
    profiles: {}, campuses: [], supportTickets: [],
  }), 'utf8');
  return file;
}

function participant(id: string) {
  return {
    id, telegramUserId: 1, chatId: 1, displayName: `User ${id}`,
    lat: 41.31, lng: 69.28, campusId: 'yashnobod', phone: '998900000000',
    language: 'ru', status: 'waiting', groupId: null,
    createdAt: '2026-06-18T07:00:00.000Z',
  };
}

test('GET /export/point returns a docx for a known id', async () => {
  const statePath = await writeState([participant('u_001')]);
  const server = createViewerServer({ statePath });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const ok = await fetch(`${base}/export/point?id=u_001`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), DOCX_MIME);
    const buf = Buffer.from(await ok.arrayBuffer());
    assert.ok(buf[0] === 0x50 && buf[1] === 0x4b, 'docx starts with PK');

    assert.equal((await fetch(`${base}/export/point`)).status, 400);
    assert.equal((await fetch(`${base}/export/point?id=missing`)).status, 404);
    assert.equal((await fetch(`${base}/export/point?id=u_001`, { method: 'POST' })).status, 405);
  } finally {
    server.close();
  }
});

test('GET /export/points returns a docx for the named ids', async () => {
  const statePath = await writeState([participant('u_001'), participant('u_002')]);
  const server = createViewerServer({ statePath });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const ok = await fetch(`${base}/export/points?ids=u_001,u_002`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), DOCX_MIME);

    assert.equal((await fetch(`${base}/export/points`)).status, 400);
  } finally {
    server.close();
  }
});

test('export routes return 503 when state file is unreadable', async () => {
  const server = createViewerServer({ statePath: path.join(tmpdir(), `missing-${randomUUID()}.json`) });
  const port = await listen(server);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/export/point?id=u_001`);
    assert.equal(r.status, 503);
  } finally {
    server.close();
  }
});
