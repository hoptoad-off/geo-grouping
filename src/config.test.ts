import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

test('loadConfig throws without BOT_TOKEN', () => {
  assert.throws(() => loadConfig({}), /BOT_TOKEN/);
});

test('loadConfig applies defaults', () => {
  const c = loadConfig({ BOT_TOKEN: 'x' });
  assert.equal(c.botToken, 'x');
  assert.equal(c.groupRadiusKm, 5);
  assert.equal(c.groupSize, 3);
  assert.equal(c.testMode, true);
});

test('loadConfig reads overrides', () => {
  const c = loadConfig({
    BOT_TOKEN: 'x',
    GROUP_RADIUS_KM: '2',
    GROUP_SIZE: '4',
    TEST_MODE: 'false',
  });
  assert.equal(c.groupRadiusKm, 2);
  assert.equal(c.groupSize, 4);
  assert.equal(c.testMode, false);
});

test('loadConfig rejects invalid radius', () => {
  assert.throws(() => loadConfig({ BOT_TOKEN: 'x', GROUP_RADIUS_KM: '0' }), /GROUP_RADIUS_KM/);
});
