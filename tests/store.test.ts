import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore } from '../src/client/store.ts';
import { createPendingInvite } from '../src/client/links.ts';
import { createLogoCache } from '../src/client/logoCache.ts';
import type { KeyValue } from '../src/auth/tokens.ts';
import type { Kehila, KehilaSummary, Me } from '../src/client/types.ts';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    remove: async (k) => { data.delete(k); },
  };
}
const summary = (id: string): KehilaSummary => ({ kehilaId: id, name: `קהילת ${id}`, role: 'member', logoVersion: null });
const meOf = (ids: string[], profile: Me['profile'] = { firstName: 'דנה', lastName: 'בדויה', lang: 'he' }): Me =>
  ({ userId: 'u1', email: 'dana@example.invalid', profile, kehilot: ids.map(summary), age13Required: false });
const kehilaOf = (id: string) => ({ kehilaId: id, name: `קהילת ${id}` }) as Kehila;

function fakeApi(me: Me, over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const api = {
    me: async () => me,
    kehila: async (k: string) => { calls.push(`kehila:${k}`); return kehilaOf(k); },
    channels: async (k: string) => { calls.push(`channels:${k}`); return []; },
    putProfile: async (p: { firstName: string; lastName?: string; lang: 'he' | 'en' }) => ({ firstName: p.firstName, lastName: p.lastName ?? '', lang: p.lang }),
    logo: async (k: string) => { calls.push(`logo:${k}`); return { logoVersion: 'v1', contentType: 'image/png' as const, data: 'QUJD' }; },
    ...over,
  };
  return { api: api as any, calls };
}

test('profile null routes to setup', async () => {
  const { api, calls } = fakeApi(meOf(['k1'], null));
  const store = createStore(api, memory());
  assert.equal(await store.start(), 'setup');
  assert.equal(store.getState().kehilaId, null);
  assert.deepEqual(calls, []);
  assert.equal(await store.saveProfile({ firstName: 'דנה', lastName: '', lang: 'en' }), 'ready');
  assert.equal(store.getState().me?.profile?.lang, 'en');
});

test('single kehila is selected automatically', async () => {
  const { api } = fakeApi(meOf(['k1']));
  const store = createStore(api, memory());
  assert.equal(await store.start(), 'ready');
  const s = store.getState();
  assert.equal(s.kehilaId, 'k1');
  assert.equal(s.kehila?.kehilaId, 'k1');
  assert.deepEqual(s.channels, []);
});

test('no kehilot routes to none; several without a last choice route to the switcher', async () => {
  assert.equal(await createStore(fakeApi(meOf([])).api, memory()).start(), 'none');
  assert.equal(await createStore(fakeApi(meOf(['k1', 'k2'])).api, memory()).start(), 'switcher');
});

test('last selection is restored per user', async () => {
  const storage = memory();
  const { api } = fakeApi(meOf(['k1', 'k2', 'k3']));
  const first = createStore(api, storage);
  await first.start();
  await first.selectKehila('k2');
  assert.equal(storage.data.get('kehilot.lastKehila.u1'), 'k2');
  const second = createStore(api, storage);
  assert.equal(await second.start(), 'ready');
  assert.equal(second.getState().kehilaId, 'k2');
  // another user does not inherit it, and a Kehila the user left is ignored
  const other = createStore(fakeApi({ ...meOf(['k1', 'k2']), userId: 'u2' }).api, storage);
  assert.equal(await other.start(), 'switcher');
  storage.data.set('kehilot.lastKehila.u1', 'gone');
  assert.equal(await createStore(api, storage).start(), 'switcher');
});

test('signOut clears the store and drops late responses', async () => {
  const storage = memory();
  let release!: (k: Kehila) => void;
  const { api } = fakeApi(meOf(['k1', 'k2']), { kehila: () => new Promise<Kehila>(r => { release = r; }) });
  const store = createStore(api, storage);
  await store.loadMe();
  const gen = store.getState().generation;
  const pending = store.selectKehila('k1');
  store.reset();
  assert.equal(store.guard(gen), false);
  release(kehilaOf('k1'));
  await pending;
  const s = store.getState();
  assert.equal(s.generation, gen + 1);
  assert.equal(s.me, null);
  assert.equal(s.kehilaId, null);
  assert.equal(s.kehila, null);
  assert.deepEqual(s.channels, []);
  assert.equal(storage.data.size, 0);
});

