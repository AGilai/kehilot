import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canPublish, canUpdate, eventChangeParts, sortId, updatedLine, updatedMeta, canSendChat, groupByDay, isMuted, needsTarget, postBody, postableChannels, joinLabel, unreadCount, visibleList } from '../src/client/messageView.ts';
import { feedFromMessages } from '../src/client/feed.ts';
import type { Channel, Message, NotifyPrefs } from '../src/client/types.ts';

// All names are invented.
const notify = (over: Partial<NotifyPrefs> = {}): NotifyPrefs =>
  ({ mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [], seatReminders: true, ...over });
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

test('chat messages add nothing to the unread count', () => {
  const chs = [channel('c1', { conversation: true })];
  const feed = feedFromMessages([msg('01A', { type: 'chat', authorKind: 'member' }), msg('01B', { channelId: 'c2' })]);
  assert.equal(unreadCount(feed, notify({ chatChannels: ['c1'] }), [...chs, channel('c2')]), 1);
});

test('management_only does not mute chat messages of an opted-in channel', () => {
  const chs = [channel('c1', { conversation: true })];
  const m = msg('m1', { type: 'chat', authorKind: 'member' });
  assert.equal(isMuted(m, notify({ chatChannels: ['c1'], membersBroadcasts: 'management_only' }), chs), false);
  assert.equal(isMuted(m, notify({ chatChannels: ['c1'], mutedMembers: ['a1'] }), chs), true);
});

test('postable channels are the canPost ones', () => {
  const list = [channel('a', { canPost: true }), channel('b'), channel('c', { canPost: true, conversation: true })];
  assert.deepEqual(postableChannels(list).map(c => c.channelId), ['a']); // a chat channel is written to in its chat view
});

test('target picker only for celebration and condolence', () => {
  assert.equal(needsTarget('celebration'), true);
  assert.equal(needsTarget('condolence'), true);
  assert.equal(needsTarget('weekly'), false);
  assert.equal(needsTarget('event'), false);
});

test('chat needs a body or an image', () => {
  assert.equal(canSendChat('', false), false);
  assert.equal(canSendChat('   \n', false), false);
  assert.equal(canSendChat('שלום', false), true);
  assert.equal(canSendChat('', true), true);
  assert.equal(canSendChat('א'.repeat(1001), false), false);
  assert.equal(canSendChat('😀'.repeat(1000), false), true); // code points, not UTF-16 units
});

test('compose can publish with a title, a channel and (when needed) a target', () => {
  const ok = { type: 'weekly' as const, channelId: 'a', title: 'כותרת', body: '', targetMemberId: null };
  assert.equal(canPublish(ok), true);
  assert.equal(canPublish({ ...ok, title: '  ' }), false);
  assert.equal(canPublish({ ...ok, channelId: null }), false);
  assert.equal(canPublish({ ...ok, title: 'א'.repeat(121) }), false);
  assert.equal(canPublish({ ...ok, body: 'א'.repeat(4001) }), false);
  assert.equal(canPublish({ ...ok, type: 'celebration' }), false);
  assert.equal(canPublish({ ...ok, type: 'celebration', targetMemberId: 'u2' }), true);
});

test('postBody drops the target for other types and empty optional fields', () => {
  assert.deepEqual(postBody({ type: 'weekly', channelId: 'a', title: ' כותרת ', body: '', targetMemberId: 'u2' }, undefined),
    { channelId: 'a', type: 'weekly', title: 'כותרת' });
  assert.deepEqual(postBody({ type: 'condolence', channelId: 'a', title: 't', body: 'b', targetMemberId: 'u2' }, 'U1'),
    { channelId: 'a', type: 'condolence', title: 't', body: 'b', targetMemberId: 'u2', imageUploadId: 'U1' });
});

test('a message of an unknown channel is muted and hidden (fail closed)', () => {
  const feed = feedFromMessages([msg('01A', { channelId: 'gone' }), msg('01B', { channelId: 'c1' })]);
  assert.equal(isMuted(msg('01A', { channelId: 'gone' }), notify(), channels), true);
  assert.deepEqual(visibleList(feed, { mode: 'mine', notify: notify(), channels }).map(m => m.messageId), ['01B']);
  assert.deepEqual(visibleList(feed, { mode: 'all', notify: notify(), channels }).map(m => m.messageId), ['01B']);
  assert.equal(unreadCount(feed, notify(), channels), 1);
});

test('postBody sends the family with its adult for a blessing, and neither for other types', () => {
  const d = { channelId: 'a', title: 't', body: '', targetMemberId: 'u2', targetFamilyId: 'F1' };
  assert.deepEqual(postBody({ ...d, type: 'celebration' }, undefined), { channelId: 'a', type: 'celebration', title: 't', targetMemberId: 'u2', targetFamilyId: 'F1' });
  assert.deepEqual(postBody({ ...d, type: 'weekly' }, undefined), { channelId: 'a', type: 'weekly', title: 't' });
});

test('postBody adds templateId and fields only when a template is given', () => {
  const d = { type: 'event' as const, channelId: 'c', title: 'T', body: 'B', targetMemberId: null };
  const withTpl = postBody(d, undefined, { templateId: 'event', fields: { name: 'x' } });
  assert.equal(withTpl.templateId, 'event');
  assert.deepEqual(withTpl.fields, { name: 'x' });
  const without = postBody(d, undefined);
  assert.ok(!('templateId' in without));
  assert.ok(!('fields' in without));
});

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID-shaped id for a time in ms. */
const ulidAt = (ms: number, tail = 'AAAAAAAAAAAAAAAA'): string => {
  let n = ms; let out = '';
  for (let i = 0; i < 10; i++) { out = CROCK[n % 32] + out; n = Math.floor(n / 32); }
  return out + tail;
};

