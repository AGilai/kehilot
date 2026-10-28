/**
 * The first Kehila's men's hall, SHAPE ONLY (UX-DESIGN §15.1): 29 columns, rows 0-13, six blocks, a bimah in the middle
 * block, 225 seats. Derived from the real workbook's shape (spec "The real workbook"); no names live here.
 * Blocks are listed right to left, as they stand in the room. Row 0 is the unnumbered front row (nearest the ark);
 * rows 1-13 are numbered as they are.
 */
export type BlockId = 'R' | 'CR' | 'C' | 'CL' | 'L' | 'FL';
export type Block = {
  id: BlockId;
  /** Hebrew name (what the preview shows). The English one is in BLOCK_NAMES. */
  name: string;
  /** First hall column of the block (0 = leftmost of the 29). */
  x: number;
  cols: number;
  /** Row index to the block columns that hold a seat in that row. */
  rows: Record<number, number[]>;
  /** Rows that have bimah cells in the block. */
  bimah?: number[];
  /** The bimah's own cells: row to block columns, as the server's layout marks them (frames follow these, not whole rows). */
  bimahCells?: Record<number, number[]>;
};
export type Hall = { cols: number; rows: number; blocks: Block[] };
export type SeatRef = { block: BlockId; row: number; col: number };

/** Confirmed by the owner (2026-10-27): the ark is at the front, the top of the map, beside row 0. */
export const ARK_SIDE = 'front' as const;
/** The front row is row 0 and carries no number; rows 1-13 are numbered as they are. */
export const FRONT_ROW = 0;

/** The one table of block names, right to left. */
export const BLOCK_NAMES: { id: BlockId; he: string; en: string }[] = [
  { id: 'R', he: 'ימין', en: 'Right' },
  { id: 'CR', he: 'מרכז ימין', en: 'Center right' },
  { id: 'C', he: 'מרכז', en: 'Center' },
  { id: 'CL', he: 'מרכז שמאל', en: 'Center left' },
  { id: 'L', he: 'שמאל', en: 'Left' },
  { id: 'FL', he: 'צד שמאל', en: 'Far left' },
];

/** The workbook's shape, rows 0-13 top (ark side) to bottom, left to right as in the sheet: S seat, B bimah, . empty. */
export const HALL_GRID = `
....SS..................SSS..
SS.SSSSS................SSSSS
SS.SSSSS................SSSSS
SS.SSSSS................SSSSS
SS.SSSSS.SSSS.SSSS.SSSS.SSSSS
SS.SSSSS.SSSS......SSSS.SSSSS
SS.SSSSS.SSSS.BBBB.SSSS.SSSSS
SS.SSSSS.SSSS.BBBB.SSSS.SSSSS
SS.SSSSS.SSSS.BBBB.SSSS.SSSSS
SS.SSSSS.SSSS......SSSS.SSSSS
SS..SSS..SSSS.SSSS.SSSS.SSSSS
.........SSSS.SSSS.SSSS.SSSSS
.........SSSS.SSSS.SSSS.SSSSS
........................SSSS.
`;

/** Blocks are the maximal column groups (seat or bimah cells) separated by empty columns; named left to right from BLOCK_NAMES. */
export function parseHall(grid: string): Hall {
  const lines = grid.trim().split('\n').map(l => l.trim());
  const cols = Math.max(...lines.map(l => l.length));
  const used = Array.from({ length: cols }, (_, c) => lines.some(l => l[c] === 'S' || l[c] === 'B'));
  const spans: [number, number][] = [];
  for (let c = 0; c < cols; c++) if (used[c]) { if (c > 0 && used[c - 1]) spans[spans.length - 1]![1] = c; else spans.push([c, c]); }
  const leftToRight = [...BLOCK_NAMES].reverse();
  if (spans.length !== leftToRight.length) throw new Error(`hall grid has ${spans.length} blocks, expected ${leftToRight.length}`);
  const blocks = spans.map(([from, to], i): Block => {
    const rows: Record<number, number[]> = {};
    const bimah: number[] = [];
    const bimahCells: Record<number, number[]> = {};
    lines.forEach((l, r) => {
      const seats: number[] = [];
      const bs: number[] = [];
      for (let c = from; c <= to; c++) { if (l[c] === 'S') seats.push(c - from); else if (l[c] === 'B') bs.push(c - from); }
      if (seats.length) rows[r] = seats;
      if (bs.length) { bimah.push(r); bimahCells[r] = bs; }
    });
    const n = leftToRight[i]!;
    return { id: n.id, name: n.he, x: from, cols: to - from + 1, rows, ...(bimah.length ? { bimah, bimahCells } : {}) };
  });
  return { cols, rows: lines.length, blocks: blocks.reverse() };
}

export const HALL: Hall = parseHall(HALL_GRID);

export const seatKey = (s: SeatRef): string => `${s.block}:${s.row}:${s.col}`;
export function parseSeatKey(key: string): SeatRef | null {
  const m = /^(R|CR|C|CL|L|FL):(\d+):(\d+)$/.exec(key);
  return m ? { block: m[1] as BlockId, row: Number(m[2]), col: Number(m[3]) } : null;
}

export const blockOf = (hall: Hall, id: BlockId): Block | undefined => hall.blocks.find(b => b.id === id);
export function hasSeat(hall: Hall, s: SeatRef): boolean {
  return !!blockOf(hall, s.block)?.rows[s.row]?.includes(s.col);
}

/** Every seat, blocks right to left, rows top to bottom, columns left to right. */
export function allSeats(hall: Hall): SeatRef[] {
  return hall.blocks.flatMap(b => Object.keys(b.rows).map(Number).sort((a, c) => a - c).flatMap(row => b.rows[row]!.map(col => ({ block: b.id, row, col }))));
}

/** First and last row that hold a seat or the bimah in the block. */
export function blockExtent(b: Block): { from: number; to: number } {
  const rows = [...Object.keys(b.rows).map(Number), ...(b.bimah ?? [])];
  return { from: Math.min(...rows), to: Math.max(...rows) };
}