test('logo fetched only when logoVersion changes', async () => {
  const storage = memory();
  const { api, calls } = fakeApi(meOf(['k1']));
  const logos = createLogoCache(storage);
  assert.equal(await logos.get(api, 'k1', null), null);
  assert.deepEqual(calls, []);
  assert.equal(await logos.get(api, 'k1', 'v1'), 'data:image/png;base64,QUJD');
  assert.equal(await logos.get(api, 'k1', 'v1'), 'data:image/png;base64,QUJD');
  assert.deepEqual(calls, ['logo:k1']);
  assert.deepEqual(JSON.parse(storage.data.get('kehilot.logo.k1')!), { v: 'v1', data: 'data:image/png;base64,QUJD' });
  await logos.get(api, 'k1', 'v2');
  assert.deepEqual(calls, ['logo:k1', 'logo:k1']);
  // a failed fetch keeps the initial-letter tile
  const failing = fakeApi(meOf(['k1']), { logo: async () => { throw new Error('x'); } }).api;
  assert.equal(await createLogoCache(memory()).get(failing, 'k9', 'v1'), null);
});

test('logo lookups are memoised in memory, failures included', async () => {
  const storage = memory();
  let storageCalls = 0;
  const counted: KeyValue = { get: async k => { storageCalls++; return storage.get(k); }, set: (k, v) => storage.set(k, v), remove: k => storage.remove(k) };
  const { api, calls } = fakeApi(meOf(['k1']));
  const logos = createLogoCache(counted);
  await logos.get(api, 'k1', 'v1');
  const before = storageCalls;
  assert.equal(await logos.get(api, 'k1', 'v1'), 'data:image/png;base64,QUJD');
  assert.equal(storageCalls, before);
  assert.deepEqual(calls, ['logo:k1']);
  let tries = 0;
  const failing = fakeApi(meOf(['k1']), { logo: async () => { tries++; throw new Error('x'); } }).api;
  assert.equal(await logos.get(failing, 'k2', 'v1'), null);
  assert.equal(await logos.get(failing, 'k2', 'v1'), null);
  assert.equal(tries, 1);
});

test('selectKehila starts one poller; switching and reset stop it', async () => {
  const timers = new Set<number>(); let id = 0;
  const sleep = (_ms: number, signal: AbortSignal) => new Promise<void>(res => { const t = ++id; timers.add(t); signal.addEventListener('abort', () => { timers.delete(t); res(); }); });
  const seen: string[] = [];
  const { api } = fakeApi(meOf(['k1', 'k2']), {
    kehila: async (k: string) => ({ ...kehilaOf(k), settings: { pollSeconds: 5 } }),
    changes: async (k: string, since?: string) => { seen.push(`${k}:${since ?? ''}`); return { cursor: 'C', more: false, changes: [] }; },
    messages: async (k: string) => [{ messageId: `M-${k}` }],
  });
  const store = createStore(api, memory(), { sleep });
  await store.start();
  await store.selectKehila('k1');
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.deepEqual(store.getState().feed.order, ['M-k1']);
  assert.equal(store.getState().feed.loaded, true);
  await store.selectKehila('k2');
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.deepEqual(store.getState().feed.order, ['M-k2']);
  assert.equal(timers.size, 1);
  store.reset();
  assert.equal(timers.size, 0);
  assert.deepEqual(store.getState().feed, { messages: {}, order: [], replies: {}, loaded: false });
});

test('feed.loaded stays false while the initial load fails', async () => {
  const sleep = (_ms: number, signal: AbortSignal) => new Promise<void>(res => signal.addEventListener('abort', () => res()));
  const { api } = fakeApi(meOf(['k1']), {
    changes: async () => ({ cursor: 'C', more: false, changes: [] }),
    messages: async () => { throw new Error('down'); },
  });
  const store = createStore(api, memory(), { sleep });
  await store.start();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(store.getState().feed.loaded, false);
  store.reset();
});

