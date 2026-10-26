import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../src/auth/cognito.ts';
import { createSignOut, localSignOut, resolveStart } from '../src/auth/signout.ts';

function deps(over: Record<string, unknown> = {}) {
  const log: string[] = [];
  return {
    log,
    d: {
      deleteDevice: async () => { log.push('device'); },
      revoke: async () => { log.push('revoke'); },
      clearTokens: async () => { log.push('tokens'); },
      clearPending: async () => { log.push('pending'); },
      wipeCaches: async () => { log.push('wipe'); },
      resetStore: () => { log.push('reset'); },
      done: () => { log.push('done'); },
      ...over,
    } as any,
  };
}

test('steps run in order', async () => {
  const a = deps(); await createSignOut(a.d)();
  assert.deepEqual(a.log, ['device', 'revoke', 'tokens', 'pending', 'wipe', 'reset', 'done']);
});

test('signOut wipes caches even when revoke fails', async () => {
  const a = deps({ revoke: async () => { throw new Error('x'); }, deleteDevice: async () => { throw new Error('y'); } });
  await createSignOut(a.d)();
  assert.deepEqual(a.log, ['tokens', 'pending', 'wipe', 'reset', 'done']);
});

test('every later step runs when one throws', async () => {
  for (const failing of ['clearTokens', 'clearPending', 'wipeCaches']) {
    const a = deps({ [failing]: async () => { throw new Error('x'); } });
    await createSignOut(a.d)();
    assert.ok(a.log.includes('wipe') || failing === 'wipeCaches', failing);
    assert.deepEqual(a.log.slice(-2), ['reset', 'done']);
    assert.equal(a.log.length, 6, failing);
  }
});

test('forced and account-deleted sign-outs wipe the caches too, without network calls', async () => {
  const a = deps(); await localSignOut(a.d);
  assert.deepEqual(a.log, ['tokens', 'pending', 'wipe', 'reset', 'done']);
  const b = deps({ clearTokens: async () => { throw new Error('x'); } }); await localSignOut(b.d);
  assert.deepEqual(b.log, ['pending', 'wipe', 'reset', 'done']);
});

test('start: restored, none, signed out, and network failure keeps the session offline', async () => {
  assert.equal(await resolveStart(async () => true), 'signedIn');
  assert.equal(await resolveStart(async () => false), 'signedOut');
  assert.equal(await resolveStart(async () => { throw new AuthError('network'); }), 'offline');
});
