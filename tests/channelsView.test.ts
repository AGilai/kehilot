import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canAppoint, canRemoveFromGroup, channelForm, exitTarget, firstWithPending, isDirty, lockListeners, lockNote, needsOpenConfirm, toRequest,
} from '../src/client/channelsView.ts';
import type { Channel } from '../src/client/types.ts';

// All names are invented.
const chan = (over: Partial<Channel> = {}): Channel => ({
  channelId: 'c1', name: 'שיחת נשים', listenersCanRead: false, postPolicy: 'broadcasters', canPost: true, inAudience: true,
  conversation: false, chatHourlyLimit: 30, isAdmin: true, groups: [], ...over,
});

test('channelForm: defaults for a new channel and the fields of an existing one', () => {
  assert.deepEqual(channelForm(), { name: '', listenersCanRead: false, postPolicy: 'management', groups: [], conversation: false, chatHourlyLimit: 30 });
  const f = channelForm(chan({ groups: ['g1'], conversation: true, chatHourlyLimit: 5 }));
  assert.deepEqual(f, { name: 'שיחת נשים', listenersCanRead: false, postPolicy: 'broadcasters', groups: ['g1'], conversation: true, chatHourlyLimit: 5 });
});

test('groups or conversation lock listeners off', () => {
  const base = channelForm();
  assert.equal(lockListeners(base), false);
  assert.equal(lockListeners({ ...base, groups: ['g1'] }), true);
  assert.equal(lockListeners({ ...base, conversation: true }), true);
  assert.equal(lockNote({ ...base, groups: ['g1'] }), 'groups');
  assert.equal(lockNote({ ...base, groups: ['g1'], conversation: true }), 'groups');
  assert.equal(lockNote({ ...base, conversation: true }), 'conversation');
  assert.equal(lockNote(base), null);
});

test('removing last group needs confirmation', () => {
  const a = { ...channelForm(), groups: ['g1'] };
  assert.equal(needsOpenConfirm(a, { ...a, groups: [] }), true);
  assert.equal(needsOpenConfirm(a, { ...a, groups: ['g2'] }), false);
  assert.equal(needsOpenConfirm({ ...a, groups: ['g1', 'g2'] }, { ...a, groups: ['g1'] }), false);
  assert.equal(needsOpenConfirm({ ...a, groups: [] }, { ...a, groups: [] }), false);
});

test('form always sends groups and conversation', () => {
  const r = toRequest(channelForm());
  assert.deepEqual(r.groups, []);
  assert.equal(r.conversation, false);
  assert.ok('groups' in r && 'conversation' in r);
  assert.equal(toRequest({ ...channelForm(), name: '  שם  ' }).name, 'שם');
  // listeners cannot read a locked channel, whatever the toggle said before
  assert.equal(toRequest({ ...channelForm(), listenersCanRead: true, groups: ['g1'] }).listenersCanRead, false);
  assert.equal(toRequest({ ...channelForm(), listenersCanRead: true, conversation: true }).listenersCanRead, false);
  assert.equal(toRequest({ ...channelForm(), listenersCanRead: true }).listenersCanRead, true);
});

test('chat limit sent only for conversation channels and clamped 0–200', () => {
  assert.equal('chatHourlyLimit' in toRequest({ ...channelForm(), chatHourlyLimit: 10 }), false);
  assert.equal(toRequest({ ...channelForm(), conversation: true, chatHourlyLimit: 10 }).chatHourlyLimit, 10);
  assert.equal(toRequest({ ...channelForm(), conversation: true, chatHourlyLimit: 999 }).chatHourlyLimit, 200);
  assert.equal(toRequest({ ...channelForm(), conversation: true, chatHourlyLimit: -4 }).chatHourlyLimit, 0);
  assert.equal(toRequest({ ...channelForm(), conversation: true, chatHourlyLimit: 7.9 }).chatHourlyLimit, 7);
  assert.equal(toRequest({ ...channelForm(), conversation: true, chatHourlyLimit: Number.NaN }).chatHourlyLimit, 30);
});

test('group admin actions: gabbai can remove an admin, member-admin cannot', () => {
  const plain = { role: 'member' as const, isAdmin: false };
  const admin = { role: 'member' as const, isAdmin: true };
  const gabbai = { role: 'gabbai' as const, isAdmin: true };
  assert.equal(canRemoveFromGroup('gabbai', admin), true);
  assert.equal(canRemoveFromGroup('gabbai', plain), true);
  assert.equal(canRemoveFromGroup('member', plain), true);
  assert.equal(canRemoveFromGroup('member', admin), false);
  assert.equal(canRemoveFromGroup('member', gabbai), false);
  assert.equal(canRemoveFromGroup('listener', plain), false);
});

test('appoint: only a member who is not yet an admin', () => {
  assert.equal(canAppoint({ role: 'member', isAdmin: false }), true);
  assert.equal(canAppoint({ role: 'member', isAdmin: true }), false);
  assert.equal(canAppoint({ role: 'listener', isAdmin: false }), false);
  assert.equal(canAppoint({ role: 'gabbai', isAdmin: true }), false);
});

test('firstWithPending: first group with requests; a failing group is skipped', async () => {
  const counts: Record<string, number> = { a: 0, b: 2, c: 5 };
  assert.equal(await firstWithPending(['a', 'b', 'c'], async id => counts[id]!), 'b');
  assert.equal(await firstWithPending(['a'], async id => counts[id]!), null);
  assert.equal(await firstWithPending([], async () => 1), null);
  assert.equal(await firstWithPending(['x', 'c'], async id => { if (id === 'x') throw new Error('boom'); return 1; }), 'c');
});

test('isDirty: compares what the sheet edits, groups as a set, limit only for conversations', () => {
  const a = { ...channelForm(), name: 'שם', groups: ['g1', 'g2'] };
  assert.equal(isDirty(a, { ...a, groups: ['g2', 'g1'] }), false);
  assert.equal(isDirty(a, { ...a, name: 'אחר' }), true);
  assert.equal(isDirty(a, { ...a, groups: ['g1'] }), true);
  assert.equal(isDirty(a, { ...a, postPolicy: 'broadcasters' }), true);
  assert.equal(isDirty(a, { ...a, chatHourlyLimit: 5 }), false);
  assert.equal(isDirty({ ...a, conversation: true }, { ...a, conversation: true, chatHourlyLimit: 5 }), true);
  assert.equal(isDirty(a, { ...a, conversation: true }), true);
});

test('exitTarget: a 403 ends the admin screen; other errors stay', () => {
  assert.equal(exitTarget('forbidden', 'group'), 'me');
  assert.equal(exitTarget('forbidden', 'limit'), 'chat');
  assert.equal(exitTarget('network', 'group'), null);
  assert.equal(exitTarget(undefined, 'limit'), null);
});
