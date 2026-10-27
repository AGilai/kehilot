import assert from 'node:assert/strict';
import { test } from 'node:test';
import { healingMessageId, syncHealingInbox, unreadMessageCount } from '../src/inbox.ts';
import { opensMessages } from '../src/notificationRouting.ts';
import { demoHealingPrayer, refreshDemoHealing, keepDemoHealing } from '../src/healingPrayers.ts';
import { DEFAULT_PREFERENCES, EMPTY_PROFILE } from '../src/types.ts';
import type { CommunityMessage, MemberState } from '../src/types.ts';

const publicMessage: CommunityMessage = { id: 'public-message', category: 'weekly', title: 'עדכון', body: 'תוכן', createdAt: '2027-01-15T10:00:00Z', author: 'גבאי', pinned: false, replies: [] };
const initial: MemberState = { profile: EMPTY_PROFILE, preferences: DEFAULT_PREFERENCES, messages: [publicMessage], readIds: [], seating: null,
  healingPrayers: [demoHealingPrayer('שם חולה בן אם', 'מכניס', new Date('2027-01-01T12:00:00Z'))] };

test('unread inbox includes due reminders and community messages, but opening a list does not mark anything read', () => {
  const state = syncHealingInbox({ ...initial, healingPrayers: refreshDemoHealing(initial.healingPrayers, new Date('2027-01-15T12:00:00Z')) });
  assert.equal(state.messages.length, 2);
  assert.equal(unreadMessageCount(state), 2);
  const message = state.messages.find(message => message.kind === 'healing')!;
  assert.equal(message.id, healingMessageId(state.healingPrayers[0]!.reminder!.cycleId));
  assert.ok(message.body.includes('שם חולה בן אם'));
  assert.equal(message.healing?.expiresOn, '2027-02-01');
  const read = syncHealingInbox({ ...state, readIds: [message.id] });
  assert.equal(unreadMessageCount(read), 1);
  assert.equal(read.healingPrayers[0]!.addedOn, '2027-01-01');
  assert.equal(read.healingPrayers[0]!.reminder!.pending, true);
  assert.equal(unreadMessageCount({ ...read, readIds: read.messages.map(message => message.id) }), 0);
});

test('resolved reminders disappear immediately and a later cycle becomes unread again', () => {
  const pending = refreshDemoHealing(initial.healingPrayers, new Date('2027-01-15T12:00:00Z'));
  const old = syncHealingInbox({ ...initial, healingPrayers: pending });
  const id = old.messages.find(message => message.kind === 'healing')!.id;
  const kept = keepDemoHealing(pending[0]!, pending[0]!.reminder!.cycleId, new Date('2027-01-16T12:00:00Z'));
  const resolved = syncHealingInbox({ ...old, readIds: [id], healingPrayers: [kept] });
  assert.deepEqual(resolved.messages, [publicMessage]);
  assert.ok(!resolved.readIds.includes(id));
  const next = syncHealingInbox({ ...resolved, healingPrayers: refreshDemoHealing([kept], new Date('2027-01-30T12:00:00Z')) });
  assert.notEqual(next.messages[1]!.id, id);
  assert.equal(unreadMessageCount(next), 2);
  assert.deepEqual(syncHealingInbox({ ...next, healingPrayers: [] }).messages, [publicMessage]);
});

test('server timestamps/read state are retained when synchronizing the inbox', () => {
  const pending = refreshDemoHealing(initial.healingPrayers, new Date('2027-01-15T12:00:00Z'));
  pending[0]!.reminder!.read = true;
  const first = syncHealingInbox({ ...initial, healingPrayers: pending });
  const messages = first.messages.map(message => message.kind === 'healing' ? { ...message, createdAt: '2027-01-14T22:00:00Z' } : message);
  const next = syncHealingInbox({ ...first, messages });
  assert.equal(next.messages[1]!.createdAt, '2027-01-14T22:00:00Z');
  assert.equal(unreadMessageCount(next), 1);
});

test('notification taps route current and legacy message payloads to the Messages screen', () => {
  for (const data of [{ screen: 'messages', messageId: 'new-id' }, { screen: 'messages' }, { messageId: 'legacy-id' }, { screen: 'healing', prayerId: 'old-prayer' }, { screen: 'membership' }]) assert.equal(opensMessages(data), true);
  for (const data of [undefined, {}, { screen: 'unknown' }, { messageId: 123 }]) assert.equal(opensMessages(data), false);
});
