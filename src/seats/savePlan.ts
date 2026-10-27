/**
 * From a ParsedHall plus the gabbai's choices to the three writes of "שמירת המפה" (pure; spec rulings 1-3, UX §16.3/16.5):
 * holders to create, the layout body, and the assignments (needs the seat ids the server makes when it saves the layout).
 */
import { normalizePhone } from '../client/phone.ts';
import type { AdminFamily } from '../client/types.ts';
import { cellKey, effectiveFamilies, isDecisionValid, resolveTwoNames, twoNameCells } from './decisions.ts';
import type { CellChoice, MatchState } from './decisions.ts';
import type { KehilaFamily } from './match.ts';
import type { HallCell, ParsedHall } from './paste.ts';

export const MAX_BLOCKS = 12;
export const BLOCK_NAME_MAX = 24;
const MAX_LAYOUT_ROWS = 40;
const FRONT_LABEL = 'קדמית';

// Ruling 1, right to left as seen facing the ark. Fewer blocks get the matching natural subset.
const RTL_NAMES: Record<number, string[]> = {
  1: ['מרכז'],
  2: ['ימין', 'שמאל'],
  3: ['ימין', 'מרכז', 'שמאל'],
  4: ['ימין', 'מרכז ימין', 'מרכז שמאל', 'שמאל'],
  5: ['ימין', 'מרכז ימין', 'מרכז', 'מרכז שמאל', 'שמאל'],
  6: ['ימין', 'מרכז ימין', 'מרכז', 'מרכז שמאל', 'שמאל', 'צד שמאל'],
};
/** One name per block in sheet order (left to right), so index i is the i-th detected block. */
export function defaultBlockNames(n: number): string[] {
  const rtl = RTL_NAMES[n] ?? [...RTL_NAMES[6]!, ...Array.from({ length: Math.max(0, n - 6) }, (_, i) => `גוש ${7 + i}`)];
  return rtl.slice(0, n).reverse();
}

export type BlockIssue = { index: number; code: 'empty' | 'long' | 'too-many' };
export function blockIssues(names: string[]): BlockIssue[] {
  const out: BlockIssue[] = [];
  names.forEach((n, index) => {
    const t = n.trim();
    if (!t) out.push({ index, code: 'empty' });
    else if ([...t].length > BLOCK_NAME_MAX) out.push({ index, code: 'long' });
  });
  if (names.length > MAX_BLOCKS) out.push({ index: -1, code: 'too-many' });
  return out;
}

/** The sheet's own labels (ruling 2); the unnumbered front row of a labelled sheet is "קדמית". Labels are at most 8 characters. */
export function rowLabelList(parsed: ParsedHall): (string | null)[] {
  const labels: (string | null)[] = parsed.rowLabels.map((l) => (l && l.length <= 8 ? l : null));
  const front = parsed.grid.findIndex((r) => r.some((c) => c.kind === 'seat' || c.kind === 'unassigned' || c.kind === 'unknown'));
  if (parsed.labelColumn && labels.some(Boolean) && front >= 0 && labels[front] === null && !labels.slice(0, front).some(Boolean)) labels[front] = FRONT_LABEL;
  return labels;
}
/** "קדמית", "3" or, for an unlabelled row, its place in the sheet. */
export const rowText = (parsed: ParsedHall, row: number): string => rowLabelList(parsed)[row] ?? String(row + 1);

export type LayoutBody = {
  rows: number;
  cols: number;
  cells: ('seat' | 'aisle' | 'bimah' | 'ark' | 'empty')[][];
  blocks: { name: string; colStart: number; colEnd: number }[];
  rowLabels: (string | null)[];
};
export type BuiltLayout = { layout: LayoutBody; /** Rows added above the sheet's first row (the ark row). */ rowOffset: number };

