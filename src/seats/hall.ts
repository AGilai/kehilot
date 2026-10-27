/**
 * The first Kehila's hall, SHAPE ONLY (UX-DESIGN §15.1): 26 columns, rows 0-13, five blocks, a bimah in the middle
 * block, 205 seats. Taken from the layout object of the gabbai-folder mockup; no names live here.
 * Blocks are listed right to left, as they stand in the room. Rows are indexes (0-13); people see row + 1.
 */
export type BlockId = 'R' | 'CR' | 'C' | 'CL' | 'L';
export type Block = {
  id: BlockId;
  name: string;
  /** First hall column of the block (0 = leftmost of the 26). */
  x: number;
  cols: number;
  /** Row index to the block columns that hold a seat in that row. */
  rows: Record<number, number[]>;
  /** Rows the bimah fills across the whole block. */
  bimah?: number[];
};
export type Hall = { cols: number; rows: number; blocks: Block[] };
export type SeatRef = { block: BlockId; row: number; col: number };

/** PROVISIONAL (to confirm with the owner against the real hall): the ark is drawn above row 1. */
export const ARK_SIDE: 'row-1' | 'row-last' = 'row-1';
/** PROVISIONAL (same): seats are numbered from the right inside their row, as people sit. */
export const SEAT_NUMBERING: 'from-right' | 'from-left' = 'from-right';

const all = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
function rowsFrom(spec: [from: number, to: number, cols: number[]][]): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const [from, to, cols] of spec) for (let r = from; r <= to; r++) out[r] = cols;
  return out;
}

export const HALL: Hall = {
  cols: 26,
  rows: 14,
  blocks: [
    { id: 'R', name: 'ימין', x: 21, cols: 5, rows: rowsFrom([[0, 0, [0, 1, 2]], [1, 12, all(5)], [13, 13, [0, 1, 2, 3]]]) },
    { id: 'CR', name: 'מרכז ימין', x: 16, cols: 4, rows: rowsFrom([[4, 12, all(4)]]) },
    { id: 'C', name: 'מרכז', x: 11, cols: 4, rows: rowsFrom([[4, 4, all(4)], [10, 12, all(4)]]), bimah: [6, 7, 8] },
    { id: 'CL', name: 'מרכז שמאל', x: 6, cols: 4, rows: rowsFrom([[4, 12, all(4)]]) },
    { id: 'L', name: 'שמאל', x: 0, cols: 5, rows: rowsFrom([[0, 0, [1, 2]], [1, 9, all(5)], [10, 10, [1, 2, 3]]]) },
  ],
};

export const seatKey = (s: SeatRef): string => `${s.block}:${s.row}:${s.col}`;
export function parseSeatKey(key: string): SeatRef | null {
  const m = /^(R|CR|C|CL|L):(\d+):(\d+)$/.exec(key);
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

/** The seat's number inside its row (1-based), counted from the right unless SEAT_NUMBERING says otherwise. */
export function seatNumber(hall: Hall, s: SeatRef): number {
  const cols = blockOf(hall, s.block)?.rows[s.row] ?? [];
  return SEAT_NUMBERING === 'from-right' ? cols.filter(c => c > s.col).length + 1 : cols.filter(c => c < s.col).length + 1;
}

/** First and last row that hold a seat or the bimah in the block. */
export function blockExtent(b: Block): { from: number; to: number } {
  const rows = [...Object.keys(b.rows).map(Number), ...(b.bimah ?? [])];
  return { from: Math.min(...rows), to: Math.max(...rows) };
}
