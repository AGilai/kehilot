import test from 'node:test';
import assert from 'node:assert/strict';
import { dualDate, dualRange, hebrewDate } from '../src/dates.ts';

const LRI = '⁦', PDI = '⁩';

test('single day: Hebrew first, Gregorian in brackets', () => {
  assert.equal(dualDate('2026-10-23', 'he'), 'י״ב בחשוון (23.10)');
  assert.equal(dualDate('2026-10-23', 'en'), '12 Cheshvan (23.10)');
  assert.equal(dualDate('2026-11-01', 'he'), 'כ״א בחשוון (1.11)');
});

test('weekday keeps the weekday, Hebrew letters in Hebrew', () => {
  assert.equal(dualDate('2026-10-23', 'he', { weekday: true }), 'יום ו׳, י״ב בחשוון (23.10)');
  assert.equal(dualDate('2026-10-24', 'he', { weekday: true }), 'שבת, י״ג בחשוון (24.10)');
  assert.equal(dualDate('2026-10-25', 'he', { weekday: true }), 'יום א׳, י״ד בחשוון (25.10)');
  assert.equal(dualDate('2026-10-23', 'en', { weekday: true }), 'Friday, 12 Cheshvan (23.10)');
});

test('year is added only on request, in gematria', () => {
  assert.equal(dualDate('2026-10-23', 'he', { year: true }), 'י״ב בחשוון תשפ״ז (23.10.2026)');
  assert.equal(dualDate('2026-10-23', 'en', { year: true }), '12 Cheshvan 5787 (23.10.2026)');
  assert.equal(dualDate('2026-10-23', 'he', { weekday: true, year: true }), 'יום ו׳, י״ב בחשוון תשפ״ז (23.10.2026)');
});

test('leap year: Adar I and Adar II are told apart; regular Adar is plain', () => {
  assert.equal(dualDate('2027-02-10', 'he'), 'ג׳ באדר א׳ (10.2)');
  assert.equal(dualDate('2027-03-10', 'he'), 'א׳ באדר ב׳ (10.3)');
  assert.equal(dualDate('2027-03-10', 'en'), '1 Adar II (10.3)');
  assert.equal(dualDate('2027-02-10', 'en'), '3 Adar I (10.2)');
  assert.equal(dualDate('2028-03-25', 'he'), 'כ״ז באדר (25.3)');
  assert.equal(dualDate('2028-03-25', 'en'), '27 Adar (25.3)');
});

test('range inside one Hebrew month shares the month name', () => {
  assert.equal(dualRange('2026-10-23', '2026-10-29', 'he'), `י״ב–י״ח בחשוון (${LRI}23.10–29.10${PDI})`);
  assert.equal(dualRange('2026-10-23', '2026-10-29', 'en'), '12–18 Cheshvan (23.10–29.10)');
});

test('range across Hebrew months names both', () => {
  assert.equal(dualRange('2026-10-09', '2026-10-15', 'he'), `כ״ח בתשרי–ד׳ בחשוון (${LRI}9.10–15.10${PDI})`);
  assert.equal(dualRange('2026-10-09', '2026-10-15', 'en'), '28 Tishrei–4 Cheshvan (9.10–15.10)');
});

test('range across the Adar I / Adar II boundary', () => {
  assert.equal(dualRange('2027-03-08', '2027-03-12', 'he'), `כ״ט באדר א׳–ג׳ באדר ב׳ (${LRI}8.3–12.3${PDI})`);
  assert.equal(dualRange('2027-02-08', '2027-02-12', 'he'), `א׳–ה׳ באדר א׳ (${LRI}8.2–12.2${PDI})`);
});

test('range across the Hebrew year keeps it readable (Elul to Tishrei)', () => {
  assert.equal(dualRange('2027-10-01', '2027-10-07', 'he'), `כ״ט באלול–ו׳ בתשרי (${LRI}1.10–7.10${PDI})`);
});

test('one-day range is a single date', () => {
  assert.equal(dualRange('2026-10-23', '2026-10-23', 'he'), 'י״ב בחשוון (23.10)');
});

test('hebrewDate is unchanged in Hebrew and no longer needs Intl for the calendar', () => {
  assert.equal(hebrewDate('2026-10-27', 'he'), 'ט״ז בחשוון תשפ״ז');
  assert.equal(hebrewDate('2027-03-10', 'he'), 'א׳ באדר ב׳ תשפ״ז');
});
