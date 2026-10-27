import { clockTime, dayOfWeek, israelDate } from '../dates.ts';
import { evaluate, parseClock } from './formula.ts';
import type {
  Clock, ComputedRow, ComputedSection, ComputedWeek, ExtraRow, Row, Schedule, ScheduleWeek, ShabbatDay, Time, ZmanimFor,
} from './types.ts';

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// The schedule week of a date: Friday through the following Thursday (docs/UX-DESIGN.md §14.1).
export function scheduleWeekOf(date: string): ScheduleWeek {
  const friday = addDays(date, -((dayOfWeek(date) + 2) % 7));
  return {
    friday, shabbat: addDays(friday, 1), weekdays: [2, 3, 4, 5, 6].map(days => addDays(friday, days)), thursday: addDays(friday, 6),
  };
}

function timeOf(time: Time, week: ScheduleWeek, zmanimFor: ZmanimFor): Clock | null {
  if (time.kind === 'fixed') return parseClock(time.at) === null ? null : time.at;
  return time.kind === 'formula' ? evaluate(time.formula, week, zmanimFor) : null;
}
const sourceOf = (time: Time): ComputedRow['source'] => time.kind === 'none' ? 'text' : time.kind;

// Which day of the week a Shabbat-section row happens on: its own `day`, else its formula's, else Shabbat.
export function rowDay(row: { day?: ShabbatDay; time: Time }): ShabbatDay {
  if (row.day) return row.day;
  return row.time.kind === 'formula' && row.time.formula.day === 'friday' ? 'friday' : 'shabbat';
}

function computeRow(row: Row | ExtraRow, kind: 'shabbat' | 'weekday', week: ScheduleWeek, zmanimFor: ZmanimFor): ComputedRow {
  const out: ComputedRow = { id: row.id, label: row.label, time: timeOf(row.time, week, zmanimFor), source: sourceOf(row.time) };
  if (row.note) out.note = row.note;
  if ('role' in row && row.role) out.role = row.role;
  if (kind === 'shabbat') out.day = rowDay(row);
  return out;
}

// `date` is any date; its schedule week is computed. Overrides are the week's own (keyed by its Friday).
export function computeWeek(schedule: Schedule, date: string, zmanimFor: ZmanimFor): ComputedWeek {
  const week = scheduleWeekOf(date);
  const overrides = schedule.weekOverrides[week.friday] ?? {};
  const sections: ComputedSection[] = schedule.sections.map(section => {
    const rows: ComputedRow[] = [];
    const hidden: ComputedRow[] = [];
    const extras = (overrides.extra ?? []).filter(extra => extra.sectionId === section.id);
    const addExtras = (afterId: string | null) => {
      for (const extra of extras) {
        if ((extra.afterRowId ?? null) === afterId) rows.push({ ...computeRow(extra, section.kind, week, zmanimFor), source: 'override', added: true });
      }
    };
    for (const row of section.rows) {
      const computed = computeRow(row, section.kind, week, zmanimFor);
      const override = overrides.rows?.[row.id];
      if (override?.kind === 'hide') hidden.push(computed);
      else if (override?.kind === 'time' && parseClock(override.at) !== null) {
        const changed: ComputedRow = { ...computed, time: override.at, source: 'override', usual: computed.time };
        if (override.note) changed.overrideNote = override.note;
        rows.push(changed);
      } else rows.push(computed);
      addExtras(row.id);
    }
    // Extras with no anchor row (null, or a row that no longer exists) go at the end.
    const known = new Set(section.rows.map(row => row.id));
    for (const extra of extras) {
      if (extra.afterRowId && !known.has(extra.afterRowId)) rows.push({ ...computeRow(extra, section.kind, week, zmanimFor), source: 'override', added: true });
    }
    addExtras(null);
    return { id: section.id, kind: section.kind, title: section.title, rows, hidden };
  });
  return { week, sections };
}

export const israelNow = (now = new Date()) => ({ date: israelDate(now), minutes: parseClock(clockTime(now.toISOString())) ?? 0 });

export type NextRow = { row: ComputedRow; section: ComputedSection; date: string; dayOffset: number; time: Clock };

// Next prayer per §14.1: the next timed row in time over today's weekday rows (Sun-Thu) and the Shabbat rows
// of the schedule week; text-only rows and candle lighting are never "next". A row at exactly `now` still counts.
// When today has nothing left it is the first row of the following days (tomorrow's first, `dayOffset` 1).
// Hidden rows are skipped, extra rows and overrides count. `now.date` is a civil date, `now.minutes` since 00:00.
export function nextRow(schedule: Schedule, now: { date: string; minutes: number }, zmanimFor: ZmanimFor): NextRow | null {
  const weeks = new Map<string, ComputedWeek>();
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const date = addDays(now.date, dayOffset);
    const friday = scheduleWeekOf(date).friday;
    if (!weeks.has(friday)) weeks.set(friday, computeWeek(schedule, date, zmanimFor));
    const computed = weeks.get(friday)!;
    const weekday = dayOfWeek(date) <= 4;
    let best: NextRow | null = null;
    for (const section of computed.sections) {
      for (const row of section.rows) {
        if (row.time === null || row.role === 'candles' || row.source === 'text') continue;
        if (section.kind === 'weekday' ? !weekday : (row.day === 'friday' ? computed.week.friday : computed.week.shabbat) !== date) continue;
        const minutes = parseClock(row.time);
        if (minutes === null || (dayOffset === 0 && minutes < now.minutes)) continue;
        if (!best || minutes < parseClock(best.time)!) best = { row, section, date, dayOffset, time: row.time };
      }
    }
    if (best) return best;
  }
  return null;
}
