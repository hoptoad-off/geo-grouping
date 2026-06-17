// src/i18n.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, LANGUAGES, strings } from './i18n.js';

test('every language has every key', () => {
  const keys = Object.keys(strings.en);
  for (const lang of LANGUAGES) {
    for (const k of keys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(strings[lang], k),
        `missing key "${k}" for language "${lang}"`
      );
    }
  }
});

test('t interpolates params', () => {
  assert.match(t('ru', 'status.grouped', { group: 'group_001' }), /group_001/);
});

test('t falls back to the key when missing', () => {
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
});
