import assert from 'node:assert/strict';
import { test } from 'node:test';
import { healingMessageId, syncPersonalInbox, unreadMessageCount } from '../src/inbox.ts';
import { opensMessages } from '../src/notificationRouting.ts';
import { demoHealingPrayer, refreshDemoHealing, keepDemoHealing } from '../src/healingPrayers.ts';
import { demoSeating, demoSeatReport } from '../src/seating.ts';
import { DEFAULT_PREFERENCES, EMPTY_PROFILE } from '../src/types.ts';
import type { CommunityMessage, MemberState } from '../src/types.ts';

const publicMessage: CommunityMessage = { id: 'public-message', category: 'weekly', title: 'עדכון', body: 'תוכן', createdAt: '2027-01-15T10:00:00Z', author: 'גבאי', pinned: false, replies: [] };
const initial: MemberState = { profile: EMPTY_PROFILE, preferences: DEFAULT_PREFERENCES, messages: [publicMessage], readIds: [], seating: null,
  healingPrayers: [demoHealingPrayer('שם חולה בן אם', 'מכניס', new Date('2027-01-01T12:00:00Z'))] };

test('unread inbox includes due reminders and community messages, but opening a list does not mark anything read', () => {
  const state = syncPersonalInbox({ ...initial, healingPrayers: refreshDemoHealing(initial.healingPrayers, new Date('2027-01-15T12:00:00Z')) });
  assert.equal(state.messages.length, 2);
  assert.equal(unreadMessageCount(state), 2);
  const message = state.messages.find(message => message.kind === 'healing')!;
  assert.equal(message.id, healingMessageId(state.healingPrayers[0]!.reminder!.cycleId));
  assert.ok(message.body.includes('שם חולה בן אם'));
  assert.equal(message.healing?.expiresOn, '2027-02-01');
  const read = syncPersonalInbox({ ...state, readIds: [message.id] });
  assert.equal(unreadMessageCount(read), 1);
  assert.equal(read.healingPrayers[0]!.addedOn, '2027-01-01');
  assert.equal(read.healingPrayers[0]!.reminder!.pending, true);
  assert.equal(unreadMessageCount({ ...read, readIds: read.messages.map(message => message.id) }), 0);
});

test('resolved reminders disappear immediately and a later cycle becomes unread again', () => {
  const pending = refreshDemoHealing(initial.healingPrayers, new Date('2027-01-15T12:00:00Z'));
  const old = syncPersonalInbox({ ...initial, healingPrayers: pending });
  const id = old.messages.find(message => message.kind === 'healing')!.id;
  const kept = keepDemoHealing(pending[0]!, pending[0]!.reminder!.cycleId, new Date('2027-01-16T12:00:00Z'));
  const resolved = syncPersonalInbox({ ...old, readIds: [id], healingPrayers: [kept] });
  assert.deepEqual(resolved.messages, [publicMessage]);
  assert.ok(!resolved.readIds.includes(id));
  const next = syncPersonalInbox({ ...resolved, healingPrayers: refreshDemoHealing([kept], new Date('2027-01-30T12:00:00Z')) });
  assert.notEqual(next.messages[1]!.id, id);
  assert.equal(unreadMessageCount(next), 2);
  assert.deepEqual(syncPersonalInbox({ ...next, healingPrayers: [] }).messages, [publicMessage]);
});

test('server timestamps/read state are retained when synchronizing the inbox', () => {
  const pending = refreshDemoHealing(initial.healingPrayers, new Date('2027-01-15T12:00:00Z'));
  pending[0]!.reminder!.read = true;
  const first = syncPersonalInbox({ ...initial, healingPrayers: pending });
  const messages = first.messages.map(message => message.kind === 'healing' ? { ...message, createdAt: '2027-01-14T22:00:00Z' } : message);
  const next = syncPersonalInbox({ ...first, messages });
  assert.equal(next.messages[1]!.createdAt, '2027-01-14T22:00:00Z');
  assert.equal(unreadMessageCount(next), 1);
});

test('notification taps route current and legacy message payloads to the Messages screen', () => {
  for (const data of [{ screen: 'messages', messageId: 'new-id' }, { screen: 'messages' }, { messageId: 'legacy-id' }, { screen: 'healing', prayerId: 'old-prayer' }, { screen: 'membership' }]) assert.equal(opensMessages(data), true);
  for (const data of [undefined, {}, { screen: 'unknown' }, { messageId: 123 }]) assert.equal(opensMessages(data), false);
});

test('seating reminders join the private inbox; reading is separate from reporting and noon is unread', () => {
  const morning = demoSeating(new Date('2026-10-30T05:30:00Z'));
  const state = syncPersonalInbox({ ...initial, seating: morning });
  const message = state.messages.find(message => message.kind === 'seating')!;
  assert.equal(message.seating?.eventId, morning.event.id);
  assert.equal(unreadMessageCount(state), 2);
  const read = syncPersonalInbox({ ...state, readIds: [message.id] });
  assert.equal(unreadMessageCount(read), 1);
  assert.equal(read.seating?.reported, false);
  const noon = demoSeating(new Date('2026-10-30T10:00:00Z'), morning);
  const next = syncPersonalInbox({ ...read, seating: noon });
  assert.notEqual(next.messages.find(m => m.kind === 'seating')?.id, message.id);
  assert.equal(unreadMessageCount(next), 2);
  const saved = demoSeatReport(noon, noon, { arvit: 1, shacharit: 2 }, new Date('2026-10-30T10:01:00Z'));
  const resolved = syncPersonalInbox({ ...next, seating: saved });
  assert.equal(resolved.messages.some(m => m.kind === 'seating'), false);
  assert.equal(unreadMessageCount(resolved), 1);
});
