import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_COLS, MAX_ROWS, addCol, addHolder, addRow, assignKeys, assignmentsOf, changeCount, changedPositions, countsByRef, diffDrafts, draftFromVersion, draftIssues,
  editReducer, emptyDraft, freeAllOf, freeKeys, heldByOthers, initialEdit, layoutBodyOf, moveFamily, paintCells, paintLosers, rebaseOnto, removeCol, removeRow,
  renameBlock, seatCount, seatsOf, setRowLabel, summarize, usedHolders, HISTORY_LIMIT,
} from '../src/seats/editModel.ts';
import type { Draft } from '../src/seats/editModel.ts';

const A = 'family:FA', B = 'family:FB';
// 3 rows x 4 cols, one block per two columns; (1,1) is the bimah, column 2 of row 0 is an aisle-ish empty
const base = (): Draft => {
  const d = emptyDraft(3, 4);
  d.layout.blocks = [{ name: 'ימין', colStart: 0, colEnd: 1 }, { name: 'שמאל', colStart: 2, colEnd: 3 }];
  d.layout.cells[1]![1] = 'bimah';
  return d;
};

test('assigning and freeing touch seats only; counts per household', () => {
  let d = assignKeys(base(), ['0:0', '0:1', '1:1'], A);
  assert.deepEqual(Object.keys(d.assign), ['0:0', '0:1'], 'bimah cell takes no holder');
  d = assignKeys(d, ['2:3'], B);
  assert.equal(countsByRef(d).get(A), 2);
  assert.equal(countsByRef(d).get(B), 1);
  d = freeKeys(d, ['0:0']);
  assert.equal(countsByRef(d).get(A), 1);
  assert.equal(countsByRef(freeAllOf(d, A)).get(A), undefined);
});

test('seats of a household are in its own order: front to back, right to left in a row', () => {
  const d = assignKeys(base(), ['0:0', '0:2', '2:1'], A);
  assert.deepEqual(seatsOf(d, A), ['0:2', '0:0', '2:1']);
});

test('heldByOthers lists seats of other households only', () => {
  const d = assignKeys(assignKeys(base(), ['0:0'], A), ['0:1'], B);
  assert.deepEqual(heldByOthers(d, ['0:0', '0:1', '0:2'], A), [{ pos: '0:1', ref: B }]);
});

test('move a family: same number of seats, free or its own; old seats freed', () => {
  const d = assignKeys(assignKeys(base(), ['0:0', '0:1'], A), ['2:0'], B);
  const ok = moveFamily(d, A, ['2:2', '2:3']);
  assert.ok(ok.ok);
  if (ok.ok) { assert.deepEqual(seatsOf(ok.draft, A), ['2:3', '2:2']); assert.equal(ok.draft.assign['0:0'], undefined); }
  const overlap = moveFamily(d, A, ['0:1', '2:3']);
  assert.ok(overlap.ok, 'a target that is already its own seat is fine');
  assert.deepEqual(moveFamily(d, A, ['2:2']), { ok: false, error: 'count' });
  assert.deepEqual(moveFamily(d, A, ['2:0', '2:2']), { ok: false, error: 'taken' });
  assert.deepEqual(moveFamily(d, A, ['1:1', '2:2']), { ok: false, error: 'not-seat' });
  assert.deepEqual(moveFamily(d, 'family:none', ['2:2']), { ok: false, error: 'count' });
});

test('paint: turning an occupied seat into anything else frees it and names who loses', () => {
  const d = assignKeys(base(), ['0:0', '0:1', '2:3'], A);
  assert.deepEqual(paintLosers(d, ['0:0', '0:1', '0:2'], 'aisle'), [{ ref: A, n: 2 }]);
  assert.deepEqual(paintLosers(d, ['0:0'], 'seat'), []);
  const p = paintCells(d, ['0:0', '1:1'], 'aisle');
  assert.equal(p.layout.cells[0]![0], 'aisle');
  assert.equal(p.assign['0:0'], undefined);
  assert.equal(p.assign['0:1'], A);
  assert.equal(seatCount(p), seatCount(d) - 1 - 0);
});

