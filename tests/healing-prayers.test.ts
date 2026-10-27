import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { api } from '../src/api.ts';
import { demoHealingPrayer, healingPrayerName, prayerAddedDate, refreshDemoHealing, keepDemoHealing } from '../src/healingPrayers.ts';
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
  assert.equal(prayerAddedDate(entry.addedOn), '02-07-2026');
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

test('gabbai combined-list request is authenticated and propagates an authorization rejection', async () => {
  let path = ''; let authorization = '';
  globalThis.fetch = async (url, options = {}) => {
    path = String(url); authorization = (options.headers as Record<string, string>).Authorization ?? '';
    return new Response(JSON.stringify({ error: 'אין הרשאה' }), { status: 403 });
  };
  await assert.rejects(api.adminHealingPrayers('member-only-token'), (error: unknown) => error instanceof Error && 'status' in error && error.status === 403);
  assert.ok(path.endsWith('/api/admin/healing-prayers'));
  assert.equal(authorization, 'Bearer member-only-token');
});

test('reminders become due after 14 Israeli calendar days and renewal updates the record date', () => {
  const entry = demoHealingPrayer('משה בן שרה', 'שם המכניס', new Date('2027-01-01T12:00:00Z'));
  assert.equal(entry.reminder?.dueOn, '2027-01-15');
  assert.equal(entry.reminder?.expiresOn, '2027-02-01');
  assert.equal(refreshDemoHealing([entry], new Date('2027-01-14T12:00:00Z'))[0]?.reminder?.pending, false);
  const pending = refreshDemoHealing([entry], new Date('2027-01-15T12:00:00Z'))[0]!;
  assert.equal(pending.reminder?.pending, true);
  const kept = keepDemoHealing(pending, pending.reminder!.cycleId, new Date('2027-01-16T12:00:00Z'));
  assert.equal(kept.addedOn, '2027-01-16');
  assert.equal(kept.reminder?.dueOn, '2027-01-30');
  assert.equal(kept.reminder?.expiresOn, '2027-02-16');
  assert.equal(kept.reminder?.pending, false);
  assert.throws(() => keepDemoHealing(kept, pending.reminder!.cycleId, new Date('2027-01-16T12:00:00Z')));
  assert.deepEqual(refreshDemoHealing([pending], new Date('2027-02-01T12:00:00Z')), []);
});

test('calendar-month deadlines clamp correctly and unanswered demo records expire after a month', () => {
  for (const [start, expiry] of [['2027-01-31', '2027-02-28'], ['2028-01-31', '2028-02-29'], ['2027-12-31', '2028-01-31']]) {
    const entry = demoHealingPrayer('שם בן אם', 'מכניס', new Date(`${start}T12:00:00Z`));
    assert.equal(entry.reminder?.expiresOn, expiry);
  }
  const old = demoHealingPrayer('שם בן אם', 'מכניס', new Date('2027-01-01T12:00:00Z'));
  assert.deepEqual(refreshDemoHealing([old], new Date('2027-02-02T12:00:00Z')), []);
});

test('keep request sends the current cycle to the authenticated owner endpoint', async () => {
  let path = ''; let options: RequestInit = {};
  globalThis.fetch = async (url, init = {}) => {
    path = String(url); options = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await api.keepHealingPrayer('owner-token', 'id/with space', 'current-cycle');
  assert.ok(path.endsWith('/api/healing-prayers/id%2Fwith%20space/keep'));
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body as string), { cycleId: 'current-cycle' });
  assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer owner-token');
});
