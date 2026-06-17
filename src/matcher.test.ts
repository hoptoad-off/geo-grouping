import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGroups, optimizeGroups } from './matcher.js';
import type { Participant, Group } from './types.js';

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

test('respects a non-default groupSize', () => {
  const waiting = [
    p('a', 41.30, 69.28, T(1)),
    p('b', 41.31, 69.28, T(2)),
    p('c', 41.30, 69.29, T(3)),
  ];
  const groups = findGroups(waiting, 5, 2);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].memberIds.length, 2);
});

test('returns no groups for empty input', () => {
  assert.deepEqual(findGroups([], 5, 3), []);
});

function gp(id: string, lat: number, lng: number, status: 'waiting' | 'grouped', groupId: string | null, createdAt: string): Participant {
  return { id, telegramUserId: 1, chatId: 1, displayName: id, lat, lng, status, groupId, createdAt };
}

test('optimizeGroups regroups tighter when a closer neighbor exists', () => {
  const ps = [
    gp('a', 41.300, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:01.000Z'),
    gp('b', 41.301, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:02.000Z'),
    gp('c', 41.340, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:03.000Z'),
    gp('d', 41.300, 69.2805, 'grouped', 'group_002', '2026-01-01T00:00:04.000Z'),
    gp('e', 41.341, 69.280, 'grouped', 'group_002', '2026-01-01T00:00:05.000Z'),
    gp('f', 41.340, 69.2805, 'grouped', 'group_002', '2026-01-01T00:00:06.000Z'),
  ];
  const existing: Group[] = [
    { groupId: 'group_001', memberIds: ['a', 'b', 'c'], centroid: { lat: 41.3, lng: 69.28 }, createdAt: 'x' },
    { groupId: 'group_002', memberIds: ['d', 'e', 'f'], centroid: { lat: 41.34, lng: 69.28 }, createdAt: 'x' },
  ];
  const result = optimizeGroups(ps, existing, 5, 3);
  assert.equal(result.groups.length, 2);
  assert.equal(result.waitingIds.length, 0);
  const aGroup = result.groups.find((g) => g.memberIds.includes('a'));
  assert.ok(aGroup.memberIds.includes('d'));
  assert.ok(!aGroup.memberIds.includes('c'));
});

test('optimizeGroups keeps a grouped point in its original group rather than orphan it', () => {
  const ps = [
    gp('a', 41.300, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:01.000Z'),
    gp('b', 41.301, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:02.000Z'),
    gp('c', 41.340, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:03.000Z'),
    gp('d', 41.300, 69.2805, 'waiting', null, '2026-01-01T00:00:04.000Z'),
  ];
  const existing: Group[] = [
    { groupId: 'group_001', memberIds: ['a', 'b', 'c'], centroid: { lat: 41.3, lng: 69.28 }, createdAt: 'x' },
  ];
  const result = optimizeGroups(ps, existing, 5, 3);
  assert.equal(result.groups.length, 1);
  assert.deepEqual([...result.groups[0].memberIds].sort(), ['a', 'b', 'c']);
  assert.deepEqual(result.waitingIds, ['d']);
});

test('optimizeGroups leaves a far waiting point in the queue', () => {
  const ps = [
    gp('a', 41.300, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:01.000Z'),
    gp('b', 41.301, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:02.000Z'),
    gp('c', 41.302, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:03.000Z'),
    gp('d', 41.800, 69.280, 'waiting', null, '2026-01-01T00:00:04.000Z'),
  ];
  const existing: Group[] = [
    { groupId: 'group_001', memberIds: ['a', 'b', 'c'], centroid: { lat: 41.3, lng: 69.28 }, createdAt: 'x' },
  ];
  const result = optimizeGroups(ps, existing, 5, 3);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.waitingIds, ['d']);
});

test('optimizeGroups returns nothing for empty input', () => {
  assert.deepEqual(optimizeGroups([], [], 5, 3), { groups: [], waitingIds: [] });
});

test('optimizeGroups throws if a grouped participant has no original group', () => {
  const ps = [
    gp('a', 41.300, 69.280, 'grouped', 'group_999', '2026-01-01T00:00:01.000Z'),
    gp('b', 41.800, 69.280, 'waiting', null, '2026-01-01T00:00:02.000Z'),
    gp('c', 41.801, 69.280, 'waiting', null, '2026-01-01T00:00:03.000Z'),
  ];
  // 'a' is grouped but existingGroups is empty -> no original group to lock.
  assert.throws(() => optimizeGroups(ps, [], 5, 3), /no original group/);
});
