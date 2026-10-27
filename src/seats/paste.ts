/**
 * Parse what a browser gives on paste from Google Sheets / Excel into a hall grid (pure, no UI).
 * Spec "The real workbook" + UX-DESIGN §16.2. Cell grammar: `<family>[ <initial>.]-<n>` (also the bidi-flipped
 * `<n>-<family>` and `<family><n>-`), `פנוי`, `בימה`; blank = empty; anything else is `unknown` and listed.
 * Nothing here knows about Kehila families: matching is match.ts.
 */

export type SeatCell = {
  kind: 'seat';
  /** Household key = family + initial ("בדיוני" and "בדיוני ש" are two keys). Dashes unified, spaces collapsed. */
  familyKey: string;
  /** Shown form: "בדיוני" or "בדיוני ש." */
  displayName: string;
  family: string;
  /** One letter, without the dot. */
  initial?: string;
  /** The `-n` in the cell: only the family's order; never shown to members. */
  order: number;
  raw: string;
};
export type UnassignedCell = { kind: 'unassigned' };
export type BimahCell = { kind: 'bimah' };
export type EmptyCell = { kind: 'empty' };
export type UnknownCell = {
  kind: 'unknown';
  raw: string;
  reason: 'two-names' | 'unreadable';
  /** two-names: what each part parses to (seat / unassigned), or null when a part is unreadable. */
  parts?: (SeatCell | UnassignedCell | null)[];
};
export type HallCell = SeatCell | UnassignedCell | BimahCell | EmptyCell | UnknownCell;

export type Block = {
  /** 0-based, left to right as in the sheet. */
  index: number;
  colStart: number;
  /** Inclusive. */
  colEnd: number;
  seats: number;
};
export type BimahArea = {
  /** Top-left cell. */
  row: number;
  col: number;
  rows: number;
  cols: number;
  /** True when the paste carried the merge (HTML rowspan/colspan); false = a lone TSV cell the editor must size. */
  sized: boolean;
};
export type WarningCode =
  | 'ignored-cell' // unknown cell (title, total, unreadable text)
  | 'two-names' // two names in one cell: needs a decision
  | 'duplicate-order' // the same family key has the same -n twice
  | 'order-gap' // the family's orders are not 1..k
  | 'spans-blocks' // one family sits in several blocks (not an error)
  | 'bimah-unsized' // TSV: one "בימה" cell, the area is not known
  | 'bimah-multiple' // several separate bimah areas
  | 'label-ignored' // a non-numeric cell in the row-label column
  | 'no-seats';
export type ParseWarning = {
  code: WarningCode;
  /** Position in the returned grid; col -1 = the dropped row-label column. */
  row: number;
  col: number;
  /** The original text, when there is one. */
  raw?: string;
  familyKey?: string;
};
export type ParsedFamily = {
  familyKey: string;
  displayName: string;
  family: string;
  initial?: string;
  seats: { row: number; col: number; order: number }[];
  /** Indexes into `blocks` that hold its seats. */
  blocks: number[];
};
export type ParsedHall = {
  rows: number;
  cols: number;
  grid: HallCell[][];
  /** Maximal column runs separated by fully empty columns, left to right as in the sheet. */
  blocks: Block[];
  /** One per grid row: the sheet's label ("1".."13") or null (the unnumbered front row). */
  rowLabels: (string | null)[];
  /** Where a numeric label column was found and dropped from the grid. */
  labelColumn: 'left' | 'right' | null;
  bimahAreas: BimahArea[];
  /** In order of first appearance (row-major). Excludes unassigned seats. */
  families: ParsedFamily[];
  counts: { seats: number; assigned: number; unassigned: number; families: number; blocks: number; rows: number };
  warnings: ParseWarning[];
};

export type PasteInput = string | { text?: string; html?: string };

// ---------- cell grammar ----------

const DASHES = '\\-\\u05BE\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212\\uFE63\\uFF0D';
const DASH_RE = new RegExp(`[${DASHES}]`, 'g');
const SEP = `[${DASHES}]`;
const HIDDEN = /[‎‏‪-‮⁦-⁩﻿​]/g;

