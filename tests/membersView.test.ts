import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bulkCount, filterMembers } from '../src/client/membersView.ts';
import type { MemberRow } from '../src/client/types.ts';

// All names are invented.
const row = (userId: string, displayName: string, over: Partial<MemberRow> = {}): MemberRow =>
  ({ userId, displayName, role: 'member', classification: '', canBroadcast: false, groups: [], ...over });
const rows: MemberRow[] = [
  row('u1', 'דנה בדויה', { canBroadcast: true, groups: ['g1'] }),
  row('u2', 'יוסי לדוגמה', { role: 'gabbai', canBroadcast: true, groups: ['g1', 'g2'] }),
  row('u3', 'Ruth Example', { groups: ['g2'] }),
  row('u4', 'שמעון', { role: 'listener' }),
  row('u5', 'רון בַּדְיוֹנִי', { canBroadcast: false }),
];
const ids = (r: MemberRow[]) => r.map(x => x.userId);

test('search ignores case and niqqud', () => {
  assert.deepEqual(ids(filterMembers(rows, { query: 'RUTH ex' })), ['u3']);
  assert.deepEqual(ids(filterMembers(rows, { query: 'בדיוני' })), ['u5']);
  assert.deepEqual(ids(filterMembers(rows, { query: '  ' })), ids(rows));
});

test('filters combine', () => {
  assert.deepEqual(ids(filterMembers(rows, { query: '', role: 'member', canBroadcast: true })), ['u1']);
  assert.deepEqual(ids(filterMembers(rows, { query: 'דנה', role: 'member' })), ['u1']);
  assert.deepEqual(ids(filterMembers(rows, { query: '', canBroadcast: false })), ['u3', 'u4', 'u5']);
});

test('bulk count excludes gabbaim and listeners', () => {
  assert.equal(bulkCount(rows, true), 2); // u3 and u5 would change; u1 already allowed
  assert.equal(bulkCount(rows, false), 1); // only u1
});

test('filter by group', () => {
  assert.deepEqual(ids(filterMembers(rows, { query: '', group: 'g2' })), ['u2', 'u3']);
  assert.deepEqual(ids(filterMembers(rows, { query: '', group: 'g1', role: 'gabbai' })), ['u2']);
  assert.deepEqual(ids(filterMembers(rows, { query: '', group: 'none' })), []);
});

test('adminGuard leaves management when not gabbai', async () => {
  const { adminGuard } = await import('../src/client/membersView.ts');
  assert.deepEqual(adminGuard('gabbai', { tab: 'members' }), { manage: true, nav: { tab: 'members' } });
  assert.deepEqual(adminGuard('member', { tab: 'members' }), { manage: false, nav: { tab: 'home' }, left: true });
  assert.deepEqual(adminGuard(undefined, { tab: 'approvals' }), { manage: false, nav: { tab: 'home' }, left: true });
});

test('manage entry is consumed once and only for a gabbai', async () => {
  const { takeManageEntry } = await import('../src/client/membersView.ts');
  const h = { current: 2 as number | null };
  assert.equal(takeManageEntry(h, 'member'), false);
  assert.equal(h.current, null); // consumed even when refused
  h.current = 3;
  assert.equal(takeManageEntry(h, 'gabbai'), true);
  assert.equal(takeManageEntry(h, 'gabbai'), false);
});

test('groups seed keeps only existing group ids', async () => {
  const { existingGroups } = await import('../src/client/membersView.ts');
  assert.deepEqual(existingGroups(['g1', 'gone', 'g2'], ['g1', 'g2', 'g3']), ['g1', 'g2']);
});
