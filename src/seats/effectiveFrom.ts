import { dayOfWeek, israelDate, upcomingFriday } from '../dates.ts';
import { addDays } from '../schedule/week.ts';
import { DEFAULT_WINDOW, cardWindow } from './window.ts';

/** The Friday of the Shabbat in progress or next (Saturday still counts as its Friday, like the server). */
export function currentShabbatFriday(today: string): string {
  return dayOfWeek(today) === 6 ? addDays(today, -1) : upcomingFriday(today);
}

/** UX §16.5: the first Shabbat that is not yet open for release (the member card opens Thursday 12:00 by default). */
export function defaultEffectiveFrom(now: Date): string {
  let friday = currentShabbatFriday(israelDate(now));
  while (cardWindow(friday, DEFAULT_WINDOW).opensAt <= now) friday = addDays(friday, 7);
  return friday;
}

/** Fridays the save dialog offers: from the current Shabbat on (earlier ones are read-only on the server). */
export function effectiveOptions(now: Date, count = 14): string[] {
  const start = currentShabbatFriday(israelDate(now));
  return Array.from({ length: count }, (_, i) => addDays(start, i * 7));
}