test('painting a seat outside every block grows the nearest block, never overlaps', () => {
  const d = base();
  d.layout.blocks = [{ name: 'ימין', colStart: 0, colEnd: 0 }, { name: 'שמאל', colStart: 3, colEnd: 3 }];
  d.layout.cells = d.layout.cells.map((r) => r.map((_, c) => (c === 0 || c === 3 ? 'seat' : 'empty')));
  const p = paintCells(d, ['0:1'], 'seat');
  assert.deepEqual(p.layout.blocks.map((b) => [b.colStart, b.colEnd]), [[0, 1], [3, 3]]);
  const q = paintCells(d, ['0:2'], 'seat');
  assert.deepEqual(q.layout.blocks.map((b) => [b.colStart, b.colEnd]), [[0, 0], [2, 3]]);
});

test('rows: add at the front shifts holders with their cells; remove drops them; caps and minimum', () => {
  const d = assignKeys(base(), ['0:0', '2:3'], A);
  const f = addRow(d, 'front');
  assert.ok(f.ok);
  if (f.ok) {
    assert.equal(f.draft.layout.rows, 4);
    assert.equal(f.draft.layout.rowLabels.length, 4);
    assert.deepEqual(Object.keys(f.draft.assign).sort(), ['1:0', '3:3']);
    assert.equal(f.draft.layout.cells[0]!.every((k) => k === 'empty'), true);
  }
  const b = addRow(d, 'back');
  if (b.ok) assert.deepEqual(Object.keys(b.draft.assign).sort(), ['0:0', '2:3']);
  const r = removeRow(d, 0);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(Object.keys(r.draft.assign), ['1:3']);
  assert.deepEqual(removeRow(emptyDraft(1, 3), 0), { ok: false, error: 'last-row' });
  assert.deepEqual(removeRow(d, 9), { ok: false, error: 'range' });
  assert.deepEqual(addRow(emptyDraft(MAX_ROWS, 3), 'back'), { ok: false, error: 'rows-cap' });
  assert.ok(addRow(emptyDraft(MAX_ROWS - 1, 3), 'back').ok);
});

test('columns: add at the edge extends the edge block; remove shrinks or drops a block', () => {
  const d = assignKeys(base(), ['0:0', '0:3'], A);
  const r = addCol(d, 'right');
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.draft.layout.cols, 5); assert.deepEqual(r.draft.layout.blocks.map((b) => b.colEnd), [1, 4]); assert.ok(r.draft.layout.cells.every((row) => row.length === 5)); }
  const l = addCol(d, 'left');
  assert.ok(l.ok);
  if (l.ok) { assert.deepEqual(l.draft.layout.blocks.map((b) => [b.colStart, b.colEnd]), [[0, 2], [3, 4]]); assert.deepEqual(Object.keys(l.draft.assign).sort(), ['0:1', '0:4']); }
  const rm = removeCol(d, 3);
  assert.ok(rm.ok);
  if (rm.ok) { assert.deepEqual(rm.draft.layout.blocks.map((b) => [b.colStart, b.colEnd]), [[0, 1], [2, 2]]); assert.deepEqual(Object.keys(rm.draft.assign), ['0:0']); }
  const e = emptyDraft(2, 2);
  e.layout.blocks = [{ name: 'א', colStart: 0, colEnd: 0 }, { name: 'ב', colStart: 1, colEnd: 1 }];
  const gone = removeCol(e, 1);
  if (gone.ok) assert.deepEqual(gone.draft.layout.blocks, [{ name: 'א', colStart: 0, colEnd: 0 }]);
  assert.deepEqual(removeCol(emptyDraft(2, 1), 0), { ok: false, error: 'last-col' });
  assert.deepEqual(addCol(emptyDraft(2, MAX_COLS), 'left'), { ok: false, error: 'cols-cap' });
});

