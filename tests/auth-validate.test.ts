import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeEmail, normEmail, passwordOk } from '../src/auth/validate.ts';
import { assertFixturesAllowed, createFixtureApi, parseFixtureParams } from '../src/client/fixtures.ts';

test('emails are trimmed and lower-cased', () => {
  assert.equal(normEmail('  Dana@Example.INVALID '), 'dana@example.invalid');
  assert.ok(looksLikeEmail('a@b.co'));
  assert.ok(!looksLikeEmail('a@b'));
});

test('passwords count code points, minimum 12', () => {
  assert.ok(!passwordOk('12345678901'));
  assert.ok(passwordOk('123456789012'));
  assert.ok(!passwordOk('😀'.repeat(11)));
  assert.ok(passwordOk('😀'.repeat(12)));
});

test('fixture params', () => {
  assert.deepEqual(parseFixtureParams('?role=gabbai&lang=en&screen=register'), { role: 'gabbai', lang: 'en', screen: 'register' });
  assert.deepEqual(parseFixtureParams('?role=bogus'), { role: 'member', lang: null, screen: null });
});

test('fixtures are refused beside a real API', () => {
  assert.throws(() => assertFixturesAllowed('https://api.example.invalid'));
  assert.doesNotThrow(() => assertFixturesAllowed(''));
});

test('fixture api serves the chosen role', async () => {
  const api = createFixtureApi('gabbai');
  const me = await api.me();
  assert.equal(me.kehilot[0]!.role, 'gabbai');
  await assert.rejects(api.deleteMe());
});
