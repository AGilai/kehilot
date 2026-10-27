import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeEmail, normEmail, passwordOk } from '../src/auth/validate.ts';
import { assertFixturesAllowed, createFixtureApi, parseFixtureParams } from '../src/client/fixtures.ts';

test('emails are trimmed and lower-cased', () => {
  assert.equal(normEmail('  Dana@Example.INVALID '), 'dana@example.invalid');
  assert.ok(looksLikeEmail('a@b.co'));
  assert.ok(!looksLikeEmail('a@b'));
});

test('passwords count code points, minimum 8', () => {
  assert.ok(!passwordOk('1234567'));
  assert.ok(passwordOk('12345678'));
  assert.ok(!passwordOk('😀'.repeat(7)));
  assert.ok(passwordOk('😀'.repeat(8)));
});

test('fixture params', () => {
  assert.deepEqual(parseFixtureParams('?role=gabbai&lang=en&screen=register'), { role: 'gabbai', lang: 'en', screen: 'register', card: null });
  assert.deepEqual(parseFixtureParams('?role=bogus'), { role: 'member', lang: null, screen: null, card: null });
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
