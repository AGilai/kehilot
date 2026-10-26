import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReply, groupByDay, isMuted, joinLabel, replierChip, unreadCount, visibleList, visibleReplies } from '../src/client/messageView.ts';
import { feedFromMessages } from '../src/client/feed.ts';
import type { Channel, Message, NotifyPrefs, Reply } from '../src/client/types.ts';

// All names are invented.
const notify = (over: Partial<NotifyPrefs> = {}): NotifyPrefs =>
  ({ mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [], ...over });
const channel = (id: string, over: Partial<Channel> = {}): Channel =>
  ({ channelId: id, name: id, listenersCanRead: true, postPolicy: 'management', canPost: false, inAudience: true, conversation: false, chatHourlyLimit: 0, isAdmin: false, ...over });
const msg = (id: string, over: Partial<Message> = {}): Message =>
  ({ messageId: id, channelId: 'c1', type: 'weekly', title: 't', body: 'b', authorId: 'a1', authorName: 'יוסי לדוגמה', authorKind: 'management', joinCount: 0, ...over });
const t = (key: string, p?: Record<string, string | number>) => (p ? `${key}|${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(',')}` : key);
const channels = [channel('c1'), channel('c2')];

test('muted by channel, type, member and management_only', () => {
  assert.equal(isMuted(msg('m1'), notify(), channels), false);
  assert.equal(isMuted(msg('m1'), notify({ mutedChannels: ['c1'] }), channels), true);
  assert.equal(isMuted(msg('m1', { type: 'event' }), notify({ mutedTypes: ['event'] }), channels), true);
  assert.equal(isMuted(msg('m1', { authorKind: 'member' }), notify({ mutedMembers: ['a1'] }), channels), true);
  assert.equal(isMuted(msg('m1', { authorKind: 'member' }), notify({ membersBroadcasts: 'management_only' }), channels), true);
  assert.equal(isMuted(msg('m1', { authorKind: 'management' }), notify({ membersBroadcasts: 'management_only' }), channels), false);
});

test('mine hides muted, all shows them flagged', () => {
  const feed = feedFromMessages([msg('01A'), msg('01B', { channelId: 'c2' }), msg('01C')]);
  const n = notify({ mutedChannels: ['c2'] });
  assert.deepEqual(visibleList(feed, { mode: 'mine', notify: n, channels }).map(m => m.messageId), ['01C', '01A']);
  const all = visibleList(feed, { mode: 'all', notify: n, channels });
  assert.deepEqual(all.map(m => m.messageId), ['01C', '01B', '01A']);
  assert.deepEqual(all.map(m => isMuted(m, n, channels)), [false, true, false]);
  assert.deepEqual(visibleList(feed, { mode: 'all', channelId: 'c2', notify: n, channels }).map(m => m.messageId), ['01B']);
});

test('unread counts only unmuted unread', () => {
  const feed = feedFromMessages([msg('01A'), msg('01B', { read: true }), msg('01C', { channelId: 'c2' }), msg('01D', { read: false })]);
  assert.equal(unreadCount(feed, notify(), channels), 3);
  assert.equal(unreadCount(feed, notify({ mutedChannels: ['c2'] }), channels), 2);
});

test('no reply box for listener, target, or untargeted', () => {
  const m = msg('m1', { type: 'celebration', targetMemberId: 'u9' });
  assert.equal(canReply(m, 'u1', 'member'), true);
  assert.equal(canReply(m, 'u1', 'gabbai'), true);
  assert.equal(canReply(m, 'u1', 'listener'), false);
  assert.equal(canReply(m, 'u9', 'member'), false);
  assert.equal(canReply(msg('m2', { type: 'celebration' }), 'u1', 'member'), false);
  assert.equal(canReply(msg('m3', { type: 'weekly', targetMemberId: 'u9' }), 'u1', 'member'), false);
  assert.equal(canReply(msg('m4', { type: 'condolence', targetMemberId: 'u9' }), 'u1', 'member'), true);
});

test('chip null at zero, former-member name when blank', () => {
  assert.equal(replierChip(msg('m1', { type: 'celebration', targetName: 'משפחת בדיוני' }), t), null);
  assert.equal(replierChip(msg('m1', { type: 'celebration', targetName: 'משפחת בדיוני', replierCount: 0 }), t), null);
  assert.equal(replierChip(msg('m1', { type: 'celebration', targetName: 'משפחת בדיוני', replierCount: 3 }), t), 'chip.celebration|n=3,name=משפחת בדיוני');
  assert.equal(replierChip(msg('m1', { type: 'condolence', targetName: '', replierCount: 2 }), t), 'chip.condolence|n=2,name=chip.formerMember');
});

test('condolence join label has no count', () => {
  assert.equal(joinLabel('celebration', 5, t), 'join.celebration|n=5');
  assert.equal(joinLabel('condolence', 5, t), 'join.condolence');
});

test('chat channel muted unless opted in', () => {
  const chs = [channel('c1', { conversation: true })];
  const m = msg('m1', { type: 'chat' });
  assert.equal(isMuted(m, notify(), chs), true);
  assert.equal(isMuted(m, notify({ chatChannels: ['c1'] }), chs), false);
});

test('gabbai outside the group sees the channel only under all', () => {
  const chs = [channel('c1', { inAudience: false }), channel('c2')];
  const feed = feedFromMessages([msg('01A'), msg('01B', { channelId: 'c2' })]);
  assert.deepEqual(visibleList(feed, { mode: 'mine', notify: notify(), channels: chs }).map(m => m.messageId), ['01B']);
  assert.deepEqual(visibleList(feed, { mode: 'all', notify: notify(), channels: chs }).map(m => m.messageId), ['01B', '01A']);
  assert.equal(unreadCount(feed, notify(), chs), 1);
});

test('replies show only to the target and to their own author', () => {
  const m = msg('m1', { type: 'condolence', targetMemberId: 'u9' });
  const rs: Reply[] = [
    { replyId: 'r1', authorId: 'u1', authorName: 'דנה בדויה', body: 'א', createdAt: '2026-10-26T10:00:00Z' },
    { replyId: 'r2', authorId: 'u2', authorName: 'רון לדוגמה', body: 'ב', createdAt: '2026-10-26T11:00:00Z' },
  ];
  assert.deepEqual(visibleReplies(m, rs, 'u9').map(r => r.replyId), ['r1', 'r2']);
  assert.deepEqual(visibleReplies(m, rs, 'u1').map(r => r.replyId), ['r1']);
  assert.deepEqual(visibleReplies(m, rs, 'gabbai-user'), []);
});

test('days group by Israel day', () => {
  // ULID time part for 2026-10-26T22:30:00Z (already Oct 27 in Israel, UTC+2) and 2026-10-26T10:00:00Z.
  const id = (ms: number) => {
    const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let s = ''; let n = ms;
    for (let i = 0; i < 10; i++) { s = A[n % 32] + s; n = Math.floor(n / 32); }
    return s + '0000000000000000';
  };
  const a = msg(id(Date.parse('2026-10-26T22:30:00Z')));
  const b = msg(id(Date.parse('2026-10-26T10:00:00Z')));
  const c = msg(id(Date.parse('2026-10-26T12:00:00Z')));
  const groups = groupByDay([a, c, b]);
  assert.deepEqual(groups.map(g => g.day), ['2026-10-27', '2026-10-26']);
  assert.equal(groups[1]!.items.length, 2);
});
