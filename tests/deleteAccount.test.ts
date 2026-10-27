import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount, DELETE_BACKOFF_MS } from '../src/client/account.ts';
import { ApiCodeError } from '../src/client/errors.ts';
import { createStore } from '../src/client/store.ts';
import type { Kehila, Me } from '../src/client/types.ts';

function harness(results: Array<'ok' | ApiCodeError>) {
  const log: string[] = [];
  const waits: number[] = [];
  let i = 0;
  const api = { deleteMe: async () => { log.push('deleteMe'); const r = results[Math.min(i++, results.length - 1)]!; if (r !== 'ok') throw r; } };
  return { log, waits, run: () => deleteAccount(api, async () => { log.push('signOut'); }, async ms => { waits.push(ms); }) };
}

test('retries internal until 204 then signs out', async () => {
  const h = harness([new ApiCodeError(500, 'internal'), new ApiCodeError(0, 'network'), 'ok']);
  assert.equal(await h.run(), 'deleted');
  assert.deepEqual(h.log, ['deleteMe', 'deleteMe', 'deleteMe', 'signOut']);
  assert.deepEqual(h.waits, [1000, 2000]);
});

test('lost response, then account_deleted on the retry, counts as deleted with one sign-out', async () => {
  const h = harness([new ApiCodeError(0, 'network'), new ApiCodeError(401, 'account_deleted')]);
  assert.equal(await h.run(), 'deleted');
  assert.deepEqual(h.log, ['deleteMe', 'deleteMe', 'signOut']);
});

test('account_deleted on the first call counts as deleted', async () => {
  const h = harness([new ApiCodeError(401, 'account_deleted')]);
  assert.equal(await h.run(), 'deleted');
  assert.deepEqual(h.log, ['deleteMe', 'signOut']);
});

test('a signOut that throws after 204 is still deleted', async () => {
  const log: string[] = [];
  const api = { deleteMe: async () => { log.push('deleteMe'); } };
  const r = await deleteAccount(api, async () => { log.push('signOut'); throw new Error('storage'); }, async () => {});
  assert.equal(r, 'deleted');
  assert.deepEqual(log, ['deleteMe', 'signOut']);
});

test('last_gabbai stops without signing out', async () => {
  const h = harness([new ApiCodeError(409, 'last_gabbai')]);
  assert.equal(await h.run(), 'last_gabbai');
  assert.deepEqual(h.log, ['deleteMe']);
});

test('gives up after 5 attempts', async () => {
  const h = harness([new ApiCodeError(500, 'internal')]);
  await assert.rejects(h.run(), (e: unknown) => e instanceof ApiCodeError && e.code === 'internal');
  assert.equal(h.log.filter(x => x === 'deleteMe').length, 6); // the first try plus 5 retries
  assert.deepEqual(h.waits, DELETE_BACKOFF_MS);
  assert.deepEqual(DELETE_BACKOFF_MS, [1000, 2000, 4000, 8000, 16000]);
  assert.ok(!h.log.includes('signOut'));
});

test('other errors are not retried', async () => {
  const h = harness([new ApiCodeError(403, 'forbidden')]);
  await assert.rejects(h.run());
  assert.deepEqual(h.log, ['deleteMe']);
});

test('passes deletePosts on every retry', async () => {
  const calls: unknown[] = [];
  let n = 0;
  const api = { deleteMe: async (o?: { deletePosts?: boolean }) => { calls.push(o?.deletePosts); if (n++ < 2) throw new ApiCodeError(0, 'network'); } };
  const r = await deleteAccount(api, async () => {}, async () => {}, { deletePosts: true });
  assert.equal(r, 'deleted');
  assert.deepEqual(calls, [true, true, true]);
});

test('without the option deletePosts is false on every call', async () => {
  const calls: unknown[] = [];
  const api = { deleteMe: async (o?: { deletePosts?: boolean }) => { calls.push(o?.deletePosts); } };
  await deleteAccount(api, async () => {}, async () => {});
  assert.deepEqual(calls, [false]);
});

test('retries try_again (503) until 204', async () => {
  const h = harness([new ApiCodeError(503, 'try_again'), new ApiCodeError(503, 'try_again'), 'ok']);
  assert.equal(await h.run(), 'deleted');
  assert.deepEqual(h.log, ['deleteMe', 'deleteMe', 'deleteMe', 'signOut']);
  assert.deepEqual(h.waits, [1000, 2000]);
});

