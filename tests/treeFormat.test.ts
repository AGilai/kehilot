import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gregOf, gregText, hebrewText, monthName, parseGreg } from '../src/tree/format.ts';

test('Hebrew date text with the "ב" before the month', () => {
  assert.equal(hebrewText({ day: 23, month: 'shevat', year: 5778 }), 'כ״ג בשבט תשע״ח');
  assert.equal(hebrewText({ day: 14, month: 'kislev', year: 5789 }), 'י״ד בכסלו תשפ״ט');
  assert.equal(hebrewText({ day: 1, month: 'adar_ii', year: 5784 }), 'א׳ באדר ב׳ תשפ״ד');
  assert.equal(hebrewText({ day: 5, month: 'sivan' }), 'ה׳ בסיון');
  assert.equal(hebrewText({ day: 5, month: 'adar', year: 5784 }), ''); // no plain Adar in a leap year
});
test('month names for the select', () => {
  assert.equal(monthName('adar_i', 5784), 'אדר א׳');
  assert.equal(monthName('adar', 5785), 'אדר');
  assert.equal(monthName('tishrei'), 'תשרי');
  assert.equal(monthName('adar_ii'), 'אדר ב׳');
});
test('Gregorian text and parsing', () => {
  assert.equal(gregText('2028-12-02'), '2.12.2028');
  assert.equal(parseGreg('2.12.2028'), '2028-12-02');
  assert.equal(parseGreg('02-12-2028'), '2028-12-02');
  assert.equal(parseGreg('2028-12-02'), '2028-12-02');
  assert.equal(parseGreg('31.2.2028'), undefined);
  assert.equal(parseGreg('abc'), undefined);
  assert.equal(gregOf({ day: 14, month: 'kislev', year: 5789 }), '2028-12-02');
  assert.equal(gregOf({ day: 14, month: 'kislev' }), undefined);
});