test('rename block, row label, issues (no seats, block name length, label length)', () => {
  let d = renameBlock(base(), 0, 'צד ימין');
  assert.equal(d.layout.blocks[0]!.name, 'צד ימין');
  d = setRowLabel(d, 1, 'ק');
  assert.equal(d.layout.rowLabels[1], 'ק');
  d = setRowLabel(d, 2, '  ');
  assert.equal(d.layout.rowLabels[2], null);
  assert.deepEqual(draftIssues(d), []);
  assert.deepEqual(draftIssues(renameBlock(d, 1, '')), [{ code: 'block-name', index: 1 }]);
  assert.deepEqual(draftIssues(renameBlock(d, 1, 'א'.repeat(25))), [{ code: 'block-name', index: 1 }]);
  assert.deepEqual(draftIssues(setRowLabel(d, 0, '123456789')), [{ code: 'row-label', index: 0 }]);
  const none = paintCells(d, ['0:0', '0:1', '0:2', '0:3', '1:0', '1:2', '1:3', '2:0', '2:1', '2:2', '2:3'], 'empty');
  assert.deepEqual(draftIssues(none), [{ code: 'no-seats' }]);
});

test('seat ids are kept for unchanged positions: the save payload is positional, ids come only from the saved layout', () => {
  const v = { ...emptyDraft(2, 2).layout, seats: [{ id: 's00', row: 0, col: 0 }, { id: 's01', row: 0, col: 1 }, { id: 's10', row: 1, col: 0 }, { id: 's11', row: 1, col: 1 }] };
  const d = draftFromVersion(v, { s00: A, s11: B, gone: A });
  assert.deepEqual(d.assign, { '0:0': A, '1:1': B });
  // paint one cell, add a new holder: unchanged positions map to the same ids, the freed seat gets null
  let e = paintCells(d, ['0:1'], 'aisle');
  e = freeKeys(e, ['1:1']);
  const h = addHolder(e, ' דוגמה  ', '0501234567');
  e = assignKeys(h.draft, ['1:0'], h.ref);
  const saved = [{ id: 's00', row: 0, col: 0 }, { id: 's10', row: 1, col: 0 }, { id: 's11', row: 1, col: 1 }];
  assert.deepEqual(assignmentsOf(e, saved, { h1: 'HOLD1' }), { s00: A, s10: 'holder:HOLD1', s11: null });
  assert.deepEqual(usedHolders(e), [{ key: 'h1', name: 'דוגמה', phone: '0501234567' }]);
  assert.deepEqual(usedHolders(freeKeys(e, ['1:0'])), [], 'a holder nobody sits with is not created');
  assert.equal(layoutBodyOf(e).cells[0]![1], 'aisle');
});

test('diff lists only what changed; count and summary', () => {
  const b = assignKeys(base(), ['0:0', '0:1'], A);
  let m = freeKeys(b, ['0:0']);
  m = assignKeys(m, ['2:2'], B);
  m = paintCells(m, ['2:0'], 'aisle');
  m = renameBlock(m, 0, 'חדש');
  const cs = diffDrafts(b, m);
  assert.deepEqual(cs.assign, { '0:0': null, '2:2': B });
  assert.deepEqual(cs.cells, { '2:0': 'aisle' });
  assert.ok(cs.blocks && !cs.rowLabels && !cs.dims);
  assert.equal(changeCount(cs), 4);
  assert.deepEqual(summarize(cs), { assigned: 1, freed: 1, cells: 1, names: true, size: false });
  assert.deepEqual([...changedPositions(cs)].sort(), ['0:0', '2:0', '2:2']);
  assert.equal(changeCount(diffDrafts(b, b)), 0);
});

test('rebase: my changes land on the newer version as unsaved changes; theirs stay', () => {
  const b = assignKeys(base(), ['0:0', '0:1'], A);
  const mine = assignKeys(freeKeys(b, ['0:0']), ['2:0', '2:1'], B);
  const theirs = assignKeys(assignKeys(b, ['2:3'], 'family:FC'), ['0:3'], 'family:FC');
  const { draft, overlaps } = rebaseOnto(theirs, b, mine);
  assert.deepEqual(overlaps, []);
  assert.equal(draft.assign['0:0'], undefined, 'my freeing applied');
  assert.equal(draft.assign['2:0'], B);
  assert.equal(draft.assign['2:3'], 'family:FC', 'their change stays');
  assert.equal(draft.assign['0:1'], A);
  // the result diffed against theirs is exactly my change set
  assert.deepEqual(diffDrafts(theirs, draft).assign, diffDrafts(b, mine).assign);
});

