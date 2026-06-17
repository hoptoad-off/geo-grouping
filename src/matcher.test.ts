import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGroups } from './matcher.js';
import type { Participant } from './types.js';

function p(id: string, lat: number, lng: number, createdAt: string): Participant {
  return {
    id,
    telegramUserId: 1,
    chatId: 1,
    displayName: id,
    lat,
    lng,
    status: 'waiting',
    groupId: null,
    createdAt,
  };
}

const T = (n: number) => `2026-01-01T00:00:0${n}.000Z`;

test('forms a group when three are within radius', () => {
  const waiting = [
    p('a', 41.30, 69.28, T(1)),
    p('b', 41.31, 69.28, T(2)),
    p('c', 41.30, 69.29, T(3)),
  ];
  const groups = findGroups(waiting, 5, 3);
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0].memberIds].sort(), ['a', 'b', 'c']);
});

test('forms no group when one member is out of radius', () => {
  const waiting = [
    p('a', 41.30, 69.28, T(1)),
    p('b', 41.31, 69.28, T(2)),
    p('f', 41.50, 69.28, T(3)), // ~22 km away
  ];
  assert.equal(findGroups(waiting, 5, 3).length, 0);
});

test('skips a seed without partners but groups the rest', () => {
  const waiting = [
    p('f', 41.50, 69.28, T(0)), // earliest, far from everyone
    p('a', 41.30, 69.28, T(1)),
    p('b', 41.31, 69.28, T(2)),
    p('c', 41.30, 69.29, T(3)),
  ];
  const groups = findGroups(waiting, 5, 3);
  assert.equal(groups.length, 1);
  assert.ok(!groups[0].memberIds.includes('f'));
});
