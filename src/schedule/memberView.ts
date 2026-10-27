// Member-facing logic for the prayer schedule (docs/UX-DESIGN.md §14.3-14.4): which mode the Home card is in, what it
// shows, the countdown, and the full-schedule week. Pure: no React, no clock (the caller passes `now`).
import { dayOfWeek, upcomingFriday } from '../dates.ts';
import { parseClock } from './formula.ts';
import type { Clock, ComputedRow, ComputedSection, ComputedWeek, Schedule, ScheduleDoc, ScheduleWeek, Text, ZmanimFor } from './types.ts';
import { addDays, computeWeek, scheduleWeekOf, timedRowsOn } from './week.ts';
import { candleTimeAt } from './zmanim.ts';

export type Now = { date: string; minutes: number };
export type CardMode = 'shabbat' | 'weekday';

const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;
export const COUNTDOWN_MINUTES = 360;
export const SHABBAT_TAIL_MINUTES = 60;

/** Shabbat mode runs from Thursday 00:00 until one hour after Shabbat ends (or after the last Shabbat row, if later). */
export function cardMode(schedule: Schedule, now: Now, zmanimFor: ZmanimFor): CardMode {
  const dow = dayOfWeek(now.date);
  if (dow === THURSDAY || dow === FRIDAY) return 'shabbat';
  if (dow !== SATURDAY) return 'weekday';
  let end = parseClock(zmanimFor(now.date)?.shabbatEnd ?? '');
  for (const section of computeWeek(schedule, now.date, zmanimFor).sections) {
    if (section.kind !== 'shabbat') continue;
    for (const row of section.rows) {
      const at = row.time === null ? null : parseClock(row.time);
      if (at !== null && row.day === 'shabbat' && (end === null || at > end)) end = at;
    }
  }
  return end === null || now.minutes < end + SHABBAT_TAIL_MINUTES ? 'shabbat' : 'weekday';
}

/** The schedule week of the Shabbat the card is about: today's on Saturday (while Shabbat mode lasts), else the coming one. */
export function upcomingShabbatWeek(now: Now, mode: CardMode): ScheduleWeek {
  return scheduleWeekOf(dayOfWeek(now.date) === SATURDAY && mode === 'shabbat' ? addDays(now.date, -1) : upcomingFriday(now.date));
}

export type Countdown = { h: number; m: number };
/** Minutes until a row, only for a row today and only within 6 hours; null otherwise. */
export function countdown(dayOffset: number, rowMinutes: number, nowMinutes: number): Countdown | null {
  const diff = rowMinutes - nowMinutes;
  if (dayOffset !== 0 || diff < 0 || diff > COUNTDOWN_MINUTES) return null;
  return { h: Math.floor(diff / 60), m: diff % 60 };
}
/** The i18n key (docs/UX-DESIGN.md §14.8) and parameters of a countdown. */
export function countdownText(c: Countdown): { key: string; params: Record<string, number> } {
  if (c.h === 0) return c.m === 0 ? { key: 'schedule.now', params: {} } : { key: 'schedule.inMin', params: { m: c.m } };
  const base = c.h === 1 ? 'inHour' : c.h === 2 ? 'inTwoHours' : 'inHours';
  return { key: `schedule.${base}${c.m === 0 ? 'Only' : ''}`, params: c.h > 2 ? { h: c.h, m: c.m } : { m: c.m } };
}

/** The city zmanim card is open by default only when the Kehila has no schedule; the member's own choice wins. */
export function zmanimOpen(stored: string | null, hasSchedule: boolean): boolean {
  return stored === 'open' ? true : stored === 'closed' ? false : !hasSchedule;
}
export const zmanimOpenKey = (hasSchedule: boolean) => `kehilot.zmanimCard.${hasSchedule ? 'schedule' : 'none'}`;

