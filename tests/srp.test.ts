import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryStorage, createPool } from '../src/auth/srp.ts';

test('SRP pool uses the in-memory storage, never localStorage', () => {
  let touched = 0;
  (globalThis as any).localStorage = new Proxy({}, { get: () => { touched++; return () => null; } });
  const storage = createMemoryStorage();
  const pool = createPool(storage, 'il-central-1_Example', 'exampleclientid') as any;
  assert.equal(pool.storage, storage);
  storage.setItem('a', 'b');
  assert.equal(storage.getItem('a'), 'b');
  storage.removeItem('a');
  assert.equal(storage.getItem('a'), null);
  assert.equal(touched, 0);
  delete (globalThis as any).localStorage;
});
