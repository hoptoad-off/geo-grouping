import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainMenuLayout } from './main-menu.js';

test('prod none: send-location, then status/support, then language', () => {
  assert.deepEqual(mainMenuLayout('none', false), [
    [{ labelKey: 'btn.sendLocation', kind: 'location' }],
    [{ labelKey: 'btn.statusItem', kind: 'text' }, { labelKey: 'btn.support', kind: 'text' }],
    [{ labelKey: 'btn.changeLang', kind: 'text' }],
  ]);
});

test('prod waiting: relocate, then actions incl unsubscribe', () => {
  assert.deepEqual(mainMenuLayout('waiting', false), [
    [{ labelKey: 'btn.relocate', kind: 'text' }],
    [{ labelKey: 'btn.statusItem', kind: 'text' }, { labelKey: 'btn.support', kind: 'text' }],
    [{ labelKey: 'btn.changeLang', kind: 'text' }, { labelKey: 'btn.unsubscribe', kind: 'text' }],
  ]);
});

test('prod grouped: no location row, unsubscribe present', () => {
  assert.deepEqual(mainMenuLayout('grouped', false), [
    [{ labelKey: 'btn.statusItem', kind: 'text' }, { labelKey: 'btn.support', kind: 'text' }],
    [{ labelKey: 'btn.changeLang', kind: 'text' }, { labelKey: 'btn.unsubscribe', kind: 'text' }],
  ]);
});

test('test mode always shows send-location even when waiting', () => {
  const rows = mainMenuLayout('waiting', true);
  assert.deepEqual(rows[0], [{ labelKey: 'btn.sendLocation', kind: 'location' }]);
  assert.deepEqual(rows[rows.length - 1], [
    { labelKey: 'btn.changeLang', kind: 'text' }, { labelKey: 'btn.unsubscribe', kind: 'text' },
  ]);
});

test('test mode none: send-location, no unsubscribe', () => {
  const rows = mainMenuLayout('none', true);
  assert.deepEqual(rows[0], [{ labelKey: 'btn.sendLocation', kind: 'location' }]);
  assert.deepEqual(rows[rows.length - 1], [{ labelKey: 'btn.changeLang', kind: 'text' }]);
});
