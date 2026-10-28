import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREA_IDS, areas, allowedTargets, todoItems, waitingAny } from '../src/client/adminAreas.ts';
import { createWaitingStore } from '../src/client/waitingStore.ts';
import type { WaitingCounts } from '../src/client/waitingStore.ts';
import { adultPhones, phoneRow } from '../src/client/membersView.ts';

// All names and numbers are invented.
const sheet0 = { sheetPending: 0, sheetPendingWeek: null };
const none = { requests: 0, terms: false, linkHints: 0, groupRequests: 0, sheetPending: 0 };

test('areas: the six groups in §18.3 order, only for a gabbai', () => {
  assert.deepEqual(AREA_IDS, ['prayers', 'seats', 'messages', 'simchas', 'people', 'settings']);
  assert.deepEqual(areas('gabbai').map(a => a.id), AREA_IDS);
  for (const role of ['member', 'listener', undefined] as const) assert.deepEqual(areas(role), []);
});

test('areas: rows inside each group, in order', () => {
  const rows = (id: string) => areas('gabbai').find(a => a.id === id)!.rows.map(r => r.id);
  assert.deepEqual(rows('prayers'), ['schedule', 'sheet']);
  assert.deepEqual(rows('seats'), ['print', 'behalf', 'responses', 'times', 'editor', 'holders']);
  assert.deepEqual(rows('messages'), ['compose', 'channels', 'types', 'pushTexts']);
  assert.deepEqual(rows('simchas'), ['simchas', 'aliyot']);
  assert.deepEqual(rows('people'), ['approvals', 'members', 'tags', 'groups', 'invite', 'import']);
  assert.deepEqual(rows('settings'), ['cap', 'privacy', 'terms']);
});

test('areas: seat rows keep their two sections; the aliyot row is reserved (no destination)', () => {
  const seats = areas('gabbai').find(a => a.id === 'seats')!.rows;
  assert.deepEqual(seats.map(r => r.section), ['week', 'week', 'week', 'every', 'hall', 'hall']);
  assert.equal(areas('gabbai').find(a => a.id === 'simchas')!.rows[1]!.target, null);
  assert.equal(seats.find(r => r.id === 'holders')!.badge, 'linkHints');
  assert.equal(areas('gabbai').find(a => a.id === 'people')!.rows[0]!.badge, 'requests');
});

test('areas: the times row is in section every, for gabbai and tech, not for a member', () => {
  const row = areas('gabbai').find(a => a.id === 'seats')!.rows.find(r => r.id === 'times')!;
  assert.deepEqual([row.target, row.section], ['seatTimes', 'every']);
  assert.ok(allowedTargets('gabbai').has('seatTimes'));
  assert.ok(allowedTargets('tech').has('seatTimes'));
  assert.ok(!allowedTargets('member').has('seatTimes'));
});

test('areas: every existing management screen is reachable from some row', () => {
  const t = allowedTargets('gabbai');
  for (const x of ['approvals', 'members', 'membersTags', 'groups', 'invite', 'import', 'channels', 'pushTexts', 'compose', 'simchas', 'scheduleEditor', 'seatPrint', 'seatBehalf', 'seatResponses', 'seatTimes', 'seatEditor', 'seatHolders', 'sheet:cap', 'sheet:privacy', 'sheet:terms']) assert.ok(t.has(x as never), x);
  assert.equal(allowedTargets('member').size, 0);
});

test('לטיפול עכשיו: hidden when nothing waits; items by urgency with counts', () => {
  assert.deepEqual(todoItems('gabbai', none), []);
  assert.equal(waitingAny('gabbai', none), false);
  const all = { requests: 3, terms: true, linkHints: 2, groupRequests: 1, sheetPending: 0 };
  assert.deepEqual(todoItems('gabbai', all).map(i => [i.id, i.count]), [['requests', 3], ['terms', 0], ['linkHints', 2], ['groupRequests', 1]]);
  assert.deepEqual(todoItems('gabbai', { ...none, linkHints: 2 }).map(i => i.id), ['linkHints']);
  assert.equal(waitingAny('gabbai', { ...none, groupRequests: 1 }), true);
  assert.deepEqual(todoItems('member', all), []);
  assert.equal(waitingAny('member', all), false);
});

