import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../src/auth/cognito.ts';
import { localSignOut, resolveStart, signOutSequence } from '../src/auth/signout.ts';

function deps(over: Record<string, unknown> = {}) {
  const log: string[] = [];
  return {
    log,
    d: {
      deleteDevice: async () => { log.push('device'); },
      revoke: async () => { log.push('revoke'); },
      clear: async () => { log.push('clear'); },
      reset: () => { log.push('reset'); },
      done: () => { log.push('done'); },
      ...over,
    } as any,
  };
}

test('local cleanup always clears tokens, resets, then signs out, even if clear throws', async () => {
  const a = deps(); await localSignOut(a.d); assert.deepEqual(a.log, ['clear', 'reset', 'done']);
  const b = deps({ clear: async () => { throw new Error('x'); } }); await localSignOut(b.d); assert.deepEqual(b.log, ['reset', 'done']);
});

test('signOut sequence order, and it finishes when revoke or clear throws', async () => {
  const a = deps(); await signOutSequence(a.d, 'tok', 'rt');
  assert.deepEqual(a.log, ['device', 'revoke', 'clear', 'reset', 'done']);
  const b = deps({ revoke: async () => { throw new Error('x'); }, clear: async () => { throw new Error('y'); } });
  await signOutSequence(b.d, null, 'rt'); assert.deepEqual(b.log, ['reset', 'done']);
});

test('start: restored, none, signed out, and network failure keeps the session offline', async () => {
  assert.equal(await resolveStart(async () => true), 'signedIn');
  assert.equal(await resolveStart(async () => false), 'signedOut');
  assert.equal(await resolveStart(async () => { throw new AuthError('network'); }), 'offline');
});
