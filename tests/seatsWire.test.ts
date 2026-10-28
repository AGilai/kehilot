import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiCodeError } from '../src/client/errors.ts';
import {
  cardModel, conflictOutcome, householdsOf, kindRects, layoutPrint, lastBy, memberFromWire, memberPutBody, onBehalfBody,
  printGeometry, saveRelease, yesChoices, holdsSeats, sameOwnSeats,
} from '../src/seats/wire.ts';
import type { CellKind, MemberSeats, MemberWire, WeekWire } from '../src/seats/wire.ts';

const mine = (k: number, n: number, erev: 'kept' | 'released' = 'kept', day: 'kept' | 'released' = 'kept') => ({ kind: 'mine' as const, k, n, state: { erev, day } });
function wire(over: Partial<MemberWire> = {}, states: Array<['kept' | 'released', 'kept' | 'released']> = [['kept', 'kept'], ['kept', 'kept'], ['kept', 'kept']]): MemberWire {
  return {
    week: '2026-10-30', deadline: '2026-10-30T10:00:00+00:00', open: true, seats: 3, updatedByGabbai: false, updatedAt: { erev: 5, day: null },
    frames: [{ blockName: 'מרכז', cols: 4, rowFrom: '5', rowTo: '8', rows: [
      { label: '5', mine: false, bimah: false, cells: [{ kind: 'other' }, { kind: 'other' }, { kind: 'gap' }, { kind: 'other' }] },
      { label: '6', mine: true, bimah: false, cells: [{ kind: 'gap' }, mine(1, 3, ...states[0]!), mine(2, 3, ...states[1]!), mine(3, 3, ...states[2]!)] },
      { label: null, mine: false, bimah: true, cells: [{ kind: 'bimah' }, { kind: 'bimah' }, { kind: 'gap' }, { kind: 'other' }] },
    ] }],
    ...over,
  };
}
const member = (over: Partial<MemberWire> = {}, states?: Array<['kept' | 'released', 'kept' | 'released']>): MemberSeats => memberFromWire(wire(over, states));

// ---- 409 retry rule (pure)

test('conflictOutcome: own seats unchanged and week open -> silent retry', () => {
  assert.equal(conflictOutcome(member(), member({ updatedAt: { erev: 9, day: null } })), 'retry');
});
test('conflictOutcome: one of his seats changed, the count changed, or the week closed -> updated', () => {
  const before = member();
  assert.equal(conflictOutcome(before, member({}, [['kept', 'kept'], ['released', 'kept'], ['kept', 'kept']])), 'updated');
  assert.equal(conflictOutcome(before, member({}, [['kept', 'released'], ['kept', 'kept'], ['kept', 'kept']])), 'updated');
  assert.equal(conflictOutcome(before, member({ seats: 2 })), 'updated');
  assert.equal(conflictOutcome(before, member({ open: false })), 'updated');
  assert.equal(conflictOutcome(before, member({ seats: 0, frames: [] })), 'updated');
});
test('sameOwnSeats compares both prayers', () => {
  assert.ok(sameOwnSeats(member(), member()));
  assert.ok(!sameOwnSeats(member(), member({}, [['kept', 'kept'], ['kept', 'kept'], ['kept', 'released']])));
});