test('reply posted is appended at once, kept in memory only, deduplicated; markRead is local first', async () => {
  const reply = { replyId: 'r1', authorId: 'u1', authorName: 'דנה בדויה', body: 'מזל טוב', createdAt: 1793008800, to: 'family' };
  const msg = { messageId: 'M1', channelId: 'c1', type: 'celebration', title: 't', body: 'b', authorId: 'a', authorName: 'x', authorKind: 'management', joinCount: 0, targetMemberId: 'u9' };
  const reads: string[] = [];
  const { api } = fakeApi(meOf(['k1']), {
    changes: async () => ({ cursor: 'c', more: false, changes: [] }),
    messages: async () => [msg],
    postReply: async () => reply,
    markRead: async (_k: string, m: string) => { reads.push(m); },
  });
  const storage = memory();
  const store = createStore(api, storage, { isActive: () => false });
  await store.start();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(store.getState().feed.loaded, true);
  await store.sendReply('M1', 'מזל טוב');
  await store.sendReply('M1', 'מזל טוב'); // the same reply arriving again
  assert.deepEqual(store.getState().feed.replies.M1, [reply]);
  await store.markRead('M1');
  assert.equal(store.getState().feed.messages.M1!.read, true);
  assert.deepEqual(reads, ['M1']);
  await store.markRead('M1');
  assert.deepEqual(reads, ['M1']);
  assert.ok(![...storage.data.values()].some(v => v.includes('מזל טוב')), 'reply text must not be stored');
  store.reset();
});

const replyMsg = { messageId: 'M1', channelId: 'c1', type: 'celebration', title: 't', body: 'b', authorId: 'a', authorName: 'x', authorKind: 'management', joinCount: 0, targetMemberId: 'u9', replyTo: 'family', canReply: true };
const mkReply = (id: string, body: string, over: Record<string, unknown> = {}) => ({ replyId: id, authorId: 'u1', authorName: 'דנה בדויה', body, createdAt: 1793008800, to: 'family', ...over });

test('editReply and deleteReply update the feed; loadReplies replaces a stale list', async () => {
  const calls: string[] = [];
  const { api } = fakeApi(meOf(['k1']), {
    changes: async () => ({ cursor: 'c', more: false, changes: [] }),
    messages: async () => [replyMsg],
    postReply: async (_k: string, m: string, body: string, to?: string) => { calls.push(`post:${m}:${body}:${to ?? ''}`); return mkReply('r1', body, { to: to ?? 'family' }); },
    putReply: async (_k: string, m: string, r: string, body: string) => { calls.push(`put:${m}:${r}`); return mkReply(r, body, { updatedAt: 1793009000 }); },
    deleteReply: async (_k: string, m: string, r: string) => { calls.push(`del:${m}:${r}`); },
    replies: async () => [mkReply('r2', 'חדש')],
  });
  const store = createStore(api, memory(), { isActive: () => false });
  await store.start();
  await new Promise(r => setTimeout(r, 20));
  await store.sendReply('M1', 'מזל טוב', 'u-yigal');
  assert.deepEqual(calls, ['post:M1:מזל טוב:u-yigal']);
  assert.equal(store.getState().feed.replies.M1![0]!.to, 'u-yigal');
  await store.editReply('M1', 'r1', 'מזל טוב מאוד');
  assert.deepEqual(store.getState().feed.replies.M1!.map(r => [r.replyId, r.body, r.updatedAt]), [['r1', 'מזל טוב מאוד', 1793009000]]);
  await store.loadReplies('M1'); // the server list is authoritative
  assert.deepEqual(store.getState().feed.replies.M1!.map(r => r.replyId), ['r2']);
  await store.sendReply('M1', 'עוד');
  await store.deleteReply('M1', 'r1');
  assert.deepEqual(store.getState().feed.replies.M1!.map(r => r.replyId), ['r2']);
  assert.ok(calls.includes('del:M1:r1'));
  store.reset();
});

const SECRET = 'טקסט סודי של תשובה';
const inboxOf = () => ({ unread: 1, threads: [{ message: { ...replyMsg, isRecipient: true }, total: 1, unread: 1, personal: 0, replies: [mkReply('r1', SECRET, { unread: true })] }] });