test('phone row: E.164 in, display / tel: / wa.me digits / list state out', () => {
  assert.equal(phoneRow(null, true), null);
  assert.equal(phoneRow('', false), null);
  assert.deepEqual(phoneRow('+972500000001', true), { display: '050-0000001', tel: 'tel:+972500000001', wa: 'https://wa.me/972500000001', list: 'all' });
  assert.deepEqual(phoneRow('+972500000002', false), { display: '050-0000002', tel: 'tel:+972500000002', wa: 'https://wa.me/972500000002', list: 'gabbaim' });
  assert.deepEqual(phoneRow('+12025550100', true)!.wa, 'https://wa.me/12025550100');
});

test('adult phones: families joined to members by userId; missing member or number gives no row', () => {
  const fam = { familyId: 'f', name: 'דוגמה', adults: [{ userId: 'u1', displayName: 'דנה דוגמה' }, { userId: 'u2', displayName: 'יוסי דוגמה' }, { userId: 'u3', displayName: 'ללא' }], children: [] };
  const members = [{ userId: 'u1', phone: '+972500000001', showPhone: true }, { userId: 'u2', phone: null, showPhone: false }];
  const out = adultPhones(fam, members);
  assert.deepEqual(out.map(a => [a.userId, a.phone?.list ?? null]), [['u1', 'all'], ['u2', null], ['u3', null]]);
});

test('waiting store: one shared fetch for concurrent refreshes, setRequests, reset on another Kehila', async () => {
  let calls = 0;
  let release: (v: WaitingCounts) => void = () => {};
  const store = createWaitingStore(() => { calls++; return new Promise(r => { release = r; }); });
  const seen: number[] = [];
  store.subscribe(() => seen.push(store.get().requests));
  const a = store.refresh('k1'), b = store.refresh('k1');
  assert.equal(calls, 1);
  release({ requests: 3, linkHints: 1, groupRequests: 2, ...sheet0 });
  await Promise.all([a, b]);
  assert.deepEqual(store.get(), { kehilaId: 'k1', requests: 3, linkHints: 1, groupRequests: 2, ...sheet0 });
  store.setRequests(1);
  assert.equal(store.get().requests, 1);
  const c = store.refresh('k1'); assert.equal(calls, 2); release({ requests: 0, linkHints: 0, groupRequests: 0, ...sheet0 }); await c;
  assert.equal(store.get().requests, 0);
  const d = store.refresh('k2');
  assert.equal(store.get().kehilaId, 'k2'); assert.equal(store.get().requests, 0);
  release({ requests: 5, linkHints: 0, groupRequests: 0, ...sheet0 }); await d;
  assert.equal(store.get().requests, 5);
  assert.ok(seen.length >= 4);
});

test('waiting store: a stale answer for the old Kehila is dropped; a failed load keeps the counts', async () => {
  const resolvers: Array<(v: WaitingCounts) => void> = [];
  const store = createWaitingStore(() => new Promise((res) => { resolvers.push(res); }));
  const old = store.refresh('k1');
  const cur = store.refresh('k2');
  resolvers[1]!({ requests: 2, linkHints: 0, groupRequests: 0, ...sheet0 }); await cur;
  resolvers[0]!({ requests: 9, linkHints: 0, groupRequests: 0, ...sheet0 }); await old;
  assert.equal(store.get().requests, 2);
  let n = 0;
  const failing = createWaitingStore(async () => { if (n++ > 0) throw new Error('x'); return { requests: 4, linkHints: 0, groupRequests: 0, ...sheet0 }; });
  await failing.refresh('k1');
  await failing.refresh('k1');
  assert.equal(failing.get().requests, 4);
});

test('areas: the prayers sheet row opens the sheet items screen with the pending badge', () => {
  const row = areas('gabbai').find(a => a.id === 'prayers')!.rows.find(r => r.id === 'sheet')!;
  assert.equal(row.target, 'sheetItems');
  assert.equal(row.badge, 'sheetPending');
  assert.ok(allowedTargets('gabbai').has('sheetItems'));
  assert.ok(allowedTargets('tech').has('sheetItems'));
});

test('todo: the sheet item comes after requests, only when something is pending', () => {
  assert.deepEqual(todoItems('gabbai', none), []);
  const w = { ...none, requests: 2, terms: true, sheetPending: 3 };
  assert.deepEqual(todoItems('gabbai', w).map(i => i.id), ['requests', 'sheet', 'terms']);
  const sheet = todoItems('gabbai', w)[1]!;
  assert.deepEqual([sheet.count, sheet.target], [3, 'sheetItems']);
  assert.deepEqual(todoItems('gabbai', { ...none, sheetPending: 1 }).map(i => i.id), ['sheet']);
  assert.equal(waitingAny('gabbai', { ...none, sheetPending: 1 }), true);
  assert.deepEqual(todoItems('member', { ...none, sheetPending: 1 }), []);
});
