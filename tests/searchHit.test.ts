import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiCodeError } from '../src/client/errors.ts';
import { resolveHit } from '../src/search/hit.ts';
import { createStore } from '../src/client/store.ts';
import { memoryStore } from '../src/search/cache.ts';
import type { Message } from '../src/client/types.ts';

const full = { messageId: 'M1', channelId: 'c1', type: 'celebration', title: 'מזל טוב', body: '', authorId: 'a', authorName: 'יוסי', authorKind: 'management', joinCount: 2 } as Message;
const copy = { messageId: 'M1', channelId: 'c1', type: 'celebration', title: 'מזל טוב', body: '', authorName: 'יוסי', authorId: 'a1', authorKind: 'management', hasImage: false, norm: '' } as const;

test('api.message resolves: the full message, not the offline copy', async () => {
  const removed: string[] = [];
  const r = await resolveHit('M1', { fetch: async () => full, cached: async () => copy, forget: async id => { removed.push(id); } });
  assert.deepEqual(r, { kind: 'full', message: full });
  assert.deepEqual(removed, []);
});

test('network error: the read-only offline copy; a server error too', async () => {
  const net = await resolveHit('M1', { fetch: async () => { throw new TypeError('network'); }, cached: async () => copy, forget: async () => {} });
  assert.deepEqual(net, { kind: 'copy', copy });
  const srv = await resolveHit('M1', { fetch: async () => { throw new ApiCodeError(503, 'unavailable'); }, cached: async () => copy, forget: async () => {} });
  assert.equal(srv.kind, 'copy');
  const none = await resolveHit('M1', { fetch: async () => { throw new TypeError('network'); }, cached: async () => null, forget: async () => {} });
  assert.equal(none.kind, 'notFound');
});

test('404: not found, and the id leaves the cache', async () => {
  const removed: string[] = [];
  const r = await resolveHit('M1', { fetch: async () => { throw new ApiCodeError(404, 'message_not_found'); }, cached: async () => copy, forget: async id => { removed.push(id); } });
  assert.equal(r.kind, 'notFound');
  assert.deepEqual(removed, ['M1']);
});

test('store.loadHit: fetched hit stays out of the feed; a 404 removes it from the cache', async () => {
  let mode: 'ok' | 'gone' = 'ok';
  const me = { userId: 'u1', email: 'x@example.invalid', profile: { firstName: 'ד', lastName: '', lang: 'he' as const }, kehilot: [{ kehilaId: 'k1', name: 'k1', role: 'member' as const, logoVersion: null }] };
  const old = { ...full, messageId: '01H0000000000000000000000A' } as Message;
  const api = {
    me: async () => me, kehila: async () => ({ kehilaId: 'k1', name: 'k', settings: { pollSeconds: 3600 } }),
    channels: async () => [{ channelId: 'c1', name: 'c1' }], changes: async () => ({ cursor: 'c', more: false, changes: [] }),
    messages: async (_k: string, o: { before?: string }) => (o.before ? [] : [old]),
    message: async () => { if (mode === 'gone') throw new ApiCodeError(404, 'message_not_found'); return old; },
  } as any;
  const store = createStore(api, { get: async () => null, set: async () => {}, remove: async () => {} }, { cacheStore: memoryStore(), isActive: () => true });
  await store.start(); await new Promise(r => setTimeout(r, 30));
  const feedBefore = Object.keys(store.getState().feed.messages);
  const r = await store.loadHit(old.messageId);
  assert.equal(r.kind, 'full');
  assert.deepEqual(Object.keys(store.getState().feed.messages), feedBefore);
  mode = 'gone';
  assert.equal((await store.loadHit(old.messageId)).kind, 'notFound');
  assert.equal(await store.cachedMessage(old.messageId), null);
  store.reset();
});
