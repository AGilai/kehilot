import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockTime } from '../src/dates.ts';
import { describe, evaluate } from '../src/schedule/formula.ts';
import type { DayZmanim, Formula, Row, Schedule, ZmanimFor } from '../src/schedule/types.ts';
import { computeWeek, nextRow, scheduleWeekOf } from '../src/schedule/week.ts';
import { DEFAULT_ZMANIM_SETTINGS, offlineDayZmanim, offlineZmanimFor } from '../src/schedule/zmanim.ts';
import { yeshivaReference } from '../src/zmanim.ts';

const offline = offlineZmanimFor();
const f = (patch: Partial<Formula> & Pick<Formula, 'anchor' | 'day'>): Formula => ({
  offset: { minutes: 0, direction: 'before' }, rounding: { mode: 'none' }, ...patch,
});
const sunsetEarliest = f({ anchor: 'sunset', day: 'earliest', offset: { minutes: 15, direction: 'before' }, rounding: { mode: 'down', step: 5 }, notLaterThan: '18:30' });

// ---- calendar -----------------------------------------------------------------------------------------------

test('schedule week runs Friday to the following Thursday', () => {
  const expected = { friday: '2026-11-06', shabbat: '2026-11-07', weekdays: ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'], thursday: '2026-11-12' };
  for (const day of ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-10', '2026-11-12']) assert.deepEqual(scheduleWeekOf(day), expected, day);
  assert.equal(scheduleWeekOf('2026-11-13').friday, '2026-11-13');
  assert.equal(scheduleWeekOf('2026-11-05').friday, '2026-10-30');
});

// ---- offline zmanim vs Home ---------------------------------------------------------------------------------

test('offline zmanim match the supplied Petah Tikva Yeshiva table within one minute', () => {
  const reference = yeshivaReference('2026-10-25')!;
  const mine = offlineDayZmanim('2026-10-25')!;
  const pairs: [string, keyof DayZmanim][] = [['sunrise', 'sunrise'], ['sofZmanShma', 'sofZmanShmaGRA'], ['sofZmanTfilla', 'sofZmanTfilaGRA'],
    ['minchaGedola', 'minchaGedola'], ['plagHaMincha', 'plagHaMincha'], ['sunset', 'sunset'], ['nightfall', 'tzeit']];
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  for (const [key, ours] of pairs) {
    const diff = Math.abs(minutes(mine[ours]!) - minutes(clockTime(reference.times[key])));
    assert.ok(diff <= 1, `${key}: ${mine[ours]} vs ${clockTime(reference.times[key])}`);
  }
});

test('offline zmanim use the Home rules (same values as applyYeshivaRules on the same astronomy)', () => {
  const z = offlineDayZmanim('2026-10-25')!;
  assert.deepEqual([z.sunset, z.tzeit, z.minchaGedola, z.sunrise], ['16:57', '17:16', '11:55', '05:52']);
  assert.equal(offlineDayZmanim('2026-10-23')!.sunset, '17:59'); // still summer time on Friday
  assert.equal(offlineDayZmanim('2026-10-24')!.shabbatEnd, '18:17');
});

test('offline zmanim do not depend on the machine time zone', () => {
  const before = JSON.stringify(offlineDayZmanim('2026-03-27'));
  const original = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try { assert.equal(JSON.stringify(offlineDayZmanim('2026-03-27')), before); } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('candle lighting is sunset minus the Kehila minutes, rounded down; tzeit and Shabbat end follow their rules', () => {
  assert.equal(offlineDayZmanim('2026-11-06')!.candleLighting, '16:06'); // sunset 16:46 - 40
  assert.equal(offlineDayZmanim('2026-11-06', { ...DEFAULT_ZMANIM_SETTINGS, candleMinutes: 18 })!.candleLighting, '16:28');
  assert.equal(offlineDayZmanim('2026-11-07', { ...DEFAULT_ZMANIM_SETTINGS, shabbatEnd: { kind: 'minutes', minutes: 72 } })!.shabbatEnd, '17:58'); // 16:45:xx + 72, rounded up
  const degrees = offlineDayZmanim('2026-11-07', { ...DEFAULT_ZMANIM_SETTINGS, tzeit: { kind: 'degrees', degrees: 8.5 } })!.tzeit!;
  assert.match(degrees, /^17:[2-4]\d$/);
});

// ---- formulas on fake zmanim ----------------------------------------------------------------------------------

const week = scheduleWeekOf('2026-11-06');
const fake = (sunsets: Record<string, string>): ZmanimFor => date => sunsets[date] ? { sunset: sunsets[date] } : null;
const flat = (sunset: string): ZmanimFor => () => ({ sunset, candleLighting: '16:10', shabbatEnd: '17:05' });

test('= shkia, = shkia - 5, rounding directions', () => {
  const z = flat('16:56');
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday' }), week, z), '16:56');
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday', offset: { minutes: 5, direction: 'before' } }), week, z), '16:51');
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday', offset: { minutes: 5, direction: 'after' } }), week, z), '17:01');
  const round = (mode: 'down' | 'up' | 'nearest', step: 1 | 5 | 10 | 15, sunset: string, minutes = 5) =>
    evaluate(f({ anchor: 'sunset', day: 'friday', offset: { minutes, direction: 'before' }, rounding: { mode, step } }), week, flat(sunset));
  assert.equal(round('down', 5, '16:56'), '16:50');
  assert.equal(round('up', 5, '16:56'), '16:55');
  assert.equal(round('nearest', 5, '16:56'), '16:50'); // 16:51
  assert.equal(round('nearest', 5, '16:58'), '16:55'); // 16:53 -> 16:55
});

test('rounding exactly on a mark leaves the time alone in every direction', () => {
  const at = (mode: 'down' | 'up' | 'nearest', step: 1 | 5 | 10 | 15, sunset: string) =>
    evaluate(f({ anchor: 'sunset', day: 'friday', rounding: { mode, step } }), week, flat(sunset));
  for (const mode of ['down', 'up', 'nearest'] as const) {
    for (const [step, mark] of [[1, '16:57'], [5, '16:55'], [10, '16:50'], [15, '17:00']] as const) assert.equal(at(mode, step, mark), mark, `${mode} ${step}`);
  }
  assert.equal(at('nearest', 10, '16:55'), '17:00'); // halfway rounds up
  assert.equal(at('down', 15, '16:59'), '16:45');
  assert.equal(at('up', 15, '17:01'), '17:15');
});

test('rounding is applied after the offset and bounds last; a tighter bound wins; crossing bounds: not-later wins', () => {
  const z = flat('16:56');
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday', offset: { minutes: 1, direction: 'after' }, rounding: { mode: 'up', step: 5 } }), week, z), '17:00'); // 16:57 -> 17:00
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday', rounding: { mode: 'down', step: 5 }, notLaterThan: '16:30' }), week, z), '16:30');
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday', rounding: { mode: 'down', step: 5 }, notEarlierThan: '17:10' }), week, z), '17:10');
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday', notEarlierThan: '17:10', notLaterThan: '16:30' }), week, z), '16:30');
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday', notEarlierThan: '16:00', notLaterThan: '18:00' }), week, z), '16:56');
});

test('earliest / latest take the anchor over Sunday to Thursday only', () => {
  const z = fake({ '2026-11-06': '10:00', '2026-11-07': '10:00', '2026-11-08': '16:50', '2026-11-09': '16:49', '2026-11-10': '16:48', '2026-11-11': '16:47', '2026-11-12': '16:52', '2026-11-13': '09:00' });
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'earliest' }), week, z), '16:47');
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'latest' }), week, z), '16:52');
  assert.equal(evaluate(sunsetEarliest, week, z), '16:30'); // 16:47 - 15 = 16:32 -> 16:30
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'shabbat' }), week, z), '10:00');
});

