import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP_FOLD_KEY, readMapFolded, writeMapFolded } from '../src/seats/mapFold.ts';

test('mapFold uses the key kehilot.seatMapCollapsed on both read and write', async () => {
  assert.equal(MAP_FOLD_KEY, 'kehilot.seatMapCollapsed');
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  const seen: string[] = [];
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => { seen.push(`get:${k}`); return mem.get(k) ?? null; },
    setItem: (k: string, v: string) => { seen.push(`set:${k}`); mem.set(k, v); },
  };
  try {
    await writeMapFolded(true);
    assert.equal(await readMapFolded(), true);
    assert.deepEqual(seen, ['set:kehilot.seatMapCollapsed', 'get:kehilot.seatMapCollapsed']);
    assert.equal(mem.get('kehilot.seatMapCollapsed'), '1');
    // A value stored under another key must not count.
    mem.clear(); mem.set('seatMapCollapsed', '1');
    assert.equal(await readMapFolded(), false);
  } finally { g.localStorage = had; }
});