test('inbox is never persisted', async () => {
  const storage = memory();
  const written: string[] = [];
  const cacheData = new Map<string, string>();
  const spy = { get: async (k: string) => cacheData.get(k) ?? null, set: async (k: string, v: string) => { written.push(`${k}=${v}`); cacheData.set(k, v); }, remove: async (k: string) => { cacheData.delete(k); } };
  const { api } = fakeApi(meOf(['k1']), {
    kehila: async (k: string) => ({ kehilaId: k, name: 'k', role: 'member' }),
    changes: async () => ({ cursor: 'c', more: false, changes: [] }),
    messages: async () => [replyMsg],
    inbox: async () => inboxOf(),
    replies: async () => [mkReply('r1', SECRET)],
  });
  const store = createStore(api, storage, { isActive: () => false, cacheStore: spy as any });
  await store.start();
  await new Promise(r => setTimeout(r, 20));
  await store.loadReplies('M1');
  await store.loadInbox();
  assert.equal(store.getState().inbox?.threads[0]?.replies[0]?.body, SECRET);
  await new Promise(r => setTimeout(r, 20));
  for (const v of [...storage.data.entries(), ...written]) {
    assert.ok(!String(v).includes(SECRET), 'reply text must not be stored');
    assert.ok(!String(v).includes('threads'), 'the inbox must not be stored');
  }
  store.reset();
  assert.equal(store.getState().inbox, null);
});

function pagedStore(role: string, over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const pages: Array<{ cursor: string; more: boolean; changes: unknown[] }> = [];
  let first = true;
  const { api } = fakeApi(meOf(['k1']), {
    kehila: async (k: string) => ({ kehilaId: k, name: 'k', role }),
    changes: async (_k: string, since?: string) => (first || since === undefined ? (first = false, { cursor: 'C0', more: false, changes: [] }) : (pages.shift() ?? { cursor: 'C', more: false, changes: [] })),
    messages: async () => [replyMsg],
    inbox: async () => { calls.push('inbox'); return inboxOf(); },
    markRepliesRead: async (_k: string, m: string, upTo: string) => { calls.push(`seen:${m}:${upTo}`); },
    ...over,
  });
  const store = createStore(api, memory(), { isActive: () => true, sleep: (_ms, signal) => new Promise<void>(res => signal.addEventListener('abort', () => res())) });
  return { store, calls, pages };
}
const replyPage = (id: string) => ({ cursor: 'C', more: false, changes: [{ kind: 'reply', id, item: { ...mkReply(id, 'x'), messageId: 'M1' } }] });

test('a reply change reloads the inbox once, 2 s later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, calls, pages } = pagedStore('member');
  await store.start();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, []);
  pages.push(replyPage('r1'), { cursor: 'C', more: false, changes: [{ kind: 'reply_removed', id: 'r1', item: { id: 'r1', messageId: 'M1' } }] });
  await store.pollNow();
  await store.pollNow();
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1999);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['inbox']);
  assert.equal(store.getState().inbox?.unread, 1);
  t.mock.timers.tick(10000);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['inbox']);
  store.reset();
});

test('markRepliesSeen tells the server, then reloads the inbox', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, calls } = pagedStore('member');
  await store.start();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  await store.markRepliesSeen('M1', 'r9');
  assert.deepEqual(calls, ['seen:M1:r9']);
  t.mock.timers.tick(2000);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['seen:M1:r9', 'inbox']);
  store.reset();
});

test('a listener never loads the inbox', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, calls, pages } = pagedStore('listener');
  await store.start();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  pages.push(replyPage('r1'));
  await store.pollNow();
  await store.markRepliesSeen('M1', 'r1').catch(() => {});
  await store.loadInbox();
  t.mock.timers.tick(5000);
  await new Promise(r => setImmediate(r));
  assert.ok(!calls.includes('inbox'));
  assert.equal(store.getState().inbox, null);
  store.reset();
});

test('markRead keeps the message unread when the server call fails, so the next open retries', async () => {
  const msg = { messageId: 'M1', channelId: 'c1', type: 'weekly', title: 't', body: 'b', authorId: 'a', authorName: 'x', authorKind: 'management', joinCount: 0 };
  let fail = true; let calls = 0;
  const { api } = fakeApi(meOf(['k1']), {
    changes: async () => ({ cursor: 'c', more: false, changes: [] }),
    messages: async () => [msg],
    markRead: async () => { calls++; if (fail) throw new Error('down'); },
  });
  const store = createStore(api, memory(), { isActive: () => false });
  await store.start();
  await new Promise(r => setTimeout(r, 20));
  await store.markRead('M1');
  assert.equal(store.getState().feed.messages.M1!.read, undefined);
  fail = false;
  await store.markRead('M1');
  assert.equal(store.getState().feed.messages.M1!.read, true);
  assert.equal(calls, 2);
  store.reset();
});

