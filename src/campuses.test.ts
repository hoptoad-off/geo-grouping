import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPUSES, campusById } from './campuses.js';

test('CAMPUSES has the two branches with exact coordinates', () => {
  assert.equal(CAMPUSES.length, 2);
  const mu = campusById('mirzo_ulugbek');
  assert.ok(mu);
  assert.equal(mu!.lat, 41.356250);
  assert.equal(mu!.lng, 69.373209);
  const ya = campusById('yashnobod');
  assert.ok(ya);
  assert.equal(ya!.lat, 41.256928);
  assert.equal(ya!.lng, 69.328708);
});

test('campusById returns undefined for unknown id', () => {
  assert.equal(campusById('nope'), undefined);
});
