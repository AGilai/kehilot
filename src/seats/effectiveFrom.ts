import { dayOfWeek, israelDate, upcomingFriday } from '../dates.ts';
import { addDays } from '../schedule/week.ts';
import { DEFAULT_WINDOW, cardWindow } from './window.ts';

/** The Friday of the Shabbat in progress or next (Saturday still counts as its Friday, like the server). */
export function currentShabbatFriday(today: string): string {
  return dayOfWeek(today) === 6 ? addDays(today, -1) : upcomingFriday(today);
}

/** UX §16.5: the first Shabbat that is not yet open for release (the member card opens Thursday 08:00 by default). */
export function defaultEffectiveFrom(now: Date): string {
  let friday = currentShabbatFriday(israelDate(now));
  while (cardWindow(friday, DEFAULT_WINDOW).opensAt <= now) friday = addDays(friday, 7);
  return friday;
}

/**
 * The save dialog's default date. In place on the open version whenever the server still takes writes to it (not before the current
 * Shabbat): the gabbai is fixing that map, and a copy from a later date would leave the open one, which is the map that counts until
 * then, unchanged. When the hall itself changed (cells, names, size), never into a Shabbat that is already open for answers. A past
 * version cannot be written: then a new version from the first Shabbat not yet open (UX §16.5).
 */
export function defaultSaveFrom(opened: string | null, now: Date, layoutChanged: boolean): string {
  const fallback = defaultEffectiveFrom(now);
  if (!opened || opened < currentShabbatFriday(israelDate(now))) return fallback;
  if (!layoutChanged) return opened;
  return opened >= fallback ? opened : fallback;
}

/** Fridays the save dialog offers: from the current Shabbat on (earlier ones are read-only on the server). */
export function effectiveOptions(now: Date, count = 14): string[] {
  const start = currentShabbatFriday(israelDate(now));
  return Array.from({ length: count }, (_, i) => addDays(start, i * 7));
}

/**
 * Ruling 6: is that Shabbat already open for answers? The server's week `open` (null when it could not be read) must be true, and the
 * member card must have opened (Thursday 08:00); without the server's word, the deadline rule alone decides.
 */
export function openForAnswers(now: Date, friday: string, weekOpen: boolean | null): boolean {
  const { opensAt, closesAt } = cardWindow(friday, DEFAULT_WINDOW);
  if (now < opensAt) return false;
  return weekOpen ?? now < closesAt;
}

/**
 * The save dialogs' open-week warning: from the member card's opening (Thursday 08:00) on, through the deadline and Shabbat, members
 * may have answered, so a save into that Shabbat changes seats they already see (seat-fix review I1).
 */
export function answersStarted(now: Date, friday: string): boolean {
  return now >= cardWindow(friday, DEFAULT_WINDOW).opensAt;
}

export type ReplaceWarning = { kind: 'same' | 'earlier'; seats: number; assigned: number } | null;
/** Saving writes the whole map and every assignment for `from`: warn when a version of that date, or the one in effect then, holds anything. */
export function replaceWarning(layouts: { effectiveFrom: string; seats: number; assigned: number }[], from: string): ReplaceWarning {
  const same = layouts.find((l) => l.effectiveFrom === from);
  if (same) return { kind: 'same', seats: same.seats, assigned: same.assigned };
  const earlier = layouts.filter((l) => l.effectiveFrom < from).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  return earlier && earlier.assigned > 0 ? { kind: 'earlier', seats: earlier.seats, assigned: earlier.assigned } : null;
}
