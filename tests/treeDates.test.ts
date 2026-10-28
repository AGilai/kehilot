import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barMitzvahSuggestion, batMitzvahDate, fromGregorian, monthsOf, shabbatOfWeek, toGregorian } from '../src/tree/dates.ts';
import type { HebDate } from '../src/tree/types.ts';

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
  assert.deepEqual(barMitzvahSuggestion({ day: 14, month: 'kislev', year: 5776 }), { date: '2028-12-02', parasha: 'וישלח', label: 'שבת פרשת וישלח' });
});

test('bar mitzvah dates pinned from the server (hebrew_calendar.bar_mitzvah_date, then moved to Shabbat)', () => {
  const cases: [HebDate, string][] = [
    [{ day: 30, month: 'cheshvan', year: 5780 }, '2032-11-06'], // 5793 is short: 30 Cheshvan -> 1 Kislev (Thu 11-04)
    [{ day: 30, month: 'kislev', year: 5779 }, '2031-12-20'],
    [{ day: 15, month: 'adar', year: 5781 }, '2034-03-11'],     // regular Adar, leap 13th year -> Adar II
    [{ day: 15, month: 'adar_i', year: 5779 }, '2032-02-28'],   // regular 13th year -> Adar
    [{ day: 15, month: 'adar_ii', year: 5779 }, '2032-02-28'],
    [{ day: 30, month: 'adar_i', year: 5779 }, '2032-03-13'],   // no 30 Adar -> 1 Nisan, itself a Shabbat
    [{ day: 15, month: 'adar_ii', year: 5782 }, '2035-03-31'],
  ];
  for (const [birth, date] of cases) assert.equal(barMitzvahSuggestion(birth).date, date, JSON.stringify(birth));
});

test('an invalid birth date throws instead of being silently mapped', () => {
  assert.throws(() => barMitzvahSuggestion({ day: 30, month: 'iyar', year: 5780 }));
  assert.throws(() => barMitzvahSuggestion({ day: 1, month: 'adar', year: 5784 }));
  assert.throws(() => barMitzvahSuggestion({ day: 1, month: 'adar_ii', year: 5785 }));
  assert.throws(() => batMitzvahDate({ day: 30, month: 'iyar', year: 5780 }));
  assert.throws(() => barMitzvahSuggestion({ day: 1, month: 'nisan' }));
});

test('every shabbat result has a label: parasha normally, the holiday name on a holiday Shabbat', () => {
  assert.deepEqual(shabbatOfWeek('2028-11-29'), { date: '2028-12-02', parasha: 'וישלח', label: 'שבת פרשת וישלח' });
  assert.equal(barMitzvahSuggestion({ day: 14, month: 'kislev', year: 5776 }).label, 'שבת פרשת וישלח');
  assert.deepEqual(shabbatOfWeek('2026-09-09'), { date: '2026-09-12', parasha: '', label: 'שבת ראש השנה' });
  assert.deepEqual(shabbatOfWeek('2028-10-04'), { date: '2028-10-07', parasha: '', label: 'שבת חול המועד סוכות' });
  assert.deepEqual(shabbatOfWeek('2027-04-21'), { date: '2027-04-24', parasha: '', label: 'שבת חול המועד פסח' });
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
  assert.deepEqual(shabbatOfWeek('2028-11-29'), { date: '2028-12-02', parasha: 'וישלח', label: 'שבת פרשת וישלח' }); // Wednesday
  assert.equal(shabbatOfWeek('2028-12-02').date, '2028-12-02');
  assert.equal(shabbatOfWeek('2028-11-26').date, '2028-12-02'); // Sunday
  assert.equal(shabbatOfWeek('2028-12-03').date, '2028-12-09'); // next Sunday
});
