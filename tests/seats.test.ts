import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARK_SIDE, BLOCK_NAMES, FRONT_ROW, HALL, HALL_GRID, allSeats, seatKey } from '../src/seats/hall.ts';
import type { SeatRef } from '../src/seats/hall.ts';
import { blockFrames, memberView } from '../src/seats/frame.ts';
import type { Allocation } from '../src/seats/frame.ts';
import { cardWindow, dayTime, israelInstant, shabbatFriday } from '../src/seats/window.ts';
import { printModel } from '../src/seats/printModel.ts';
import { PRINT_STYLES, PRINT_STYLE_DEFAULT, PRINT_STYLE_KEY, legendItems, parsePrintStyle, pendingNotch, seatFill } from '../src/seats/printStyle.ts';
import he from '../src/i18n/he.json' with { type: 'json' };
import en from '../src/i18n/en.json' with { type: 'json' };
import { releaseCounts, toggleRelease } from '../src/seats/release.ts';
import { seatPrintAllowed, seatPrintRole, seatScreenFor } from '../src/seats/access.ts';
import { fixtureSeatHall, fixtureMemberSeats } from '../src/client/fixtures.ts';
import { pushDestination, routeFromPush } from '../src/client/push.ts';

const ref = (block: string, row: number, col: number): SeatRef => ({ block: block as SeatRef['block'], row, col });

test('hall: 225 seats, six named blocks right to left, rows 0-13, bimah in the middle block', () => {
  assert.equal(allSeats(HALL).length, 225);
  assert.equal(new Set(allSeats(HALL).map(seatKey)).size, 225);
  assert.equal(HALL.cols, 29);
  assert.equal(HALL.rows, 14);
  assert.equal(HALL.blocks.length, 6);
  assert.deepEqual(HALL.blocks.map(b => b.name), ['ימין', 'מרכז ימין', 'מרכז', 'מרכז שמאל', 'שמאל', 'צד שמאל']);
  assert.deepEqual(HALL.blocks.map(b => b.id), ['R', 'CR', 'C', 'CL', 'L', 'FL']);
  assert.deepEqual(BLOCK_NAMES.map(n => n.id), HALL.blocks.map(b => b.id));
  assert.deepEqual(HALL.blocks.map(b => [b.x, b.cols]), [[24, 5], [19, 4], [14, 4], [9, 4], [3, 5], [0, 2]]);
  assert.deepEqual(HALL.blocks.find(b => b.id === 'C')!.bimah, [6, 7, 8]);
  assert.equal(HALL.blocks.filter(b => b.bimah).length, 1);
  assert.ok(allSeats(HALL).every(s => s.row >= 0 && s.row <= 13));
  const per = Object.fromEntries(HALL.blocks.map(b => [b.id, allSeats(HALL).filter(s => s.block === b.id).length]));
  assert.deepEqual(per, { R: 67, CR: 36, C: 16, CL: 36, L: 50, FL: 20 });
});

test('hall: the grid is the spec shape (bimah 4x3 cells, front row 0 is unnumbered, ark at the front)', () => {
  const lines = HALL_GRID.trim().split('\n');
  assert.equal(lines.length, 14);
  assert.equal(lines.join('').split('B').length - 1, 12);
  assert.equal(lines.join('').split('S').length - 1, 225);
  assert.equal(ARK_SIDE, 'front');
  assert.equal(FRONT_ROW, 0);
});

test('seat numbers are internal: no numbering constant or helper is exported from the hall', async () => {
  const hall = await import('../src/seats/hall.ts');
  assert.equal('SEAT_NUMBERING' in hall, false);
  assert.equal('seatNumber' in hall, false);
});

test('member view: cells carry only the family order (k of n), never a seat number', () => {
  const view = memberView(HALL, [{ householdId: 'h', name: 'x', seats: [ref('CR', 6, 0), ref('R', 3, 4), ref('R', 3, 2), ref('R', 1, 0)] }], 'h');
  const mine = view.frames.flatMap(f => f.rows.flatMap(r => r.cells)).filter(c => c.kind === 'mine') as unknown as Record<string, unknown>[];
  assert.equal(mine.length, 4);
  assert.ok(mine.every(c => !('seatNo' in c) && !('number' in c)));
  // Block right to left, row front to back, then right to left in the row: R1/0, R3/4, R3/2, CR6/0.
  assert.deepEqual(mine.map(c => [c.key, c.k, c.n]).sort((a, b) => (a[1] as number) - (b[1] as number)),
    [['R:1:0', 1, 4], ['R:3:4', 2, 4], ['R:3:2', 3, 4], ['CR:6:0', 4, 4]]);
});

