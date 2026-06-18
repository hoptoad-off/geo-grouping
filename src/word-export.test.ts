import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Participant } from './types.js';
import { buildPointDoc, buildPointsDoc, campusLabel } from './word-export.js';

function p(id: string, over: Partial<Participant> = {}): Participant {
  return {
    id,
    telegramUserId: 1,
    chatId: 1,
    displayName: `User ${id}`,
    lat: 41.31,
    lng: 69.28,
    campusId: 'yashnobod',
    phone: '998900000000',
    language: 'ru',
    status: 'waiting',
    groupId: null,
    createdAt: '2026-06-18T07:00:00.000Z',
    ...over,
  };
}

function isDocx(buf: Buffer): boolean {
  // .docx is a zip; zip files start with the bytes "PK".
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

test('campusLabel maps known ids and falls back to the raw id', () => {
  assert.equal(campusLabel('yashnobod'), 'Yashnobod');
  assert.equal(campusLabel('unknown_x'), 'unknown_x');
});

test('buildPointDoc returns a non-empty docx buffer', async () => {
  const buf = await buildPointDoc(p('u_001', { displayName: 'Иван', status: 'grouped', groupId: 'group_001' }));
  assert.ok(isDocx(buf), 'buffer should start with PK');
});

test('buildPointsDoc builds a docx for many participants', async () => {
  const buf = await buildPointsDoc([p('u_001'), p('u_002'), p('u_003')]);
  assert.ok(isDocx(buf), 'buffer should start with PK');
});

test('buildPointsDoc handles an empty list without throwing', async () => {
  const buf = await buildPointsDoc([]);
  assert.ok(isDocx(buf), 'buffer should start with PK');
});
