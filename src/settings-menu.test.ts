import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuScreen } from './settings-menu.js';

test('root offers status and general', () => {
  assert.deepEqual(menuScreen('root', 'none'), [
    [{ labelKey: 'btn.statusItem', data: 's:status' }],
    [{ labelKey: 'btn.general', data: 's:general' }],
  ]);
});

test('status (waiting) shows relocate + unsubscribe then back', () => {
  const rows = menuScreen('status', 'waiting');
  assert.deepEqual(rows[0], [
    { labelKey: 'btn.relocate', data: 's:relocate' },
    { labelKey: 'btn.unsubscribe', data: 's:leave' },
  ]);
  assert.deepEqual(rows[rows.length - 1], [{ labelKey: 'btn.back', data: 's:root' }]);
});

test('status (grouped) hides relocate, keeps unsubscribe', () => {
  const datas = menuScreen('status', 'grouped').flat().map((b) => b.data);
  assert.ok(!datas.includes('s:relocate'));
  assert.ok(datas.includes('s:leave'));
});

test('status (none) has only back', () => {
  assert.deepEqual(menuScreen('status', 'none'), [[{ labelKey: 'btn.back', data: 's:root' }]]);
});

test('general offers support, language, back', () => {
  assert.deepEqual(menuScreen('general', 'none'), [
    [{ labelKey: 'btn.support', data: 's:support' }],
    [{ labelKey: 'btn.changeLang', data: 's:lang' }],
    [{ labelKey: 'btn.back', data: 's:root' }],
  ]);
});

test('lang offers three languages then back to general', () => {
  const rows = menuScreen('lang', 'none');
  assert.deepEqual(rows[0].map((b) => b.data), ['s:lang:en', 's:lang:ru', 's:lang:uz']);
  assert.deepEqual(rows[1], [{ labelKey: 'btn.back', data: 's:general' }]);
});
