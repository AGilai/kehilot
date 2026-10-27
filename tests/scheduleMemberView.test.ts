import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCached } from '../src/schedule/cache.ts';
import { fixtureNow, fixtureScheduleDoc } from '../src/client/fixtures.ts';
import { israelInstant } from '../src/seats/window.ts';
import { israelNow } from '../src/schedule/week.ts';
import { parashaOf } from '../src/schedule/parasha.ts';
import {
  cardMode, clockLabel, countdown, dateRange, shortDate, countdownText, fullModel, homeCardModel, upcomingRows, zmanimOpen, zmanimOpenKey,
} from '../src/schedule/memberView.ts';
import type { Schedule } from '../src/schedule/types.ts';
import { offlineZmanimFor, zmanimForLocation } from '../src/schedule/zmanim.ts';

const zf = offlineZmanimFor();
const FRIDAY = '2026-10-30';
const doc = fixtureScheduleDoc(FRIDAY);
const at = (date: string, hm: string) => israelNow(israelInstant(date, hm));

// ---- card mode: Thursday 00:00 -> one hour after Shabbat ends --------------------------------------------------

test('card mode is Shabbat from Thursday 00:00 and weekday on Sunday to Wednesday', () => {
  for (const [date, hm, mode] of [
    ['2026-10-25', '12:00', 'weekday'], ['2026-10-27', '23:59', 'weekday'], ['2026-10-28', '12:00', 'weekday'],
    ['2026-10-29', '00:00', 'shabbat'], ['2026-10-29', '23:59', 'shabbat'], ['2026-10-30', '08:00', 'shabbat'], ['2026-10-31', '08:00', 'shabbat'],
  ] as const) assert.equal(cardMode(doc, at(date, hm), zf), mode, `${date} ${hm}`);
});

test('Shabbat mode ends one hour after the later of Shabbat end and the last Shabbat row', () => {
  // The fixture's last Shabbat row is 19:30 (after Shabbat end): the card flips at 20:30.
  assert.equal(cardMode(doc, at('2026-10-31', '20:29'), zf), 'shabbat');
  assert.equal(cardMode(doc, at('2026-10-31', '20:30'), zf), 'weekday');
  // Without that row it is Shabbat end + 1 hour.
  const shorter: Schedule = { ...doc, sections: doc.sections.map(s => ({ ...s, rows: s.rows.filter(r => r.id !== 's-daf2') })) };
  const end = zf('2026-10-31')!.shabbatEnd!;
  const [h, m] = end.split(':').map(Number) as [number, number];
  const flip = h * 60 + m + 60;
  assert.equal(cardMode(shorter, { date: '2026-10-31', minutes: flip - 1 }, zf), 'shabbat');
  assert.equal(cardMode(shorter, { date: '2026-10-31', minutes: flip }, zf), 'weekday');
});

// ---- countdown: only within 6 hours, today -----------------------------------------------------------------------

test('countdown shows only for a row today within 6 hours', () => {
  assert.deepEqual(countdown(0, 600, 560), { h: 0, m: 40 });
  assert.deepEqual(countdown(0, 360 + 100, 100), { h: 6, m: 0 });
  assert.equal(countdown(0, 361 + 100, 100), null);
  assert.equal(countdown(1, 400, 390), null);
  assert.equal(countdown(0, 500, 501), null);
});

test('countdown wording keys follow the design table', () => {
  assert.deepEqual(countdownText({ h: 0, m: 40 }), { key: 'schedule.inMin', params: { m: 40 } });
  assert.deepEqual(countdownText({ h: 1, m: 5 }), { key: 'schedule.inHour', params: { m: 5 } });
  assert.deepEqual(countdownText({ h: 2, m: 51 }), { key: 'schedule.inTwoHours', params: { m: 51 } });
  assert.deepEqual(countdownText({ h: 3, m: 10 }), { key: 'schedule.inHours', params: { h: 3, m: 10 } });
  assert.deepEqual(countdownText({ h: 1, m: 0 }), { key: 'schedule.inHourOnly', params: { m: 0 } });
  assert.deepEqual(countdownText({ h: 6, m: 0 }), { key: 'schedule.inHoursOnly', params: { h: 6, m: 0 } });
  assert.equal(countdownText({ h: 0, m: 0 }).key, 'schedule.now');
});

// ---- Home card model ---------------------------------------------------------------------------------------------

