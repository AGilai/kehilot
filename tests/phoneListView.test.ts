import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterFamilies, sortFamilies } from '../src/client/phoneListView.ts';
import type { PhoneListFamily } from '../src/client/types.ts';

const fam = (name: string, ...people: string[]): PhoneListFamily =>
  ({ familyId: name, name, people: people.map((n, i) => ({ userId: `${name}${i}`, name: n, phone: '+972500000001' })) });
const rows = [fam('בדיוני', 'דנה בדיוני', 'יוסי בדיוני'), fam('ניסיון · דמיון', 'אבי ניסיון', 'רותי דמיון'), fam('אלמוני', 'שרה אלמוני')];

test('search matches first or last name ignoring niqqud', () => {
  assert.deepEqual(filterFamilies(rows, 'רותי').map(f => f.name), ['ניסיון · דמיון']);
  assert.deepEqual(filterFamilies(rows, 'דִּמְיוֹן').map(f => f.name), ['ניסיון · דמיון']);
  assert.deepEqual(filterFamilies(rows, 'בדי').map(f => f.name), ['בדיוני']);
  assert.equal(filterFamilies(rows, '  ').length, 3);
  assert.equal(filterFamilies(rows, '').length, 3);
});

test('every word must match', () => {
  assert.deepEqual(filterFamilies(rows, 'דנה בדיוני').map(f => f.name), ['בדיוני']);
  assert.deepEqual(filterFamilies(rows, 'דנה אלמוני'), []);
});

test('sorts with Hebrew collation', () => {
  const sorted = sortFamilies(rows);
  assert.deepEqual(sorted.map(f => f.name), ['אלמוני', 'בדיוני', 'ניסיון · דמיון']);
  assert.deepEqual(rows.map(f => f.name)[0], 'בדיוני'); // input untouched
});
