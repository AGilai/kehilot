import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canPostInChat, mainTabs, roleFeatures, showCompose } from '../src/client/roleView.ts';
import type { Channel } from '../src/client/types.ts';

// All names are invented.
const ch = (over: Partial<Channel> = {}): Channel =>
  ({ channelId: 'c1', name: 'ערוץ', listenersCanRead: true, postPolicy: 'management', canPost: false, inAudience: true, conversation: false, chatHourlyLimit: 0, isAdmin: false, ...over });

test('a listener uses the normal tabs but gets no compose, no directory, no management, no blessing box, no join', () => {
  const f = roleFeatures('listener');
  assert.deepEqual(f.tabs, ['home', 'messages', 'me']);
  assert.deepEqual([f.compose, f.directory, f.management, f.blessingReply, f.join], [false, false, false, false, false]);
  assert.equal(f.membershipCard, true);
});

test('member and gabbai are unchanged; only the gabbai manages', () => {
  const m = roleFeatures('member');
  assert.deepEqual(m.tabs, ['home', 'messages', 'me']);
  assert.deepEqual([m.compose, m.directory, m.management, m.blessingReply, m.join, m.membershipCard], [true, true, false, true, true, false]);
  const g = roleFeatures('gabbai');
  assert.deepEqual([g.compose, g.directory, g.management, g.blessingReply, g.join, g.membershipCard], [true, true, true, true, true, false]);
  assert.deepEqual(mainTabs('gabbai'), ['home', 'messages', 'me']);
});

test('no role yet shows the least: like a listener', () => {
  assert.equal(roleFeatures(undefined).compose, false);
});

test('compose shows only when the role may and a channel can be broadcast to (conversation channels do not count)', () => {
  const postable = [ch({ canPost: true })];
  assert.equal(showCompose('member', postable), true);
  assert.equal(showCompose('member', [ch({ canPost: true, conversation: true })]), false);
  assert.equal(showCompose('member', [ch()]), false);
  assert.equal(showCompose('listener', postable), false); // even if a channel said canPost
});

test('chat: everyone posts exactly where the server says canPost', () => {
  assert.equal(canPostInChat('listener', ch({ conversation: true, canPost: true })), true);
  assert.equal(canPostInChat('listener', ch({ conversation: true, canPost: false })), false);
  assert.equal(canPostInChat('listener', ch({ conversation: false, canPost: true })), false); // a listener never posts announcements
  assert.equal(canPostInChat('member', ch({ conversation: true, canPost: true })), true);
  assert.equal(canPostInChat('member', ch({ conversation: true, canPost: false })), false);
  assert.equal(canPostInChat('gabbai', ch({ conversation: true, canPost: true })), true);
});

test('only members and gabbaim get the phone list (entry, Me card)', () => {
  assert.equal(roleFeatures('listener').phoneList, false);
  assert.equal(roleFeatures(undefined).phoneList, false);
  assert.equal(roleFeatures('member').phoneList, true);
  assert.equal(roleFeatures('gabbai').phoneList, true);
});

test('only members and gabbaim get the family card', () => {
  assert.equal(roleFeatures('listener').family, false);
  assert.equal(roleFeatures(undefined).family, false);
  assert.equal(roleFeatures('member').family, true);
  assert.equal(roleFeatures('gabbai').family, true);
});
