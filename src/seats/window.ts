import { TZ, israelDate, upcomingFriday } from '../dates.ts';

/** When the reminder card shows (default: Thursday 12:00 until Friday 12:00, Israel time). Offsets are days before the Friday. */
export type WindowConfig = { reminder: { daysBefore: number; time: string }; deadline: { daysBefore: number; time: string } };
export const DEFAULT_WINDOW: WindowConfig = { reminder: { daysBefore: 1, time: '12:00' }, deadline: { daysBefore: 0, time: '12:00' } };

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

/** The Friday of the Shabbat the card is about: the next Friday by Israel's calendar (today, if it is Friday). */
export function shabbatFriday(now: Date): string {
  return upcomingFriday(israelDate(now));
}

export function cardWindow(friday: string, cfg: WindowConfig = DEFAULT_WINDOW): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: israelInstant(minusDays(friday, cfg.reminder.daysBefore), cfg.reminder.time),
    closesAt: israelInstant(minusDays(friday, cfg.deadline.daysBefore), cfg.deadline.time),
  };
}

/** Real timing (Thu 12:00 to Fri 12:00). The preview deliberately does not use it: UX §15.4 shows the card always; the server version will gate Home on this. */
export type CardState = 'before' | 'open' | 'closed';
export function seatCardState(now: Date, friday: string = shabbatFriday(now), cfg: WindowConfig = DEFAULT_WINDOW): CardState {
  const { opensAt, closesAt } = cardWindow(friday, cfg);
  return now < opensAt ? 'before' : now < closesAt ? 'open' : 'closed';
}

/** "יום שישי" / "Friday" and "12:00" for a moment, in Israel time (the {day} {time} of the seat copy). */
export function whenParts(at: Date, lang: 'he' | 'en'): { day: string; time: string } {
  return {
    day: new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'he-IL', { timeZone: TZ, weekday: 'long' }).format(at),
    time: new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at),
  };
}
