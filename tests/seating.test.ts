import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { api } from '../src/api.ts';
import { demoSeating, demoSeatReport, initialSeatValue, seatContextKey, seatOptions, seatReport } from '../src/seating.ts';
import { DEFAULT_PREFERENCES, EMPTY_PROFILE, normalizeMemberState } from '../src/types.ts';
import type { SeatingStatus } from '../src/types.ts';

const now = new Date('2026-10-25T10:00:00Z');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('seat dropdown includes zero through the full allocation and ordinary defaults keep all seats', () => {
  assert.deepEqual(seatOptions(4).map(option => option.value), ['0', '1', '2', '3', '4']);
  assert.deepEqual(seatOptions(0), [{ value: '0', label: '0' }]);
  const state = demoSeating(now);
  assert.equal(state.event.date, '2026-10-31');
  assert.equal(initialSeatValue(state, 'arvit'), '0');
  assert.equal(state.neededSeats?.arvit, 4);
  assert.equal(state.reported, false);
});

test('ordinary numbers release seats; special numbers request them and require an active choice', () => {
  const regular = demoSeating(now);
  assert.equal(demoSeatReport(regular, regular, { arvit: 1, shacharit: 3 }, now).neededSeats?.arvit, 3);
  const special = { ...regular, event: { ...regular.event, mode: 'needed' as const }, neededSeats: { arvit: 0, shacharit: 0 }, releasedSeats: { arvit: 4, shacharit: 4 } };
  assert.equal(initialSeatValue(special, 'arvit'), '');
  const zero = demoSeatReport(special, special, { arvit: 0, shacharit: 0 }, now);
  assert.equal(zero.reported, true);
  assert.deepEqual(zero.value, { arvit: 0, shacharit: 0 });
  assert.equal(zero.neededSeats?.arvit, 0);
  assert.equal(initialSeatValue(zero, 'arvit'), '0');
  assert.equal(demoSeatReport(special, special, { arvit: 3, shacharit: 1 }, now).neededSeats?.arvit, 3);
});

test('seat reports reject out-of-range values, unknown quotas, closed events and stale contexts', () => {
  const state = demoSeating(now);
  for (const invalid of [-1, 5, 1.5, NaN]) {
    assert.throws(() => seatReport(state, { arvit: invalid, shacharit: 0 }));
    assert.throws(() => seatReport(state, { arvit: 0, shacharit: invalid }));
  }
  assert.throws(() => seatReport({ ...state, eligible: false }, { arvit: 0, shacharit: 0 }));
  assert.throws(() => seatReport({ ...state, allocatedSeats: null }, { arvit: 0, shacharit: 0 }));
  assert.throws(() => seatReport({ ...state, event: { ...state.event, reportingOpen: false } }, { arvit: 0, shacharit: 0 }));
  const changed = { ...state, event: { ...state.event, revision: 2, mode: 'needed' as const } };
  assert.notEqual(seatContextKey(state), seatContextKey(changed));
  assert.throws(() => demoSeatReport(changed, state, { arvit: 2, shacharit: 1 }));
  assert.notEqual(seatContextKey(state), seatContextKey({ ...state, allocationRevision: 2 }));
});

test('demo reports survive refresh for their event and never carry into a new Shabbat', () => {
  const state = demoSeating(now);
  const reported = demoSeatReport(state, state, { arvit: 2, shacharit: 1 }, now);
  assert.equal(demoSeating(now, reported), reported);
  assert.deepEqual(reported.neededSeats, { arvit: 2, shacharit: 3 });
  assert.equal(initialSeatValue(reported, 'shacharit'), '1');
  const during = demoSeating(new Date('2026-10-31T10:00:00Z'), reported);
  assert.equal(during.event.id, reported.event.id);
  assert.equal(during.reported, true);
  assert.equal(during.event.reportingOpen, false);
  assert.deepEqual(during.value, { arvit: 2, shacharit: 1 });
  assert.equal(demoSeating(now, { ...reported, event: { ...reported.event, mode: 'needed' } }).reported, false);
  const next = demoSeating(new Date('2026-11-01T10:00:00Z'), reported);
  assert.equal(next.event.date, '2026-11-07');
  assert.equal(next.reported, false);
  assert.equal(next.neededSeats?.arvit, 4);
});

test('known special Shabbat dates require explicit seats-needed reports', () => {
  assert.equal(demoSeating(new Date('2026-02-22T10:00:00Z')).event.mode, 'needed');
  assert.equal(demoSeating(new Date('2026-09-06T10:00:00Z')).event.mode, 'needed');
});

test('legacy single-number demo reports are cleared without changing personal data', () => {
  const oldSeats = { ...demoSeating(now), reported: true, value: 1, neededSeats: 3, releasedSeats: 1 } as unknown as SeatingStatus;
  const old = { profile: { ...EMPTY_PROFILE, name: 'שם שמור' }, preferences: DEFAULT_PREFERENCES, messages: [], readIds: ['read'], seating: oldSeats };
  const normalized = normalizeMemberState(old);
  assert.equal(normalized.seating, null);
  assert.equal(normalized.profile.name, old.profile.name);
  assert.deepEqual(normalized.readIds, ['read']);
  const current = demoSeatReport(demoSeating(now), demoSeating(now), { arvit: 1, shacharit: 3 }, now);
  assert.deepEqual(normalizeMemberState({ ...old, seating: current }).seating, current);
});

test('seating API sends the exact event meaning and allocation snapshot with the selected value', async () => {
  const state = demoSeating(now);
  const payload = seatReport(state, { arvit: 0, shacharit: 2 });
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).endsWith('/api/seating'));
    assert.equal(options?.method, 'PUT');
    assert.deepEqual(JSON.parse(options?.body as string), payload);
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    return new Response(JSON.stringify(state), { status: 200 });
  };
  await api.saveSeating('test-token', payload);
});
