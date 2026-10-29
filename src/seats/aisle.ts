// A TypeScript mirror of the server's aisle rule (server/cloud/seating_week.py: lanes, head_side, free_order). Only the
// preview fixture uses it; the real app gets `freeOrder`, `lanes` and `gapAbove` from the server.
import type { Side, WireLayout } from './wire.ts';

const blockIndexOf = (layout: WireLayout, col: number): number => layout.blocks.findIndex((b) => b.colStart <= col && col <= b.colEnd);

/** The sides of a block that are a lane: the column just outside is inside the hall and in no block. */
export function laneSides(layout: WireLayout, blockIndex: number): Side[] {
  const b = layout.blocks[blockIndex]!;
  const out: Side[] = [];
  for (const [side, col] of [['left', b.colStart - 1], ['right', b.colEnd + 1]] as const) {
    if (col >= 0 && col < layout.cols && blockIndexOf(layout, col) === -1) out.push(side);
  }
  return out;
}

/** "The aisle": the only lane, or the lane nearer the bimah's centre column. A tie, or no bimah, goes right. */
export function headSide(layout: WireLayout, blockIndex: number): Side | null {
  const ls = laneSides(layout, blockIndex);
  if (ls.length < 2) return ls[0] ?? null;
  const cols: number[] = [];
  layout.cells.forEach((row) => row.forEach((k, c) => { if (k === 'bimah') cols.push(c); }));
  if (!cols.length) return 'right';
  const centre = cols.reduce((a, c) => a + c, 0) / cols.length;
  const b = layout.blocks[blockIndex]!;
  return Math.abs(b.colStart - 1 - centre) < Math.abs(b.colEnd + 1 - centre) ? 'left' : 'right';
}

function aisleDistance(layout: WireLayout, blockIndex: number, seat: { row: number; col: number }): number {
  const side = headSide(layout, blockIndex);
  if (!side) return 0;
  const b = layout.blocks[blockIndex]!;
  const row = layout.cells[seat.row]!;
  let n = 0;
  const [from, to] = side === 'right' ? [seat.col + 1, b.colEnd] : [b.colStart, seat.col - 1];
  for (let c = from; c <= to; c++) if (row[c] === 'seat') n++;
  return n;
}

/** Seat ids (given in the family's order), first to free first: rear row, then the largest aisle distance, then the higher family order. */
export function freeOrderIds(layout: WireLayout, orderedIds: string[]): string[] {
  const pos = new Map(layout.seats.map((s) => [s.id, s]));
  return orderedIds
    .map((id, i) => {
      const seat = pos.get(id)!;
      const bi = blockIndexOf(layout, seat.col);
      return { id, row: seat.row, dist: bi >= 0 ? aisleDistance(layout, bi, seat) : 0, i };
    })
    .sort((a, b) => b.row - a.row || b.dist - a.dist || b.i - a.i)
    .map((x) => x.id);
}
