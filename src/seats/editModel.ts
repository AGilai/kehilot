/**
 * The map editor's model (pure, UX-DESIGN §16.4-16.5): a draft is a layout plus who holds each seat, keyed by POSITION
 * ("row:col"), never by seat id. The server keeps a seat's id when it stays at the same row and column, so saving the
 * whole draft (layout, then every seat's holder) preserves ids for unchanged positions; ids appear only at save time.
 * Everything here returns new drafts and never mutates. Caps are the server's (40 x 60, 1-12 blocks, names 1-24, labels 8).
 */
import { MAX_COLS, MAX_ROWS } from './paste.ts';
import { BLOCK_NAME_MAX, MAX_BLOCKS } from './savePlan.ts';
import type { LayoutBody, NewHolder } from './savePlan.ts';
import { parsePos, posKey } from './grid.ts';
import type { Pos } from './grid.ts';

export type Kind = LayoutBody['cells'][number][number];
export const ROW_LABEL_MAX = 8;
export { MAX_COLS, MAX_ROWS, MAX_BLOCKS, BLOCK_NAME_MAX };

/** `assign`: position to "family:<id>" | "holder:<id>" | "new:<key>" (a holder this draft will create at save). */
export type Draft = { layout: LayoutBody; assign: Record<Pos, string>; holders: NewHolder[] };
export type EditError = 'rows-cap' | 'cols-cap' | 'last-row' | 'last-col' | 'blocks-cap' | 'count' | 'taken' | 'not-seat' | 'range';
export type Edit = { ok: true; draft: Draft } | { ok: false; error: EditError };

const clone = (d: Draft): Draft => ({ layout: { ...d.layout, cells: d.layout.cells.map((r) => [...r]), blocks: d.layout.blocks.map((b) => ({ ...b })), rowLabels: [...d.layout.rowLabels] }, assign: { ...d.assign }, holders: d.holders.map((h) => ({ ...h })) });
export const kindAt = (d: Draft, p: Pos): Kind | undefined => { const { r, c } = parsePos(p); return d.layout.cells[r]?.[c]; };
export const isSeat = (d: Draft, p: Pos): boolean => kindAt(d, p) === 'seat';

/** A saved version (layout + seats with ids) and its assignments by seat id to a draft; holders of unknown seats are dropped. */
export function draftFromVersion(v: LayoutBody & { seats: { id: string; row: number; col: number }[] }, byId: Record<string, string>): Draft {
  const assign: Record<Pos, string> = {};
  for (const s of v.seats) { const ref = byId[s.id]; if (ref) assign[posKey(s.row, s.col)] = ref; }
  return { layout: { rows: v.rows, cols: v.cols, cells: v.cells.map((r) => [...r]), blocks: v.blocks.map((b) => ({ ...b })), rowLabels: [...v.rowLabels] }, assign, holders: [] };
}

/** Build from scratch: one block, every cell a seat, labels 1..n. */
export function emptyDraft(rows = 6, cols = 10): Draft {
  return { layout: { rows, cols, cells: Array.from({ length: rows }, () => Array<Kind>(cols).fill('seat')), blocks: [{ name: 'מרכז', colStart: 0, colEnd: cols - 1 }], rowLabels: Array.from({ length: rows }, (_, i) => String(i + 1)) }, assign: {}, holders: [] };
}

export const seatCount = (d: Draft): number => d.layout.cells.reduce((n, r) => n + r.filter((k) => k === 'seat').length, 0);
/** Seats per household ref (seats only). */
export function countsByRef(d: Draft): Map<string, number> {
  const m = new Map<string, number>();
  for (const [p, ref] of Object.entries(d.assign)) if (isSeat(d, p)) m.set(ref, (m.get(ref) ?? 0) + 1);
  return m;
}
export const freeSeats = (d: Draft): number => seatCount(d) - [...countsByRef(d).values()].reduce((a, b) => a + b, 0);
/** A household's positions in the family's own order: blocks right to left, rows front to back, right to left in a row (spec "k of n"). */
export function seatsOf(d: Draft, ref: string): Pos[] {
  return Object.entries(d.assign).filter(([p, r]) => r === ref && isSeat(d, p)).map(([p]) => p).sort((x, y) => { const a = parsePos(x), b = parsePos(y); return a.r - b.r || b.c - a.c; });
}

