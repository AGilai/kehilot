import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areas, todoItems } from '../src/client/adminAreas.ts';
import { canRemoveFromGroup } from '../src/client/channelsView.ts';
import { pickHomeCard } from '../src/client/homeCard.ts';
import { menuRows } from '../src/client/meMap.ts';
import { adminGuard, takeManageEntry } from '../src/client/membersView.ts';
import { pushDestination } from '../src/client/push.ts';
import { isAdult } from '../src/client/roles.ts';
import { roleFeatures, scheduleEditorAllowed } from '../src/client/roleView.ts';
import { mapRows, parseCsv } from '../src/import/parse.ts';

// All names are invented. A tech has every right of a gabbai (owner decision 2026-10-28).
const W = { requests: 2, terms: true, linkHints: 1, groupRequests: 0 };

test('a tech gets the same management areas and to-do items as a gabbai', () => {
  assert.deepEqual(areas('tech'), areas('gabbai'));
  assert.ok(areas('tech').length > 0);
  assert.deepEqual(todoItems('tech', W), todoItems('gabbai', W));
  assert.deepEqual(areas('member'), []);
});

test('roleFeatures and the schedule editor treat tech as management', () => {
  assert.deepEqual(roleFeatures('tech'), roleFeatures('gabbai'));
  assert.equal(scheduleEditorAllowed('tech'), true);
});

test('isAdult: member, gabbai, tech', () => {
  assert.deepEqual((['listener', 'member', 'gabbai', 'tech'] as const).map(isAdult), [false, true, true, true]);
});

test('admin guard, manage entry, home card, menu rows, push for a tech', () => {
  assert.equal(adminGuard('tech', { tab: 'overview' }).manage, true);
  assert.equal(takeManageEntry({ current: 1 }, 'tech'), true);
  assert.equal(pickHomeCard({ terms: true } as never, 'tech'), 'terms');
  assert.deepEqual(menuRows('tech'), menuRows('gabbai'));
  assert.equal(pushDestination({ screen: 'requests' }, 'tech', false), 'approvals');
  assert.equal(pushDestination({ screen: 'group_requests' }, 'tech', false), 'group_requests');
});

test('a tech may remove any group admin; a member may not remove a gabbai or a tech', () => {
  assert.equal(canRemoveFromGroup('tech', { role: 'member', isAdmin: true }), true);
  assert.equal(canRemoveFromGroup('member', { role: 'tech', isAdmin: false }), false);
  assert.equal(canRemoveFromGroup('member', { role: 'gabbai', isAdmin: false }), false);
  assert.equal(canRemoveFromGroup('member', { role: 'member', isAdmin: false }), true);
});

test('the import accepts the role טכני / tech', () => {
  const r = mapRows(parseCsv('שם פרטי,שם משפחה,אימייל,תפקיד\nרינה,בדיונית,rina@example.org,טכני\nדן,לדוגמה,dan@example.org,tech'));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.rows.map(x => x.role), ['tech', 'tech']);
});

// ---- attributions carry the role (R2): "טכני", never "גבאי" for a tech

import { staffRole } from '../src/client/roles.ts';
import { cardModel, memberFromWire } from '../src/seats/wire.ts';
import type { MemberWire } from '../src/seats/wire.ts';

test('staffRole: tech stays tech, anything else (legacy, missing) is a gabbai', () => {
  assert.equal(staffRole('tech'), 'tech');
  assert.equal(staffRole('gabbai'), 'gabbai');
  assert.equal(staffRole(undefined), 'gabbai');
  assert.equal(staffRole(null), 'gabbai');
});

const mw = (over: Partial<MemberWire>): MemberWire => ({ week: '2026-10-30', deadline: '2026-10-30T10:00:00+00:00', open: true, seats: 2, updatedByGabbai: true, updatedAt: { erev: 1, day: null }, frames: [], ...over });

test('a member seat view keeps updatedByRole; no role on an old answer means gabbai', () => {
  assert.equal(memberFromWire(mw({ updatedByRole: 'tech' })).updatedByRole, 'tech');
  assert.equal(memberFromWire(mw({})).updatedByRole, 'gabbai');
  assert.equal(memberFromWire(mw({ updatedByGabbai: false })).updatedByRole, null);
});

test('the Home seat card carries the role of the staff edit', () => {
  const now = new Date('2026-10-30T08:00:00Z');
  assert.equal(cardModel(memberFromWire(mw({ updatedByRole: 'tech' })), now)?.byRole, 'tech');
  assert.equal(cardModel(memberFromWire(mw({})), now)?.byRole, 'gabbai');
});
