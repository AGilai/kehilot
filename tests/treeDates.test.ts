import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HDate } from '@hebcal/hdate';
import { barMitzvahSuggestion, batMitzvahDate, fromGregorian, monthsOf, shabbatOfWeek, toGregorian } from '../src/tree/dates.ts';
import type { HebDate } from '../src/tree/types.ts';

const iso = (d: HDate) => d.greg().toISOString().slice(0, 10) === '' ? '' : [d.greg().getFullYear(), String(d.greg().getMonth() + 1).padStart(2, '0'), String(d.greg().getDate()).padStart(2, '0')].join('-');
const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay();

test('monthsOf lists the right Adars', () => {
  const leap = monthsOf(5784), regular = monthsOf(5785);
  assert.equal(leap.length, 13);
  assert.ok(leap.includes('adar_i') && leap.includes('adar_ii') && !leap.includes('adar'));
  assert.equal(regular.length, 12);
  assert.ok(regular.includes('adar') && !regular.includes('adar_i') && !regular.includes('adar_ii'));
});

test('toGregorian and fromGregorian round trip, Adar kept exact', () => {
  assert.equal(toGregorian({ day: 14, month: 'kislev', year: 5776 }), '2015-11-26');
  assert.deepEqual(fromGregorian('2015-11-26'), { day: 14, month: 'kislev', year: 5776 });
  assert.deepEqual(fromGregorian(toGregorian({ day: 14, month: 'adar_ii', year: 5784 })), { day: 14, month: 'adar_ii', year: 5784 });
  assert.deepEqual(fromGregorian(toGregorian({ day: 14, month: 'adar_i', year: 5784 })), { day: 14, month: 'adar_i', year: 5784 });
  assert.deepEqual(fromGregorian(toGregorian({ day: 14, month: 'adar', year: 5785 })), { day: 14, month: 'adar', year: 5785 });
});

test('toGregorian rejects an Adar that does not exist in that year', () => {
  assert.throws(() => toGregorian({ day: 1, month: 'adar', year: 5784 }));
  assert.throws(() => toGregorian({ day: 1, month: 'adar_i', year: 5785 }));
  assert.throws(() => toGregorian({ day: 1, month: 'tishrei' }));
});

test('doc example: born 14 Kislev 5776 -> Vayishlach, 2028-12-02', () => {
  assert.deepEqual(barMitzvahSuggestion({ day: 14, month: 'kislev', year: 5776 }), { date: '2028-12-02', parasha: 'וישלח' });
});

test('bar mitzvah is the Shabbat of or after the 13th birthday, as hebcal computes it', () => {
  const cases: HebDate[] = [
    { day: 14, month: 'kislev', year: 5776 },
    { day: 30, month: 'cheshvan', year: 5780 },   // 5793 is short: no 30 Cheshvan
    { day: 30, month: 'kislev', year: 5779 },
    { day: 15, month: 'adar', year: 5781 },        // 5794 is leap -> Adar II
    { day: 15, month: 'adar_i', year: 5779 },
    { day: 15, month: 'adar_ii', year: 5779 },
    { day: 30, month: 'adar_i', year: 5779 },
  ];
  for (const birth of cases) {
    const got = barMitzvahSuggestion(birth);
    assert.equal(dow(got.date), 6, JSON.stringify(birth));
    // hebcal's own 13th birthday: the first date >= it that is Shabbat
    const num = { tishrei: 7, cheshvan: 8, kislev: 9 } as Record<string, number>;
    const targetYear = birth.year! + 13;
    const leap = HDate.isLeapYear(targetYear);
    let month = ({ nisan: 1, iyar: 2, sivan: 3, tamuz: 4, av: 5, elul: 6, tishrei: 7, cheshvan: 8, kislev: 9, tevet: 10, shevat: 11 } as Record<string, number>)[birth.month] ?? 0;
    if (!month) month = birth.month === 'adar' ? (leap ? 13 : 12) : birth.month === 'adar_i' ? 12 : (leap ? 13 : 12);
    void num;
    let day = birth.day;
    if (day > HDate.daysInMonth(month, targetYear)) { day = 1; month = month === 12 && leap ? 13 : month === 13 || (month === 12 && !leap) ? 1 : month + 1; }
    const hd = new HDate(day, month, targetYear);
    let expected = iso(hd);
    while (dow(expected) !== 6) { const d = new Date(`${expected}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); expected = d.toISOString().slice(0, 10); }
    assert.equal(got.date, expected, JSON.stringify(birth));
  }
});

test('birthday on a Shabbat is that same Shabbat', () => {
  for (let year = 5770; year < 5790; year++) {
    const b: HebDate = { day: 10, month: 'shevat', year };
    const bd = toGregorian({ ...b, year: year + 13 });
    if (dow(bd) === 6) { assert.equal(barMitzvahSuggestion(b).date, bd); return; }
  }
  assert.fail('no Shabbat anniversary found');
});

test('bat mitzvah is the 12th Hebrew birthday', () => {
  assert.equal(batMitzvahDate({ day: 14, month: 'kislev', year: 5776 }), toGregorian({ day: 14, month: 'kislev', year: 5788 }));
});

test('shabbatOfWeek returns that week Shabbat (Sunday to Saturday)', () => {
  assert.deepEqual(shabbatOfWeek('2028-11-29'), { date: '2028-12-02', parasha: 'וישלח' }); // Wednesday
  assert.equal(shabbatOfWeek('2028-12-02').date, '2028-12-02');
  assert.equal(shabbatOfWeek('2028-11-26').date, '2028-12-02'); // Sunday
  assert.equal(shabbatOfWeek('2028-12-03').date, '2028-12-09'); // next Sunday
});