test('a missing zman on any needed day gives null', () => {
  const z = fake({ '2026-11-08': '16:50', '2026-11-09': '16:49' });
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'earliest' }), week, z), null);
  assert.equal(evaluate(f({ anchor: 'tzeit', day: 'friday' }), week, flat('16:56')), null);
  assert.equal(evaluate(f({ anchor: 'sunset', day: 'friday', offset: { minutes: 720, direction: 'before' } }), week, flat('11:00')), null); // before midnight
});

// ---- the formulas of the brief on real (offline) weeks, incl. both DST switch weeks ------------------------------

const results = (date: string) => {
  const w = scheduleWeekOf(date);
  const at = (formula: Formula) => evaluate(formula, w, offline);
  return {
    shkia: at(f({ anchor: 'sunset', day: 'earliest' })),
    minus5: at(f({ anchor: 'sunset', day: 'earliest', offset: { minutes: 5, direction: 'before' } })),
    minus5Down5: at(f({ anchor: 'sunset', day: 'earliest', offset: { minutes: 5, direction: 'before' }, rounding: { mode: 'down', step: 5 } })),
    capped: at(sunsetEarliest),
    candles: at(f({ anchor: 'candleLighting', day: 'friday' })),
    tzeit: at(f({ anchor: 'tzeit', day: 'latest' })),
    shabbatEnd: at(f({ anchor: 'shabbatEnd', day: 'shabbat' })),
  };
};

