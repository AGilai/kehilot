import { HDate } from '@hebcal/hdate';
import { HebrewCalendar } from '@hebcal/core/dist/esm/hebcal';
import { flags } from '@hebcal/core/dist/esm/event';
import { hebrew, parashaOf } from '../schedule/parasha.ts';
import type { HebDate, MonthKey } from './types.ts';

// hebcal month numbers (Tishrei = 7). In a leap year 12 is Adar I and 13 is Adar II; in a regular year 12 is Adar.
const NUMBERS: Record<Exclude<MonthKey, 'adar' | 'adar_i' | 'adar_ii'>, number> = { nisan: 1, iyar: 2, sivan: 3, tamuz: 4, av: 5, elul: 6, tishrei: 7, cheshvan: 8, kislev: 9, tevet: 10, shevat: 11 };
const ORDER: MonthKey[] = ['tishrei', 'cheshvan', 'kislev', 'tevet', 'shevat', 'adar', 'adar_i', 'adar_ii', 'nisan', 'iyar', 'sivan', 'tamuz', 'av', 'elul'];

// The months of a Hebrew year in calendar order, Tishrei first; exactly one Adar in a regular year, two in a leap year.
export function monthsOf(year: number): MonthKey[] {
  const leap = HDate.isLeapYear(year);
  return ORDER.filter(m => leap ? m !== 'adar' : m !== 'adar_i' && m !== 'adar_ii');
}
function monthNumber(month: MonthKey, year: number): number {
  if (!monthsOf(year).includes(month)) throw new Error(`${month} does not exist in ${year}`);
  return month === 'adar' || month === 'adar_i' ? 12 : month === 'adar_ii' ? 13 : NUMBERS[month];
}
function monthKey(number: number, year: number): MonthKey {
  if (number === 12) return HDate.isLeapYear(year) ? 'adar_i' : 'adar';
  if (number === 13) return 'adar_ii';
  return (Object.keys(NUMBERS) as (keyof typeof NUMBERS)[]).find(k => NUMBERS[k] === number)!;
}
const isoOf = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const noon = (iso: string) => new Date(`${iso}T12:00:00`);
function hdateOf(d: HebDate): HDate {
  if (d.year === undefined) throw new Error('Hebrew year is needed');
  const number = monthNumber(d.month, d.year);
  if (d.day < 1 || d.day > HDate.daysInMonth(number, d.year)) throw new Error('day out of range');
  return new HDate(d.day, number, d.year);
}

export function toGregorian(d: HebDate): string { return isoOf(hdateOf(d).greg()); }
export function fromGregorian(iso: string): HebDate {
  const h = new HDate(noon(iso));
  return { day: h.getDate(), month: monthKey(h.getMonth(), h.getFullYear()), year: h.getFullYear() };
}

// The same Hebrew birthday `years` later. Regular Adar -> Adar II in a leap year; Adar I stays Adar I when possible
// (Adar in a regular year); Adar II in a regular year -> Adar; a missing day 30 moves to the 1st of the next month
// (the convention of server/hebrew_calendar.py bar_mitzvah_date).
// An invalid birth (no year, an Adar that does not exist that year, a day past the month's end) throws, like toGregorian.
function anniversary(birth: HebDate, years: number): HDate {
  hdateOf(birth);
  const birthYear = birth.year!;
  const year = birthYear + years;
  const leap = HDate.isLeapYear(year);
  const number = birth.month === 'adar' ? (leap ? 13 : 12) : birth.month === 'adar_ii' ? (leap ? 13 : 12) : birth.month === 'adar_i' ? 12 : NUMBERS[birth.month];
  if (birth.day <= HDate.daysInMonth(number, year)) return new HDate(birth.day, number, year);
  return new HDate(new HDate(1, number, year).abs() + HDate.daysInMonth(number, year));
}

const SHABBAT = 6;
const addDays = (iso: string, days: number) => { const d = noon(iso); d.setDate(d.getDate() + days); return isoOf(d); };
export type ShabbatInfo = { date: string; parasha: string; label: string };
// Holiday Shabbat: parasha is '' and the label is the holiday ("שבת ראש השנה", "שבת חול המועד סוכות").
function holidayLabel(date: string): string {
  const events = HebrewCalendar.getHolidaysOnDate(new HDate(noon(date)), true) ?? [];
  const event = events.find(e => e.getFlags() & (flags.CHAG | flags.CHOL_HAMOED)) ?? events[0];
  if (!event) return 'שבת';
  // render() gives "סוכות א׳", "פסח ג׳ (חוה״מ)", "ראש השנה 5787"; keep the bare holiday name.
  const name = hebrew(event.render('he')).replace(/ \(חוה״מ\)$/, '').replace(/ \d+$/, '').replace(/ [א-ת]׳$/, '').replace(/^סכות$/, 'סוכות').trim(); // hebcal's pointed text loses the full spelling
  return event.getFlags() & flags.CHOL_HAMOED ? `שבת חול המועד ${name}` : `שבת ${name}`;
}
function shabbat(date: string): ShabbatInfo {
  const parasha = parashaOf(date, 'he') ?? '';
  return { date, parasha, label: parasha ? `שבת פרשת ${parasha}` : holidayLabel(date) };
}

export function barMitzvahSuggestion(birth: HebDate): ShabbatInfo {
  const day = isoOf(anniversary(birth, 13).greg());
  return shabbat(addDays(day, (SHABBAT - noon(day).getDay() + 7) % 7));
}
// Completed Hebrew years of age on `todayIso` (the Hebrew birthday counts, Adar rules as in anniversary()).
export function hebrewAge(birth: HebDate, todayIso: string): number {
  const now = new HDate(noon(todayIso));
  hdateOf(birth);
  let years = Math.max(0, now.getFullYear() - birth.year!);
  while (years > 0 && anniversary(birth, years).abs() > now.abs()) years--;
  return years;
}
export function batMitzvahDate(birth: HebDate): string { return isoOf(anniversary(birth, 12).greg()); }
// The Shabbat of the week (Sunday to Saturday) containing `iso`.
export function shabbatOfWeek(iso: string): ShabbatInfo {
  return shabbat(addDays(iso, SHABBAT - noon(iso).getDay()));
}
