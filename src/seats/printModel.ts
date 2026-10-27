import { allSeats, seatKey } from './hall.ts';
import type { BlockId, Hall } from './hall.ts';
import type { Allocation } from './frame.ts';

/** taken: allocated and coming; released: allocated, freed for this prayer; free: not allocated to anyone. */
export type PrintState = 'taken' | 'released' | 'free';
export type PrintSeat = { key: string; block: BlockId; row: number; /** Hall column 0-28. */ x: number; state: PrintState; /** Only when the gabbai chose to print names. */ name?: string };
export type Counts = { taken: number; released: number; free: number };
export type PrintModel = { seats: PrintSeat[]; total: Counts; blocks: ({ id: BlockId; name: string } & Counts)[] };

/** The gabbai's whole-hall view of one prayer. `released` is the set of seat keys freed for it. Names are off unless asked for. */
export function printModel(hall: Hall, allocations: Allocation[], released: ReadonlySet<string>, opts: { names?: boolean } = {}): PrintModel {
  const owner = new Map<string, Allocation>();
  for (const a of allocations) for (const s of a.seats) owner.set(seatKey(s), a);
  const empty = (): Counts => ({ taken: 0, released: 0, free: 0 });
  const total = empty();
  const byBlock = new Map<BlockId, Counts>(hall.blocks.map(b => [b.id, empty()]));
  const seats = allSeats(hall).map((s): PrintSeat => {
    const key = seatKey(s);
    const who = owner.get(key);
    const state: PrintState = !who ? 'free' : released.has(key) ? 'released' : 'taken';
    total[state]++; byBlock.get(s.block)![state]++;
    const block = hall.blocks.find(b => b.id === s.block)!;
    return { key, block: s.block, row: s.row, x: block.x + s.col, state, ...(opts.names && who ? { name: who.name } : {}) };
  });
  return { seats, total, blocks: hall.blocks.map(b => ({ id: b.id, name: b.name, ...byBlock.get(b.id)! })) };
}