test('rebase: a cell both changed differently is an overlap, theirs wins unless picked', () => {
  const b = assignKeys(base(), ['0:0'], A);
  const mine = assignKeys(b, ['0:0'], B);
  const theirs = assignKeys(b, ['0:0'], 'family:FC');
  const r = rebaseOnto(theirs, b, mine);
  assert.deepEqual(r.overlaps, [{ pos: '0:0', what: 'seat', base: A, theirs: 'family:FC', mine: B }]);
  assert.equal(r.draft.assign['0:0'], 'family:FC');
  assert.equal(rebaseOnto(theirs, b, mine, { '0:0|seat': 'mine' }).draft.assign['0:0'], B);
  // both made the same change: no overlap
  assert.deepEqual(rebaseOnto(mine, b, mine).overlaps, []);
});

test('rebase: layout edits apply, a seat I assigned that they turned into an aisle is dropped and listed', () => {
  const b = base();
  const mine = renameBlock(assignKeys(paintCells(b, ['2:2'], 'aisle'), ['0:2'], A), 1, 'שמאל חדש');
  const theirs = paintCells(b, ['0:2'], 'aisle');
  const r = rebaseOnto(theirs, b, mine);
  assert.equal(r.draft.layout.cells[2]![2], 'aisle', 'my cell edit applied');
  assert.equal(r.draft.layout.cells[0]![2], 'aisle', 'their cell edit kept');
  assert.equal(r.draft.assign['0:2'], undefined, 'no holder on a non-seat');
  assert.equal(r.draft.layout.blocks[1]!.name, 'שמאל חדש');
  assert.deepEqual(r.overlaps.map((o) => o.pos), ['0:2']);
});

test('rebase: sizes grow to what either side needs; my new holders come along', () => {
  const b = base();
  const grown = addRow(b, 'back');
  assert.ok(grown.ok);
  if (!grown.ok) return;
  const withHolder = addHolder(grown.draft, 'חדש');
  const mine = assignKeys(withHolder.draft, ['3:0'], withHolder.ref);
  const theirs = b;
  const r = rebaseOnto(theirs, b, mine);
  assert.equal(r.draft.layout.rows, 4);
  assert.equal(r.draft.layout.cells[3]!.length, 4);
  assert.equal(r.draft.holders.length, 1);
  // theirs also grew (columns): rows from me, cols from them
  const t2 = addCol(b, 'right');
  if (t2.ok) { const r2 = rebaseOnto(t2.draft, b, mine); assert.equal(r2.draft.layout.rows, 4); assert.equal(r2.draft.layout.cols, 5); }
});

test('undo / redo, redo cleared by a new edit, limit 40, identical set is no step', () => {
  const d0 = base();
  let s = initialEdit(d0);
  const d1 = assignKeys(d0, ['0:0'], A);
  const d2 = assignKeys(d1, ['0:1'], A);
  s = editReducer(s, { type: 'set', draft: d1 });
  s = editReducer(s, { type: 'set', draft: d1 });
  assert.equal(s.past.length, 1);
  s = editReducer(s, { type: 'set', draft: d2 });
  s = editReducer(s, { type: 'undo' });
  assert.deepEqual(s.draft, d1);
  s = editReducer(s, { type: 'redo' });
  assert.deepEqual(s.draft, d2);
  s = editReducer(s, { type: 'undo' });
  s = editReducer(s, { type: 'set', draft: assignKeys(d1, ['2:0'], B) });
  assert.equal(s.future.length, 0);
  assert.equal(editReducer(initialEdit(d0), { type: 'undo' }).draft, d0);
  let long = initialEdit(d0);
  for (let i = 0; i < 60; i++) long = editReducer(long, { type: 'set', draft: setRowLabel(long.draft, 0, String(i)) });
  assert.equal(long.past.length, HISTORY_LIMIT);
  assert.deepEqual(editReducer(long, { type: 'reset', draft: d0 }), initialEdit(d0));
});