test('Friday afternoon: Shabbat mode, next block, four following rows with the override, candle line time', () => {
  const card = homeCardModel(doc, at(FRIDAY, '15:40'), zf)!;
  assert.equal(card.mode, 'shabbat');
  assert.equal(card.header, 'shabbat');
  assert.equal(card.week.shabbat, '2026-10-31');
  assert.equal(card.next!.row.id, 'kabbalat');
  assert.ok(card.next!.countdown && card.next!.countdown.h <= 2);
  assert.deepEqual(card.following.map(r => r.row.id), ['s-daf', 's-shacharit', 's-gedola', 's-third']);
  const gedola = card.following.find(r => r.row.id === 's-gedola')!;
  assert.equal(gedola.time, '12:45');
  assert.equal(gedola.row.usual, '13:15');
  assert.equal(gedola.row.overrideNote, 'בגלל הקידוש');
  assert.equal(card.candles, zf(FRIDAY)!.candleLighting);
});

test('Thursday: Shabbat mode, but next is still today\'s weekday prayer, then Friday and Shabbat rows', () => {
  const card = homeCardModel(doc, at('2026-10-29', '15:55'), zf)!;
  assert.equal(card.mode, 'shabbat');
  assert.equal(card.next!.row.id, 'w-mincha');
  assert.equal(card.next!.dayOffset, 0);
  assert.equal(card.following[0]!.row.id, 'w-arvit');
  assert.equal(card.following[0]!.today, true);
  assert.equal(card.following[1]!.row.id, 'w-arvit2');
  assert.equal(card.following[2]!.row.id, 'kabbalat');
  assert.equal(card.following[2]!.today, false);
  assert.equal(card.week.friday, FRIDAY);
});

test('weekday mode: next block with countdown and up to three more of today, candle time on the footer line', () => {
  const card = homeCardModel(doc, at('2026-10-27', '10:24'), zf)!;
  assert.equal(card.mode, 'weekday');
  assert.equal(card.header, 'today');
  assert.equal(card.next!.row.id, 'w-gedola');
  assert.deepEqual(countdownText(card.next!.countdown!), { key: 'schedule.inTwoHours', params: { m: 51 } });
  assert.deepEqual(card.following.map(r => r.row.id), ['w-mincha', 'w-arvit', 'w-arvit2']);
  assert.equal(card.week.friday, FRIDAY);
  assert.equal(card.candles, zf(FRIDAY)!.candleLighting);
});

test('weekday mode after the last row of the day shows tomorrow, without a countdown', () => {
  const card = homeCardModel(doc, at('2026-10-27', '21:00'), zf)!;
  assert.equal(card.header, 'tomorrow');
  assert.equal(card.next!.row.id, 'w-sh1');
  assert.equal(card.next!.dayOffset, 1);
  assert.equal(card.next!.countdown, null);
  assert.deepEqual(card.following.map(r => r.row.id), ['w-daf', 'w-sh2']);
});

test('Saturday night after the card returns to weekday mode shows Sunday\'s first minyan', () => {
  const card = homeCardModel(doc, at('2026-10-31', '20:45'), zf)!;
  assert.equal(card.mode, 'weekday');
  assert.equal(card.header, 'tomorrow');
  assert.equal(card.next!.date, '2026-11-01');
  assert.equal(card.week.friday, '2026-11-06');
});

test('a hidden row is skipped and an extra row of the week counts as next', () => {
  const week = '2026-10-23';
  const edited: Schedule = { ...doc, weekOverrides: { [week]: {
    rows: { 'w-gedola': { kind: 'hide' } },
    extra: [{ id: 'x1', sectionId: 'weekday', afterRowId: 'w-sh2', label: { he: 'שיעור מיוחד' }, time: { kind: 'fixed', at: '12:00' } }],
  } } };
  const card = homeCardModel(edited, at('2026-10-27', '10:24'), zf)!;
  assert.equal(card.next!.row.id, 'x1');
  assert.equal(card.next!.row.added, true);
  assert.ok(!card.following.some(r => r.row.id === 'w-gedola'));
  assert.deepEqual(card.following.map(r => r.row.id), ['w-mincha', 'w-arvit', 'w-arvit2']);
});

test('no timed rows (or no sections) means no schedule card', () => {
  assert.equal(homeCardModel({ version: 1, sections: [], weekOverrides: {} }, at(FRIDAY, '10:00'), zf), null);
  const text: Schedule = { version: 1, weekOverrides: {}, sections: [{ id: 's', kind: 'weekday', title: { he: 'x' }, rows: [{ id: 'r', label: { he: 'שיעור' }, time: { kind: 'none' } }] }] };
  assert.equal(homeCardModel(text, at(FRIDAY, '10:00'), zf), null);
});

test('upcoming rows never include candle lighting or text-only rows, and respect the limit', () => {
  const rows = upcomingRows(doc, at(FRIDAY, '00:00'), zf, 50, '2026-10-31');
  assert.ok(!rows.some(r => r.row.id === 'candles' || r.row.id === 's-shiur'));
  assert.equal(upcomingRows(doc, at(FRIDAY, '00:00'), zf, 2).length, 2);
});

