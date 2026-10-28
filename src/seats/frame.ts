import { FRONT_ROW, blockExtent, hasSeat, seatKey } from './hall.ts';
import type { Block, BlockId, Hall, SeatRef } from './hall.ts';

/** The member's cut of the hall: his block, his rows, two more each way (UX-DESIGN §15.3). */
export const REACH = 2;
/** Seats in one block at most this many rows apart share one frame; farther apart get one each. */
export const SPLIT_GAP = 4;

/** `other` and `gap` carry nothing: no key, no number, no name. Only `mine` identifies a seat. */
export type FrameCell =
  | { kind: 'gap' }
  | { kind: 'other' }
  | { kind: 'bimah' }
  | { kind: 'mine'; key: string; /** The family's own order, 1..n (block right to left, row front to back, right to left in the row). Not a seat number. */ k: number; n: number };
export type FrameRow = { row: number; /** What people see: the row number, null for the unnumbered front row. */ label: number | null; mine: boolean; bimah: boolean; cells: FrameCell[] };
export type Frame = { blockId: BlockId; blockName: string; cols: number; rowFrom: number; rowTo: number; rows: FrameRow[] };

/** A gabbai-side record: who holds which seats. Never sent to a member except through memberView. */
export type Allocation = { householdId: string; name: string; seats: SeatRef[] };

/** The family's order: blocks right to left (hall order), rows front to back, columns right to left. */
function familyOrder(hall: Hall, seats: SeatRef[]): Map<string, number> {
  const idx = (s: SeatRef) => hall.blocks.findIndex(b => b.id === s.block);
  const sorted = [...seats].sort((a, b) => idx(a) - idx(b) || a.row - b.row || b.col - a.col);
  return new Map(sorted.map((s, i) => [seatKey(s), i + 1]));
}

function buildFrame(block: Block, rowFrom: number, rowTo: number, mine: SeatRef[], order: Map<string, number>): Frame {
  const mineKeys = new Map(mine.map(s => [seatKey(s), s]));
  const rows: FrameRow[] = [];
  for (let row = rowFrom; row <= rowTo; row++) {
    const seatCols = block.rows[row] ?? [];
    const bimahCols = block.bimahCells?.[row] ?? [];
    const bimah = bimahCols.length > 0;
    const cells: FrameCell[] = Array.from({ length: block.cols }, (_, col): FrameCell => {
      if (bimahCols.includes(col)) return { kind: 'bimah' };
      if (!seatCols.includes(col)) return { kind: 'gap' };
      const ref = { block: block.id, row, col };
      const key = seatKey(ref);
      return mineKeys.has(key) ? { kind: 'mine', key, k: order.get(key)!, n: order.size } : { kind: 'other' };
    });
    rows.push({ row, label: row === FRONT_ROW ? null : row, mine: cells.some(c => c.kind === 'mine'), bimah, cells });
  }
  return { blockId: block.id, blockName: block.name, cols: block.cols, rowFrom, rowTo, rows };
}

/**
 * The frames for a person's seats: one per block, rows r-2..r+2 around his rows, clipped to the block's own extent
 * (so never outside the hall). Seats in the same block within SPLIT_GAP rows share a frame; farther apart, or in another
 * block, get their own. Blocks right to left, then top to bottom. Seats that are not in the hall are ignored.
 */
export function blockFrames(hall: Hall, mySeats: SeatRef[]): Frame[] {
  const frames: Frame[] = [];
  const order = familyOrder(hall, mySeats.filter(s => hasSeat(hall, s)));
  for (const block of hall.blocks) {
    const seats = mySeats.filter(s => s.block === block.id && hasSeat(hall, s)).sort((a, b) => a.row - b.row);
    if (!seats.length) continue;
    const { from, to } = blockExtent(block);
    const groups: SeatRef[][] = [];
    for (const s of seats) {
      const last = groups[groups.length - 1];
      if (last && s.row - last[last.length - 1]!.row <= SPLIT_GAP) last.push(s);
      else groups.push([s]);
    }
    for (const g of groups) {
      const lo = Math.max(from, g[0]!.row - REACH);
      const hi = Math.min(to, g[g.length - 1]!.row + REACH);
      frames.push(buildFrame(block, lo, hi, g, order));
    }
  }
  return frames;
}

export type MemberSeats = { seatCount: number; frames: Frame[] };

/**
 * What the member's page receives: only his frames and his seat count. This is the boundary the server will keep:
 * it takes the gabbai-side hall and every allocation, and returns nothing about anyone else.
 */
export function memberView(hall: Hall, allocations: Allocation[], householdId: string): MemberSeats {
  const mine = allocations.filter(a => a.householdId === householdId).flatMap(a => a.seats).filter(s => hasSeat(hall, s));
  return { seatCount: mine.length, frames: blockFrames(hall, mine) };
}

/** First and last row as people name them; null is the front row. */
export function frameTitleRows(f: Frame): { from: number | null; to: number | null } {
  return { from: f.rowFrom === FRONT_ROW ? null : f.rowFrom, to: f.rowTo === FRONT_ROW ? null : f.rowTo };
}
