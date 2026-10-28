import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeTypes, refusalBanner, filterMessages, filterTypeChips, fromCached, mergeArchive, metaLine, showChannelChips, typeRuleBody, TYPE_ORDER } from '../src/client/typesView.ts';
import type { Channel, Message, MessageType } from '../src/client/types.ts';
import type { CachedMessage } from '../src/search/cache.ts';

const msg = (id: string, type: MessageType, title: string, body = '', channelId = 'c1'): Message =>
  ({ messageId: id, channelId, type, title, body, authorId: 'a', authorName: 'יוסי לדוגמה', authorKind: 'management', joinCount: 0 });
const list = [
  msg('05', 'celebration', 'מזל טוב לבית בדיוני', 'שמחה בשבת'),
  msg('04', 'condolence', 'השתתפות בצער', 'יהי זכרו ברוך'),
  msg('03', 'weekly', 'שַׁבָּת שלום', 'Kabbalat Shabbat at the usual time'),
  msg('02', 'general', 'שיעור חדש', 'שמחה גדולה'),
  msg('01', 'event', 'אירוע לילד', 'dinner'),
];
const ids = (l: Message[]) => l.map(m => m.messageId);

test('no text and no types keeps everything', () => {
  assert.deepEqual(ids(filterMessages(list, { text: '', types: [] })), ['05', '04', '03', '02', '01']);
  assert.deepEqual(ids(filterMessages(list, { text: '   ', types: [] })), ['05', '04', '03', '02', '01']);
});
test('types are OR-ed within the selection', () => {
  assert.deepEqual(ids(filterMessages(list, { text: '', types: ['celebration', 'condolence'] })), ['05', '04']);
});
test('text AND types', () => {
  assert.deepEqual(ids(filterMessages(list, { text: 'שמחה', types: [] })), ['05', '02']);
  assert.deepEqual(ids(filterMessages(list, { text: 'שמחה', types: ['general'] })), ['02']);
  assert.deepEqual(ids(filterMessages(list, { text: 'שמחה', types: ['weekly'] })), []);
});
test('text ignores niqqud, case and final letters; English works; every word must occur', () => {
  assert.deepEqual(ids(filterMessages(list, { text: 'שבת', types: [] })), ['05', '03']);
  assert.deepEqual(ids(filterMessages(list, { text: 'kabbalat SHABBAT', types: [] })), ['03']);
  assert.deepEqual(ids(filterMessages(list, { text: 'שבת kabbalat', types: ['weekly'] })), ['03']);
  assert.deepEqual(ids(filterMessages(list, { text: 'שבת dinner', types: [] })), []);
  assert.deepEqual(ids(filterMessages(list, { text: 'יוסי', types: ['event'] })), ['01']); // author name
});

const ch = (id: string, over: Partial<Channel> = {}): Channel => ({ channelId: id, name: id, listenersCanRead: true, postPolicy: 'broadcasters', canPost: true, inAudience: true, conversation: false, chatHourlyLimit: 0, isAdmin: false, postableTypes: [], ...over });

test('compose lists postableTypes in the fixed order, never chat', () => {
  assert.deepEqual(composeTypes(ch('c', { postableTypes: ['condolence', 'general', 'celebration'] })), ['general', 'celebration', 'condolence']);
  assert.deepEqual(composeTypes(ch('c', { postableTypes: ['chat', 'weekly'] })), ['weekly']);
  assert.deepEqual(composeTypes(ch('c', { postableTypes: ['event', 'weekly', 'general', 'celebration', 'condolence'] })), [...TYPE_ORDER]);
  assert.deepEqual(composeTypes(ch('c')), []);
  assert.deepEqual(composeTypes(undefined), []);
  assert.deepEqual(composeTypes(ch('c', { postableTypes: ['general', 'nonsense' as MessageType] })), ['general']);
});

test('channel chip row only with more than one channel', () => {
  assert.equal(showChannelChips([]), false);
  assert.equal(showChannelChips([ch('a')]), false);
  assert.equal(showChannelChips([ch('a'), ch('b')]), true);
});

test('meta line: type and time, channel in the middle only with several channels', () => {
  assert.equal(metaLine('מזל טוב', '14:50', null), 'מזל טוב · 14:50');
  assert.equal(metaLine('הודעה', '14:50', 'נוער'), 'הודעה · נוער · 14:50');
});

test('type chips: members see all five; a listener only sees the hidden pair when such a message exists', () => {
  assert.deepEqual(filterTypeChips('member', list), [...TYPE_ORDER]);
  assert.deepEqual(filterTypeChips('gabbai', []), [...TYPE_ORDER]);
  assert.deepEqual(filterTypeChips('listener', []), ['general', 'weekly', 'event']);
  assert.deepEqual(filterTypeChips('listener', [msg('1', 'condolence', 'x')]), ['general', 'weekly', 'event', 'condolence']);
});

test('settings form to body: one rule per call, both keys always present', () => {
  const rules = { celebration: { post: 'broadcasters' as const, listeners: false }, condolence: { post: 'broadcasters' as const, listeners: false } };
  assert.deepEqual(typeRuleBody(rules, 'celebration', { post: 'management' }), { typeRules: { celebration: { post: 'management', listeners: false } } });
  assert.deepEqual(typeRuleBody(rules, 'condolence', { listeners: true }), { typeRules: { condolence: { post: 'broadcasters', listeners: true } } });
  assert.deepEqual(typeRuleBody(undefined, 'condolence', { listeners: true }), { typeRules: { condolence: { post: 'broadcasters', listeners: true } } });
});

test('archive hits older than the feed join the list, newest first, without duplicates', () => {
  const c = (id: string): CachedMessage => ({ messageId: id, channelId: 'c1', type: 'weekly', title: 't' + id, body: '', authorName: 'א', authorId: 'a1', authorKind: 'management', hasImage: false, norm: 't' });
  const merged = mergeArchive(list.slice(0, 2), [c('04'), c('00'), c('03')]);
  assert.deepEqual(ids(merged), ['05', '04', '03', '00']);
  assert.equal(fromCached(c('00')).title, 't00');
});

test('refused banner: offers a regular message only when it is still postable and not already chosen', () => {
  assert.deepEqual(refusalBanner(['general', 'celebration'], 'celebration'), { text: 'refused', asGeneral: true });
  assert.deepEqual(refusalBanner(['general'], 'general'), { text: 'refused', asGeneral: false });
  assert.deepEqual(refusalBanner(['weekly'], 'weekly'), { text: 'refused', asGeneral: false });
  assert.deepEqual(refusalBanner([], 'celebration'), { text: 'refusedAll', asGeneral: false });
});