const conflict = () => new ApiCodeError(409, 'week_changed');
test('saveRelease: plain save sends the prayer, orders and the prayer\'s updatedAt', async () => {
  const bodies: unknown[] = [];
  const base = member();
  const r = await saveRelease({ put: async (b) => { bodies.push(b); return member(); }, reread: async () => { throw new Error('no reread'); } }, base, 'arvit', new Set(['3', '1']));
  assert.equal(r.kind, 'saved');
  assert.deepEqual(bodies, [{ week: '2026-10-30', prayer: 'erev', released: [1, 3], ifUpdatedAt: 5 }]);
});
test('saveRelease: 409 from another family -> re-read, one silent retry with the new updatedAt', async () => {
  const bodies: Array<{ ifUpdatedAt: number | null }> = [];
  let calls = 0;
  const fresh = member({ updatedAt: { erev: 9, day: 2 } });
  const r = await saveRelease({
    put: async (b) => { bodies.push(b); if (calls++ === 0) throw conflict(); return fresh; },
    reread: async () => fresh,
  }, member(), 'shacharit', new Set(['2']));
  assert.equal(r.kind, 'saved');
  assert.deepEqual(bodies.map((b) => b.ifUpdatedAt), [null, 2]);
});
test('saveRelease: 409 and his own seats changed -> updated, no retry', async () => {
  let puts = 0;
  const fresh = member({}, [['released', 'kept'], ['kept', 'kept'], ['kept', 'kept']]);
  const r = await saveRelease({ put: async () => { puts++; throw conflict(); }, reread: async () => fresh }, member(), 'arvit', new Set(['2']));
  assert.equal(r.kind, 'updated');
  assert.equal(puts, 1);
  assert.equal(r.data, fresh);
});
test('saveRelease: a second 409 stops after one retry and shows the updated state; other errors pass through', async () => {
  let puts = 0;
  const r = await saveRelease({ put: async () => { puts++; throw conflict(); }, reread: async () => member() }, member(), 'arvit', new Set());
  assert.equal(r.kind, 'updated');
  assert.equal(puts, 2);
  await assert.rejects(saveRelease({ put: async () => { throw new ApiCodeError(403, 'deadline_passed'); }, reread: async () => member() }, member(), 'arvit', new Set()), { code: 'deadline_passed' });
});

// ---- member card visibility from the server payload

test('member payload: his frames, orders as keys, released states per prayer, bimah per cell', () => {
  const m = member({}, [['released', 'kept'], ['kept', 'kept'], ['kept', 'released']]);
  assert.equal(m.seatCount, 3);
  assert.deepEqual([...m.released.arvit], ['1']);
  assert.deepEqual([...m.released.shacharit], ['3']);
  assert.deepEqual(m.updatedAt, { arvit: 5, shacharit: null });
  const row = m.frames[0]!.rows[2]!;
  assert.deepEqual(row.cells.map((c) => c.kind), ['bimah', 'bimah', 'gap', 'other']);
  assert.equal(memberPutBody('w', 'shacharit', m.released.shacharit, null).prayer, 'day');
});
test('member with no seats: nothing to show, no card', () => {
  const none = memberFromWire({ week: 'w', deadline: '2026-10-30T10:00:00+00:00', open: true, seats: 0 });
  assert.equal(holdsSeats(none), false);
  assert.equal(cardModel(none, new Date('2026-10-30T08:00:00Z')), null);
  assert.equal(cardModel(none, new Date('2026-10-30T08:00:00Z'), true), null);
  assert.equal(cardModel(null, new Date()), null);
});
test('card window: a day before the server deadline until the deadline', () => {
  const m = member();
  assert.equal(cardModel(m, new Date('2026-10-29T09:59:59Z')), null);
  assert.equal(cardModel(m, new Date('2026-10-29T10:00:00Z'))?.state, 'ask');
  assert.equal(cardModel(m, new Date('2026-10-30T09:59:59Z'))?.state, 'ask');
  assert.equal(cardModel(m, new Date('2026-10-30T10:00:00Z')), null);
  assert.equal(cardModel(member({ open: false }), new Date('2026-10-30T09:00:00Z')), null);
  assert.equal(cardModel(m, new Date('2026-11-20T09:00:00Z'), true)?.state, 'ask', 'preview ignores the timer');
});
test('card state: ask until the server says both prayers are answered; a gabbai change shows its own state', () => {
  const now = new Date('2026-10-30T08:00:00Z');
  const ans = (erev: boolean, day: boolean) => member({ answered: { erev, day } });
  assert.equal(cardModel(member(), now)?.state, 'ask');
  assert.equal(cardModel(ans(true, false), now)?.state, 'ask');
  assert.equal(cardModel(ans(true, true), now)?.state, 'done');
  const some = cardModel(member({ answered: { erev: true, day: true } }, [['released', 'kept'], ['kept', 'kept'], ['kept', 'kept']]), now)!;
  assert.deepEqual(some.free, { arvit: 1, shacharit: 0 });
  assert.equal(cardModel(member({ updatedByGabbai: true, answered: { erev: true, day: true } }), now)?.state, 'byGabbai');
  assert.equal(cardModel(member(), now)?.count, 3);
});
test('"yes, everyone\'s coming" saves the current released set for both prayers', () => {
  const m = member({}, [['released', 'kept'], ['kept', 'kept'], ['kept', 'kept']]);
  const y = yesChoices(m);
  assert.deepEqual([...y.arvit], ['1']);
  assert.deepEqual([...y.shacharit], []);
  assert.deepEqual(memberPutBody(m.week, 'shacharit', y.shacharit, m.updatedAt.shacharit), { week: '2026-10-30', prayer: 'day', released: [], ifUpdatedAt: null });
});
test('seats: 0 payload (deep link, push) is the no-seats state', () => {
  const none = memberFromWire({ week: 'w', deadline: '2026-10-30T10:00:00+00:00', open: true, seats: 0 });
  assert.equal(none.seatCount, 0);
  assert.deepEqual(none.frames, []);
  assert.deepEqual(none.answered, { arvit: false, shacharit: false });
});

