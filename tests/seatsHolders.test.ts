import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seatCountsByRef, dismissKey, holderBody, holderRows, linkError, linkOutcome, loadDismissed, saveDismissed, seatCountsByHolder, visibleSuggestions, whyKey } from '../src/seats/holders.ts';
import type { LinkSuggestion } from '../src/seats/holders.ts';

const sug = (holderId: string, familyId: string, why = 'phone-surname', level: 'exact' | 'likely' = 'exact', familyHoldsSeats = false): LinkSuggestion =>
  ({ holderId, holderName: `מחזיק ${holderId}`, familyId, familyName: `משפחה ${familyId}`, why, level, familyHoldsSeats });

test('holderBody: name 1-60 characters, phone optional and normalised', () => {
  assert.deepEqual(holderBody('  משפחת משל ר. ', ''), { ok: true, body: { name: 'משפחת משל ר.' } });
  assert.deepEqual(holderBody('מדומה', '050-1234567'), { ok: true, body: { name: 'מדומה', phone: '+972501234567' } });
  assert.deepEqual(holderBody('   ', ''), { ok: false, field: 'name' });
  assert.deepEqual(holderBody('א'.repeat(61), ''), { ok: false, field: 'name' });
  assert.deepEqual(holderBody('מדומה', '12'), { ok: false, field: 'phone' });
});

test('seatCountsByHolder counts only holder refs', () => {
  const m = seatCountsByHolder({ a: 'holder:H1', b: 'holder:H1', c: 'family:F', d: 'holder:H2' });
  assert.deepEqual([...m], [['H1', 2], ['H2', 1]]);
});

test('seatCountsByRef counts families too', () => {
  assert.deepEqual([...seatCountsByRef({ a: 'family:F', b: 'family:F', c: 'holder:H' })], [['family:F', 2], ['holder:H', 1]]);
});

test('visibleSuggestions hides the dismissed pair only, and keeps the server order', () => {
  const list = [sug('H1', 'F1'), sug('H1', 'F2', 'surname-only', 'likely'), sug('H2', 'F3')];
  const dismissed = new Set([dismissKey('H1', 'F1')]);
  assert.deepEqual(visibleSuggestions(list, dismissed).map((s) => s.familyId), ['F2', 'F3']);
});

test('dismissed pairs are stored per Kehila and a broken store is harmless', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveDismissed(store, 'k1', new Set(['H1|F1']));
  assert.deepEqual([...loadDismissed(store, 'k1')], ['H1|F1']);
  assert.deepEqual([...loadDismissed(store, 'k2')], []);
  mem.set('kehilot.seatLinkDismissed.k1', '{oops');
  assert.deepEqual([...loadDismissed(store, 'k1')], []);
  const throwing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  assert.deepEqual([...loadDismissed(throwing, 'k1')], []);
  assert.doesNotThrow(() => saveDismissed(throwing, 'k1', new Set(['a'])));
  assert.deepEqual([...loadDismissed(undefined, 'k1')], []);
});

test('holderRows: suggested holders first, then by name, with count, suggestion and a suggestions-only filter', () => {
  const holders = [
    { holderId: 'H2', name: 'שרטוט י.', phone: null, createdAt: 2, updatedAt: 2 },
    { holderId: 'H1', name: 'מדומה', phone: '+972500000014', createdAt: 1, updatedAt: 1 },
  ];
  const rows = holderRows(holders, new Map([['H1', 1]]), [sug('H1', 'F1')], false);
  assert.deepEqual(rows.map((r) => [r.holder.holderId, r.seats, r.suggestion?.familyId]), [['H1', 1, 'F1'], ['H2', 0, undefined]]);
  assert.deepEqual(holderRows(holders, new Map(), [sug('H1', 'F1')], true).map((r) => r.holder.holderId), ['H1']);
});

test('holderRows puts suggested holders before the others', () => {
  const holders = [{ holderId: 'A', name: 'אלמוני', phone: null, createdAt: 1, updatedAt: 1 }, { holderId: 'T', name: 'תבנית', phone: null, createdAt: 1, updatedAt: 1 }];
  assert.deepEqual(holderRows(holders, new Map(), [sug('T', 'F9')], false).map((r) => r.holder.holderId), ['T', 'A']);
});

test('whyKey: weak reasons are flagged "without a phone to compare"', () => {
  assert.deepEqual(whyKey('phone-surname'), { key: 'phone-surname', weak: false });
  assert.deepEqual(whyKey('phone'), { key: 'phone', weak: false });
  assert.deepEqual(whyKey('surname-initial'), { key: 'surname-initial', weak: true });
  assert.deepEqual(whyKey('something-new'), { key: 'other', weak: true });
});

test('linkOutcome: the union of both seat sets, a choice panel only when the family already holds seats', () => {
  assert.deepEqual(linkOutcome(1, 0), { total: 1, family: 0, union: false });
  assert.deepEqual(linkOutcome(1, 2), { total: 3, family: 2, union: true });
});

test('linkError separates a stale holder, a retry and a missing record', () => {
  const e = (code: string) => ({ code });
  assert.equal(linkError(e('holder_changed')), 'changed');
  assert.equal(linkError(e('try_again')), 'retry');
  assert.equal(linkError(e('holder_not_found')), 'gone');
  assert.equal(linkError(e('family_not_found')), 'gone');
  assert.equal(linkError(e('boom')), 'other');
  assert.equal(linkError(null), 'other');
});
