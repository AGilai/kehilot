import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holderOwner, seatOwnerLabel, ownerLabels } from '../src/seats/ownerLabel.ts';
import type { SeatOwner } from '../src/seats/ownerLabel.ts';

const o = (surname: string, first?: string): SeatOwner => ({ surname, ...(first !== undefined ? { first } : {}) });

test('seatOwnerLabel: unique surname is the surname alone', () => {
  const all = [o('משל', 'יוסי'), o('דוגמה', 'דנה')];
  assert.equal(seatOwnerLabel(all[0]!, all), 'משל');
});
test('seatOwnerLabel: a repeated surname adds the first letter of the first name and a dot', () => {
  const all = [o('משל', 'יוסי'), o('משל', 'דנה'), o('דוגמה', 'אבי')];
  assert.equal(seatOwnerLabel(all[0]!, all), 'משל י.');
  assert.equal(seatOwnerLabel(all[1]!, all), 'משל ד.');
});
test('seatOwnerLabel: two first names, initials with or without a dot, extra spaces', () => {
  const all = [o('  משל ', ' יוסי משל '), o('משל', 'ד.'), o('משל', 'ש'), o('משל', '')];
  assert.equal(seatOwnerLabel(all[0]!, all), 'משל י.');
  assert.equal(seatOwnerLabel(all[1]!, all), 'משל ד.');
  assert.equal(seatOwnerLabel(all[2]!, all), 'משל ש.');
  assert.equal(seatOwnerLabel(all[3]!, all), 'משל');
});
test('seatOwnerLabel: surnames compare ignoring final letters and niqqud; empty name is ""', () => {
  const all = [o('דמיון', 'א'), o('דמיונ', 'ב')];
  assert.equal(seatOwnerLabel(all[0]!, all), 'דמיון א.');
  assert.equal(seatOwnerLabel(o(' '), [o(' ')]), '');
  assert.equal(seatOwnerLabel(o('', 'יוסי'), [o('', 'יוסי')]), '');
});
test('holderOwner: parsed like the paste matcher (surname, optional single-letter initial, family prefix dropped)', () => {
  assert.deepEqual(holderOwner('בדיוני ש.'), { surname: 'בדיוני', first: 'ש' });
  assert.deepEqual(holderOwner('בדיוני ש'), { surname: 'בדיוני', first: 'ש' });
  assert.deepEqual(holderOwner('משפחת מדומה'), { surname: 'מדומה' });
  assert.deepEqual(holderOwner('  משל  '), { surname: 'משל' });
  assert.deepEqual(holderOwner('בית הלל'), { surname: 'בית הלל' });
  assert.deepEqual(holderOwner(''), { surname: '' });
});
test('ownerLabels: a family and a holder with the same surname both get the initial', () => {
  const m = ownerLabels(new Map([['family:1', o('מדומה', 'יוסי')], ['holder:1', holderOwner('מדומה ר.')], ['family:2', o('דוגמה', 'דנה')]]));
  assert.equal(m.get('family:1'), 'מדומה י.');
  assert.equal(m.get('holder:1'), 'מדומה ר.');
  assert.equal(m.get('family:2'), 'דוגמה');
});

import { fitFontSize } from '../src/seats/ownerLabel.ts';
test('fitFontSize: full size when it fits, shrinks to the minimum, never below', () => {
  assert.equal(fitFontSize('דוגמה', 60), 12);
  assert.ok(fitFontSize('פיקטיבי י.', 60) < 12);
  assert.equal(fitFontSize('משפחת אבולעפיה הגדולה י.', 60), 9);
  assert.equal(fitFontSize('', 60), 12);
});