function clean(s: string): string {
  return s.replace(HIDDEN, '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitInitial(name: string): { family: string; initial?: string } {
  const text = clean(name).replace(/\s+\./g, '.');
  const tokens = text.split(' ');
  const last = tokens[tokens.length - 1] ?? '';
  const m = /^([א-ת])[.'׳’]?$/.exec(last);
  if (tokens.length >= 2 && m) return { family: tokens.slice(0, -1).join(' '), initial: m[1] };
  return { family: text };
}

function seatFrom(familyPart: string, order: number, raw: string): SeatCell | null {
  const { family: rawFamily, initial } = splitInitial(familyPart);
  const family = rawFamily.replace(DASH_RE, '-').replace(/\s*-\s*/g, '-').replace(/[.,;:]+$/, '').trim();
  if (!family || !/\p{L}/u.test(family)) return null;
  const familyKey = initial ? `${family} ${initial}` : family;
  return { kind: 'seat', familyKey, displayName: initial ? `${family} ${initial}.` : family, family, initial, order, raw };
}

function parseSingle(text: string): SeatCell | UnassignedCell | null {
  const t = clean(text);
  if (t === 'פנוי') return { kind: 'unassigned' };
  // greedy: names with their own maqaf ("בן-דוגמה-2") take the LAST dash as the separator
  let m = new RegExp(`^(.+)${SEP}\\s*(\\d{1,3})\\s*\\.?$`, 'u').exec(t);
  if (m) return seatFrom(m[1]!, Number(m[2]), t);
  m = new RegExp(`^(.+?)\\s*(\\d{1,3})\\s*${SEP}\\s*\\.?$`, 'u').exec(t); // family ש2-.  /  בדיוני1-
  if (m) return seatFrom(m[1]!, Number(m[2]), t);
  m = new RegExp(`^(\\d{1,3})\\s*${SEP}\\s*(.+)$`, 'u').exec(t); // bidi-flipped: 2-בדיוני ש.
  if (m) return seatFrom(m[2]!, Number(m[1]), t);
  return null;
}

export function classifyCell(text: string): HallCell {
  const t = clean(text);
  if (!t) return { kind: 'empty' };
  if (t === 'בימה') return { kind: 'bimah' };
  if (t === 'פנוי') return { kind: 'unassigned' };
  const lines = text.split(/\r?\n/);
  let pieces = lines.flatMap((l) => l.split(/[/\\;|+&]/)).map(clean).filter(Boolean);
  if (pieces.length === 1) pieces = t.split(/(?<=\d\.?)\s+(?=\p{L})/u); // "דוגמה-1 ניסיון-2" with no separator
  if (pieces.length > 1) {
    const parts = pieces.map(parseSingle);
    if (parts.some(Boolean)) return { kind: 'unknown', raw: t, reason: 'two-names', parts };
  }
  const one = parseSingle(t);
  if (one) return one;
  return { kind: 'unknown', raw: t, reason: 'unreadable' };
}

// ---------- clipboard -> string matrix ----------

type Merge = { row: number; col: number; rows: number; cols: number };
type Matrix = { cells: string[][]; merges: Merge[] };

export function parseTsv(text: string): Matrix {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return { cells: rows, merges: [] };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** The first <table> of a text/html clipboard flavour; keeps rowspan/colspan as merges. */
export function parseHtmlTable(html: string): Matrix | null {
  const table = /<table\b[\s\S]*?(<\/table>|$)/i.exec(html);
  if (!table) return null;
  const cells: string[][] = [];
  const merges: Merge[] = [];
  const taken = new Set<string>();
  let r = -1;
  const rowRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(table[0]))) {
    r++;
    cells[r] ??= [];
    let c = 0;
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]!))) {
      while (taken.has(`${r},${c}`)) c++;
      const span = (name: string) => Math.max(1, Math.min(200, Number(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(cm![1]!)?.[1] ?? 1)));
      const rows = span('rowspan');
      const cols = span('colspan');
      const body = cm[2]!.replace(/<\/t[dh]>[\s\S]*$/i, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
      const text = decode(body).replace(/[ \t\r\f]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
      cells[r]![c] = text;
      for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < cols; dc++) {
        if (dr || dc) taken.add(`${r + dr},${c + dc}`);
      }
      if (rows > 1 || cols > 1) merges.push({ row: r, col: c, rows, cols });
      c += cols;
    }
  }
  for (const m of merges) for (let dr = 0; dr < m.rows; dr++) cells[m.row + dr] ??= [];
  return cells.length ? { cells, merges } : null;
}