// ---- bimah from the server's cells

const K = (s: string): CellKind[] => [...s].map((c) => (c === 'S' ? 'seat' : c === 'B' ? 'bimah' : c === 'K' ? 'ark' : c === 'A' ? 'aisle' : 'empty'));
test('kindRects: a bimah of cells becomes its own rectangle, not whole rows', () => {
  const cells = ['SS.SS', 'SSBBS', 'SSBBS', 'SSBBS', 'SS.SS'].map(K);
  assert.deepEqual(kindRects(cells, 'bimah'), [{ row: 1, col: 2, rows: 3, cols: 2 }]);
});
test('kindRects: separate and staggered shapes stay separate; ark likewise', () => {
  const cells = ['KK.B', '...B', 'B.BB', '....'].map(K);
  assert.deepEqual(kindRects(cells, 'bimah'), [{ row: 0, col: 3, rows: 2, cols: 1 }, { row: 2, col: 0, rows: 1, cols: 1 }, { row: 2, col: 2, rows: 1, cols: 2 }]);
  assert.deepEqual(kindRects(cells, 'ark'), [{ row: 0, col: 0, rows: 1, cols: 2 }]);
  assert.deepEqual(kindRects(cells, 'seat'), []);
});

function week(): WeekWire {
  const cells = ['SS.SSB', 'SS.SSB', 'SS.SS.'].map(K);
  const seats: WeekWire['layout']['seats'] = [];
  cells.forEach((r, row) => r.forEach((k, col) => { if (k === 'seat') seats.push({ id: `s${row}${col}`, row, col }); }));
  return {
    week: '2026-10-30', deadline: '2026-10-30T10:00:00+00:00', open: true,
    layout: { effectiveFrom: '2026-09-04', rows: 3, cols: 6, cells, blocks: [{ name: 'שמאל', colStart: 0, colEnd: 1 }, { name: 'ימין', colStart: 3, colEnd: 4 }], rowLabels: [null, '1', '2'], seats },
    assignments: { s00: 'family:f1', s01: 'family:f1', s03: 'family:f1', s10: 'holder:h1', s11: 'holder:h1', s04: 'family:f2' },
    households: { 'family:f1': 'משפחת בדיוני', 'holder:h1': 'דוגמה', 'family:f2': 'ניסיון' },
    prayers: {
      erev: { answered: { 'family:f2': 5, 'family:f1': 10 }, seats: { s01: { released: true, by: 'member', at: 10 }, s10: { released: true, by: 'gabbai', at: 20 }, s04: { released: false, by: 'member', at: 5 } }, requests: {}, canUndo: false, updatedAt: 77 },
      day: { seats: {}, requests: {}, canUndo: false, updatedAt: null },
    },
  };
}