test('canUpdate: author, management, bereaved family adult; nobody else', () => {
  const cond = msg('m1', { type: 'condolence', authorId: 'u1', authorKind: 'member', targetFamilyId: 'f9' });
  const ev = msg('m2', { type: 'event', authorId: 'u1', authorKind: 'member', targetFamilyId: 'f9' });
  assert.equal(canUpdate(cond, 'u1', { role: 'member', familyId: 'f1' }), true);
  assert.equal(canUpdate(cond, 'u2', { role: 'gabbai', familyId: 'f1' }), true);
  assert.equal(canUpdate(cond, 'u2', { role: 'tech', familyId: null }), true);
  assert.equal(canUpdate(cond, 'u3', { role: 'member', familyId: 'f9' }), true);
  assert.equal(canUpdate(cond, 'u3', { role: 'member', familyId: 'f1' }), false);
  assert.equal(canUpdate(cond, 'u3', { role: 'member' }), false);
  assert.equal(canUpdate(ev, 'u3', { role: 'member', familyId: 'f9' }), false);
  assert.equal(canUpdate(cond, 'u3', { role: 'listener', familyId: 'f9' }), false);
  assert.equal(canUpdate(msg('m3', { type: 'general', authorId: 'u1' }), 'u1', { role: 'member' }), false);
  assert.equal(canUpdate(msg('m4', { type: 'event', authorId: 'u1' }), 'u1', { role: 'listener' }), false);
});

test('sortId is the bump id or the message id', () => {
  assert.equal(sortId(msg('m1')), 'm1');
  assert.equal(sortId(msg('m1', { bumpId: 'm9' })), 'm9');
});

test('eventChangeParts: time and place, old struck', () => {
  const m = msg('m1', { type: 'event', fields: { date: '2026-11-03', time: '21:00', place: 'בית הכנסת' }, changed: { time: '20:30', place: 'הספרייה' } });
  assert.deepEqual(eventChangeParts(m), [
    { text: 'בשעה ', struck: false }, { text: '20:30', struck: true }, { text: ' 21:00', struck: false },
    { text: ' · במקום ', struck: false }, { text: 'הספרייה', struck: true }, { text: ' בית הכנסת', struck: false },
  ]);
  assert.equal(eventChangeParts(msg('m1', { type: 'event', fields: { time: '21:00' } })), null);
  assert.equal(eventChangeParts(msg('m1', { type: 'condolence', changed: { time: '20:30' } })), null);
});

test('updatedLine only for a full condolence that was updated', () => {
  const at = Date.UTC(2026, 9, 28, 12, 30) / 1000;
  const id = ulidAt(Date.UTC(2026, 9, 28, 7, 12));
  const full = msg(id, { type: 'condolence', updatedAt: at, fields: { variant: 'full' } });
  assert.match(updatedLine(full, t, Date.UTC(2026, 9, 28, 14, 30))!, /^msg\.updatedLine\|time=\d\d:\d\d,first=09:12$/);
  assert.equal(updatedLine(msg(id, { type: 'condolence', updatedAt: at, fields: { variant: 'later' } }), t), null);
  assert.equal(updatedLine(msg(id, { type: 'condolence', fields: { variant: 'full' } }), t), null);
  assert.equal(updatedLine(msg(id, { type: 'event', updatedAt: at, fields: { variant: 'full' } }), t), null);
});

test('updatedMeta: updated for a condolence, changed for an event, time today else d.m', () => {
  const now = Date.UTC(2026, 9, 28, 14, 30);
  const today = Math.floor(Date.UTC(2026, 9, 28, 11, 30) / 1000); // 13:30 Israel (UTC+2 in late Oct 2026? DST ends 25 Oct)
  const old = Math.floor(Date.UTC(2026, 9, 20, 11, 30) / 1000);
  assert.equal(updatedMeta(msg('m1', { type: 'condolence', updatedAt: today }), t, now), 'msg.updated|time=13:30');
  assert.equal(updatedMeta(msg('m1', { type: 'event', updatedAt: today }), t, now), 'msg.changed|time=13:30');
  assert.equal(updatedMeta(msg('m1', { type: 'condolence', updatedAt: old }), t, now), 'msg.updated|time=20.10');
  assert.equal(updatedMeta(msg('m1', { type: 'condolence' }), t, now), null);
  assert.equal(updatedMeta(msg('m1', { type: 'weekly', updatedAt: today }), t, now), null);
});

test('groupByDay puts a bumped message under the bump day', () => {
  const old = ulidAt(Date.UTC(2026, 9, 20, 9, 0));
  const mid = ulidAt(Date.UTC(2026, 9, 25, 9, 0));
  const bump = ulidAt(Date.UTC(2026, 9, 28, 9, 0));
  const g = groupByDay([msg(old, { bumpId: bump }), msg(mid)]);
  assert.deepEqual(g.map(x => x.day), ['2026-10-28', '2026-10-25']);
  assert.equal(g[0]!.items[0]!.messageId, old);
});