export type CardRow = {
  row: ComputedRow; section: ComputedSection; date: string; dayOffset: number; time: Clock; minutes: number; today: boolean;
};
export type CardModel = {
  mode: CardMode;
  /** 'today' / 'tomorrow' (weekday mode, after the day's last row) / 'shabbat'. */
  header: 'shabbat' | 'today' | 'tomorrow';
  week: ScheduleWeek;
  next: (CardRow & { countdown: Countdown | null }) | null;
  following: CardRow[];
  /** Shabbat mode: the sheet's candle-lighting line; weekday mode: the Friday time of the candle row. */
  candles: Clock | null;
};

/** Timed rows from `now` on, in time order, up to `limit`, not past `untilDate` (inclusive). */
export function upcomingRows(schedule: Schedule, now: Now, zmanimFor: ZmanimFor, limit: number, untilDate?: string): CardRow[] {
  const out: CardRow[] = [];
  const weeks = new Map<string, ComputedWeek>();
  for (let dayOffset = 0; dayOffset <= 8 && out.length < limit; dayOffset++) {
    const date = addDays(now.date, dayOffset);
    if (untilDate && date > untilDate) break;
    const friday = scheduleWeekOf(date).friday;
    if (!weeks.has(friday)) weeks.set(friday, computeWeek(schedule, date, zmanimFor));
    for (const item of timedRowsOn(weeks.get(friday)!, date)) {
      if (dayOffset === 0 && item.minutes < now.minutes) continue;
      if (out.length < limit) out.push({ ...item, date, dayOffset, today: dayOffset === 0 });
    }
  }
  return out;
}

/** The candle-lighting row's time in a schedule week (its override counts), if the schedule has one. */
export function candleRowTime(week: ComputedWeek): Clock | null {
  for (const section of week.sections) for (const row of section.rows) if (row.role === 'candles' && row.time) return row.time;
  return null;
}

export function hasTimedRows(schedule: Schedule): boolean {
  return schedule.sections.some(section => section.rows.some(row => row.time.kind !== 'none'));
}

/** What the Home schedule card shows; null when the Kehila has no schedule rows (Home then shows the old cards). */
export function homeCardModel(schedule: Schedule, now: Now, zmanimFor: ZmanimFor): CardModel | null {
  if (!hasTimedRows(schedule)) return null;
  const mode = cardMode(schedule, now, zmanimFor);
  const week = upcomingShabbatWeek(now, mode);
  const candles = candleRowTime(computeWeek(schedule, week.friday, zmanimFor));
  const base = { mode, week, candles };
  if (mode === 'shabbat') {
    const within = upcomingRows(schedule, now, zmanimFor, 5, week.shabbat);
    if (within.length) return { ...base, header: 'shabbat', next: withCountdown(within[0]!, now), following: within.slice(1) };
    const later = upcomingRows(schedule, now, zmanimFor, 1)[0];
    return { ...base, header: 'shabbat', next: later ? withCountdown(later, now) : null, following: [] };
  }
  const today = upcomingRows(schedule, now, zmanimFor, 4, now.date);
  if (today.length) return { ...base, header: 'today', next: withCountdown(today[0]!, now), following: today.slice(1) };
  const first = upcomingRows(schedule, now, zmanimFor, 1)[0];
  if (!first) return { ...base, header: 'today', next: null, following: [] };
  const tomorrow = upcomingRows(schedule, now, zmanimFor, 3, first.date);
  return { ...base, header: 'tomorrow', next: withCountdown(tomorrow[0]!, now), following: tomorrow.slice(1) };
}
const withCountdown = (row: CardRow, now: Now) => ({ ...row, countdown: countdown(row.dayOffset, row.minutes, now.minutes) });

/** Shabbat-mode candle line: one entry per city of the sheet, or the Kehila's own candle row when the sheet names none. */
export function candleLine(doc: ScheduleDoc, week: ScheduleWeek, fallback: Clock | null): Array<{ name: Text | null; time: Clock }> {
  const cities = doc.sheet.candleCities.flatMap(city => {
    const time = candleTimeAt(week.friday, city);
    return time ? [{ name: city.name, time }] : [];
  });
  return cities.length ? cities : fallback ? [{ name: null, time: fallback }] : [];
}

