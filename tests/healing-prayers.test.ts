import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { api } from '../src/api.ts';
import { demoHealingPrayer, healingPrayerName, prayerAddedDate } from '../src/healingPrayers.ts';
import { DEFAULT_PREFERENCES, EMPTY_PROFILE, normalizeMemberState } from '../src/types.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('healing names preserve the supplied name and mother name while rejecting empty/oversized input', () => {
  assert.equal(healingPrayerName('  משה בן שרה  '), 'משה בן שרה');
  assert.equal(healingPrayerName('מרים בת חנה'), 'מרים בת חנה');
  for (const value of ['', ' \n ', 'א'.repeat(201)]) assert.throws(() => healingPrayerName(value));
  assert.equal(healingPrayerName('א'.repeat(200)).length, 200);
});

test('demo prayer dates are Gregorian and follow Israel across UTC midnight', () => {
  const entry = demoHealingPrayer('משה בן שרה', 'חבר לדוגמה', new Date('2026-07-01T21:30:00Z'));
  assert.equal(entry.addedOn, '2026-07-02');
  assert.equal(prayerAddedDate(entry.addedOn), '02/07/2026');
  assert.equal(entry.memberName, 'חבר לדוגמה');
  assert.equal(entry.name, 'משה בן שרה');
});

test('legacy member state gains an empty prayer list without losing existing data', () => {
  const legacy = { profile: { ...EMPTY_PROFILE, name: 'שם שמור' }, preferences: DEFAULT_PREFERENCES, messages: [], readIds: ['read-message'] };
  const upgraded = normalizeMemberState(legacy);
  assert.deepEqual(upgraded.healingPrayers, []);
  assert.equal(upgraded.profile.name, 'שם שמור');
  assert.deepEqual(upgraded.readIds, ['read-message']);
  const entry = demoHealingPrayer('משה בן שרה', 'שם שמור');
  assert.deepEqual(normalizeMemberState({ ...upgraded, healingPrayers: [entry] }).healingPrayers, [entry]);
});

test('prayer API creates only a name and deletes by authenticated ID without a request body', async () => {
  const requests: { url: string; options: RequestInit }[] = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await api.addHealingPrayer('test-token', 'משה בן שרה');
  await api.deleteHealingPrayer('test-token', 'id/with space');
  assert.equal(requests[0]!.options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0]!.options.body as string), { name: 'משה בן שרה' });
  assert.equal(requests[1]!.options.method, 'DELETE');
  assert.equal(requests[1]!.options.body, undefined);
  assert.ok(requests[1]!.url.endsWith('/api/healing-prayers/id%2Fwith%20space'));
  assert.equal((requests[1]!.options.headers as Record<string, string>).Authorization, 'Bearer test-token');
});
