import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore } from '../src/client/store.ts';
import { ApiCodeError } from '../src/client/errors.ts';
import { PENDING_INVITE_KEY, PENDING_TTL_MS, createPendingInvite, inviteUrl, normalizeCode, parseLink } from '../src/client/links.ts';
import type { KeyValue } from '../src/auth/tokens.ts';
import type { Kehila, KehilaSummary, Me } from '../src/client/types.ts';

const WEB = 'https://app.example.invalid';
const CODE = '7K3M9Q2XPA';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    remove: async (k) => { data.delete(k); },
  };
}

test('parses web, localhost and scheme join links', () => {
  assert.deepEqual(parseLink(`${WEB}/join/${CODE}`, { webUrl: WEB }), { kind: 'join', code: CODE });
  assert.deepEqual(parseLink(`${WEB}/join/${CODE}/?x=1#y`, { webUrl: WEB }), { kind: 'join', code: CODE });
  assert.deepEqual(parseLink(`http://localhost:8081/join/${CODE}`, { webUrl: WEB }), { kind: 'join', code: CODE });
  assert.deepEqual(parseLink(`shul://join/${CODE}`, { webUrl: WEB }), { kind: 'join', code: CODE });
  assert.deepEqual(parseLink(`shul://auth?code=abc`, { webUrl: WEB }), { kind: 'authCallback' });
  assert.equal(inviteUrl(CODE, WEB), `${WEB}/join/${CODE}`);
});

test('normalizes typed codes like the server', () => {
  assert.equal(normalizeCode('  7k3m9q2xpa '), CODE);
  assert.equal(normalizeCode('ilo'), '110');
  assert.deepEqual(parseLink('7k3m-9q2x pa'.replace(/[- ]/g, ''), { webUrl: WEB }), { kind: 'join', code: CODE });
  assert.deepEqual(parseLink('OIL1OIL1OI', { webUrl: WEB }), { kind: 'join', code: '0111011101' });
  assert.equal(parseLink('7K3M9Q2XP', { webUrl: WEB }), null);
  assert.equal(parseLink('7K3M9Q2XPAA', { webUrl: WEB }), null);
  assert.equal(parseLink('7K3M9Q2XPU', { webUrl: WEB }), null);
  assert.deepEqual(parseLink(`${WEB}/join/7k3m9q2xpa`, { webUrl: WEB }), { kind: 'join', code: CODE });
});

test('rejects other hosts', () => {
  assert.equal(parseLink(`https://evil.example.invalid/join/${CODE}`, { webUrl: WEB }), null);
  assert.equal(parseLink(`${WEB}.evil.example.invalid/join/${CODE}`, { webUrl: WEB }), null);
  assert.equal(parseLink(`http://localhost:9999/join/${CODE}`, { webUrl: WEB }), null);
  assert.equal(parseLink(`other://join/${CODE}`, { webUrl: WEB }), null);
  assert.equal(parseLink(`${WEB}/other/${CODE}`, { webUrl: WEB }), null);
  assert.equal(parseLink('', { webUrl: WEB }), null);
  assert.equal(parseLink(`/join/${CODE}`, { webUrl: '' }), null);
});

const summary = (id: string): KehilaSummary => ({ kehilaId: id, name: id, role: 'listener', logoVersion: null });
function fakeApi(over: Record<string, unknown> = {}) {
  let profile: Me['profile'] = null;
  let kehilot: KehilaSummary[] = [];
  const accepted: string[] = [];
  const api = {
    me: async (): Promise<Me> => ({ userId: 'u1', email: 'dana@example.invalid', profile, kehilot }),
    putProfile: async (p: { firstName: string; lang: 'he' | 'en' }) => { profile = { firstName: p.firstName, lastName: '', lang: p.lang }; return profile; },
    acceptInvite: async (code: string) => { accepted.push(code); kehilot = [summary('k1')]; return { kehilaId: 'k1', role: 'listener' as const }; },
    kehila: async (k: string) => ({ kehilaId: k, name: k, role: 'listener', pendingRequest: false, settings: { pollSeconds: 30 } }) as Kehila,
    channels: async () => [],
    ...over,
  };
  return { api: api as any, accepted };
}

