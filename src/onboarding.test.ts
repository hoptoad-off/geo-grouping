import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOnboarding, advance } from './onboarding.js';

test('full happy path produces a profile at ready', () => {
  let s = startOnboarding();
  assert.equal(s.step, 'language');

  let r = advance(s, { type: 'language', value: 'uz' });
  assert.equal(r.state.step, 'campus');
  assert.equal(r.profile, undefined);

  r = advance(r.state, { type: 'campus', value: 'yashnobod' });
  assert.equal(r.state.step, 'phone');

  r = advance(r.state, { type: 'phone', value: '+998901112233' });
  assert.equal(r.state.step, 'ready');
  assert.deepEqual(r.profile, { language: 'uz', campusId: 'yashnobod', phone: '+998901112233' });
});

test('out-of-order events are ignored (stay on the same step)', () => {
  const s = startOnboarding();
  const r = advance(s, { type: 'phone', value: '+998900000000' });
  assert.equal(r.state.step, 'language');
  assert.equal(r.profile, undefined);
});

test('ready state is terminal', () => {
  let s = startOnboarding();
  s = advance(s, { type: 'language', value: 'en' }).state;
  s = advance(s, { type: 'campus', value: 'mirzo_ulugbek' }).state;
  s = advance(s, { type: 'phone', value: '+1' }).state;
  const r = advance(s, { type: 'language', value: 'ru' });
  assert.equal(r.state.step, 'ready');
});
