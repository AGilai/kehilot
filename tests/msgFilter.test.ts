import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearFilters, facetRows, mutedCount, normalizeTypes, rowDisabled, showLabel, showMutedKey, showMutedFromStored, showMutedToStored, toggleType, typeCounts, typeSummary } from '../src/client/msgFilter.ts';
import type { Channel, Message, MessageType, NotifyPrefs } from '../src/client/types.ts';

// All names are invented.
const notify = (over: Partial<NotifyPrefs> = {}): NotifyPrefs => ({ mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [], ...over });
const channel = (id: string): Channel => ({ channelId: id, name: id, listenersCanRead: true, postPolicy: 'management', canPost: false, inAudience: true, conversation: false, chatHourlyLimit: 0, isAdmin: false });
const msg = (id: string, type: MessageType, over: Partial<Message> = {}): Message =>
  ({ messageId: id, channelId: 'c1', type, title: 'כותרת', body: 'גוף', authorId: 'a1', authorName: 'יוסי לדוגמה', authorKind: 'management', joinCount: 0, ...over });
const channels = [channel('c1'), channel('c2')];
const t = (key: string, p?: Record<string, string | number>) => ({
  'messages.type.summary': `סוג: ${p?.list}`, 'messages.type.more': `${p?.first} ועוד ${p?.n}`,
}[key] ?? key);
const label = (x: string) => ({ general: 'הודעה', weekly: 'שבועי', event: 'אירוע', celebration: 'מזל טוב', condolence: 'השתתפות בצער' }[x] ?? x);

test('summary: up to two names within 22 characters, else first + "ועוד n"', () => {
  assert.equal(typeSummary(['event'], label, t), 'אירוע');
  assert.equal(typeSummary(['event', 'celebration'], label, t), 'אירוע, מזל טוב');
  assert.equal(typeSummary(['general', 'weekly', 'event'], label, t), 'הודעה ועוד 2');
  assert.equal(typeSummary(['celebration', 'condolence'], label, t), 'מזל טוב, השתתפות בצער'); // 21 characters
});
test('summary: exactly 22 characters fits, 23 does not', () => {
  const l = (x: string) => (x === 'general' ? 'א'.repeat(10) : 'ב'.repeat(10));
  assert.equal(typeSummary(['general', 'weekly'], l, t), `${'א'.repeat(10)}, ${'ב'.repeat(10)}`); // 22
  const l2 = (x: string) => (x === 'general' ? 'א'.repeat(10) : 'ב'.repeat(11));
  assert.equal(typeSummary(['general', 'weekly'], l2, t), `${'א'.repeat(10)} ועוד 1`); // 23
});
test('summary follows the fixed order, not the tap order', () => {
  assert.equal(typeSummary(['celebration', 'event'], label, t), 'אירוע, מזל טוב');
});

test('muted switch: remembered per user and Kehila, old "mine/all" values still read', () => {
  assert.equal(showMutedKey('u1', 'k1'), 'kehilot.filter.u1.k1');
  assert.equal(showMutedFromStored('all'), true);
  assert.equal(showMutedFromStored('mine'), false);
  assert.equal(showMutedFromStored(null), false);
  assert.equal(showMutedFromStored('junk'), false);
  assert.equal(showMutedToStored(true), 'all');
  assert.equal(showMutedToStored(false), 'mine');
});

const all5: MessageType[] = ['general', 'weekly', 'event', 'celebration', 'condolence'];
test('type selection: fixed order, collapses to "all" when everything is picked, drops hidden types', () => {
  assert.deepEqual(normalizeTypes(['event', 'general'], all5), ['general', 'event']);
  assert.deepEqual(normalizeTypes(all5, all5), []);
  assert.deepEqual(normalizeTypes(['celebration'], ['general', 'weekly', 'event']), []);
  assert.deepEqual(toggleType(['event'], 'general', all5), ['general', 'event']);
  assert.deepEqual(toggleType(['event', 'general'], 'event', all5), ['general']);
  const three: MessageType[] = ['general', 'weekly', 'event'];
  assert.deepEqual(toggleType(['general', 'weekly'], 'event', three), []);
});

test('counts: per type over the given rows, total is the sum of the type rows', () => {
  const rows = [msg('5', 'event'), msg('4', 'event'), msg('3', 'weekly'), msg('2', 'chat')];
  assert.deepEqual(typeCounts(rows, all5), { total: 3, byType: { general: 0, weekly: 1, event: 2, celebration: 0, condolence: 0 } });
});

test('rows with 0 are disabled unless already selected', () => {
  assert.equal(rowDisabled(0, false), true);
  assert.equal(rowDisabled(0, true), false);
  assert.equal(rowDisabled(3, false), false);
});

test('footer label: show n / show one / close', () => {
  assert.equal(showLabel(0), 'common.close');
  assert.equal(showLabel(1), 'messages.type.showOne');
  assert.equal(showLabel(8), 'messages.type.show');
});

test('clear filters: text, types and channel go; the muted switch stays', () => {
  assert.deepEqual(clearFilters({ text: 'שבת', types: ['event'], channelId: 'c1', showMuted: true }), { text: '', types: [], channelId: null, showMuted: true });
  assert.deepEqual(clearFilters({ text: '', types: [], channelId: null, showMuted: false }), { text: '', types: [], channelId: null, showMuted: false });
});