/** null while a two-names cell is undecided. The ark is not in a sheet: one centred row on top (ruling 3). */
export function buildLayout(parsed: ParsedHall, blockNames: string[], cells: Record<string, CellChoice>): BuiltLayout | null {
  if (!parsed.rows || !parsed.cols) return null;
  const twos = new Map(twoNameCells(parsed).map((c) => [cellKey(c.row, c.col), c]));
  const inBlock = (col: number) => parsed.blocks.some((b) => col >= b.colStart && col <= b.colEnd);
  const body: LayoutBody['cells'] = [];
  for (let r = 0; r < parsed.rows; r++) {
    const row: LayoutBody['cells'][number] = [];
    for (let c = 0; c < parsed.cols; c++) {
      const cell: HallCell = parsed.grid[r]![c]!;
      let kind: LayoutBody['cells'][number][number];
      if (cell.kind === 'seat' || cell.kind === 'unassigned') kind = 'seat';
      else if (cell.kind === 'bimah') kind = 'bimah';
      else if (cell.kind === 'unknown' && cell.reason === 'two-names') {
        if (!resolveTwoNames(twos.get(cellKey(r, c))!, cells[cellKey(r, c)])) return null;
        kind = 'seat';
      } else kind = inBlock(c) ? 'empty' : 'aisle';
      row.push(kind);
    }
    body.push(row);
  }
  const labels = rowLabelList(parsed);
  let rowOffset = 0;
  if (parsed.rows + 1 <= MAX_LAYOUT_ROWS) {
    const w = Math.min(parsed.cols, Math.max(1, Math.round(parsed.cols / 6)));
    const start = Math.floor((parsed.cols - w) / 2);
    body.unshift(Array.from({ length: parsed.cols }, (_, c) => (c >= start && c < start + w ? 'ark' : 'aisle')));
    labels.unshift(null);
    rowOffset = 1;
  }
  return {
    rowOffset,
    layout: {
      rows: body.length, cols: parsed.cols, cells: body, rowLabels: labels,
      blocks: parsed.blocks.map((b, i) => ({ name: (blockNames[i] ?? '').trim(), colStart: b.colStart, colEnd: b.colEnd })),
    },
  };
}

/** KehilaFamily rows for the matcher from the gabbai families list (the head's and the spouse's first names). */
export function familiesForMatch(admin: AdminFamily[], holding: Set<string> = new Set()): KehilaFamily[] {
  return admin.map((f) => {
    const first = (a?: { displayName: string }) => {
      const n = (a?.displayName ?? '').trim();
      if (!n) return undefined;
      return n.endsWith(` ${f.name}`) ? n.slice(0, -f.name.length - 1).trim() || undefined : n.split(' ')[0];
    };
    return { id: f.familyId, lastName: f.name, firstName: first(f.adults[0]), spouseFirstName: first(f.adults[1]), holdsSeats: holding.has(f.familyId) };
  });
}

export type NewHolder = { key: string; name: string; phone?: string };
export function holdersToCreate(parsed: ParsedHall, state: MatchState): NewHolder[] {
  const out: NewHolder[] = [];
  for (const f of effectiveFamilies(parsed, state.cells)) {
    const d = state.decisions[f.familyKey];
    if (d?.kind !== 'new' || !isDecisionValid(d)) continue;
    const phone = d.phone.trim() ? normalizePhone(d.phone.trim()) : null;
    out.push({ key: f.familyKey, name: d.name.trim(), ...(phone ? { phone } : {}) });
  }
  return out;
}

/** familyKey -> "family:<id>" | "holder:<id>" | null (free). `created` = holder ids made for the 'new' decisions. */
export function refsFor(state: MatchState, created: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, d] of Object.entries(state.decisions)) {
    out[key] = d.kind === 'family' ? `family:${d.id}` : d.kind === 'holder' ? `holder:${d.id}` : d.kind === 'new' && created[key] ? `holder:${created[key]}` : null;
  }
  return out;
}

/** Every seat of the saved layout gets a value (ref or null), so the paste replaces what was assigned before. */
export function assignmentsFor(
  parsed: ParsedHall, cells: Record<string, CellChoice>, rowOffset: number,
  seats: { id: string; row: number; col: number }[], refs: Record<string, string | null>,
): Record<string, string | null> {
  const twos = new Map(twoNameCells(parsed).map((c) => [cellKey(c.row, c.col), c]));
  const out: Record<string, string | null> = {};
  for (const s of seats) {
    const r = s.row - rowOffset;
    const cell = parsed.grid[r]?.[s.col];
    let key: string | null = null;
    if (cell?.kind === 'seat') key = cell.familyKey;
    else if (cell?.kind === 'unknown' && cell.reason === 'two-names') {
      const part = resolveTwoNames(twos.get(cellKey(r, s.col))!, cells[cellKey(r, s.col)]);
      if (part?.kind === 'seat') key = part.familyKey;
    }
    out[s.id] = key ? refs[key] ?? null : null;
  }
  return out;
}