test('normal week (Fri 2026-11-06)', () => {
  assert.deepEqual(results('2026-11-06'), { shkia: '16:42', minus5: '16:37', minus5Down5: '16:35', capped: '16:25', candles: '16:06', tzeit: '17:03', shabbatEnd: '17:04' });
});

test('October DST week (Fri 2026-10-23, clocks go back Sunday 25th): Friday in summer time, Sun-Thu in winter time', () => {
  assert.deepEqual(results('2026-10-23'), { shkia: '16:53', minus5: '16:48', minus5Down5: '16:45', capped: '16:35', candles: '17:19', tzeit: '17:16', shabbatEnd: '18:17' });
  // the weekday earliest sunset is Thursday's, not Friday's 17:59
  assert.equal(offline('2026-10-29')!.sunset, '16:53');
});

test('March DST week (Fri 2026-03-27, clocks forward that morning): the 18:30 bound caps the weekday time', () => {
  assert.deepEqual(results('2026-03-27'), { shkia: '18:58', minus5: '18:53', minus5Down5: '18:50', capped: '18:30', candles: '18:16', tzeit: '19:20', shabbatEnd: '19:16' });
});

test('the week before the March switch is all winter time', () => {
  const r = results('2026-03-20');
  assert.deepEqual([r.shkia, r.capped, r.candles, r.shabbatEnd], ['17:53', '17:35', '17:11', '18:11']);
});

test('winter week (Fri 2027-01-08)', () => {
  assert.deepEqual(results('2027-01-08'), { shkia: '16:53', minus5: '16:48', minus5Down5: '16:45', capped: '16:35', candles: '16:12', tzeit: '17:16', shabbatEnd: '17:11' });
});

// ---- describe -------------------------------------------------------------------------------------------------

test('describe: Hebrew and English plain-language summaries (UX-DESIGN §14.8)', () => {
  assert.equal(describe(sunsetEarliest, 'he'), '15 דקות לפני השקיעה המוקדמת בימים א׳–ה׳, מעוגל למטה ל־5, לא אחרי 18:30.');
  assert.equal(describe(sunsetEarliest, 'en'), '15 minutes before earliest sunset on Sun–Thu, rounded down to 5, not later than 18:30.');
  const exact = f({ anchor: 'sunset', day: 'friday' });
  assert.equal(describe(exact, 'he'), 'בדיוק בשקיעה ביום שישי.');
  assert.equal(describe(exact, 'en'), 'Exactly at sunset on Friday.');
  const minus5 = f({ anchor: 'sunset', day: 'shabbat', offset: { minutes: 5, direction: 'before' }, rounding: { mode: 'down', step: 5 } });
  assert.equal(describe(minus5, 'he'), '5 דקות לפני השקיעה בשבת, מעוגל למטה ל־5.');
  assert.equal(describe(f({ anchor: 'tzeit', day: 'latest', rounding: { mode: 'up', step: 5 } }), 'he'), 'בצאת הכוכבים המאוחרת בימים א׳–ה׳, מעוגל למעלה ל־5.');
  assert.equal(describe(f({ anchor: 'minchaGedola', day: 'latest', offset: { minutes: 1, direction: 'after' }, rounding: { mode: 'nearest', step: 10 }, notEarlierThan: '13:00' }), 'he'),
    'דקה אחת אחרי מנחה גדולה המאוחרת בימים א׳–ה׳, מעוגל לקרוב ל־10, לא לפני 13:00.');
  assert.equal(describe(f({ anchor: 'candleLighting', day: 'friday', offset: { minutes: 2, direction: 'after' } }), 'en'), '2 minutes after candle lighting on Friday.');
  assert.equal(describe(f({ anchor: 'plagHaMincha', day: 'earliest', offset: { minutes: 10, direction: 'before' }, rounding: { mode: 'nearest', step: 5 } }), 'en'),
    '10 minutes before earliest Plag HaMincha on Sun–Thu, rounded to the nearest 5.');
});