// ---------- the parser ----------

const isNumericLabel = (s: string) => /^\d{1,2}$/.test(clean(s));

export function parseHall(input: PasteInput): ParsedHall {
  const text = typeof input === 'string' ? input : input.text ?? '';
  const html = typeof input === 'string' ? '' : input.html ?? '';
  const fromHtml = html && /<table\b/i.test(html) ? parseHtmlTable(html) : null;
  const matrix = fromHtml ?? parseTsv(text);

  const width = Math.max(0, ...matrix.cells.map((r) => r.length));
  let raw: string[][] = matrix.cells.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ''));
  // merged areas: only the anchor holds text. Remember them by anchor position (moved with trimming below).
  let merges = matrix.merges.map((m) => ({ ...m }));

  const blank = (s: string) => clean(s) === '';
  const rowBlank = (r: string[]) => r.every(blank);
  const colBlank = (rows: string[][], c: number) => rows.every((r) => blank(r[c] ?? ''));
  // A merge covers cells that are blank in the matrix; they must not be trimmed away from the anchor's own area,
  // but trimming only removes edges that are fully blank, and the anchor itself is never blank, so that is safe.

  let labels: (string | null)[] = raw.map(() => null);
  let strays: (string | null)[] = raw.map(() => null); // non-numeric text found in the label column, per row
  let labelColumn: 'left' | 'right' | null = null;
  const warnings: ParseWarning[] = [];

  const trim = () => {
    let top = 0;
    while (top < raw.length && rowBlank(raw[top]!)) top++;
    let bottom = raw.length;
    while (bottom > top && rowBlank(raw[bottom - 1]!)) bottom--;
    raw = raw.slice(top, bottom);
    labels = labels.slice(top, bottom);
    strays = strays.slice(top, bottom);
    merges = merges.map((m) => ({ ...m, row: m.row - top }));
    const w = raw[0]?.length ?? 0;
    let left = 0;
    while (left < w && colBlank(raw, left)) left++;
    let right = w;
    while (right > left && colBlank(raw, right - 1)) right--;
    raw = raw.map((r) => r.slice(left, right));
    merges = merges.map((m) => ({ ...m, col: m.col - left }));
  };
  trim();

  // Row-label column at either edge: numbers only (lenient: >= 80% numeric, at least 3).
  const tryLabels = (side: 'left' | 'right'): boolean => {
    const w = raw[0]?.length ?? 0;
    if (w < 2) return false;
    const c = side === 'left' ? 0 : w - 1;
    const vals = raw.map((r) => clean(r[c] ?? ''));
    const filled = vals.filter(Boolean);
    const nums = filled.filter(isNumericLabel);
    if (nums.length < 3 || nums.length < filled.length * 0.8) return false;
    labels = vals.map((v) => (isNumericLabel(v) ? v : null));
    strays = vals.map((v) => (v && !isNumericLabel(v) ? v : null));
    raw = raw.map((r) => (side === 'left' ? r.slice(1) : r.slice(0, -1)));
    merges = merges.map((m) => ({ ...m, col: m.col - (side === 'left' ? 1 : 0) }));
    labelColumn = side;
    return true;
  };
  if (!tryLabels('left')) tryLabels('right');
  if (labelColumn) trim(); // labels stay aligned; label-only edge rows and now-blank edge columns go

  const rows = raw.length;
  const cols = raw[0]?.length ?? 0;
  const grid: HallCell[][] = raw.map((r) => r.map(classifyCell));

  // bimah areas: merges that anchor on a bimah cell, else connected bimah cells (bounding box)
  const bimahAreas: BimahArea[] = [];
  const covered = new Set<string>();
  for (const m of merges) {
    if (grid[m.row]?.[m.col]?.kind !== 'bimah') continue;
    bimahAreas.push({ row: m.row, col: m.col, rows: m.rows, cols: m.cols, sized: true });
    for (let dr = 0; dr < m.rows; dr++) for (let dc = 0; dc < m.cols; dc++) {
      if (grid[m.row + dr]?.[m.col + dc]) { grid[m.row + dr]![m.col + dc] = { kind: 'bimah' }; covered.add(`${m.row + dr},${m.col + dc}`); }
    }
  }
  const seen = new Set<string>(covered);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (grid[r]![c]!.kind !== 'bimah' || seen.has(`${r},${c}`)) continue;
    const stack: [number, number][] = [[r, c]];
    let r1 = r, c1 = c, r0 = r, c0 = c;
    seen.add(`${r},${c}`);
    while (stack.length) {
      const [y, x] = stack.pop()! as [number, number];
      r0 = Math.min(r0, y); c0 = Math.min(c0, x); r1 = Math.max(r1, y); c1 = Math.max(c1, x);
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const ny = y + dy!, nx = x + dx!;
        if (grid[ny]?.[nx]?.kind === 'bimah' && !seen.has(`${ny},${nx}`)) { seen.add(`${ny},${nx}`); stack.push([ny, nx]); }
      }
    }
    bimahAreas.push({ row: r0, col: c0, rows: r1 - r0 + 1, cols: c1 - c0 + 1, sized: r1 > r0 || c1 > c0 });
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) grid[y]![x] = { kind: 'bimah' };
  }
  bimahAreas.sort((a, b) => a.row - b.row || a.col - b.col);
  for (const a of bimahAreas) if (!a.sized) warnings.push({ code: 'bimah-unsized', row: a.row, col: a.col });
  if (bimahAreas.length > 1) warnings.push({ code: 'bimah-multiple', row: bimahAreas[1]!.row, col: bimahAreas[1]!.col });

  // blocks: maximal runs of columns that hold anything, separated by fully empty columns
  const blocks: Block[] = [];
  const colUsed = (c: number) => grid.some((r) => r[c]!.kind !== 'empty');
  for (let c = 0; c < cols; ) {
    if (!colUsed(c)) { c++; continue; }
    let e = c;
    while (e + 1 < cols && colUsed(e + 1)) e++;
    blocks.push({ index: blocks.length, colStart: c, colEnd: e, seats: 0 });
    c = e + 1;
  }
  const blockOf = (col: number) => blocks.findIndex((b) => col >= b.colStart && col <= b.colEnd);

  // seats, families, warnings
  const byKey = new Map<string, ParsedFamily>();
  let unassigned = 0;
  let seatCount = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = grid[r]![c]!;
    if (cell.kind === 'unassigned') { unassigned++; blocks[blockOf(c)]!.seats++; seatCount++; }
    else if (cell.kind === 'seat') {
      seatCount++;
      blocks[blockOf(c)]!.seats++;
      let f = byKey.get(cell.familyKey);
      if (!f) {
        f = { familyKey: cell.familyKey, displayName: cell.displayName, family: cell.family, initial: cell.initial, seats: [], blocks: [] };
        byKey.set(cell.familyKey, f);
      }
      f.seats.push({ row: r, col: c, order: cell.order });
      const b = blockOf(c);
      if (!f.blocks.includes(b)) f.blocks.push(b);
    } else if (cell.kind === 'unknown') {
      warnings.push({ code: cell.reason === 'two-names' ? 'two-names' : 'ignored-cell', row: r, col: c, raw: cell.raw });
    }
  }
  for (const f of byKey.values()) {
    const orders = new Set<number>();
    for (const s of f.seats) {
      if (orders.has(s.order)) warnings.push({ code: 'duplicate-order', row: s.row, col: s.col, familyKey: f.familyKey });
      orders.add(s.order);
    }
    const sorted = [...orders].sort((a, b) => a - b);
    if (sorted.some((n, i) => n !== i + 1)) warnings.push({ code: 'order-gap', row: f.seats[0]!.row, col: f.seats[0]!.col, familyKey: f.familyKey });
    if (f.blocks.length > 1) warnings.push({ code: 'spans-blocks', row: f.seats[0]!.row, col: f.seats[0]!.col, familyKey: f.familyKey });
  }
  strays.forEach((v, i) => { if (v) warnings.push({ code: 'label-ignored', row: i, col: -1, raw: v }); });
  if (seatCount === 0) warnings.push({ code: 'no-seats', row: 0, col: 0 });
  warnings.sort((a, b) => a.row - b.row || a.col - b.col);

  const families = [...byKey.values()];
  return {
    rows, cols, grid, blocks,
    rowLabels: labels.length === rows ? labels : Array.from({ length: rows }, () => null),
    labelColumn, bimahAreas, families,
    counts: { seats: seatCount, assigned: seatCount - unassigned, unassigned, families: families.length, blocks: blocks.length, rows },
    warnings,
  };
}
