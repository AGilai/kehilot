import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREAS, deadlineHm, areaTotals, formTemplateCsv, latestPerName, parseFormCsv, parseStamp, splitCsv, weekWindow, inWeek, textTooBig } from '../src/seats/formCsv.ts';
import { MAX_FILE_BYTES } from '../src/import/parse.ts';
import type { FormAnswer } from '../src/seats/formCsv.ts';

const HEADER = 'Timestamp,שם,ערב שבת: כמה מקומות לא אצטרך,יום שבת: כמה מקומות לא אצטרך,חג: כמה מהמקומות יתפנו,קריאת מגילה: כמה יתפנו,בקשה לשמירת מקומות נשים · בית הכנסת,בקשה לשמירת מקומות גברים · אולם,בקשה לשמירת מקומות נשים · אולם';

test('splitCsv: BOM, quotes, doubled quotes, newline in a field, CRLF, trailing blank line', () => {
  const rows = splitCsv('﻿a,"b,1","say ""hi""","x\ny"\r\n1,2,3,4\r\n\r\n');
  assert.deepEqual(rows, [['a', 'b,1', 'say "hi"', 'x\ny'], ['1', '2', '3', '4']]);
});
test('splitCsv: tab-separated paste and semicolons', () => {
  assert.deepEqual(splitCsv('a\tb\tc\n1\t2\t3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(splitCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('parseStamp: M/D/YYYY H:MM:SS, serial numbers, ISO; D/M when asked', () => {
  const t = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s);
  assert.equal(parseStamp('10/29/2026 20:41:05', 'mdy'), t(2026, 10, 29, 20, 41, 5));
  assert.equal(parseStamp('1/2/2026 9:05:00', 'mdy'), t(2026, 1, 2, 9, 5));
  assert.equal(parseStamp('1/2/2026 9:05:00', 'dmy'), t(2026, 2, 1, 9, 5));
  assert.equal(parseStamp('29/10/2026 20:41', 'dmy'), t(2026, 10, 29, 20, 41));
  assert.equal(parseStamp('2026-10-29 20:41:05', 'mdy'), t(2026, 10, 29, 20, 41, 5));
  assert.equal(parseStamp('46324.5', 'mdy'), t(2026, 10, 29, 12, 0, 0)); // 46324 = 2026-10-29
  assert.equal(parseStamp('', 'mdy'), null);
  assert.equal(parseStamp('לא תאריך', 'mdy'), null);
  assert.equal(parseStamp('13/13/2026 1:00', 'mdy'), null);
});

test('parseFormCsv maps by header text, not position', () => {
  const csv = '﻿' + HEADER + '\n10/29/2026 20:41:05,בדיוני שמעון,1,2,3,4,2,,1\n';
  const r = parseFormCsv(csv);
  assert.ok(r.ok);
  assert.equal(r.answers.length, 1);
  assert.deepEqual(r.answers[0]!.counts, { erev: 1, day: 2, hag: 3, megila: 4 });
  assert.deepEqual(r.answers[0]!.requests, { [AREAS[0]!]: 2, [AREAS[2]!]: 1 });
  assert.equal(r.answers[0]!.name, 'בדיוני שמעון');
  // shuffled columns, extra unknown column, quoted header
  const shuffled = 'הערות,"יום שבת: כמה לא אצטרך",שם,חותמת זמן,"ערב שבת"\nשלום,3,"דוגמה, יואב",10/30/2026 8:12:00,1\n';
  const s = parseFormCsv(shuffled);
  assert.ok(s.ok);
  assert.deepEqual(s.answers[0]!.counts, { erev: 1, day: 3 });
  assert.equal(s.answers[0]!.name, 'דוגמה, יואב');
  assert.deepEqual(s.unknownHeaders, ['הערות']);
});

test('parseFormCsv: women/men/hall request headers are told apart; blank is not zero, junk is counted unreadable', () => {
  const r = parseFormCsv('חותמת זמן,שם,ערב שבת,גברים · אולם,נשים · אולם,נשים · בית הכנסת\n10/29/2026 1:00:00,א ב,,x,3,\n');
  assert.ok(r.ok);
  assert.deepEqual(r.answers[0]!.counts, {});
  assert.deepEqual(r.answers[0]!.requests, { [AREAS[2]!]: 3 });
  assert.equal(r.unreadable, 1);
});

test('parseFormCsv: dates day-first when any row says so; skips blank-name rows; problems', () => {
  const r = parseFormCsv('חותמת זמן,שם,ערב שבת\n29/10/2026 20:41:05,א,1\n1/2/2026 9:00:00,ב,1\n,,\n');
  assert.ok(r.ok);
  assert.equal(r.dateOrder, 'dmy');
  assert.equal(r.answers.length, 2);
  assert.equal(r.answers[1]!.at, Date.UTC(2026, 1, 1, 9, 0, 0));
  const none = parseFormCsv('');
  assert.deepEqual(none, { ok: false, problem: 'empty' });
  assert.deepEqual(parseFormCsv('שם,ערב שבת\nא,1'), { ok: false, problem: 'no-timestamp' });
  assert.deepEqual(parseFormCsv('חותמת זמן,ערב שבת\n10/29/2026 1:00:00,1'), { ok: false, problem: 'no-name' });
  assert.deepEqual(parseFormCsv('חותמת זמן,שם\n10/29/2026 1:00:00,א'), { ok: false, problem: 'no-counts' });
});

test('week window: previous Friday deadline to this Friday deadline (wall clock), so a Saturday-night answer counts for the coming Shabbat', () => {
  const w = weekWindow('2026-10-30', '12:00');
  assert.equal(w.from, Date.UTC(2026, 9, 23, 12, 0)); // the week crosses the end of Israeli DST (Oct 25): wall clock, no hour shift
  assert.equal(w.to, Date.UTC(2026, 9, 30, 12, 0));
  assert.equal(weekWindow('2026-10-30').to, Date.UTC(2026, 9, 30, 12, 0));
  assert.equal(weekWindow('2026-03-27', '09:30').from, Date.UTC(2026, 2, 20, 9, 30)); // DST starts Mar 27 2026
  const mk = (name: string, at: number | null): FormAnswer => ({ line: 2, at, name, counts: { erev: 1 }, requests: {} });
  const r = inWeek([
    mk('א', Date.UTC(2026, 9, 23, 12, 0)), mk('ב', Date.UTC(2026, 9, 23, 11, 59)), mk('ג', Date.UTC(2026, 9, 30, 12, 0)),
    mk('ד', Date.UTC(2026, 9, 24, 21, 0)), mk('ה', null), mk('ו', Date.UTC(2026, 9, 30, 11, 59)),
  ], '2026-10-30', '12:00');
  assert.deepEqual(r.rows.map((x) => x.name), ['ג', 'ד', 'ו']); // Saturday night (Oct 24) is in; exactly the closing deadline is in, exactly the opening one is not
  assert.equal(r.older, 2);
  assert.equal(r.later, 0);
  assert.equal(r.undated, 1);
});

test('deadlineHm reads the Israel wall clock of the server deadline, summer and winter', () => {
  assert.equal(deadlineHm('2026-10-30T10:00:00Z'), '12:00'); // IST, UTC+2
  assert.equal(deadlineHm('2026-06-26T09:00:00Z'), '12:00'); // IDT, UTC+3
  assert.equal(deadlineHm('garbage'), '12:00');
});

test('latestPerName: the latest answer wins, the earlier ones are counted; a tie goes to the later line', () => {
  const mk = (name: string, at: number, erev: number, line: number): FormAnswer => ({ line, at, name, counts: { erev }, requests: {} });
  const r = latestPerName([mk('בדיוני  שמעון', 100, 1, 2), mk('דוגמה', 50, 1, 3), mk('בדיוני שמעון', 300, 2, 4), mk('בדיוני שמעון', 200, 3, 5), mk('דוגמה', 50, 4, 6)], (n) => n.replace(/\s+/g, ' ').trim());
  assert.equal(r.latest.length, 2);
  const b = r.latest.find((x) => x.name.includes('בדיוני'))!;
  assert.equal(b.counts.erev, 2);
  assert.equal(b.earlier, 2);
  assert.equal(r.latest.find((x) => x.name === 'דוגמה')!.counts.erev, 4);
  assert.equal(r.duplicates, 3);
});

test('areaTotals: count and households per area', () => {
  const a = (name: string, requests: Record<string, number>): FormAnswer => ({ line: 2, at: 1, name, counts: {}, requests });
  assert.deepEqual(areaTotals([a('א', { [AREAS[0]!]: 2 }), a('ב', { [AREAS[0]!]: 4, [AREAS[1]!]: 1 }), a('ג', { [AREAS[0]!]: 0 })]),
    [{ area: AREAS[0], seats: 6, households: 2 }, { area: AREAS[1], seats: 1, households: 1 }]);
});

test('the template has the Form columns and reads back through the parser', () => {
  const r = parseFormCsv(formTemplateCsv());
  assert.ok(r.ok);
  assert.ok(r.answers.length >= 1);
  assert.deepEqual(Object.keys(r.columns).sort(), ['day', 'erev', 'hag', 'megila', 'name', 'req0', 'req1', 'req2', 'stamp']);
});

test('inWeek: the window is (previous Friday deadline, this Friday deadline]; an answer exactly at a deadline is the earlier week', () => {
  const mk = (at: number | null) => ({ line: 2, at, name: 'x', counts: {}, requests: {} }) as never;
  const { from, to } = weekWindow('2026-10-30', '12:00');
  const r = inWeek([mk(from), mk(from + 1), mk(to), mk(to + 1), mk(null)], '2026-10-30', '12:00');
  assert.equal(r.older, 1);
  assert.equal(r.rows.length, 2);
  assert.equal(r.later, 1);
  assert.equal(r.undated, 1);
});

test('textTooBig: pasted text over MAX_FILE_BYTES is rejected like a file; Hebrew counts as bytes', () => {
  assert.equal(textTooBig('a'.repeat(MAX_FILE_BYTES)), false);
  assert.equal(textTooBig('a'.repeat(MAX_FILE_BYTES + 1)), true);
  assert.equal(textTooBig('א'.repeat(MAX_FILE_BYTES / 2 + 1)), true);
});
