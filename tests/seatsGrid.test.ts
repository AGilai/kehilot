import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellAt, emptySel, jumpPos, posKey, rectKeys, selReducer, stepPos } from '../src/seats/grid.ts';

const any = () => true;

test('rectangle is the same whichever corner it was dragged from', () => {
  const a = rectKeys('1:1', '2:3');
  assert.deepEqual(a, ['1:1', '1:2', '1:3', '2:1', '2:2', '2:3']);
  assert.deepEqual(rectKeys('2:3', '1:1'), a);
  assert.deepEqual(rectKeys('2:1', '1:3'), a);
});

test('rectangle keeps only the cells the mode can select', () => {
  const seats = new Set(['0:0', '0:2', '1:1']);
  assert.deepEqual(rectKeys('0:0', '1:2', (p) => seats.has(p)), ['0:0', '0:2', '1:1']);
});

test('pixels map to cells; a mirrored (right to left) grid counts columns from the right edge', () => {
  assert.deepEqual(cellAt(5, 5, 62, 38, 4, 6), { r: 0, c: 0 });
  assert.deepEqual(cellAt(5, 5, 62, 38, 4, 6, true), { r: 0, c: 5 });
  assert.deepEqual(cellAt(62 * 6 - 1, 38 * 4 - 1, 62, 38, 4, 6, true), { r: 3, c: 0 });
  assert.equal(cellAt(62 * 6, 0, 62, 38, 4, 6), null);
  assert.equal(cellAt(-1, 0, 62, 38, 4, 6), null);
});

test('a drag in RTL coordinates selects the same rectangle as the cells it crosses', () => {
  // grid of 6 columns drawn mirrored: pointer from x=300 (col 1) to x=70 (col 4), rows 0-1
  const a = cellAt(300, 5, 62, 38, 4, 6, true)!;
  const b = cellAt(70, 40, 62, 38, 4, 6, true)!;
  assert.deepEqual([a.c, b.c], [1, 4]);
  assert.deepEqual(rectKeys(posKey(a.r, a.c), posKey(b.r, b.c)), ['0:1', '0:2', '0:3', '0:4', '1:1', '1:2', '1:3', '1:4']);
});

test('arrows are physical; mirrored swaps left and right; edges clamp', () => {
  assert.equal(stepPos('1:1', 'right', 3, 3), '1:2');
  assert.equal(stepPos('1:1', 'right', 3, 3, true), '1:0');
  assert.equal(stepPos('0:0', 'up', 3, 3), '0:0');
  assert.equal(stepPos('2:2', 'down', 3, 3), '2:2');
  assert.equal(jumpPos('1:1', 'home', 3, 5), '1:0');
  assert.equal(jumpPos('1:1', 'end', 3, 5), '1:4');
  assert.equal(jumpPos('1:1', 'front', 3, 5), '0:1');
  assert.equal(jumpPos('1:1', 'back', 3, 5), '2:1');
});

test('selection: click replaces, toggle adds and removes, drag extends from the anchor and honours the base', () => {
  let s = selReducer(emptySel(), { type: 'click', pos: '0:0', pred: any });
  assert.deepEqual(s.keys, ['0:0']);
  s = selReducer(s, { type: 'toggle', pos: '0:3', pred: any });
  assert.deepEqual(s.keys, ['0:0', '0:3']);
  s = selReducer(s, { type: 'toggle', pos: '0:0', pred: any });
  assert.deepEqual(s.keys, ['0:3']);
  s = selReducer(s, { type: 'start', pos: '2:0', additive: true, pred: any });
  s = selReducer(s, { type: 'to', pos: '3:1', pred: any });
  assert.deepEqual(s.keys, ['0:3', '2:0', '2:1', '3:0', '3:1']);
  s = selReducer(s, { type: 'to', pos: '2:0', pred: any });
  assert.deepEqual(s.keys, ['0:3', '2:0'], 'shrinking the drag shrinks the rectangle');
  assert.deepEqual(selReducer(s, { type: 'clear' }).keys, []);
});

test('selection: an unselectable cell is not picked; shift+arrows extend from the anchor', () => {
  const seat = (p: string) => p !== '0:1';
  let s = selReducer(emptySel(), { type: 'click', pos: '0:0', pred: seat });
  s = selReducer(s, { type: 'to', pos: stepPos('0:0', 'right', 3, 3), pred: seat });
  assert.deepEqual(s.keys, ['0:0']);
  s = selReducer(s, { type: 'to', pos: '1:2', pred: seat });
  assert.deepEqual(s.keys, ['0:0', '0:2', '1:0', '1:1', '1:2']);
  assert.deepEqual(selReducer(emptySel(), { type: 'click', pos: '0:1', pred: seat }).keys, []);
});

test('selection: a plain arrow re-anchors, so Shift+arrows grow from where the focus is', () => {
  let s = selReducer(emptySel(), { type: 'click', pos: '0:0', pred: any });
  s = selReducer(s, { type: 'anchor', pos: '2:2' });
  assert.deepEqual(s.keys, ['0:0']);
  s = selReducer(s, { type: 'to', pos: '3:3', pred: any });
  assert.deepEqual(s.keys, ['0:0', '2:2', '2:3', '3:2', '3:3']);
});