test('screen-reader labels say "place k of n" and never "seat N"', () => {
  for (const [lang, d] of [['he', he], ['en', en]] as const) {
    const seats = d.seats as unknown as Record<string, string>;
    for (const key of ['seatLabelComing', 'seatLabelFree']) {
      assert.ok(seats[key]!.includes('{k}') && seats[key]!.includes('{n}'), `${lang} ${key}`);
      assert.ok(!/כיסא|seat \d|seat \{/i.test(seats[key]!), `${lang} ${key}`);
    }
    assert.equal('seatNo' in seats, false);
  }
});

test('print styles: fills per state follow the designer table, shapes never change', () => {
  assert.deepEqual(PRINT_STYLES, ['green', 'greenRed', 'bw']);
  assert.equal(PRINT_STYLE_DEFAULT, 'green');
  assert.equal(PRINT_STYLE_KEY, 'kehilot.seatPrintStyle');
  const states = ['taken', 'pending', 'released', 'free'] as const;
  assert.deepEqual(states.map(s => seatFill('green', s)), ['#EBEBEB', '#E9B44C', '#9ED8AA', '#57B46C']);
  assert.deepEqual(states.map(s => seatFill('greenRed', s)), ['#DB5B56', '#E9B44C', '#9ED8AA', '#57B46C']);
  assert.deepEqual(states.map(s => seatFill('bw', s)), ['#C8C8C8', '#FFFFFF', '#FFFFFF', '#FFFFFF']);
});

test('print legend: four items per style in order, only pending has the notch', () => {
  for (const st of PRINT_STYLES) {
    const items = legendItems(st);
    assert.deepEqual(items.map(i => i.state), ['taken', 'pending', 'released', 'free']);
    assert.deepEqual(items.map(i => i.fill), ['taken', 'pending', 'released', 'free'].map(x => seatFill(st, x as 'taken')));
    assert.deepEqual(items.map(i => i.notch), [false, true, false, false]);
  }
});

test('pending notch: 35% of the cell height, between 5 and 9 px', () => {
  assert.equal(pendingNotch(24), 8);
  assert.equal(pendingNotch(18), 6);
  assert.equal(pendingNotch(4), 5);
  assert.equal(pendingNotch(80), 9);
});

test('print style: a stored choice falls back to the default when missing or unknown', () => {
  assert.equal(parsePrintStyle('bw'), 'bw');
  assert.equal(parsePrintStyle('greenRed'), 'greenRed');
  for (const bad of [null, undefined, '', 'red', 'GREEN', '{"a":1}']) assert.equal(parsePrintStyle(bad), 'green');
});

test('print style copy exists in both languages', () => {
  for (const d of [he, en]) {
    const p = d.seats.print as unknown as Record<string, string>;
    for (const key of ['style', 'styleGreen', 'styleGreenRed', 'styleBw', 'styleNote', 'noteGreen', 'noteGreenRed', 'noteBw']) assert.ok(p[key], key);
  }
  assert.equal((he.seats.print as Record<string, string>).styleGreen, 'ירוק לפנוי');
});

const rowsOf = (f: { rows: { row: number }[] }) => f.rows.map(r => r.row);
const mineIn = (f: { rows: { cells: { kind: string }[] }[] }) => f.rows.flatMap(r => r.cells).filter(c => c.kind === 'mine').length;

test('frame: a mid-hall seat shows rows r-2..r+2 of its own block only', () => {
  const frames = blockFrames(HALL, [ref('CR', 6, 1), ref('CR', 6, 2), ref('CR', 6, 3)]);
  assert.equal(frames.length, 1);
  const f = frames[0]!;
  assert.equal(f.blockId, 'CR');
  assert.deepEqual(rowsOf(f), [4, 5, 6, 7, 8]);
  assert.equal(f.rows.length, 5);
  assert.ok(f.rows.every(r => r.cells.length === 4));
  assert.equal(mineIn(f), 3);
  assert.deepEqual(f.rows.map(r => r.label), [4, 5, 6, 7, 8]);
  // Others are plain cells: no key, no seat number, nothing to identify them.
  const other = f.rows[0]!.cells[0]!;
  assert.deepEqual(other, { kind: 'other' });
});

test('frame: clips at the hall edges, never out of range', () => {
  const top = blockFrames(HALL, [ref('R', 0, 0)])[0]!;
  assert.deepEqual(rowsOf(top), [0, 1, 2]);
  assert.deepEqual(top.rows.map(r => r.label), [null, 1, 2]); // the front row has no number
  const bottom = blockFrames(HALL, [ref('R', 13, 3)])[0]!;
  assert.equal(bottom.rows.length, 3);
  assert.deepEqual(rowsOf(bottom), [11, 12, 13]);
  const edges = blockFrames(HALL, [ref('L', 5, 0), ref('L', 5, 4)])[0]!;
  assert.equal(edges.rows[0]!.cells.length, 5);
  assert.equal(mineIn(edges), 2);
  // The far-left block is 2 columns wide and starts at row 1 (nothing in row 0), so a frame there clips at row 1.
  const far = blockFrames(HALL, [ref('FL', 2, 0), ref('FL', 2, 1)])[0]!;
  assert.equal(far.blockId, 'FL');
  assert.ok(far.rows.every(r => r.cells.length === 2));
  assert.deepEqual(rowsOf(far), [1, 2, 3, 4]);
  assert.equal(mineIn(far), 2);
  assert.deepEqual(rowsOf(blockFrames(HALL, [ref('FL', 10, 1)])[0]!), [8, 9, 10]); // block ends at row 10
  for (const s of allSeats(HALL)) {
    const f = blockFrames(HALL, [s])[0]!;
    assert.ok(f.rowFrom >= 0 && f.rowTo <= 13, seatKey(s));
    assert.ok(f.rowFrom >= Math.max(0, s.row - 2) && f.rowTo <= Math.min(13, s.row + 2), seatKey(s));
    assert.equal(mineIn(f), 1);
  }
});

test('frame: block with a bimah and empty rows keeps them as bimah and gap rows', () => {
  const f = blockFrames(HALL, [ref('C', 4, 1)])[0]!;
  assert.deepEqual(rowsOf(f), [4, 5, 6]);
  assert.equal(f.rowFrom, 4); // rows 2-3 hold nothing in this block: clipped to its extent
  assert.equal(f.rowTo, 6);
  assert.equal(f.rows[2]!.bimah, true);
  assert.ok(f.rows[2]!.cells.every(c => c.kind === 'bimah'));
  assert.ok(f.rows[1]!.cells.every(c => c.kind === 'gap'));
});

test('split seats: same block within 4 rows share one frame', () => {
  const one = blockFrames(HALL, [ref('CR', 6, 1), ref('CR', 10, 2)]);
  assert.equal(one.length, 1);
  assert.deepEqual(rowsOf(one[0]!), [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(mineIn(one[0]!), 2);
});

test('split seats: 5 rows apart, or another block, give one frame each in hall order', () => {
  const far = blockFrames(HALL, [ref('CR', 6, 1), ref('CR', 11, 2)]);
  assert.equal(far.length, 2);
  assert.deepEqual(far.map(f => [f.rowFrom, f.rowTo]), [[4, 8], [9, 12]]);
  const blocks = blockFrames(HALL, [ref('FL', 2, 1), ref('L', 5, 1), ref('R', 3, 0), ref('CR', 6, 1)]);
  assert.deepEqual(blocks.map(f => f.blockId), ['R', 'CR', 'L', 'FL']);
  // Seats apart in the far-left block and the left block are never merged.
  assert.equal(blockFrames(HALL, [ref('FL', 2, 0), ref('L', 2, 0)]).length, 2);
  // Chain: 1-5, 5-9 are both within 4, so all three merge.
  const chain = blockFrames(HALL, [ref('CR', 4, 0), ref('CR', 8, 0), ref('CR', 12, 0)]);
  assert.equal(chain.length, 1);
});

test('frame: no seats, or seats that are not in the hall, give no frame', () => {
  assert.deepEqual(blockFrames(HALL, []), []);
  assert.deepEqual(blockFrames(HALL, [ref('C', 0, 0), ref('FL', 0, 0)]), []);
});

test('memberView: returns only the cut of the asked household', () => {
  const hall = fixtureSeatHall();
  const mine = hall.allocations.find(a => a.householdId === 'me')!;
  const view = memberView(hall.hall, hall.allocations, 'me');
  assert.equal(view.seatCount, mine.seats.length);
  assert.ok(view.frames.length >= 1);
  const json = JSON.stringify(view);
  for (const a of hall.allocations) {
    if (a.householdId === 'me') continue;
    assert.ok(!json.includes(a.householdId), a.householdId);
    assert.ok(!json.includes(a.name), a.name);
  }
  const cells = view.frames.flatMap(f => f.rows.flatMap(r => r.cells));
  assert.equal(cells.filter(c => c.kind === 'mine').length, mine.seats.length);
  assert.ok(view.frames.every(f => f.rows.length <= 9), 'a frame spans at most 9 rows');
  assert.deepEqual(memberView(hall.hall, hall.allocations, 'nobody'), { seatCount: 0, frames: [] });
  const a: Allocation[] = [{ householdId: 'x', name: 'בדיוני', seats: [ref('CR', 6, 1)] }];
  assert.equal(memberView(HALL, a, 'x').frames.length, 1);
});

test('fixture member variants: default, split, none', () => {
  assert.equal(fixtureMemberSeats('default').frames.length, 1);
  assert.equal(fixtureMemberSeats('default').seatCount, 3);
  assert.equal(fixtureMemberSeats('split').frames.length, 2);
  assert.equal(fixtureMemberSeats('none').seatCount, 0);
  assert.equal(fixtureMemberSeats('closed').closed, true);
  assert.equal(fixtureMemberSeats('gabbai').source, 'gabbai');
});

test('release: toggling and counting', () => {
  const none = new Set<string>();
  const one = toggleRelease(none, 'CR:6:1');
  assert.ok(one.has('CR:6:1') && !none.has('CR:6:1'));
  assert.ok(!toggleRelease(one, 'CR:6:1').has('CR:6:1'));
  assert.deepEqual(releaseCounts(3, one), { need: 2, free: 1 });
  assert.deepEqual(releaseCounts(3, new Set()), { need: 3, free: 0 });
});

test('window: Thu 08:00 to Fri 14:00 Israel time, winter, summer and the DST Friday', () => {
  const w = cardWindow('2026-12-18');
  assert.equal(w.opensAt.toISOString(), '2026-12-17T06:00:00.000Z');
  assert.equal(w.closesAt.toISOString(), '2026-12-18T12:00:00.000Z');
  const summer = cardWindow('2026-07-10');
  assert.equal(summer.opensAt.toISOString(), '2026-07-09T05:00:00.000Z');
  assert.equal(summer.closesAt.toISOString(), '2026-07-10T11:00:00.000Z');
  const dst = cardWindow('2027-03-26');
  assert.equal(dst.opensAt.toISOString(), '2027-03-25T06:00:00.000Z'); // Thursday still UTC+2
  assert.equal(dst.closesAt.toISOString(), '2027-03-26T11:00:00.000Z'); // Friday already UTC+3
  assert.equal(israelInstant('2027-03-26', '01:30').toISOString(), '2027-03-25T23:30:00.000Z');
  // Clocks go back on Sunday 25 Oct 2026; the Friday after is plain winter time.
  assert.equal(cardWindow('2026-10-30').closesAt.toISOString(), '2026-10-30T12:00:00.000Z');
});

test('shabbatFriday: Saturday before and after Shabbat ends', () => {
  const sat = (hm: string) => israelInstant('2026-10-31', hm);
  assert.equal(shabbatFriday(sat('17:00'), sat('17:40')), '2026-10-30');
  assert.equal(shabbatFriday(sat('17:41'), sat('17:40')), '2026-11-06');
  assert.equal(shabbatFriday(sat('23:00')), '2026-10-30'); // no end known: the server's rule
  assert.equal(shabbatFriday(israelInstant('2026-10-28', '10:00')), '2026-10-30');
  assert.equal(shabbatFriday(new Date('2026-10-30T20:30:00Z')), '2026-10-30'); // Friday night
  assert.equal(shabbatFriday(new Date('2026-10-27T08:00:00Z')), '2026-10-30'); // Tuesday, Israel date not UTC
});

test('dayTime never breaks between day and time', () => {
  assert.equal(dayTime(israelInstant('2026-10-30', '14:00'), 'he'), 'יום ו׳\u00a014:00');
  assert.equal(dayTime(israelInstant('2026-10-30', '14:00'), 'en'), 'Fri\u00a014:00');
});

test('window: custom opening and deadline', () => {
  const w = cardWindow('2026-12-18', { opens: { daysBefore: 2, time: '18:00' }, deadline: { daysBefore: 0, time: '09:30' } });
  assert.equal(w.opensAt.toISOString(), '2026-12-16T16:00:00.000Z');
  assert.equal(w.closesAt.toISOString(), '2026-12-18T07:30:00.000Z');
});

test('print model: counts add up to 225 per prayer and names are off by default', () => {
  const h = fixtureSeatHall();
  const m = printModel(h.hall, h.allocations, h.released.arvit);
  assert.equal(m.total.taken + m.total.released + m.total.free, 225);
  assert.equal(m.blocks.reduce((n, b) => n + b.taken + b.released + b.free, 0), 225);
  assert.deepEqual(m.blocks.map(b => b.name), ['ימין', 'מרכז ימין', 'מרכז', 'מרכז שמאל', 'שמאל', 'צד שמאל']);
  assert.ok(m.seats.every(s => s.name === undefined));
  assert.equal(m.seats.length, 225);
  const named = printModel(h.hall, h.allocations, h.released.arvit, { names: true });
  assert.ok(named.seats.some(s => s.name));
  assert.ok(named.seats.filter(s => s.state === 'free').every(s => s.name === undefined));
  const other = printModel(h.hall, h.allocations, h.released.shacharit);
  assert.notDeepEqual(other.total, m.total);
});

test('deep link: screen "seats" opens the seat page when the preview is on, Home otherwise', () => {
  assert.equal(pushDestination({ screen: 'seats' }, 'member', true), 'seats');
  assert.equal(pushDestination({ screen: 'seats' }, 'gabbai', true), 'seats');
  assert.equal(pushDestination({ screen: 'seats' }, 'member', false), 'home');
  assert.equal(pushDestination({ screen: 'requests' }, 'gabbai', true), 'approvals');
  assert.equal(pushDestination({ messageId: 'M1' }, 'member', true), 'message');
  const r = routeFromPush({ kehila: 'K1', screen: 'seats' });
  assert.deepEqual(r, { kehila: 'K1', screen: 'seats' });
});

test('print gate: only a gabbai with the flag reaches the hall print; seat screens map from ?screen=', () => {
  assert.equal(seatPrintAllowed('gabbai', true), true);
  for (const role of ['member', 'listener', undefined]) assert.equal(seatPrintAllowed(role, true), false);
  assert.equal(seatPrintAllowed('gabbai', false), false);
  assert.equal(seatPrintRole('gabbai'), true, 'the real print needs no flag');
  for (const role of ['member', 'listener', undefined]) assert.equal(seatPrintRole(role), false);
  assert.equal(seatScreenFor('seat-print', 'gabbai', true), 'seatPrint');
  assert.equal(seatScreenFor('seat-print', 'member', true), null);
  assert.equal(seatScreenFor('seat-print', 'gabbai', false), null);
  for (const s of ['seats', 'seats-split', 'seats-none', 'seats-closed', 'seats-gabbai']) assert.equal(seatScreenFor(s, 'member', true), 'seats', s);
  assert.equal(seatScreenFor('seats', 'member', false), null);
  assert.equal(seatScreenFor('home', 'member', true), null);
});
