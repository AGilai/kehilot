// A TypeScript mirror of the server's free-order rule (server/cloud/seating_week.py: lanes, keep_key, keep_chain,
// free_order; §15.10.11, owner 2026-10-29). Only the preview fixtures use it; the real app gets `freeOrder`, `lanes` and
// `gapAbove` from the server.
import type { Side, WireLayout } from './wire.ts';

type Pos = { id: string; row: number; col: number };

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

function bimahCentre(layout: WireLayout): number | null {
  const cols: number[] = [];
  layout.cells.forEach((row) => row.forEach((k, c) => { if (k === 'bimah') cols.push(c); }));
  return cols.length ? cols.reduce((a, c) => a + c, 0) / cols.length : null;
}

/** The row of the Aron (ark cells; row 0, the front row, when there are none). */
function frontRow(layout: WireLayout): number {
  const r = layout.cells.findIndex((row) => row.includes('ark'));
  return r < 0 ? 0 : r;
}

/** Sides that count as an aisle for the free order: a lane, or the hall's side wall ("wall is an aisle"). */
function aisleSides(layout: WireLayout, blockIndex: number): Side[] {
  const b = layout.blocks[blockIndex]!;
  const out: Side[] = [];
  for (const [side, col] of [['left', b.colStart - 1], ['right', b.colEnd + 1]] as const) {
    if (col < 0 || col >= layout.cols || blockIndexOf(layout, col) === -1) out.push(side);
  }
  return out;
}

/** Seats (anyone's) between the seat and the nearer aisle of its block, in its row; null without an aisle. */
function aisleGap(layout: WireLayout, blockIndex: number, seat: Pos): number | null {
  const b = layout.blocks[blockIndex]!;
  const row = layout.cells[seat.row]!;
  const gaps = aisleSides(layout, blockIndex).map((side) => {
    const [from, to] = side === 'left' ? [b.colStart, seat.col - 1] : [seat.col + 1, b.colEnd];
    let n = 0;
    for (let c = from; c <= to; c++) if (row[c] === 'seat') n++;
    return n;
  });
  return gaps.length ? Math.min(...gaps) : null;
}

/** How good a seat is, best first (smaller is better); a total order: row nearer the Aron, next to an aisle, nearer the
 * bimah (columns), fewer seats to an aisle, the right seat. Index 1 is the row. */
export function keepKey(layout: WireLayout, seat: Pos, centre = bimahCentre(layout), front = frontRow(layout)): number[] {
  const bi = blockIndexOf(layout, seat.col);
  const gap = bi >= 0 ? aisleGap(layout, bi, seat) : null;
  return [Math.abs(seat.row - front), seat.row, gap === 0 ? 0 : 1, centre === null ? 0 : Math.abs(seat.col - centre), gap ?? 2 ** 30, -seat.col];
}

const cmp = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

/** Neighbours in a row (a gap or a bimah cell breaks it), or directly in front of / behind one another. */
export function touches(a: Pos, b: Pos): boolean {
  return (a.row === b.row && Math.abs(a.col - b.col) === 1) || (a.col === b.col && Math.abs(a.row - b.row) === 1);
}

/** A small binary min-heap on key tuples. */
function heapPush(h: Array<[number[], string]>, item: [number[], string]): void {
  h.push(item);
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (cmp(h[p]![0], h[i]![0]) <= 0) break;
    [h[p], h[i]] = [h[i]!, h[p]!];
    i = p;
  }
}
function heapPop(h: Array<[number[], string]>): string {
  const top = h[0]!, last = h.pop()!;
  if (h.length) {
    h[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && cmp(h[l]![0], h[m]![0]) < 0) m = l;
      if (r < h.length && cmp(h[r]![0], h[m]![0]) < 0) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i]!, h[m]!];
      i = m;
    }
  }
  return top[1];
}

/** The family's seat ids in keep order: the head's seat, then each next seat the best that touches the chain, else the best
 * left. O(n log n): a heap holds the seats that touch the chain. */
export function keepChain(layout: WireLayout, orderedIds: string[]): string[] {
  const pos = new Map(layout.seats.map((s) => [s.id, s as Pos]));
  const centre = bimahCentre(layout), front = frontRow(layout);
  const key = new Map(orderedIds.map((id) => [id, keepKey(layout, pos.get(id)!, centre, front)]));
  const at = new Map(orderedIds.map((id) => [`${pos.get(id)!.row},${pos.get(id)!.col}`, id]));
  const rest = [...orderedIds].sort((a, b) => cmp(key.get(a)!, key.get(b)!));
  const chain: string[] = [];
  const queued = new Set<string>();
  const frontier: Array<[number[], string]> = [];
  const add = (id: string) => {
    chain.push(id);
    queued.add(id);
    const s = pos.get(id)!;
    for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const other = at.get(`${s.row + dr},${s.col + dc}`);
      if (other !== undefined && !queued.has(other)) { queued.add(other); heapPush(frontier, [key.get(other)!, other]); }
    }
  };
  if (orderedIds.length) {
    // the head: the best seat by rank within the main row (the row with most of the family's seats; a tie: nearer the Aron)
    const perRow = new Map<number, string[]>();
    for (const id of rest) { const r = key.get(id)![1]!; perRow.set(r, [...(perRow.get(r) ?? []), id]); }
    const rows = [...perRow.entries()].sort(([ra, a], [rb, b]) => b.length - a.length || key.get(a[0]!)![0]! - key.get(b[0]!)![0]! || ra - rb);
    add(rows[0]![1][0]!); // each row's ids are already in rank order
  }
  let next = 0;
  while (chain.length < orderedIds.length) {
    if (frontier.length) { add(heapPop(frontier)); continue; }
    while (queued.has(rest[next]!)) next++;
    add(rest[next]!);
  }
  return chain;
}

/** Seat ids, first to free first: the keep chain backwards. */
export function freeOrderIds(layout: WireLayout, orderedIds: string[]): string[] {
  return keepChain(layout, orderedIds).reverse();
}