// ---- zmanim card default ----------------------------------------------------------------------------------------

test('the city zmanim card is open by default only without a schedule; the member\'s choice wins', () => {
  assert.equal(zmanimOpen(null, false), true);
  assert.equal(zmanimOpen(null, true), false);
  assert.equal(zmanimOpen('closed', false), false);
  assert.equal(zmanimOpen('open', true), true);
  assert.equal(zmanimOpen('garbage', true), false);
  assert.notEqual(zmanimOpenKey(true), zmanimOpenKey(false));
});

// ---- full schedule ----------------------------------------------------------------------------------------------

test('full schedule: Shabbat first from Thursday and for next week, weekdays first otherwise; next row and past rows', () => {
  const fri = fullModel(doc, at(FRIDAY, '15:40'), zf, 0);
  assert.deepEqual(fri.sections.map(s => s.kind), ['shabbat', 'weekday']);
  assert.equal(fri.week.friday, FRIDAY);
  assert.equal(fri.next!.rowId, 'kabbalat');
  assert.equal(fri.past.size, 0);
  const tue = fullModel(doc, at('2026-10-27', '10:24'), zf, 0);
  assert.deepEqual(tue.sections.map(s => s.kind), ['weekday', 'shabbat']);
  assert.equal(tue.week.friday, '2026-10-23');
  assert.equal(tue.next!.rowId, 'w-gedola');
  assert.deepEqual([...tue.past].sort(), ['w-daf', 'w-sh1', 'w-sh2']);
  const nextWeek = fullModel(doc, at('2026-10-27', '10:24'), zf, 1);
  assert.equal(nextWeek.week.friday, FRIDAY);
  assert.deepEqual(nextWeek.sections.map(s => s.kind), ['shabbat', 'weekday']);
  assert.equal(nextWeek.next, null);
  assert.equal(nextWeek.past.size, 0);
  assert.equal(nextWeek.computed.sections[0]!.rows.find(r => r.id === 's-gedola')!.source, 'override');
});

// ---- location and parasha ---------------------------------------------------------------------------------------

test('the saved location (coordinates and candle minutes) feeds the zmanim, with a default when missing', () => {
  const base = zmanimForLocation(null)(FRIDAY)!;
  assert.equal(base.candleLighting, zf(FRIDAY)!.candleLighting);
  const other = zmanimForLocation({ latitude: 29.5577, longitude: 34.9519, elevation: 'sea', candleMinutes: 18 })(FRIDAY)!;
  assert.notEqual(other.candleLighting, base.candleLighting);
  const ground = zmanimForLocation({ latitude: 31.7683, longitude: 35.2137, elevation: 'ground', elevationMeters: 800, candleMinutes: 40 })(FRIDAY)!;
  assert.notEqual(ground.sunset, zmanimForLocation({ latitude: 31.7683, longitude: 35.2137, elevation: 'sea', candleMinutes: 40 })(FRIDAY)!.sunset);
});

test('parasha of a Shabbat in Hebrew and English, null on a holiday Shabbat', () => {
  assert.equal(parashaOf('2026-10-31', 'he'), 'וירא');
  assert.equal(parashaOf('2026-10-31', 'en'), 'Vayera');
  assert.equal(parashaOf('2026-10-03', 'he'), null);
});

// ---- labels, cache, fixture clock -------------------------------------------------------------------------------

test('labels: times lose the leading zero, ranges are isolated left to right', () => {
  assert.equal(clockLabel('08:30'), '8:30');
  assert.equal(clockLabel('16:05'), '16:05');
  assert.equal(shortDate('2026-11-01'), '1.11');
  assert.equal(dateRange('2026-10-30', '2026-11-05'), '⁦30.10–5.11⁩');
  assert.equal(dateRange('2026-10-30', '2026-10-31', true), '⁦30–31.10⁩');
  assert.equal(dateRange('2026-10-31', '2026-11-01', true), '⁦31.10–1.11⁩');
});

test('a saved schedule copy is used only when it looks like one', () => {
  assert.equal(parseCached(null), null);
  assert.equal(parseCached('not json'), null);
  assert.equal(parseCached(JSON.stringify({ doc: { sections: [] }, savedAt: 1 })), null);
  assert.ok(parseCached(JSON.stringify({ doc, savedAt: 5 })));
});

test('fixture clock: ?now= is Israel wall time, only in fixture mode', () => {
  assert.equal(fixtureNow('?now=2026-10-30T15:40'), null); // fixtures are off in tests
});