// ---- assigning ----
/** Give seats to a household; other kinds of cell are ignored. */
export function assignKeys(d: Draft, keys: Pos[], ref: string): Draft {
  const n = clone(d);
  for (const p of keys) if (isSeat(d, p)) n.assign[p] = ref;
  return n;
}
export function freeKeys(d: Draft, keys: Pos[]): Draft {
  const n = clone(d);
  for (const p of keys) delete n.assign[p];
  return n;
}
export const freeAllOf = (d: Draft, ref: string): Draft => freeKeys(d, seatsOf(d, ref));
/** Selected seats that belong to somebody else than `ref` (the "move it or free it" question). */
export const heldByOthers = (d: Draft, keys: Pos[], ref: string | null): { pos: Pos; ref: string }[] => keys.flatMap((p) => { const r = d.assign[p]; return r && isSeat(d, p) && r !== ref ? [{ pos: p, ref: r }] : []; });

/** Move a household's seats to `targets`: exactly as many seats as it holds, each free or its own. Old seats not in `targets` become free. */
export function moveFamily(d: Draft, ref: string, targets: Pos[]): Edit {
  const old = seatsOf(d, ref);
  const want = [...new Set(targets)];
  if (want.length !== old.length || old.length === 0) return { ok: false, error: 'count' };
  if (want.some((p) => !isSeat(d, p))) return { ok: false, error: 'not-seat' };
  if (heldByOthers(d, want, ref).length) return { ok: false, error: 'taken' };
  const n = clone(d);
  for (const p of old) delete n.assign[p];
  for (const p of want) n.assign[p] = ref;
  return { ok: true, draft: n };
}

// ---- new holders created at save ----
export function addHolder(d: Draft, name: string, phone?: string): { draft: Draft; ref: string } {
  const key = `h${d.holders.length + 1}`;
  const n = clone(d);
  n.holders.push({ key, name: name.trim(), ...(phone ? { phone } : {}) });
  return { draft: n, ref: `new:${key}` };
}
/** Holders still referenced by a seat; the others are dropped at save, so nothing is created for them. */
export const usedHolders = (d: Draft): NewHolder[] => d.holders.filter((h) => Object.values(d.assign).includes(`new:${h.key}`));

// ---- layout ----
/** Every seat column ends up inside a block: the nearest block grows to it (blocks stay ascending and apart). */
export function fitBlocks(layout: LayoutBody): LayoutBody {
  const blocks = layout.blocks.map((b) => ({ ...b }));
  if (!blocks.length) return layout;
  for (let c = 0; c < layout.cols; c++) {
    if (!layout.cells.some((r) => r[c] === 'seat') || blocks.some((b) => c >= b.colStart && c <= b.colEnd)) continue;
    let best = 0, dist = Infinity;
    blocks.forEach((b, i) => { const dd = c < b.colStart ? b.colStart - c : c - b.colEnd; if (dd < dist) { dist = dd; best = i; } });
    const b = blocks[best]!;
    if (c < b.colStart) b.colStart = c; else b.colEnd = c;
  }
  return { ...layout, blocks };
}

/** Which households lose seats if `keys` turn into `kind` (anything but a seat takes the seat away). */
export function paintLosers(d: Draft, keys: Pos[], kind: Kind): { ref: string; n: number }[] {
  if (kind === 'seat') return [];
  const m = new Map<string, number>();
  for (const p of keys) { const ref = d.assign[p]; if (ref && isSeat(d, p)) m.set(ref, (m.get(ref) ?? 0) + 1); }
  return [...m].map(([ref, n]) => ({ ref, n }));
}
export function paintCells(d: Draft, keys: Pos[], kind: Kind): Draft {
  const n = clone(d);
  for (const p of keys) {
    const { r, c } = parsePos(p);
    if (!n.layout.cells[r] || n.layout.cells[r]![c] === undefined) continue;
    n.layout.cells[r]![c] = kind;
    if (kind !== 'seat') delete n.assign[p];
  }
  n.layout = fitBlocks(n.layout);
  return n;
}