// ---- full schedule (P22) -------------------------------------------------------------------------------------------

export type FullModel = {
  week: ScheduleWeek;
  computed: ComputedWeek;
  sections: ComputedSection[];       // display order: Shabbat first from Thursday (and for next week), else weekdays first
  next: { rowId: string; date: string; countdown: Countdown | null } | null;
  /** Rows of this week already past today (muted), by row id. */
  past: Set<string>;
};

/** `weekIndex` 0 = the week the card is about (from Thursday: the coming Shabbat's week), 1 = the one after. */
export function fullModel(schedule: Schedule, now: Now, zmanimFor: ZmanimFor, weekIndex: 0 | 1): FullModel {
  const mode = cardMode(schedule, now, zmanimFor);
  // Sunday-Wednesday the week in progress began last Friday; from Thursday on the Shabbat card's week is the one to read.
  const startsHere = mode === 'shabbat' ? upcomingShabbatWeek(now, mode) : scheduleWeekOf(now.date);
  const week = weekIndex === 0 ? startsHere : scheduleWeekOf(addDays(startsHere.friday, 7));
  const computed = computeWeek(schedule, week.friday, zmanimFor);
  const shabbatFirst = weekIndex === 1 || mode === 'shabbat';
  const sections = [...computed.sections].sort((a, b) => (a.kind === b.kind ? 0 : (a.kind === 'shabbat') === shabbatFirst ? -1 : 1));
  const first = weekIndex === 0 ? upcomingRows(schedule, now, zmanimFor, 1)[0] : undefined;
  const inWeek = first && computed.sections.some(s => s.rows.some(r => r.id === first.row.id)) && (first.section.kind === 'weekday' ? week.weekdays.includes(first.date) : first.date === week.friday || first.date === week.shabbat);
  const next = first && inWeek ? { rowId: first.row.id, date: first.date, countdown: countdown(first.dayOffset, first.minutes, now.minutes) } : null;
  const past = new Set<string>();
  if (weekIndex === 0) {
    for (const section of computed.sections) for (const row of section.rows) {
      const at = row.time ? parseClock(row.time) : null;
      if (at === null || row.role === 'candles') continue;
      const date = section.kind === 'weekday' ? (week.weekdays.includes(now.date) ? now.date : null) : (row.day === 'friday' ? week.friday : week.shabbat);
      if (date === now.date && at < now.minutes) past.add(row.id);
    }
  }
  return { week, computed, sections, next, past };
}

// ---- labels ------------------------------------------------------------------------------------------------------

/** "08:30" -> "8:30" (the frames write times without a leading zero). */
export const clockLabel = (clock: Clock): string => clock.replace(/^0/, '');
/** "2026-10-30" -> "30.10". */
export const shortDate = (date: string): string => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
/** "30–31.10" within a month (compact), else "30.10–1.11". */
export function dateRange(from: string, to: string, compact = false): string {
  // Isolated left-to-right so the dash does not reorder the numbers inside a Hebrew line.
  const range = compact && from.slice(5, 7) === to.slice(5, 7) ? `${Number(from.slice(8, 10))}–${shortDate(to)}` : `${shortDate(from)}–${shortDate(to)}`;
  return `\u2066${range}\u2069`;
}
export const textIn = (text: Text, lang: 'he' | 'en'): string => (lang === 'en' && text.en ? text.en : text.he);

/** The place name for "times are calculated for ...": the server stores no name, so only the default place is named. */
export function isDefaultPlace(location: { latitude: number; longitude: number }): boolean {
  return Math.abs(location.latitude - 32.0878) < 0.02 && Math.abs(location.longitude - 34.8878) < 0.02;
}
