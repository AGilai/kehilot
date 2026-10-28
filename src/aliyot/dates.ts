// Ported from origin/main 6d74d0e src/dates.ts (formatCivilDate, pickerDate, isYomKippur); our src/dates.ts has the rest.
import { HDate } from '@hebcal/hdate';
import { validCivilDate } from '../dates.ts';

export function formatCivilDate(value: string): string {
  if (!value) return '';
  if (!validCivilDate(value, true)) return '—';
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year}`;
}
export function pickerDate(value: string): Date {
  if (!validCivilDate(value, true)) throw new Error('יש לבחור תאריך תקין.');
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(0);
  result.setFullYear(year!, month! - 1, day!);
  result.setHours(12, 0, 0, 0);
  return result;
}
export function isYomKippur(value: string): boolean {
  if (!validCivilDate(value, true)) return false;
  const hebrew = new HDate(pickerDate(value));
  return hebrew.getMonth() === 7 && hebrew.getDate() === 10;
}
