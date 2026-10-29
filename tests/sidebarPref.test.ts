import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIDEBAR_COLLAPSED_KEY, SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH, loadSidebarCollapsed, parseSidebarCollapsed, saveSidebarCollapsed, sidebarWidth } from '../src/client/sidebarPref.ts';

test('parseSidebarCollapsed: only the stored "1" collapses; missing or junk means expanded', () => {
  assert.equal(parseSidebarCollapsed('1'), true);
  for (const v of [null, undefined, '', '0', 'true', 'x']) assert.equal(parseSidebarCollapsed(v), false);
});

test('sidebarWidth: 272 expanded, 64 rail', () => {
  assert.equal(sidebarWidth(false), SIDEBAR_WIDTH);
  assert.equal(sidebarWidth(true), SIDEBAR_RAIL_WIDTH);
  assert.equal(SIDEBAR_WIDTH, 272);
  assert.equal(SIDEBAR_RAIL_WIDTH, 64);
});

test('save then load round-trips through the per-device store', async () => {
  const mem = new Map<string, string>();
  const store = { get: async (k: string) => mem.get(k) ?? null, set: async (k: string, v: string) => { mem.set(k, v); } };
  assert.equal(await loadSidebarCollapsed(store), false);
  await saveSidebarCollapsed(store, true);
  assert.equal(mem.get(SIDEBAR_COLLAPSED_KEY), '1');
  assert.equal(await loadSidebarCollapsed(store), true);
  await saveSidebarCollapsed(store, false);
  assert.equal(await loadSidebarCollapsed(store), false);
});

test('a failing store never throws: load is expanded, save is silent', async () => {
  const bad = { get: async () => { throw new Error('blocked'); }, set: async () => { throw new Error('blocked'); } };
  assert.equal(await loadSidebarCollapsed(bad), false);
  await saveSidebarCollapsed(bad, true);
});