test('layoutPrint: states, counts per block and total, bimah from cells, names only on request', () => {
  const w = week();
  const p = layoutPrint(w, 'arvit');
  assert.equal(p.seats.length, 12);
  assert.deepEqual(p.total, { taken: 4, released: 2, free: 6, pending: 0 });
  assert.deepEqual(p.blocks.map((b) => [b.name, b.taken, b.released, b.free]), [['שמאל', 2, 2, 2], ['ימין', 2, 0, 4]]);
  assert.deepEqual(p.bimah, [{ row: 0, col: 5, rows: 2, cols: 1 }]);
  assert.ok(p.seats.every((s) => s.name === undefined), 'no names by default');
  assert.equal(layoutPrint(w, 'arvit', { names: true }).seats.find((s) => s.id === 's10')!.name, 'דוגמה');
  assert.equal(layoutPrint(w, 'arvit', { names: true }).seats.find((s) => s.id === 's20')?.name, undefined, 'free seats have no name');
  // pending: an assigned family seat whose family has not answered; holders without an account cannot answer, so they stay taken
  const open = structuredClone(w);
  open.prayers.erev.answered = {};
  const pend = layoutPrint(open, 'arvit');
  assert.deepEqual(pend.total, { taken: 1, released: 2, free: 6, pending: 3 });
  assert.equal(pend.seats.find((s) => s.id === 's11')!.state, 'taken');
  assert.equal(pend.seats.find((s) => s.id === 's00')!.state, 'pending');
  assert.equal(pend.seats.find((s) => s.id === 's01')!.state, 'released', 'released wins over pending');
  assert.deepEqual(layoutPrint(w, 'shacharit').total, { taken: 2, released: 0, free: 6, pending: 4 });
});

test('printGeometry fits any layout inside the page box', () => {
  for (const [rows, cols] of [[14, 29], [40, 60], [1, 1], [20, 45]] as const) {
    const g = printGeometry(rows, cols);
    assert.ok(g.hallW <= 1055, `${rows}x${cols} width ${g.hallW}`);
    assert.ok(g.hallH <= 410, `${rows}x${cols} height ${g.hallH}`);
    assert.ok(g.cellW >= 8 && g.cellH >= 4);
  }
  assert.equal(printGeometry(14, 29).cellW, 32);
});

// ---- on behalf

test('householdsOf: server order (blocks right to left, rows front to back, columns right to left), k of n', () => {
  const hs = householdsOf(week());
  const f1 = hs.find((h) => h.ref === 'family:f1')!;
  assert.deepEqual(f1.seats.map((s) => [s.id, s.k, s.n, s.blockName]), [['s03', 1, 3, 'ימין'], ['s01', 2, 3, 'שמאל'], ['s00', 3, 3, 'שמאל']]);
  assert.equal(hs.length, 3);
  assert.equal(hs.find((h) => h.ref === 'holder:h1')!.name, 'דוגמה');
});

test('onBehalfBody: only changed seats, the prayer item\'s updatedAt, null when nothing changes', () => {
  const w = week();
  const f1 = householdsOf(w).find((h) => h.ref === 'family:f1')!;
  assert.equal(onBehalfBody(w, 'arvit', f1, new Set(['s01'])), null);
  assert.deepEqual(onBehalfBody(w, 'arvit', f1, new Set(['s03'])), { prayer: 'erev', released: { s01: false, s03: true }, ifUpdatedAt: 77 });
  assert.deepEqual(onBehalfBody(w, 'shacharit', f1, new Set(['s00', 's01', 's03'])), { prayer: 'day', released: { s00: true, s01: true, s03: true }, ifUpdatedAt: null });
  const h1 = householdsOf(w).find((h) => h.ref === 'holder:h1')!;
  assert.equal(lastBy(w, 'arvit', h1), 'gabbai');
  assert.equal(lastBy(w, 'shacharit', h1), null);
});

