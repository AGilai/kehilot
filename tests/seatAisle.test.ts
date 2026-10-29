import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freeOrderIds, headSide, laneSides } from '../src/seats/aisle.ts';
import type { CellKind, WireLayout } from '../src/seats/wire.ts';

function make(blocks: Array<[number, number]> = [[0, 1], [3, 5], [7, 8]], bimah: number[] = []): WireLayout {
  const rows: CellKind[][] = [Array(9).fill('ark') as CellKind[]];
  for (let i = 0; i < 3; i++) rows.push(['seat', 'seat', 'aisle', 'seat', 'seat', 'seat', 'aisle', 'seat', 'seat']);
  for (const c of bimah) rows[3]![c] = 'bimah';
  const seats: WireLayout['seats'] = [];
  for (const r of [1, 2, 3]) for (let c = 0; c < 9; c++) if (rows[r]![c] === 'seat') seats.push({ id: `s${r}${c}`, row: r, col: c });
  return { effectiveFrom: '2026-09-04', rows: 4, cols: 9, cells: rows, seats, blocks: blocks.map(([a, b], i) => ({ name: `b${i}`, colStart: a, colEnd: b })), rowLabels: ['0', '1', '2', '3'] };
}

test('laneSides', () => {
  const lay = make();
  assert.deepEqual(lay.blocks.map((_, i) => laneSides(lay, i)), [['right'], ['left', 'right'], ['left']]);
  const l2 = make([[0, 1], [3, 6], [7, 8]]);
  assert.deepEqual(laneSides(l2, 1), ['left']);
});

test('headSide is the lane nearer the bimah; a tie or no bimah goes right', () => {
  assert.equal(headSide(make([[0, 1], [3, 5], [7, 8]], [7, 8]), 1), 'right');
  assert.equal(headSide(make([[0, 1], [3, 5], [7, 8]], [0, 1]), 1), 'left');
  const b = make();
  assert.equal(headSide(b, 1), 'right');
  assert.equal(headSide(b, 0), 'right');
  assert.equal(headSide(b, 2), 'left');
  assert.equal(headSide(make([[0, 8]]), 0), null);
});

test('freeOrderIds: far side first', () => {
  assert.deepEqual(freeOrderIds(make([[0, 1], [3, 5], [7, 8]], [7, 8]), ['s15', 's14', 's13']), ['s13', 's14', 's15']);
});

test('freeOrderIds: rear row first; no lane falls back to the family order reversed', () => {
  assert.deepEqual(freeOrderIds(make([[0, 1], [3, 5], [7, 8]], [7, 8]), ['s25', 's35']), ['s35', 's25']);
  assert.deepEqual(freeOrderIds(make([[0, 8]]), ['s13', 's14', 's15']), ['s15', 's14', 's13']);
});
