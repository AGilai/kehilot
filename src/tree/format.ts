import { HDate } from '@hebcal/hdate';
import { monthsOf, toGregorian } from './dates.ts';
import type { HebDate } from './types.ts';

/** "כ״ג בשבט תשע״ח" (year left out when unknown). In a leap year Adar is "אדר א׳" or "אדר ב׳". */
export function hebrewText(d: HebDate): string {
  const number = (m: HebDate['month']) => (m === 'adar_ii' ? 13 : m === 'adar' || m === 'adar_i' ? 12 : ({ nisan: 1, iyar: 2, sivan: 3, tamuz: 4, av: 5, elul: 6, tishrei: 7, cheshvan: 8, kislev: 9, tevet: 10, shevat: 11 } as const)[m]);
  // hebcal needs a year; a leap one gives both Adars their names.
  const year = d.year ?? 5784;
  if (d.year !== undefined && !monthsOf(d.year).includes(d.month)) return '';
  const parts = new HDate(d.day, number(d.month), year).renderGematriya(true).split(' ');
  const day = parts[0]!;
  const yearText = parts[parts.length - 1]!;
  const month = parts.slice(1, -1).join(' ');
  return d.year === undefined ? `${day} ב${month}` : `${day} ב${month} ${yearText}`;
}
/** "ז׳ בכסלו" style month names for the select ("אדר א׳", "אדר ב׳" in a leap year). */
export function monthName(month: HebDate['month'], year?: number): string {
  const text = hebrewText({ day: 1, month, year: year !== undefined && monthsOf(year).includes(month) ? year : month === 'adar_i' || month === 'adar_ii' ? 5784 : 5785 });
  return text.replace(/^[^ ]+ ב/, '').replace(/ [^ ]+$/, '');
}
/** "2.12.2028" from an ISO day. */
export function gregText(iso: string): string { const [y, m, d] = iso.split('-').map(Number); return `${d}.${m}.${y}`; }
/** The day-of-month, month and year typed as "d.m.yyyy" (or an ISO day) -> ISO; undefined when it is not a real day. */
export function parseGreg(text: string): string | undefined {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/.exec(text) ?? undefined;
  const iso = m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.test(text) ? text.trim() : undefined;
  if (!iso) return undefined;
  const date = new Date(`${iso}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}
/** The Gregorian day of a stored Hebrew date, or undefined (no year, not a real day). */
export function gregOf(d: HebDate): string | undefined { if (d.year === undefined) return undefined; try { return toGregorian(d); } catch { return undefined; } }