// ---- computeWeek, overrides, next ----------------------------------------------------------------------------

const row = (id: string, he: string, time: Row['time'], extra: Partial<Row> = {}): Row => ({ id, label: { he, en: id }, time, ...extra });
const schedule: Schedule = {
  version: 1,
  sections: [
    { id: 'shabbat', kind: 'shabbat', title: { he: 'שבת' }, rows: [
      row('candles', 'הדלקת נרות', { kind: 'formula', formula: f({ anchor: 'candleLighting', day: 'friday' }) }, { role: 'candles' }),
      row('kabbalat', 'קבלת שבת', { kind: 'formula', formula: f({ anchor: 'candleLighting', day: 'friday', offset: { minutes: 10, direction: 'after' } }) }),
      row('shacharit', 'שחרית', { kind: 'fixed', at: '08:30' }),
      row('lessons', 'שיעורים אחרי התפילה', { kind: 'none' }, { note: 'לגברים, נשים וילדים' }),
      row('shabbat-end', 'צאת השבת', { kind: 'formula', formula: f({ anchor: 'shabbatEnd', day: 'shabbat' }) }),
    ] },
    { id: 'weekday', kind: 'weekday', title: { he: 'ימי חול' }, rows: [
      row('shacharit-1', 'שחרית א׳', { kind: 'fixed', at: '06:30' }),
      row('mincha', 'מנחה', { kind: 'formula', formula: sunsetEarliest }),
      row('arvit', 'ערבית', { kind: 'fixed', at: '17:30' }),
    ] },
  ],
  weekOverrides: {},
};
const rows = (computed: ReturnType<typeof computeWeek>, section: string) => computed.sections.find(s => s.id === section)!.rows;

test('computeWeek marks rows fixed / formula / text and keeps Shabbat rows on their day', () => {
  const computed = computeWeek(schedule, '2026-11-09', offline); // Monday: the week that began Friday the 6th
  assert.equal(computed.week.friday, '2026-11-06');
  const shabbat = rows(computed, 'shabbat');
  assert.deepEqual(shabbat.map(r => [r.id, r.time, r.source, r.day]), [
    ['candles', '16:06', 'formula', 'friday'], ['kabbalat', '16:16', 'formula', 'friday'], ['shacharit', '08:30', 'fixed', 'shabbat'],
    ['lessons', null, 'text', 'shabbat'], ['shabbat-end', '17:04', 'formula', 'shabbat'],
  ]);
  assert.equal(shabbat[0]!.role, 'candles');
  assert.equal(shabbat[3]!.note, 'לגברים, נשים וילדים');
  assert.deepEqual(rows(computed, 'weekday').map(r => [r.time, r.source]), [['06:30', 'fixed'], ['16:25', 'formula'], ['17:30', 'fixed']]);
});

const withOverrides = (friday: string, overrides: Schedule['weekOverrides'][string]): Schedule => ({ ...schedule, weekOverrides: { [friday]: overrides } });

