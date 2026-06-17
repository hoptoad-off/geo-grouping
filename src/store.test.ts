import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import type { NewParticipant } from './store.js';

function np(lat: number, lng: number, uid = 1): NewParticipant {
  return { telegramUserId: uid, chatId: uid, displayName: `u${uid}`, lat, lng };
}

function tmpPath(): string {
  return path.join(tmpdir(), `state-${randomUUID()}.json`);
}

test('load returns empty state for a missing file', async () => {
  const store = await Store.load(tmpPath());
  assert.deepEqual(store.getState(), { seq: 0, participants: [], groups: [] });
});

test('joinAndMatch forms a group once three are close', async () => {
  const store = await Store.load(tmpPath());
  store.joinAndMatch(np(41.30, 69.28), 5, 3);
  store.joinAndMatch(np(41.31, 69.28), 5, 3);
  const third = store.joinAndMatch(np(41.30, 69.29), 5, 3);
  assert.equal(third.formedGroups.length, 1);
  assert.equal(third.formedGroups[0].members.length, 3);
  assert.ok(store.getState().participants.every((p) => p.status === 'grouped'));
});

test('save then load round-trips state', async () => {
  const file = tmpPath();
  const store = await Store.load(file);
  store.joinAndMatch(np(41.30, 69.28), 5, 3);
  await store.save();
  const reloaded = await Store.load(file);
  assert.equal(reloaded.getState().participants.length, 1);
});

test('leave by a grouped member dissolves the group and re-queues others', async () => {
  const store = await Store.load(tmpPath());
  const a = store.joinAndMatch(np(41.30, 69.28), 5, 3).participant;
  store.joinAndMatch(np(41.31, 69.28), 5, 3);
  store.joinAndMatch(np(41.30, 69.29), 5, 3);

  const result = store.leave(a.id, 5, 3);
  assert.equal(result.removed?.id, a.id);
  assert.ok(result.dissolvedGroup);
  assert.equal(result.dissolvedGroup!.notifiedMembers.length, 2);
  assert.equal(store.getState().groups.length, 0);
  assert.ok(
    store.getState().participants.every((p) => p.status === 'waiting' && p.groupId === null)
  );
});

test('leave triggers re-grouping when enough remain', async () => {
  const store = await Store.load(tmpPath());
  const a = store.joinAndMatch(np(41.30, 69.28), 5, 3).participant;
  store.joinAndMatch(np(41.31, 69.28), 5, 3);
  store.joinAndMatch(np(41.30, 69.29), 5, 3);
  store.joinAndMatch(np(41.31, 69.29), 5, 3); // 4th, waiting

  const result = store.leave(a.id, 5, 3);
  assert.equal(result.formedGroups.length, 1); // remaining 3 regroup
});

test('leave by a waiting member just removes them', async () => {
  const store = await Store.load(tmpPath());
  const a = store.joinAndMatch(np(41.30, 69.28), 5, 3).participant;
  const result = store.leave(a.id, 5, 3);
  assert.equal(result.dissolvedGroup, null);
  assert.equal(store.getState().participants.length, 0);
});

test('participantsByUser returns only that user\'s participants', async () => {
  const store = await Store.load(tmpPath());
  store.joinAndMatch(np(41.30, 69.28, 1), 5, 3);
  store.joinAndMatch(np(41.31, 69.28, 2), 5, 3);
  store.joinAndMatch(np(41.30, 69.29, 1), 5, 3);
  assert.equal(store.participantsByUser(1).length, 2);
  assert.equal(store.participantsByUser(2).length, 1);
});

test('removeWaitingByUser drops only that user\'s waiting participants', async () => {
  const store = await Store.load(tmpPath());
  store.joinAndMatch(np(41.30, 69.28, 1), 5, 3);
  store.joinAndMatch(np(41.31, 69.28, 2), 5, 3);
  store.removeWaitingByUser(1);
  assert.equal(store.participantsByUser(1).length, 0);
  assert.equal(store.participantsByUser(2).length, 1);
});

test('rebuild keeps a grouped member in its group instead of orphaning it', async () => {
  const store = await Store.load(tmpPath());
  store.joinAndMatch(np(41.300, 69.280, 1), 5, 3);
  store.joinAndMatch(np(41.301, 69.280, 2), 5, 3);
  store.joinAndMatch(np(41.340, 69.280, 3), 5, 3);
  store.joinAndMatch(np(41.300, 69.2805, 4), 5, 3);

  const result = store.rebuild(5, 3);

  assert.equal(store.getState().groups.length, 1);
  assert.equal(store.getState().participants.filter((p) => p.status === 'grouped').length, 3);
  assert.equal(store.getState().participants.filter((p) => p.status === 'waiting').length, 1);
  assert.equal(result.changed, 0);
});

test('rebuild reshuffles into tighter groups and reports changed count', async () => {
  const store = await Store.load(tmpPath());
  store.joinAndMatch(np(41.300, 69.280, 1), 5, 3);   // a
  store.joinAndMatch(np(41.301, 69.280, 2), 5, 3);   // b
  store.joinAndMatch(np(41.340, 69.280, 3), 5, 3);   // c -> [a,b,c]
  store.joinAndMatch(np(41.300, 69.2805, 4), 5, 3);  // d (near a,b)
  store.joinAndMatch(np(41.341, 69.280, 5), 5, 3);   // e (near c)
  store.joinAndMatch(np(41.340, 69.2805, 6), 5, 3);  // f (near c) -> [d,e,f]

  assert.equal(store.getState().groups.length, 2);
  const result = store.rebuild(5, 3);

  assert.equal(store.getState().groups.length, 2);
  assert.equal(store.getState().participants.filter((p) => p.status === 'grouped').length, 6);
  const aMember = store.getState().participants.find((p) => p.id === 'u_001');
  const aGroup = store.getState().groups.find((g) => g.groupId === aMember.groupId);
  assert.ok(aGroup.memberIds.includes('u_005'));
  assert.equal(result.changed, 2);
});

test('rebuild on empty state is a no-op', async () => {
  const store = await Store.load(tmpPath());
  const result = store.rebuild(5, 3);
  assert.equal(result.changed, 0);
  assert.deepEqual(store.getState().groups, []);
});
