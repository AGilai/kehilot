import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore } from '../src/client/store.ts';
import { memoryStore } from '../src/search/cache.ts';
import type { Channel, Kehila, Message } from '../src/client/types.ts';

const ch = (id: string): Channel => ({ channelId: id, name: id, listenersCanRead: true, postPolicy: 'management', canPost: false, inAudience: true, conversation: false, chatHourlyLimit: 0, isAdmin: false });
const msg = (id: string, channelId: string, title: string): Message =>
  ({ messageId: id, channelId, type: 'weekly', title, body: '', authorId: 'a', authorName: 'יוסי לדוגמה', authorKind: 'management', joinCount: 0 });
const idle = async () => { await new Promise(r => setTimeout(r, 20)); };

function setup(over: { kehilot?: string[] } = {}) {
  const state = { channels: ['c1'], changes: [] as any[], resync: false, history: [msg('01H0000000000000000000000A', 'c1', 'שיעור ישן'), msg('01H0000000000000000000000B', 'c1', 'שיעור חדש')] };
  const me = { userId: 'u1', email: 'dana@example.invalid', profile: { firstName: 'ד', lastName: '', lang: 'he' as const }, kehilot: (over.kehilot ?? ['k1']).map(kehilaId => ({ kehilaId, name: kehilaId, role: 'member' as const, logoVersion: null })) };
  const api = {
    me: async () => me,
    kehila: async (k: string) => ({ kehilaId: k, name: k, settings: { pollSeconds: 3600 } }) as Kehila,
    channels: async () => state.channels.map(ch),
    changes: async () => (state.resync ? (state.resync = false, { resync: true as const }) : { cursor: 'c', more: false, changes: state.changes.splice(0) }),
    messages: async (_k: string, o: { before?: string }) => (o.before ? [] : state.history),
    postMessage: async (_k: string, b: { channelId: string; title?: string; body?: string }) => ({ ...msg('01H0000000000000000000000D', b.channelId, b.title ?? ''), body: b.body ?? '' }),
  } as any;
  const cacheStore = memoryStore();
  const store = createStore(api, { get: async () => null, set: async () => {}, remove: async () => {} }, { cacheStore, isActive: () => true });
  return { state, store, cacheStore, me };
}
const titles = async (store: ReturnType<typeof setup>['store']) => (await store.search('שיעור', {})).map(m => m.title);

test('selecting a Kehila backfills the cache and feed changes keep it current', async () => {
  const { store, state } = setup();
  await store.start(); await idle();
  assert.deepEqual(await titles(store), ['שיעור חדש', 'שיעור ישן']);
  assert.equal((await store.cacheStatus()).complete, true);
  state.changes.push({ kind: 'message', id: 'x', item: msg('01H0000000000000000000000C', 'c1', 'שיעור שלישי') });
  state.changes.push({ kind: 'reply', id: 'r', item: { replyId: 'r1', messageId: '01H0000000000000000000000B', authorId: 'z', authorName: 'ז', body: 'ברכה סודית', createdAt: '' } });
  await store.pollNow(); await idle();
  assert.equal((await titles(store))[0], 'שיעור שלישי');
  state.changes.push({ kind: 'message_removed', id: 'x', item: { id: '01H0000000000000000000000A' } });
  await store.pollNow(); await idle();
  assert.deepEqual(await titles(store), ['שיעור שלישי', 'שיעור חדש']);
  assert.equal((await store.search('סודית', {})).length, 0);
  store.reset();
});

test('a changed readable channel set on focus wipes the cache and refills it', async () => {
  const { store, state, cacheStore } = setup();
  await store.start(); await idle();
  state.history = [msg('01H0000000000000000000000B', 'c1', 'שיעור חדש')];
  state.channels = ['c1', 'c2']; // admitted to a group
  await store.refreshChannels(); await idle();
  assert.deepEqual(await titles(store), ['שיעור חדש']); // wiped, then refilled from the server
  assert.ok(![...cacheStore.data.values()].some(v => v.includes('שיעור ישן')));
  state.channels = ['c1']; // removed again: the cache is wiped for the removal too
  state.history = [];
  await store.refreshChannels(); await idle();
  assert.deepEqual(await titles(store), []);
  store.reset();
});

test('resync wipes the cache and refills it', async () => {
  const { store, state } = setup();
  await store.start(); await idle();
  state.history = [msg('01H0000000000000000000000B', 'c1', 'שיעור חדש')];
  state.resync = true;
  await store.pollNow(); await idle(); await idle();
  assert.deepEqual(await titles(store), ['שיעור חדש']);
  store.reset();
});

test('a Kehila missing from me() is wiped from the cache', async () => {
  const { store, cacheStore, me } = setup({ kehilot: ['k1', 'k2'] });
  await store.start(); // switcher: no selection yet
  await store.selectKehila('k1'); await idle();
  assert.ok([...cacheStore.data.keys()].some(k => k.startsWith('u1/k1/')));
  me.kehilot = me.kehilot.filter(x => x.kehilaId !== 'k1');
  await store.loadMe(); await idle();
  assert.ok(![...cacheStore.data.keys()].some(k => k.startsWith('u1/k1/')));
  store.reset();
});

test('results and offline copies only come from channels the user can read now', async () => {
  const { store, state } = setup();
  await store.start(); await idle();
  assert.equal((await titles(store)).length, 2);
  assert.equal((await store.cachedMessage('01H0000000000000000000000B'))?.title, 'שיעור חדש');
  state.channels = []; // lost every channel; ensureChannels has not run yet
  state.history = [];
  const api = (store as any);
  void api;
  // channels(k) answers, state.channels is updated, but the cache is not yet wiped: the filter hides hits at once.
  await store.refreshChannels();
  assert.deepEqual(await titles(store), []);
  assert.equal(await store.cachedMessage('01H0000000000000000000000B'), null);
  store.reset();
});

test('a message the user posts is applied to the feed and the cache at once', async () => {
  const { store } = setup();
  await store.start(); await idle();
  const m = await store.postMessage({ channelId: 'c1', type: 'weekly', title: 'שיעור שפורסם עכשיו' });
  assert.equal(store.getState().feed.order[0], m.messageId);
  await idle();
  assert.deepEqual((await store.search('שפורסם', {})).map(x => x.title), ['שיעור שפורסם עכשיו']);
  await store.postMessage({ channelId: 'c1', type: 'weekly', title: 'שיעור שפורסם עכשיו' }); // the poll bringing it again changes nothing
  assert.equal(store.getState().feed.order.filter(id => id === m.messageId).length, 1);
  store.reset();
});
