import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGroupFormed, safeSend } from './notify.js';
import type { Participant } from './types.js';

function p(id: string, lat: number, lng: number, name: string): Participant {
  return {
    id,
    telegramUserId: 1,
    chatId: 1,
    displayName: name,
    lat,
    lng,
    status: 'grouped',
    groupId: 'group_001',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

test('formatGroupFormed lists the other members with distances', () => {
  const self = p('a', 41.30, 69.28, 'Alice');
  const other = p('b', 41.31, 69.28, 'Bob');
  const text = formatGroupFormed([self, other], self);
  assert.match(text, /Bob/);
  assert.match(text, /км/);
  assert.ok(!text.includes('Alice')); // self excluded
});

test('safeSend swallows send errors', async () => {
  const api = {
    sendMessage: async () => {
      throw new Error('blocked by user');
    },
  } as never;
  await safeSend(api, 1, 'hi'); // must not throw
});