const rows = [
  msg('9', 'event', { title: 'שיעור חדש' }),
  msg('8', 'event', { channelId: 'c2', title: 'שיעור ערב' }),
  msg('7', 'weekly', { title: 'שיעור שבועי' }),
  msg('6', 'weekly', { title: 'סעודה' }),
  msg('5', 'general', { channelId: 'c2', title: 'שיעור כללי' }),
];
const n = notify({ mutedChannels: ['c2'] });

test('facets: mode AND channel AND text, ignoring types (muted off drops muted)', () => {
  const f = { text: '', channelId: null, showMuted: false, notify: n, channels };
  assert.deepEqual(facetRows(rows, f).map(m => m.messageId), ['9', '7', '6']);
  assert.deepEqual(facetRows(rows, { ...f, showMuted: true }).map(m => m.messageId), ['9', '8', '7', '6', '5']);
  assert.deepEqual(facetRows(rows, { ...f, showMuted: true, text: 'שיעור' }).map(m => m.messageId), ['9', '8', '7', '5']);
  assert.deepEqual(facetRows(rows, { ...f, showMuted: true, channelId: 'c2' }).map(m => m.messageId), ['8', '5']);
});
test('counts follow search, channel and the muted switch but not the selected types', () => {
  const f = { text: 'שיעור', channelId: null, showMuted: false, notify: n, channels };
  assert.equal(typeCounts(facetRows(rows, f), all5).byType.event, 1);
  assert.equal(typeCounts(facetRows(rows, { ...f, showMuted: true }), all5).byType.event, 2);
});

test('muted count: muted rows that match channel, text and (optionally) types', () => {
  const f = { text: '', channelId: null, showMuted: false, notify: n, channels };
  assert.equal(mutedCount(rows, f, []), 2);
  assert.equal(mutedCount(rows, f, ['event']), 1);
  assert.equal(mutedCount(rows, { ...f, text: 'כללי' }, []), 1);
  assert.equal(mutedCount(rows, { ...f, channelId: 'c1' }, []), 0);
});

// Messages merge / visibility path: feed + archive.
import { archiveBase } from '../src/client/msgFilter.ts';
import { feedFromMessages, applyChanges } from '../src/client/feed.ts';
import type { CachedMessage } from '../src/search/cache.ts';

const cached = (id: string, over: Partial<CachedMessage> = {}): CachedMessage =>
  ({ messageId: id, channelId: 'c1', type: 'weekly', title: 'ישן', body: '', authorName: 'דנה', authorId: 'a1', authorKind: 'management', hasImage: false, norm: 'ישן דנה', ...over });

test('archive rows older than the feed are read (no unread dot) and the feed wins on duplicates', () => {
  const feed = feedFromMessages([msg('05', 'weekly', { read: false })]);
  const rows = archiveBase(feed, [cached('05', { title: 'עותק' }), cached('01')], notify(), channels);
  assert.deepEqual(rows.map(m => m.messageId), ['05', '01']);
  assert.equal(rows[0]!.read, false);
  assert.equal(rows[1]!.read, true);
});
test('mute rules apply to archive rows: muted member, management-only broadcasts, muted channel and type', () => {
  const feed = feedFromMessages([]);
  const a = [cached('04', { authorKind: 'member', authorId: 'm1' }), cached('03', { authorKind: 'member', authorId: 'm2' }), cached('02', { type: 'event' }), cached('01', { channelId: 'c2' })];
  const f = { text: '', channelId: null, showMuted: false, channels };
  const ids = (n: NotifyPrefs) => facetRows(archiveBase(feed, a, n, channels), { ...f, notify: n }).map(m => m.messageId);
  assert.deepEqual(ids(notify()), ['04', '03', '02', '01']);
  assert.deepEqual(ids(notify({ mutedMembers: ['m1'] })), ['03', '02', '01']);
  assert.deepEqual(ids(notify({ membersBroadcasts: 'management_only' })), ['02', '01']);
  assert.deepEqual(ids(notify({ mutedTypes: ['event'], mutedChannels: ['c2'] })), ['04', '03']);
  const n = notify({ mutedMembers: ['m1'] });
  assert.equal(mutedCount(archiveBase(feed, a, n, channels), { ...f, notify: n }, []), 1);
});
test('archive rows from channels the person can no longer read are left out', () => {
  assert.deepEqual(archiveBase(feedFromMessages([]), [cached('01', { channelId: 'gone' })], notify(), channels), []);
});
test('a deleted message leaves the list once the archive no longer holds it', () => {
  let feed = feedFromMessages([msg('05', 'weekly')]);
  feed = applyChanges(feed, [{ kind: 'message_removed', id: '05', item: { id: '05' } }]);
  assert.deepEqual(archiveBase(feed, [cached('01')], notify(), channels).map(m => m.messageId), ['01']);
  assert.deepEqual(archiveBase(feed, [cached('01'), cached('05')], notify(), channels).map(m => m.messageId), ['05', '01']); // stale archive: why the cache must drop it
});