// ---- fixtures in the server's shapes (the preview flag path)

import { createSeatsFixture, hallLayout } from '../src/seats/fixtureSeats.ts';
import { HALL, allSeats } from '../src/seats/hall.ts';
import { blockFrames } from '../src/seats/frame.ts';
import { householdsOf as households } from '../src/seats/wire.ts';

test('hallLayout: 225 seats, six blocks, the bimah is one 4x3 rectangle of cells, ark side row labelled', () => {
  const L = hallLayout(HALL);
  assert.equal(L.seats.length, allSeats(HALL).length);
  assert.equal(L.blocks.length, 6);
  assert.deepEqual(kindRects(L.cells, 'bimah'), [{ row: 6, col: 14, rows: 3, cols: 4 }]);
  assert.equal(L.rowLabels[0], 'ק');
});

test('frame.ts bimah follows the cells: only the bimah cells, never whole rows', () => {
  const c = HALL.blocks.find((b) => b.id === 'C')!;
  const f = blockFrames(HALL, [{ block: 'C', row: 4, col: 0 }])[0]!;
  const bimahRow = f.rows.find((r) => r.row === 6)!;
  assert.ok(bimahRow.bimah);
  assert.deepEqual(bimahRow.cells.map((x) => x.kind), c.bimahCells![6]!.map(() => 'bimah'));
  assert.equal(f.rows.find((r) => r.row === 5)!.bimah, false);
});

test('fixture member wire round-trips; a member save and a gabbai on-behalf change show on the other side', () => {
  const fx = createSeatsFixture('default', null, '2026-10-30');
  const m = memberFromWire(fx.memberWire());
  assert.equal(m.seatCount, 3);
  assert.deepEqual(m.answered, { arvit: false, shacharit: false });
  assert.equal(m.updatedByGabbai, false);
  assert.deepEqual(m.frames[0]!.rows.filter((r) => r.mine).length, 1);
  // member releases seat 3 for erev
  const after = memberFromWire(fx.putMine(memberPutBody(m.week, 'arvit', new Set(['3']), m.updatedAt.arvit)));
  assert.deepEqual([...after.released.arvit], ['3']);
  assert.throws(() => fx.putMine(memberPutBody(m.week, 'arvit', new Set(), m.updatedAt.arvit)), { code: 'week_changed' });
  // the gabbai frees another of his seats on behalf; the member side flags it
  const w = fx.adminWeek();
  const me = households(w).find((h) => h.ref === 'family:me')!;
  const body = onBehalfBody(w, 'arvit', me, new Set([...releasedNowOf(w, me), me.seats[0]!.id]))!;
  assert.deepEqual(Object.values(body.released), [true]);
  fx.putWeek(body);
  const seen = memberFromWire(fx.memberWire());
  assert.equal(seen.updatedByGabbai, true);
  assert.deepEqual(seen.answered, { arvit: true, shacharit: false }, 'save and on-behalf answer only their prayer');
  assert.deepEqual([...seen.released.arvit].sort(), ['1', '3']);
  assert.throws(() => fx.putWeek(body), { code: 'week_changed' });
  assert.equal(memberFromWire(createSeatsFixture('none', null, '2026-10-30').memberWire()).seatCount, 0);
  assert.equal(memberFromWire(createSeatsFixture('closed', null, '2026-10-30').memberWire()).open, false);
});
function releasedNowOf(w: WeekWire, h: ReturnType<typeof households>[number]): string[] {
  return h.seats.filter((s) => w.prayers.erev.seats[s.id]?.released).map((s) => s.id);
}
