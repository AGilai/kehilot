import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freeOrderIds, keepChain, laneSides, touches } from '../src/seats/aisle.ts';
import type { CellKind, WireLayout } from '../src/seats/wire.ts';

// Row patterns: S seat, A aisle, . empty. Row 0 is the ark; `bimah` columns of the last row become bimah cells.
function hall(rows: string[], bimah: number[] = []): WireLayout {
  const cols = rows[0]!.length;
  const cells: CellKind[][] = [Array(cols).fill('ark') as CellKind[], ...rows.map((r) => [...r].map((ch) => (ch === 'S' ? 'seat' : ch === 'A' ? 'aisle' : 'empty') as CellKind))];
  for (const c of bimah) cells[cells.length - 1]![c] = 'bimah';
  const used = (c: number) => cells.slice(1).some((r) => r[c] === 'seat' || r[c] === 'bimah');
  const blocks: WireLayout['blocks'] = [];
  let start = -1;
  for (let c = 0; c <= cols; c++) {
    if (c < cols && used(c)) { if (start < 0) start = c; } else if (start >= 0) { blocks.push({ name: `b${blocks.length}`, colStart: start, colEnd: c - 1 }); start = -1; }
  }
  const seats: WireLayout['seats'] = [];
  for (let r = 1; r < cells.length; r++) for (let c = 0; c < cols; c++) if (cells[r]![c] === 'seat') seats.push({ id: `s${r}_${c}`, row: r, col: c });
  return { effectiveFrom: '2026-09-04', rows: cells.length, cols, cells, seats, blocks, rowLabels: cells.map((_, i) => String(i)) };
}
const FIVE = Array(5).fill('SSASSSSSASS') as string[];
const RIGHT = [9, 10], LEFT = [0, 1];
const id = (r: number, c: number) => `s${r}_${c}`;
const free = (lay: WireLayout, ...ids: string[]) => freeOrderIds(lay, ids);

test('laneSides', () => {
  const lay = hall(Array(3).fill('SSASSSASS') as string[]);
  assert.deepEqual(lay.blocks.map((_, i) => laneSides(lay, i)), [['right'], ['left', 'right'], ['left']]);
  assert.deepEqual(laneSides(hall(Array(3).fill('SSASSSSSS') as string[]), 1), ['left']);
});

test('each rule decides a pair (the worse seat is freed first)', () => {
  const r = hall(FIVE, RIGHT), l = hall(FIVE, LEFT), n = hall(FIVE);
  assert.deepEqual(free(r, id(1, 4), id(4, 4)), [id(4, 4), id(1, 4)]); // 1: row nearer the Aron
  assert.deepEqual(free(r, id(2, 3), id(2, 4)), [id(2, 4), id(2, 3)]); // 2: next to an aisle
  assert.deepEqual(free(l, id(2, 7), id(2, 6)), [id(2, 6), id(2, 7)]);
  assert.deepEqual(free(r, id(2, 4), id(2, 5)), [id(2, 5), id(2, 4)]); // 3: fewer seats to an aisle beats the bimah
  assert.deepEqual(free(r, id(2, 7), id(2, 3)), [id(2, 3), id(2, 7)]); // 4: nearer the bimah
  assert.deepEqual(free(l, id(2, 7), id(2, 3)), [id(2, 7), id(2, 3)]);
  assert.deepEqual(free(r, id(2, 6), id(2, 4)), [id(2, 4), id(2, 6)]);
  assert.deepEqual(free(n, id(2, 6), id(2, 4)), [id(2, 4), id(2, 6)]); // 5: the right seat
  assert.deepEqual(free(hall(['SSSS', 'SSSS']), id(1, 3), id(1, 2), id(1, 1)), [id(1, 1), id(1, 2), id(1, 3)]);
});

test('walls are aisles; the head takes an aisle seat over a nearer row', () => {
  const n = hall(FIVE);
  assert.deepEqual(free(n, id(2, 5), id(2, 10)), [id(2, 5), id(2, 10)]);
  assert.equal(keepChain(n, [id(2, 0), id(2, 5)])[0], id(2, 0));
  assert.deepEqual(keepChain(n, [id(1, 5), id(4, 3)]), [id(4, 3), id(1, 5)]);
  assert.deepEqual(free(n, id(1, 5), id(4, 3)), [id(1, 5), id(4, 3)]);
});

test('whole row: freeing starts at the far end and walks towards the head', () => {
  const row = [7, 6, 5, 4, 3].map((c) => id(3, c));
  assert.deepEqual(free(hall(FIVE, RIGHT), ...row), [3, 4, 5, 6, 7].map((c) => id(3, c)));
  assert.deepEqual(free(hall(FIVE, LEFT), ...row), [7, 6, 5, 4, 3].map((c) => id(3, c)));
});

test('two adjacent rows keep the group around the head; separate groups: the non-touching one goes first', () => {
  const lay = hall(FIVE, RIGHT);
  assert.deepEqual(keepChain(lay, [id(1, 4), id(1, 5), id(2, 4), id(2, 5)]), [id(1, 4), id(1, 5), id(2, 4), id(2, 5)]);
  assert.deepEqual(free(lay, id(1, 6), id(1, 5), id(4, 4), id(4, 5)), [id(4, 5), id(4, 4), id(1, 5), id(1, 6)]);
  assert.deepEqual(free(lay, id(1, 6), id(1, 5), id(4, 3), id(4, 4)), [id(1, 5), id(1, 6), id(4, 4), id(4, 3)]);
});

test('an empty cell breaks adjacency; the input order does not matter', () => {
  const lay = hall(['SSASSS..ASS', ...Array(3).fill('SSASSSSSASS')] as string[], RIGHT);
  assert.equal(touches({ id: 'a', row: 1, col: 5 }, { id: 'b', row: 1, col: 7 }), false);
  const ids = lay.seats.map((s) => s.id);
  const a = freeOrderIds(lay, ids);
  assert.deepEqual(freeOrderIds(lay, [...ids].reverse()), a);
  assert.equal(new Set(a).size, ids.length);
});

test('kept seats stay one group after freeing any number', () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  for (const bimah of [[], RIGHT, LEFT]) {
    const lay = hall(FIVE, bimah);
    for (let t = 0; t < 40; t++) {
      const group = [lay.seats[rnd(lay.seats.length)]!];
      for (let i = rnd(8) + 1; i > 0; i--) {
        const near = lay.seats.filter((s) => !group.includes(s) && group.some((g) => touches(s, g)));
        if (near.length) group.push(near[rnd(near.length)]!);
      }
      const out = freeOrderIds(lay, group.map((s) => s.id));
      for (let k = 0; k < out.length; k++) {
        const kept = out.slice(k).map((i) => lay.seats.find((s) => s.id === i)!);
        const seen = [kept[0]!];
        for (let i = 0; i < seen.length; i++) for (const s of kept) if (!seen.includes(s) && touches(s, seen[i]!)) seen.push(s);
        assert.equal(seen.length, kept.length);
      }
    }
  }
});
