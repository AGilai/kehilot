import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWaitingStore } from '../src/client/waitingStore.ts';
import type { WaitingCounts } from '../src/client/waitingStore.ts';

// All numbers are invented.
const counts = (over: Partial<WaitingCounts> = {}): WaitingCounts => ({ requests: 0, linkHints: 0, groupRequests: 0, sheetPending: 0, sheetPendingWeek: null, ...over });

test('waiting store: a Kehila switch resets the sheet count and week', async () => {
  const store = createWaitingStore(async () => counts({ sheetPending: 4, sheetPendingWeek: '2026-11-06' }));
  await store.refresh('k1');
  assert.equal(store.get().sheetPending, 4);
  assert.equal(store.get().sheetPendingWeek, '2026-11-06');
  const next = store.refresh('k2');
  assert.equal(store.get().kehilaId, 'k2');
  assert.equal(store.get().sheetPending, 0);
  assert.equal(store.get().sheetPendingWeek, null);
  await next;
});

test('waiting store: setSheetPending notifies once; equal numbers do not notify', () => {
  const store = createWaitingStore(async () => counts());
  let n = 0;
  store.subscribe(() => n++);
  store.setSheetPending(3, '2026-11-06');
  assert.equal(n, 1);
  assert.deepEqual([store.get().sheetPending, store.get().sheetPendingWeek], [3, '2026-11-06']);
  store.setSheetPending(3, '2026-11-06');
  assert.equal(n, 1);
  store.setSheetPending(3, '2026-11-13');
  assert.equal(n, 2);
});

test('waiting store: a load that changes only the sheet count notifies', async () => {
  let v = 1;
  const store = createWaitingStore(async () => counts({ sheetPending: v }));
  let n = 0;
  await store.refresh('k1');
  store.subscribe(() => n++);
  v = 2;
  await store.refresh('k1');
  assert.equal(n, 1);
  assert.equal(store.get().sheetPending, 2);
});
