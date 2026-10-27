import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromEpochSeconds } from '../src/client/time.ts';

test('fromEpochSeconds reads Unix seconds, not milliseconds', () => {
  assert.equal(fromEpochSeconds(1793000000).toISOString(), '2026-10-26T07:33:20.000Z');
  assert.equal(fromEpochSeconds(0).getTime(), 0);
  assert.equal(fromEpochSeconds(1.5).getTime(), 1500);
});

test('fromEpochSeconds of a server-shaped expiry is in this century, never 1970', () => {
  assert.ok(fromEpochSeconds(1793000000).getUTCFullYear() >= 2026);
});