/** A new row at the front (above row 0, the ark side) or the back. Every position below shifts; the holders shift with their cells. */
export function addRow(d: Draft, where: 'front' | 'back'): Edit {
  if (d.layout.rows >= MAX_ROWS) return { ok: false, error: 'rows-cap' };
  const n = clone(d);
  const fresh = (): Kind[] => Array.from({ length: n.layout.cols }, (_, c) => (n.layout.blocks.some((b) => c >= b.colStart && c <= b.colEnd) ? 'empty' : 'aisle'));
  if (where === 'front') {
    n.layout.cells.unshift(fresh()); n.layout.rowLabels.unshift(null);
    n.assign = Object.fromEntries(Object.entries(d.assign).map(([p, ref]) => { const { r, c } = parsePos(p); return [posKey(r + 1, c), ref]; }));
  } else { n.layout.cells.push(fresh()); n.layout.rowLabels.push(null); }
  n.layout.rows += 1;
  return { ok: true, draft: n };
}
export function removeRow(d: Draft, row: number): Edit {
  if (d.layout.rows <= 1) return { ok: false, error: 'last-row' };
  if (row < 0 || row >= d.layout.rows) return { ok: false, error: 'range' };
  const n = clone(d);
  n.layout.cells.splice(row, 1); n.layout.rowLabels.splice(row, 1); n.layout.rows -= 1;
  n.assign = Object.fromEntries(Object.entries(d.assign).filter(([p]) => parsePos(p).r !== row).map(([p, ref]) => { const { r, c } = parsePos(p); return [posKey(r > row ? r - 1 : r, c), ref]; }));
  return { ok: true, draft: n };
}
/** A new column at the left or right edge of the hall, inside the first / last block. */
export function addCol(d: Draft, where: 'left' | 'right'): Edit {
  if (d.layout.cols >= MAX_COLS) return { ok: false, error: 'cols-cap' };
  const n = clone(d);
  const L = n.layout;
  for (const r of L.cells) { if (where === 'left') r.unshift('empty'); else r.push('empty'); }
  L.cols += 1;
  if (where === 'left') {
    L.blocks.forEach((b) => { b.colStart += 1; b.colEnd += 1; });
    if (L.blocks.length) L.blocks[0]!.colStart = 0;
    n.assign = Object.fromEntries(Object.entries(d.assign).map(([p, ref]) => { const { r, c } = parsePos(p); return [posKey(r, c + 1), ref]; }));
  } else if (L.blocks.length) L.blocks[L.blocks.length - 1]!.colEnd = L.cols - 1;
  return { ok: true, draft: n };
}
export function removeCol(d: Draft, col: number): Edit {
  if (d.layout.cols <= 1) return { ok: false, error: 'last-col' };
  if (col < 0 || col >= d.layout.cols) return { ok: false, error: 'range' };
  const n = clone(d);
  const L = n.layout;
  for (const r of L.cells) r.splice(col, 1);
  L.cols -= 1;
  L.blocks = L.blocks.flatMap((b) => {
    const colStart = b.colStart > col ? b.colStart - 1 : b.colStart;
    const colEnd = b.colEnd >= col ? b.colEnd - 1 : b.colEnd;
    return colEnd < colStart ? [] : [{ ...b, colStart, colEnd }];
  });
  if (!L.blocks.length) L.blocks = [{ name: 'מרכז', colStart: 0, colEnd: L.cols - 1 }];
  n.assign = Object.fromEntries(Object.entries(d.assign).filter(([p]) => parsePos(p).c !== col).map(([p, ref]) => { const { r, c } = parsePos(p); return [posKey(r, c > col ? c - 1 : c), ref]; }));
  n.layout = fitBlocks(L);
  return { ok: true, draft: n };
}
export function renameBlock(d: Draft, index: number, name: string): Draft {
  const n = clone(d);
  if (n.layout.blocks[index]) n.layout.blocks[index]!.name = name;
  return n;
}
export function setRowLabel(d: Draft, row: number, label: string): Draft {
  const n = clone(d);
  if (row >= 0 && row < n.layout.rows) n.layout.rowLabels[row] = label.trim() === '' ? null : label;
  return n;
}
/** What stops a save (the server's rules): no seat, a bad block name, a long row label, too many blocks. */
export type DraftIssue = { code: 'no-seats' | 'block-name' | 'row-label' | 'too-many-blocks'; index?: number };
export function draftIssues(d: Draft): DraftIssue[] {
  const out: DraftIssue[] = [];
  if (seatCount(d) === 0) out.push({ code: 'no-seats' });
  d.layout.blocks.forEach((b, index) => { const len = [...b.name.trim()].length; if (len < 1 || len > BLOCK_NAME_MAX) out.push({ code: 'block-name', index }); });
  d.layout.rowLabels.forEach((l, index) => { if (l !== null && [...l].length > ROW_LABEL_MAX) out.push({ code: 'row-label', index }); });
  if (d.layout.blocks.length > MAX_BLOCKS) out.push({ code: 'too-many-blocks' });
  return out;
}