test('pending invite survives the sign-up detour', async () => {
  const storage = memory();
  const pending = createPendingInvite(storage, () => 1000);
  await pending.set(CODE);
  assert.equal(JSON.parse(storage.data.get(PENDING_INVITE_KEY)!).code, CODE);
  const { api, accepted } = fakeApi();
  const store = createStore(api, storage, { pending, isActive: () => false });
  // Signed in, no profile yet: the invite waits.
  assert.equal(await store.start(), 'setup');
  assert.deepEqual(accepted, []);
  assert.ok(storage.data.has(PENDING_INVITE_KEY));
  // The profile step accepts it once and lands in the new Kehila.
  assert.equal(await store.saveProfile({ firstName: 'דנה', lastName: '', lang: 'he' }), 'ready');
  assert.deepEqual(accepted, [CODE]);
  assert.equal(store.getState().kehilaId, 'k1');
  assert.equal(storage.data.has(PENDING_INVITE_KEY), false);
  // A later start does not accept again.
  await store.start();
  assert.deepEqual(accepted, [CODE]);
  store.reset();
});

test('every definitive outcome removes the pending invite; transient ones keep it', async () => {
  for (const [code, removed] of [['already_member', true], ['invite_expired', true], ['invite_not_found', true], ['kehila_full', true], ['try_again', false], ['profile_required', false]] as const) {
    const storage = memory();
    const pending = createPendingInvite(storage, () => 1000);
    await pending.set(CODE);
    const { api } = fakeApi({ acceptInvite: async () => { throw new ApiCodeError(code === 'try_again' ? 409 : 410, code); } });
    const store = createStore(api, storage, { pending, isActive: () => false });
    await store.saveProfile({ firstName: 'דנה', lastName: '', lang: 'he' }).catch(() => {});
    await store.start();
    assert.equal(storage.data.has(PENDING_INVITE_KEY), !removed, code);
    if (removed) assert.equal(store.getState().joinError, code);
    store.reset();
  }
});

test('concurrent accepts run once', async () => {
  const storage = memory();
  const pending = createPendingInvite(storage, () => 1000);
  await pending.set(CODE);
  let n = 0;
  const run = () => pending.accept(async () => { n++; await new Promise(r => setTimeout(r, 5)); return { kehilaId: 'k1', role: 'listener' as const }; });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(n, 1);
  assert.equal(a.status === 'joined' || b.status === 'joined', true);
  assert.equal(a.status === 'none' || b.status === 'none', true);
});

test('expired pending invite is ignored', async () => {
  const storage = memory();
  let now = 1000;
  const pending = createPendingInvite(storage, () => now);
  await pending.set(CODE);
  now += PENDING_TTL_MS - 1;
  assert.equal(await pending.get(), CODE);
  now += 2;
  assert.equal(await pending.get(), null);
  assert.equal(storage.data.has(PENDING_INVITE_KEY), false);
  const { api, accepted } = fakeApi();
  await pending.set(CODE);
  now += PENDING_TTL_MS + 1;
  const store = createStore(api, storage, { pending, isActive: () => false });
  await store.saveProfile({ firstName: 'דנה', lastName: '', lang: 'he' });
  assert.deepEqual(accepted, []);
  store.reset();
});

test('membership request: sent state from the reply or a 409 already_requested', async () => {
  for (const fail of [null, new ApiCodeError(409, 'already_requested')]) {
    const calls: string[] = [];
    const { api } = fakeApi({ requestMembership: async (k: string) => { calls.push(k); if (fail) throw fail; return {}; } });
    const store = createStore(api, memory(), { isActive: () => false });
    await store.selectKehila('k1');
    await store.requestMembership();
    assert.deepEqual(calls, ['k1']);
    assert.equal(store.getState().kehila?.pendingRequest, true);
    store.reset();
  }
  const { api } = fakeApi({ requestMembership: async () => { throw new ApiCodeError(403, 'forbidden'); } });
  const store = createStore(api, memory(), { isActive: () => false });
  await store.selectKehila('k1');
  await assert.rejects(store.requestMembership(), { code: 'forbidden' });
  assert.equal(store.getState().kehila?.pendingRequest, false);
  store.reset();
});

test('approval shows without re-login: syncRole reloads the Kehila when me() changed the role', async () => {
  let role: 'listener' | 'member' = 'listener';
  const { api } = fakeApi({
    me: async () => ({ userId: 'u1', email: 'x@example.invalid', profile: { firstName: 'ד', lastName: '', lang: 'he' }, kehilot: [{ ...summary('k1'), role }] }),
    kehila: async (k: string) => ({ kehilaId: k, name: k, role, pendingRequest: role === 'listener', settings: { pollSeconds: 30 } }) as Kehila,
  });
  const store = createStore(api, memory(), { isActive: () => false });
  await store.start();
  assert.equal(store.getState().kehila?.role, 'listener');
  assert.equal(await store.syncRole(), false);
  role = 'member';
  await store.loadMe();
  assert.equal(await store.syncRole(), true);
  assert.equal(store.getState().kehila?.role, 'member');
  store.reset();
});
