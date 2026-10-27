import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mainKey } from '../src/client/navReset.ts';

test('Main is keyed by Kehila: a switch remounts it (Home, no stale chat/detail/group, no management toast)', () => {
  assert.notEqual(mainKey('k1'), mainKey('k2'));
  assert.equal(mainKey('k1'), mainKey('k1'));
  assert.notEqual(mainKey(null), mainKey('k1'));
});
