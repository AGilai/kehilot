// The seat form's times for one Shabbat, mirrored from server/cloud/seat_times.py (opening < reminder 1 < reminder 2 < deadline).
// Pure rules; tests/seatTimes.test.ts keeps the defaults equal to the server's.

export type Day = 'thu' | 'fri';
export type Slot = { day: Day; time: string };
export type ReminderSetting = Slot & { on: boolean };
export type Which = '1' | '2' | 'deadline';
/** `GET/PUT admin/seats/times`. `deadline` is Friday at that time; `pending` is null with no layout. */
export type SeatTimes = {
  opens: Slot; reminders: Record<'1' | '2', ReminderSetting>; deadline: string; week: string;
  layout: boolean; pending: number | null; sent: Record<'1' | '2', boolean>;
};

export const OPENS: Slot = { day: 'thu', time: '08:00' };
export const DEFAULT_REMINDERS: Record<'1' | '2', ReminderSetting> = {
  '1': { on: true, day: 'thu', time: '20:00' },
  '2': { on: true, day: 'fri', time: '11:00' },
};
export const MIN_GAP = 30;
const STEP = 15;
const DAY_MIN = 1440;

const hm = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const pad = (n: number): string => String(n).padStart(2, '0');

/** Minutes from Thursday 00:00. */
export const weekMinute = (s: Slot): number => (s.day === 'fri' ? DAY_MIN : 0) + hm(s.time);
const slotAt = (minute: number): Slot => {
  const day: Day = minute >= DAY_MIN ? 'fri' : 'thu';
  const m = minute - (day === 'fri' ? DAY_MIN : 0);
  return { day, time: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` };
};

/** The steps of the chain that are on, in order: the opening, the reminders that are on, the deadline. */
function chain(t: SeatTimes): Array<{ which: Which | 'opens'; minute: number }> {
  const out: Array<{ which: Which | 'opens'; minute: number }> = [{ which: 'opens', minute: weekMinute(t.opens) }];
  for (const n of ['1', '2'] as const) if (t.reminders[n].on) out.push({ which: n, minute: weekMinute(t.reminders[n]) });
  out.push({ which: 'deadline', minute: weekMinute({ day: 'fri', time: t.deadline }) });
  return out;
}

/** Where `which` may sit given its neighbours (30 minutes from each); null for a reminder that is off or when nothing fits. */
export function allowedRange(t: SeatTimes, which: Which): { from: Slot; to: Slot } | null {
  if (which !== 'deadline' && !t.reminders[which].on) return null;
  const steps = chain(t);
  const i = steps.findIndex((s) => s.which === which);
  const prev = steps[i - 1]!;
  const next = steps[i + 1];
  const from = prev.minute + MIN_GAP;
  const to = next ? next.minute - MIN_GAP : 2 * DAY_MIN - STEP;
  const lo = which === 'deadline' ? Math.max(from, DAY_MIN) : from;
  return lo <= to ? { from: slotAt(lo), to: slotAt(to) } : null;
}

/** Is `slot` an allowed time for `which`: a quarter hour, on Thursday or Friday (the deadline on Friday), inside the range. */
export function fits(t: SeatTimes, which: Which, slot: Slot): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time) || hm(slot.time) % STEP !== 0) return false;
  if (slot.day !== 'thu' && slot.day !== 'fri') return false;
  if (which === 'deadline' && slot.day !== 'fri') return false;
  const r = allowedRange(t, which);
  if (!r) return false;
  const m = weekMinute(slot);
  return m >= weekMinute(r.from) && m <= weekMinute(r.to);
}

/** "ה׳ 08:30" / "Thu 08:30", never breaking between day and time. */
export const slotLabel = (s: Slot, lang: 'he' | 'en'): string =>
  `${lang === 'en' ? (s.day === 'thu' ? 'Thu' : 'Fri') : s.day === 'thu' ? 'ה׳' : 'ו׳'}\u00a0${s.time}`;

export const onCount = (t: SeatTimes): 0 | 1 | 2 => ((t.reminders['1'].on ? 1 : 0) + (t.reminders['2'].on ? 1 : 0)) as 0 | 1 | 2;