/** The save payload's layout (blocks trimmed, empty labels null). */
export function layoutBodyOf(d: Draft): LayoutBody {
  const L = fitBlocks(d.layout);
  return { rows: L.rows, cols: L.cols, cells: L.cells.map((r) => [...r]), blocks: L.blocks.map((b) => ({ ...b, name: b.name.trim() })), rowLabels: L.rowLabels.map((l) => (l && l.trim() ? l : null)) };
}
/** Every seat of the saved layout gets a value, so what the draft frees is freed. `created`: holder key to the id made at save. */
export function assignmentsOf(d: Draft, seats: { id: string; row: number; col: number }[], created: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const s of seats) {
    const ref = d.assign[posKey(s.row, s.col)] ?? null;
    out[s.id] = ref && ref.startsWith('new:') ? (created[ref.slice(4)] ? `holder:${created[ref.slice(4)]}` : null) : ref;
  }
  return out;
}

// ---- change set: the pure diff that the conflict dialog re-applies ----
export type ChangeSet = {
  dims: { rows: number; cols: number } | null;
  cells: Record<Pos, Kind | null>;
  blocks: LayoutBody['blocks'] | null;
  rowLabels: (string | null)[] | null;
  assign: Record<Pos, string | null>;
  holders: NewHolder[];
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What `mine` changed against `base`: cells (null = beyond the grid), holders of seats, sizes, block and row names. */
export function diffDrafts(base: Draft, mine: Draft): ChangeSet {
  const cells: ChangeSet['cells'] = {};
  const rows = Math.max(base.layout.rows, mine.layout.rows), cols = Math.max(base.layout.cols, mine.layout.cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const b = base.layout.cells[r]?.[c] ?? null, m = mine.layout.cells[r]?.[c] ?? null;
    if (b !== m) cells[posKey(r, c)] = m;
  }
  const assign: ChangeSet['assign'] = {};
  const seatRef = (d: Draft, p: Pos) => (isSeat(d, p) ? d.assign[p] ?? null : null);
  for (const p of new Set([...Object.keys(base.assign), ...Object.keys(mine.assign)])) {
    const b = seatRef(base, p), m = seatRef(mine, p);
    if (b !== m) assign[p] = m;
  }
  return {
    dims: base.layout.rows === mine.layout.rows && base.layout.cols === mine.layout.cols ? null : { rows: mine.layout.rows, cols: mine.layout.cols },
    cells, assign,
    blocks: same(base.layout.blocks, mine.layout.blocks) ? null : mine.layout.blocks.map((b) => ({ ...b })),
    rowLabels: same(base.layout.rowLabels, mine.layout.rowLabels) ? null : [...mine.layout.rowLabels],
    holders: mine.holders.map((h) => ({ ...h })),
  };
}
export const changedPositions = (cs: ChangeSet): Set<Pos> => new Set([...Object.keys(cs.cells), ...Object.keys(cs.assign)]);
export function changeCount(cs: ChangeSet): number {
  return Object.keys(cs.cells).length + Object.keys(cs.assign).filter((p) => !(p in cs.cells)).length + (cs.blocks ? 1 : 0) + (cs.rowLabels ? 1 : 0) + (cs.dims && !Object.keys(cs.cells).length ? 1 : 0);
}
/** For the one-line "3 שינויים: …" of the save dialog. */
export function summarize(cs: ChangeSet): { assigned: number; freed: number; cells: number; names: boolean; size: boolean } {
  const vals = Object.values(cs.assign);
  return { assigned: vals.filter((v) => v !== null).length, freed: vals.filter((v) => v === null).length, cells: Object.keys(cs.cells).length, names: !!cs.blocks || !!cs.rowLabels, size: !!cs.dims };
}

export type Overlap = { pos: Pos; what: 'cell' | 'seat'; base: string | null; theirs: string | null; mine: string | null };
/**
 * Re-apply `mine` (against `base`) on `theirs`, the newer saved version: every change that theirs did not also touch lands as an unsaved
 * change; a position both changed differently stays theirs unless `pick[pos+what]` is 'mine'. Overlaps are reported for the dialog's list.
 */
export function rebaseOnto(theirs: Draft, base: Draft, mine: Draft, pick: Record<string, 'mine' | 'theirs'> = {}): { draft: Draft; overlaps: Overlap[] } {
  const cs = diffDrafts(base, mine);
  const out = clone(theirs);
  out.holders = cs.holders.map((h) => ({ ...h }));
  const overlaps: Overlap[] = [];
  const L = out.layout;
  // size: grow to what either side needs; a shrink applies only when theirs kept the base size
  const baseDims = { rows: base.layout.rows, cols: base.layout.cols };
  const theirsSized = theirs.layout.rows !== baseDims.rows || theirs.layout.cols !== baseDims.cols;
  const rows = cs.dims ? (theirsSized ? Math.max(L.rows, cs.dims.rows) : cs.dims.rows) : L.rows;
  const cols = cs.dims ? (theirsSized ? Math.max(L.cols, cs.dims.cols) : cs.dims.cols) : L.cols;
  while (L.rows < rows) { L.cells.push(Array<Kind>(L.cols).fill('empty')); L.rowLabels.push(null); L.rows += 1; }
  while (L.rows > rows) { L.cells.pop(); L.rowLabels.pop(); L.rows -= 1; }
  for (const r of L.cells) { while (r.length < cols) r.push('empty'); r.length = cols; }
  L.cols = cols;
  if (cs.blocks && same(theirs.layout.blocks, base.layout.blocks)) L.blocks = cs.blocks.map((b) => ({ ...b, colEnd: Math.min(b.colEnd, cols - 1) })).filter((b) => b.colStart <= b.colEnd);
  if (cs.rowLabels && same(theirs.layout.rowLabels, base.layout.rowLabels)) cs.rowLabels.forEach((l, i) => { if (i < L.rows) L.rowLabels[i] = l; });
  for (const [p, m] of Object.entries(cs.cells)) {
    const { r, c } = parsePos(p);
    const t = theirs.layout.cells[r]?.[c] ?? null, b = base.layout.cells[r]?.[c] ?? null;
    const clash = t !== b && t !== m;
    if (clash) overlaps.push({ pos: p, what: 'cell', base: b, theirs: t, mine: m });
    if ((!clash || pick[`${p}|cell`] === 'mine') && m && L.cells[r]?.[c] !== undefined) L.cells[r]![c] = m;
  }
  for (const [p, m] of Object.entries(cs.assign)) {
    const t = isSeat(theirs, p) ? theirs.assign[p] ?? null : null, b = isSeat(base, p) ? base.assign[p] ?? null : null;
    const gone = !!m && !isSeat(out, p); // the place is no longer a seat after the merge: nothing to hold
    const clash = (t !== b && t !== m) || gone;
    if (clash) overlaps.push({ pos: p, what: 'seat', base: b, theirs: t, mine: m });
    if (!clash || (pick[`${p}|seat`] === 'mine' && !gone)) { if (m) out.assign[p] = m; else delete out.assign[p]; }
  }
  // a holder of a cell that is no longer a seat, or off the grid, is dropped
  for (const p of Object.keys(out.assign)) if (!isSeat(out, p)) delete out.assign[p];
  out.layout = fitBlocks(L);
  return { draft: out, overlaps };
}

// ---- undo / redo ----
export const HISTORY_LIMIT = 40;
export type EditState = { draft: Draft; past: Draft[]; future: Draft[] };
export type EditAction = { type: 'set'; draft: Draft } | { type: 'undo' } | { type: 'redo' } | { type: 'reset'; draft: Draft };
export const initialEdit = (draft: Draft): EditState => ({ draft, past: [], future: [] });
export function editReducer(s: EditState, a: EditAction): EditState {
  switch (a.type) {
    case 'reset': return initialEdit(a.draft);
    case 'set': return same(s.draft, a.draft) ? s : { draft: a.draft, past: [...s.past, s.draft].slice(-HISTORY_LIMIT), future: [] };
    case 'undo': { const prev = s.past[s.past.length - 1]; return prev ? { draft: prev, past: s.past.slice(0, -1), future: [s.draft, ...s.future] } : s; }
    case 'redo': { const next = s.future[0]; return next ? { draft: next, past: [...s.past, s.draft].slice(-HISTORY_LIMIT), future: s.future.slice(1) } : s; }
  }
}