// Leaving a Kehila and editing the profile go through the store.
const sum = (id: string) => ({ kehilaId: id, name: id, role: 'member' as const, logoVersion: null });
function storeWith(kehilot: string[], over: Record<string, unknown> = {}) {
  let me: Me = { userId: 'u1', email: 'dana@example.invalid', profile: { firstName: 'דנה', lastName: 'בדויה', lang: 'he' }, kehilot: kehilot.map(sum), age13Required: false };
  const calls: string[] = [];
  const api = {
    me: async () => me,
    kehila: async (k: string) => ({ kehilaId: k, name: k, role: 'member', settings: { pollSeconds: 60 } }) as Kehila,
    channels: async () => [],
    putProfile: async (p: { firstName: string; lastName?: string; lang: 'he' | 'en' }) => ({ firstName: p.firstName, lastName: p.lastName ?? '', lang: p.lang }),
    leave: async (k: string) => { calls.push(`leave:${k}`); me = { ...me, kehilot: me.kehilot.filter(x => x.kehilaId !== k) }; },
    ...over,
  };
  const data = new Map<string, string>();
  const storage = { get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => { data.set(k, v); }, remove: async (k: string) => { data.delete(k); } };
  return { store: createStore(api as any, storage, { isActive: () => false, sleep: (_ms: number, signal: AbortSignal) => new Promise<void>(res => signal.addEventListener('abort', () => res())) }), calls };
}

test('leaving the open Kehila moves to the other one', async () => {
  const { store, calls } = storeWith(['k1', 'k2']);
  await store.start(); await store.selectKehila('k1');
  assert.equal(await store.leaveKehila('k1'), 'ready');
  assert.deepEqual(calls, ['leave:k1']);
  assert.equal(store.getState().kehilaId, 'k2');
  assert.deepEqual(store.getState().me?.kehilot.map(x => x.kehilaId), ['k2']);
  store.reset();
});

test('a failed me() after a successful leave throws and keeps the selection for a retry', async () => {
  let left = false;
  const m: Me = { userId: 'u1', email: 'dana@example.invalid', profile: { firstName: 'דנה', lastName: 'בדויה', lang: 'he' }, kehilot: [sum('k1'), sum('k2')], age13Required: false };
  const { store } = storeWith(['k1', 'k2'], {
    me: async () => { if (left) throw new ApiCodeError(0, 'network'); return m; },
    leave: async () => { left = true; },
  });
  await store.start(); await store.selectKehila('k1');
  await assert.rejects(store.leaveKehila('k1'), (e: unknown) => e instanceof ApiCodeError && e.code === 'network');
  assert.equal(store.getState().kehilaId, 'k1');
  store.reset();
});

test('leaving the only Kehila gives none and drops the selection', async () => {
  const { store } = storeWith(['k1']);
  await store.start();
  assert.equal(await store.leaveKehila('k1'), 'none');
  assert.equal(store.getState().kehilaId, null);
  assert.equal(store.getState().kehila, null);
});

test('a refused leave keeps everything', async () => {
  const { store } = storeWith(['k1', 'k2'], { leave: async () => { throw new ApiCodeError(409, 'last_gabbai'); } });
  await store.start(); await store.selectKehila('k1');
  await assert.rejects(store.leaveKehila('k1'), (e: unknown) => e instanceof ApiCodeError && e.code === 'last_gabbai');
  assert.equal(store.getState().kehilaId, 'k1');
  assert.equal(store.getState().me?.kehilot.length, 2);
  store.reset();
});

test('editProfile updates me.profile with the server answer', async () => {
  const { store } = storeWith(['k1']);
  await store.start();
  await store.editProfile({ firstName: 'דנית', lastName: 'בדויה', lang: 'en' });
  assert.deepEqual(store.getState().me?.profile, { firstName: 'דנית', lastName: 'בדויה', lang: 'en' });
});

test('editProfile keeps the phone when the server answer lacks it', async () => {
  const { store } = storeWith(['k1'], { putPhone: async (phone: string | null) => ({ phone }) });
  await store.start();
  await store.setPhone('+972500000001');
  await store.editProfile({ firstName: 'דנית', lastName: 'בדויה', lang: 'en' });
  assert.equal(store.getState().me?.profile?.phone, '+972500000001');
  assert.equal(store.getState().me?.profile?.firstName, 'דנית');
});