test('setPhone and setShowPhone update me and the open Kehila', async () => {
  const sent: unknown[] = [];
  const { api } = fakeApi(meOf(['k1']), {
    kehila: async (k: string) => ({ ...kehilaOf(k), showPhone: false }),
    putPhone: async (phone: string | null) => { sent.push(phone); return { phone }; },
    putPhoneList: async (_k: string, show: boolean) => { sent.push(show); return { show }; },
  });
  const store = createStore(api, memory());
  await store.start();
  await store.setPhone('+972500000001');
  assert.equal(store.getState().me?.profile?.phone, '+972500000001');
  await store.setShowPhone(true);
  assert.equal(store.getState().kehila?.showPhone, true);
  await store.setPhone(null);
  assert.equal(store.getState().me?.profile?.phone, null);
  assert.deepEqual(sent, ['+972500000001', true, null]);
});

test('setShowPhone leaves the switch as it was when the server refuses', async () => {
  const { api } = fakeApi(meOf(['k1']), {
    kehila: async (k: string) => ({ ...kehilaOf(k), showPhone: false }),
    putPhoneList: async () => { throw new Error('x'); },
  });
  const store = createStore(api, memory());
  await store.start();
  await assert.rejects(store.setShowPhone(true));
  assert.equal(store.getState().kehila?.showPhone, false);
});

test('profile save records age13 before loading me', async () => {
  const order: string[] = [];
  let required = true;
  const { api } = fakeApi(meOf(['k1'], null), {
    me: async () => { order.push('me'); return { ...meOf(['k1'], null), age13Required: required }; },
    putProfile: async (p: { firstName: string; lang: 'he' | 'en' }) => { order.push('putProfile'); return { firstName: p.firstName, lastName: '', lang: p.lang }; },
    age13Consent: async () => { order.push('age13Consent'); required = false; },
  });
  const store = createStore(api, memory());
  assert.equal(await store.start(), 'setup');
  order.length = 0;
  assert.equal(await store.saveProfile({ firstName: 'דנה', lastName: '', lang: 'he' }, { age13: true }), 'ready');
  assert.deepEqual(order, ['putProfile', 'age13Consent', 'me']);
  assert.equal(store.getState().me?.age13Required, false);
  assert.ok(store.getState().me?.profile);
});

test('acceptAge13 reloads me', async () => {
  let required = true;
  const { api } = fakeApi(meOf(['k1']), {
    me: async () => ({ ...meOf(['k1']), age13Required: required }),
    age13Consent: async () => { required = false; },
  });
  const store = createStore(api, memory());
  await store.start();
  assert.equal(store.getState().me?.age13Required, true);
  await store.acceptAge13();
  assert.equal(store.getState().me?.age13Required, false);
  store.reset();
});

test('a stored invite waits behind the age gate and joins after acceptAge13', async () => {
  const storage = memory();
  const pending = createPendingInvite(storage, () => 1000);
  await pending.set('7K3M9Q2XPA');
  let required = true;
  let kehilot: KehilaSummary[] = [];
  const accepted: string[] = [];
  const { api } = fakeApi(meOf([]), {
    me: async () => ({ ...meOf([]), kehilot, age13Required: required }),
    age13Consent: async () => { required = false; },
    acceptInvite: async (c: string) => { accepted.push(c); kehilot = [summary('k1')]; return { kehilaId: 'k1', role: 'listener' }; },
  });
  const store = createStore(api, storage, { pending, isActive: () => false });
  await store.start();
  assert.deepEqual(accepted, []);
  assert.equal(store.getState().kehilaId, null);
  assert.equal(await store.acceptAge13(), 'ready');
  assert.deepEqual(accepted, ['7K3M9Q2XPA']);
  assert.equal(store.getState().kehilaId, 'k1');
  store.reset();
});