test('overrides: a different time, hide, and an extra row apply to their week only', () => {
  const s = withOverrides('2026-11-06', {
    rows: { mincha: { kind: 'time', at: '16:20', note: 'השיעור מתקיים לפני' }, shacharit: { kind: 'hide' } },
    extra: [{ id: 'slichot', sectionId: 'weekday', afterRowId: 'shacharit-1', label: { he: 'סליחות' }, time: { kind: 'fixed', at: '05:45' } },
      { id: 'kiddush', sectionId: 'shabbat', label: { he: 'קידוש' }, time: { kind: 'none' } }],
  });
  const thisWeek = computeWeek(s, '2026-11-10', offline);
  const mincha = rows(thisWeek, 'weekday').find(r => r.id === 'mincha')!;
  assert.deepEqual([mincha.time, mincha.source, mincha.usual, mincha.overrideNote], ['16:20', 'override', '16:25', 'השיעור מתקיים לפני']);
  assert.deepEqual(rows(thisWeek, 'weekday').map(r => r.id), ['shacharit-1', 'slichot', 'mincha', 'arvit']);
  const slichot = rows(thisWeek, 'weekday')[1]!;
  assert.deepEqual([slichot.source, slichot.added, slichot.time], ['override', true, '05:45']);
  assert.ok(!rows(thisWeek, 'shabbat').some(r => r.id === 'shacharit'));
  assert.deepEqual(thisWeek.sections[0]!.hidden.map(r => r.id), ['shacharit']);
  assert.equal(rows(thisWeek, 'shabbat').at(-1)!.id, 'kiddush');
  // next week: formula back, nothing hidden, no extras
  const nextWeek = computeWeek(s, '2026-11-13', offline);
  assert.deepEqual(rows(nextWeek, 'weekday').map(r => [r.id, r.source]), [['shacharit-1', 'fixed'], ['mincha', 'formula'], ['arvit', 'fixed']]);
  assert.equal(nextWeek.sections[0]!.hidden.length, 0);
});

const at = (date: string, time: string) => ({ date, minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) });
const next = (s: Schedule, date: string, time: string) => { const n = nextRow(s, at(date, time), offline); return n && [n.row.id, n.date, n.time, n.dayOffset]; };

test('next row: weekday rows today, text-only and candle lighting never next, tomorrow after the last row', () => {
  assert.deepEqual(next(schedule, '2026-11-10', '07:00'), ['mincha', '2026-11-10', '16:25', 0]);
  assert.deepEqual(next(schedule, '2026-11-10', '16:25'), ['mincha', '2026-11-10', '16:25', 0]);
  assert.deepEqual(next(schedule, '2026-11-10', '16:26'), ['arvit', '2026-11-10', '17:30', 0]);
  assert.deepEqual(next(schedule, '2026-11-10', '20:00'), ['shacharit-1', '2026-11-11', '06:30', 1]);
});

test('next row: Thursday night and Friday go to the Shabbat rows (candle lighting skipped, lessons skipped)', () => {
  assert.deepEqual(next(schedule, '2026-11-12', '20:00'), ['kabbalat', '2026-11-13', '16:11', 1]);
  assert.deepEqual(next(schedule, '2026-11-06', '10:00'), ['kabbalat', '2026-11-06', '16:16', 0]);
  assert.deepEqual(next(schedule, '2026-11-06', '16:30'), ['shacharit', '2026-11-07', '08:30', 1]);
  assert.deepEqual(next(schedule, '2026-11-07', '08:31'), ['shabbat-end', '2026-11-07', '17:04', 0]);
  assert.deepEqual(next(schedule, '2026-11-07', '18:00'), ['shacharit-1', '2026-11-08', '06:30', 1]);
});

test('next row skips rows hidden this week and includes this week\'s extra rows', () => {
  const s = withOverrides('2026-11-06', {
    rows: { mincha: { kind: 'hide' } },
    extra: [{ id: 'special', sectionId: 'weekday', afterRowId: 'mincha', label: { he: 'שיעור מיוחד' }, time: { kind: 'fixed', at: '16:00' } }],
  });
  assert.deepEqual(next(s, '2026-11-10', '07:00'), ['special', '2026-11-10', '16:00', 0]);
  assert.deepEqual(next(s, '2026-11-10', '16:01'), ['arvit', '2026-11-10', '17:30', 0]);
  // an override time is the time that counts
  const moved = withOverrides('2026-11-06', { rows: { arvit: { kind: 'time', at: '18:00' } } });
  assert.deepEqual(next(moved, '2026-11-10', '17:31'), ['arvit', '2026-11-10', '18:00', 0]);
  // Shabbat rows hidden this week
  const noEnd = withOverrides('2026-11-06', { rows: { kabbalat: { kind: 'hide' }, shacharit: { kind: 'hide' } } });
  assert.deepEqual(next(noEnd, '2026-11-06', '10:00'), ['shabbat-end', '2026-11-07', '17:04', 1]);
});

test('next row: an empty schedule has none', () => {
  assert.equal(nextRow({ version: 1, sections: [], weekOverrides: {} }, at('2026-11-10', '07:00'), offline), null);
});
