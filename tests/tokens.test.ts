import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTokenManager } from '../src/auth/tokens.ts';
import type { KeyValue, Tokens } from '../src/auth/tokens.ts';
import { AuthError } from '../src/auth/cognito.ts';

function b64(o: object) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
const jwt = (extra = {}) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', email: 'dana@example.invalid', ...extra })}.sig`;

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    remove: async (k) => { data.delete(k); },
  };
}
const session = (expiresAt: number): Tokens => ({ idToken: jwt(), refreshToken: 'r-1', expiresAt });

test('restore without stored refresh token is false', async () => {
  const m = createTokenManager({ storage: memory(), refresh: async () => { throw new Error('no'); }, onSignedOut: () => {} });
  assert.equal(await m.restore(), false);
});

test('idToken refreshes when under 60 s left', async () => {
  const storage = memory();
  let calls = 0;
  const fresh = jwt({ n: 2 });
  const m = createTokenManager({
    storage, now: () => 1_000_000,
    refresh: async (rt) => { calls++; assert.equal(rt, 'r-1'); return { idToken: fresh, expiresIn: 3600 }; },
    onSignedOut: () => {},
  });
  await m.setSession(session(1_000_000 + 30_000));
  assert.equal(await m.idToken(), fresh);
  assert.equal(calls, 1);
  assert.equal(await m.idToken(), fresh);
  assert.equal(calls, 1);
  assert.deepEqual(m.claims(), { sub: 'u-1', email: 'dana@example.invalid' });
  assert.deepEqual([...storage.data.keys()], ['kehilot.refresh.v1']);
  assert.equal(storage.data.get('kehilot.refresh.v1'), 'r-1');
});

test('concurrent callers share one refresh', async () => {
  let calls = 0;
  const m = createTokenManager({
    storage: memory(), now: () => 0,
    refresh: async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return { idToken: jwt(), expiresIn: 3600 }; },
    onSignedOut: () => {},
  });
  await m.setSession(session(1000));
  const out = await Promise.all([1, 2, 3, 4, 5].map(() => m.idToken()));
  assert.equal(calls, 1);
  assert.equal(new Set(out).size, 1);
});

test('NotAuthorized on refresh clears storage and signals signed out', async () => {
  const storage = memory();
  let signedOut = 0;
  const m = createTokenManager({
    storage, now: () => 0,
    refresh: async () => { throw new AuthError('NotAuthorizedException'); },
    onSignedOut: () => { signedOut++; },
  });
  await m.setSession(session(1000));
  await assert.rejects(m.idToken(), (e: unknown) => e instanceof AuthError && e.code === 'signed_out');
  assert.equal(signedOut, 1);
  assert.equal(storage.data.size, 0);
});

test('clear removes the stored token', async () => {
  const storage = memory();
  const m = createTokenManager({ storage, refresh: async () => ({ idToken: jwt(), expiresIn: 1 }), onSignedOut: () => {} });
  await m.setSession(session(Date.now() + 3_600_000));
  assert.equal(storage.data.size, 1);
  await m.clear();
  assert.equal(storage.data.size, 0);
});

test('a refresh that resolves after clear() does not restore the session', async () => {
  const storage = memory();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const m = createTokenManager({
    storage, now: () => 0,
    refresh: async () => { await gate; return { idToken: jwt(), expiresIn: 3600 }; },
    onSignedOut: () => {},
  });
  await m.setSession(session(1000));
  const p = m.idToken();
  const settled = p.then(() => 'ok', (e: unknown) => (e instanceof AuthError ? e.code : 'other'));
  await m.clear();
  release();
  assert.equal(await settled, 'signed_out');
  assert.deepEqual(m.claims(), { sub: '', email: '' });
  await assert.rejects(m.idToken(), (e: unknown) => e instanceof AuthError && e.code === 'signed_out');
  assert.equal(storage.data.size, 0);
});

test('after a network failure the next idToken() retries', async () => {
  let calls = 0;
  const m = createTokenManager({
    storage: memory(), now: () => 0,
    refresh: async () => { calls++; if (calls === 1) throw new AuthError('network'); return { idToken: jwt(), expiresIn: 3600 }; },
    onSignedOut: () => {},
  });
  await m.setSession(session(1000));
  await assert.rejects(m.idToken(), (e: unknown) => e instanceof AuthError && e.code === 'network');
  await m.idToken();
  assert.equal(calls, 2);
});
