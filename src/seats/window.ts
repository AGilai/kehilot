import { HEBREW_DAY_LABELS, TZ, dayOfWeek, israelDate, upcomingFriday } from '../dates.ts';

/** When the Home card shows (default: opens Thursday 08:00, deadline Friday 14:00, Israel time). Offsets are days before the Friday. */
export type WindowConfig = { opens: { daysBefore: number; time: string }; deadline: { daysBefore: number; time: string } };
/** The Kehila's default deadline. Must equal the server's `seating_week.DEFAULT_DEADLINE` (tests/seatTimes.test.ts). */
export const DEFAULT_DEADLINE_HM = '14:00';
export const DEFAULT_WINDOW: WindowConfig = { opens: { daysBefore: 1, time: '08:00' }, deadline: { daysBefore: 0, time: DEFAULT_DEADLINE_HM } };

function offsetMs(instant: number): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(instant));
  const n = (t: string) => Number(p.find(x => x.type === t)!.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(instant / 1000) * 1000;
}

/** The instant of a wall-clock time ('YYYY-MM-DD', 'HH:MM') in Asia/Jerusalem, whatever the offset is on that day. */
export function israelInstant(date: string, hm: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hm.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - offsetMs(wall);
  t = wall - offsetMs(t);
  return new Date(t);
}

function minusDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/**
 * The Friday of the Shabbat Home is about: the next Friday by Israel's calendar (today, if it is Friday). On Saturday it is
 * the day before until `shabbatEndsAt` (no end known: all Saturday, like the server), then the next Friday.
 */
export function shabbatFriday(now: Date, shabbatEndsAt?: Date | null): string {
  const today = israelDate(now);
  if (dayOfWeek(today) === 6) return shabbatEndsAt && now > shabbatEndsAt ? upcomingFriday(today) : minusDays(today, 1);
  return upcomingFriday(today);
}

export function cardWindow(friday: string, cfg: WindowConfig = DEFAULT_WINDOW): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: israelInstant(minusDays(friday, cfg.opens.daysBefore), cfg.opens.time),
    closesAt: israelInstant(minusDays(friday, cfg.deadline.daysBefore), cfg.deadline.time),
  };
}

/** "יום שישי" / "Friday" and "12:00" for a moment, in Israel time (the {day} {time} of the seat copy). */
export function whenParts(at: Date, lang: 'he' | 'en'): { day: string; time: string } {
  return {
    day: new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'he-IL', { timeZone: TZ, weekday: 'long' }).format(at),
    time: new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at),
  };
}

/** "יום ו׳ 14:00" / "Fri 14:00": the short weekday and the time, never breaking between them. */
export function dayTime(at: Date, lang: 'he' | 'en'): string {
  const day = lang === 'en'
    ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(at)
    : `יום ${HEBREW_DAY_LABELS[dayOfWeek(israelDate(at))]}`;
  return `${day}\u00a0${whenParts(at, lang).time}`;
}

/**
 * When Shabbat ends, for `shabbatFriday`: only on Saturday (else null). The Kehila schedule's `shabbatEnd` ("HH:MM") wins;
 * without a schedule it is the loaded zmanim `nightfall` (ISO); with neither it is null (Saturday then lasts all day, like the server).
 */
export function shabbatEndFor(now: Date, from: { scheduleHm?: string | null; nightfall?: string | null }): Date | null {
  const today = israelDate(now);
  if (dayOfWeek(today) !== 6) return null;
  if (from.scheduleHm) return israelInstant(today, from.scheduleHm);
  if (from.nightfall) { const at = new Date(from.nightfall); return Number.isNaN(at.getTime()) ? null : at; }
  return null;
}
