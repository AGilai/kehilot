// Prayer schedule types. The server (Task 2, Python) stores and validates this JSON as-is and never computes
// times; the shared TypeScript in this folder computes a week from it.
//
// JSON shape (all strings UTF-8; "HH:MM" = 24h wall clock Asia/Jerusalem, 00:00-23:59; dates "YYYY-MM-DD"):
//
//   Schedule = {
//     version: 1,
//     sections: Section[],                         // ordered; ids unique across sections
//     weekOverrides: { [fridayDate: string]: WeekOverrides }   // key = the schedule week's Friday
//   }
//   Section = { id: string, kind: "shabbat" | "weekday", title: Text, rows: Row[] }   // ids unique across rows
//   Text    = { he: string, en?: string }
//   Row     = { id: string, label: Text, note?: string, role?: "candles",
//               day?: "friday" | "shabbat",      // shabbat sections only; default: the formula's day, else "shabbat"
//               time: Time }
//   Time    = { kind: "none" }                                  // text-only row
//           | { kind: "fixed", at: "HH:MM" }
//           | { kind: "formula", formula: Formula }
//   Formula = {
//     anchor: "alotHaShachar" | "misheyakir" | "sunrise" | "sofZmanShmaMGA" | "sofZmanShmaGRA" | "sofZmanTfilaGRA" |
//             "chatzot" | "minchaGedola" | "minchaKetana" | "plagHaMincha" | "sunset" | "candleLighting" |
//             "tzeit" | "shabbatEnd",
//     day: "friday" | "shabbat"                    // shabbat sections
//        | "earliest" | "latest",                  // weekday sections: min / max over Sunday-Thursday of the week
//     offset: { minutes: integer 0..720, direction: "before" | "after" },
//     rounding: { mode: "none" } | { mode: "down" | "up" | "nearest", step: 1 | 5 | 10 | 15 },
//     notEarlierThan?: "HH:MM",
//     notLaterThan?: "HH:MM"
//   }
//   WeekOverrides = {
//     rows?: { [rowId: string]: { kind: "time", at: "HH:MM", note?: string } | { kind: "hide" } },
//     extra?: ExtraRow[]                           // rows that exist this week only
//   }
//   ExtraRow = { id: string, sectionId: string, afterRowId?: string | null, label: Text, note?: string,
//                day?: "friday" | "shabbat", time: Time }     // time: "none" | "fixed" | "formula"
//
// `role: "candles"` marks the candle-lighting row (it is never the "next prayer"; Home shows it on its own line);
// it is explicit, a row anchored on candleLighting (e.g. Kabbalat Shabbat = candles + 10) is still a prayer.
//
// Rules the validator should mirror: the formula order is offset, then rounding, then notEarlierThan, then
// notLaterThan (if both bounds cross, notLaterThan wins). `step` is only present when mode is not "none".
// Unknown keys are rejected. Only the shapes above exist; "the row's own day" is not offered (single-day sections
// come later).

export type Lang = 'he' | 'en';
export type Clock = string; // "HH:MM"

export const ANCHORS = [
  'alotHaShachar', 'misheyakir', 'sunrise', 'sofZmanShmaMGA', 'sofZmanShmaGRA', 'sofZmanTfilaGRA', 'chatzot',
  'minchaGedola', 'minchaKetana', 'plagHaMincha', 'sunset', 'candleLighting', 'tzeit', 'shabbatEnd',
] as const;
export type AnchorId = typeof ANCHORS[number];
export type DaySource = 'friday' | 'shabbat' | 'earliest' | 'latest';
export type RoundMode = 'none' | 'down' | 'up' | 'nearest';
export type RoundStep = 1 | 5 | 10 | 15;
export type Rounding = { mode: 'none' } | { mode: 'down' | 'up' | 'nearest'; step: RoundStep };
export type Formula = {
  anchor: AnchorId;
  day: DaySource;
  offset: { minutes: number; direction: 'before' | 'after' };
  rounding: Rounding;
  notEarlierThan?: Clock;
  notLaterThan?: Clock;
};
export type Time = { kind: 'none' } | { kind: 'fixed'; at: Clock } | { kind: 'formula'; formula: Formula };
export type Text = { he: string; en?: string };
export type ShabbatDay = 'friday' | 'shabbat';
export type Row = { id: string; label: Text; note?: string; role?: 'candles'; day?: ShabbatDay; time: Time };
export type Section = { id: string; kind: 'shabbat' | 'weekday'; title: Text; rows: Row[] };
export type RowOverride = { kind: 'time'; at: Clock; note?: string } | { kind: 'hide' };
export type ExtraRow = {
  id: string; sectionId: string; afterRowId?: string | null; label: Text; note?: string; day?: ShabbatDay; time: Time;
};
export type WeekOverrides = { rows?: Record<string, RowOverride>; extra?: ExtraRow[] };
export type Schedule = { version: 1; sections: Section[]; weekOverrides: Record<string, WeekOverrides> };

// Zmanim for one civil date as wall-clock times; an anchor is missing when it cannot be calculated.
export type DayZmanim = Partial<Record<AnchorId, Clock>>;
export type ZmanimFor = (date: string) => DayZmanim | null;

// Schedule week: Friday through the following Thursday. `weekdays` = Sunday..Thursday.
export type ScheduleWeek = { friday: string; shabbat: string; weekdays: string[]; thursday: string };

export type RowSource = 'fixed' | 'formula' | 'override' | 'text';
export type ComputedRow = {
  id: string; label: Text; note?: string; role?: 'candles'; day?: ShabbatDay;
  time: Clock | null; source: RowSource;
  usual?: Clock | null;        // override: what the row shows in other weeks
  overrideNote?: string;       // override: the week note
  added?: boolean;             // an extra row of this week only
};
export type ComputedSection = { id: string; kind: Section['kind']; title: Text; rows: ComputedRow[]; hidden: ComputedRow[] };
export type ComputedWeek = { week: ScheduleWeek; sections: ComputedSection[] };
