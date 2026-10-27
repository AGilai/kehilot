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

// P11: family line and link candidates. Invented names.
const fam = (id: string, adults: string[], kids: number) => ({
  familyId: id, name: 'בדיוני', adults: adults.map(u => ({ userId: u, displayName: 'שם ' + u })),
  children: Array.from({ length: kids }, (_, i) => ({ firstName: 'ילד' + i, gender: 'm' as const })),
});

test('family line with partner and children', async () => {
  const { familyLine } = await import('../src/client/membersView.ts');
  assert.deepEqual(familyLine('u1', [fam('f1', ['u1', 'u2'], 3)]), { partnerName: 'שם u2', children: 3 });
  assert.deepEqual(familyLine('u2', [fam('f1', ['u1', 'u2'], 3)]), { partnerName: 'שם u1', children: 3 });
});

test('family line alone', async () => {
  const { familyLine } = await import('../src/client/membersView.ts');
  assert.deepEqual(familyLine('u3', [fam('f2', ['u3'], 1)]), { partnerName: null, children: 1 });
  assert.deepEqual(familyLine('u9', []), { partnerName: null, children: 0 }); // no family item yet
});

test('link candidates exclude linked people and self', async () => {
  const { linkCandidates } = await import('../src/client/membersView.ts');
  const m = [row('u1', 'א'), row('u2', 'ב'), row('u3', 'ג'), row('u4', 'ד', { role: 'gabbai' }), row('u5', 'ה', { role: 'listener' }), row('u6', 'ו')];
  const families = [fam('f1', ['u1', 'u2'], 0), fam('f2', ['u3'], 1)];
  assert.deepEqual(ids(linkCandidates(m, families, 'u3')), ['u4', 'u6']); // u1,u2 linked; u3 self; u5 listener
  assert.deepEqual(ids(linkCandidates(m, families, 'u6')), ['u3', 'u4']);
});
