import { HALL, allSeats, seatKey } from './hall.ts';
import type { Hall, SeatRef } from './hall.ts';
import { memberView } from './frame.ts';
import type { Allocation, MemberSeats } from './frame.ts';
import type { Prayer } from './release.ts';
import { ApiCodeError } from '../client/errors.ts';
import { parseSeatKey } from './hall.ts';
import { israelInstant } from './window.ts';
import type { MemberWire, OnBehalfBody, WeekWire, WireFrame, WireLayout, WirePrayer } from './wire.ts';

// --- Seat-release preview (UX-DESIGN §15; the seats are the gabbai-side data, the member only ever gets memberView's cut) ---
// All names are invented.
export type SeatVariant = 'default' | 'split' | 'none' | 'closed' | 'gabbai';
const SURNAMES = ['בדיוני', 'דוגמה', 'ניסוי', 'אלמוני', 'פלוני', 'מדומה', 'קהילתי', 'ניסיון', 'דגמי', 'שמי', 'תבנית', 'דמיוני', 'אקראי', 'מקרי', 'פיקטיבי'];
const MINE: Record<'default' | 'split', SeatRef[]> = {
  default: [{ block: 'CR', row: 6, col: 1 }, { block: 'CR', row: 6, col: 2 }, { block: 'CR', row: 6, col: 3 }],
  split: [{ block: 'FL', row: 2, col: 1 }, { block: 'CR', row: 6, col: 2 }, { block: 'CR', row: 6, col: 3 }],
};

/** The whole hall for the gabbai: fixed pseudo-random households over the 225 seats (about one in eight stays unallocated) and what each prayer released. */
export function fixtureSeatHall(hall: Hall = HALL): { hall: Hall; allocations: Allocation[]; released: Record<Prayer, Set<string>> } {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const taken = new Set([...MINE.default, ...MINE.split].map(seatKey));
  const allocations: Allocation[] = [{ householdId: 'me', name: 'דוגמה', seats: MINE.default }];
  let current: Allocation | null = null;
  let left = 0;
  let n = 0;
  for (const seat of allSeats(hall)) {
    const key = seatKey(seat);
    if (taken.has(key)) { current = null; continue; }
    if (rnd() < 0.13) { current = null; continue; }
    if (!current || left === 0) {
      n++;
      current = { householdId: `h${n}`, name: SURNAMES[n % SURNAMES.length]!, seats: [] };
      left = 1 + Math.floor(rnd() * 3);
      allocations.push(current);
    }
    current.seats.push(seat); left--;
  }
  const released: Record<Prayer, Set<string>> = { arvit: new Set(), shacharit: new Set() };
  for (const a of allocations.slice(1)) for (const s of a.seats) {
    if (rnd() < 0.15) released.arvit.add(seatKey(s));
    if (rnd() < 0.25) released.shacharit.add(seatKey(s));
  }
  return { hall, allocations, released };
}

export type FixtureMemberSeats = MemberSeats & { closed: boolean; source: 'member' | 'gabbai' | 'tech'; answers: Record<Prayer, string[]> };
/** What the member page receives in the preview: his frames cut from the gabbai-side hall, and his current answers. */
export function fixtureMemberSeats(variant: SeatVariant = 'default'): FixtureMemberSeats {
  const h = fixtureSeatHall();
  const me = h.allocations[0]!;
  const seats = variant === 'split' ? MINE.split : variant === 'none' ? [] : MINE.default;
  const allocations = [{ ...me, seats }, ...h.allocations.slice(1)];
  const cut = memberView(h.hall, allocations, 'me');
  const mineKeys = seats.map(seatKey);
  const answers: Record<Prayer, string[]> = variant === 'gabbai' ? { arvit: [mineKeys[2]!], shacharit: [] } : { arvit: [], shacharit: [] };
  return { ...cut, closed: variant === 'closed', source: variant === 'gabbai' ? 'gabbai' : 'member', answers };
}

export function seatVariantOf(screen: string | null): SeatVariant {
  return screen === 'seats-split' ? 'split' : screen === 'seats-none' ? 'none' : screen === 'seats-closed' ? 'closed' : screen === 'seats-gabbai' ? 'gabbai' : 'default';
}

// --- The same preview data in the server's wire shapes (fixtures API: `seats/me`, `admin/seats/week`), kept in memory so a save shows up on the next read ---

export const fixtureSeatId = (s: SeatRef): string => `s-${s.block}-${s.row}-${s.col}`;
const rowLabel = (row: number): string => (row === 0 ? 'ק' : String(row));

/** The hall as the server's layout: cells per kind (bimah only where the bimah is), blocks by column span, row labels, seats with ids. */
export function hallLayout(hall: Hall = HALL, effectiveFrom = '2026-09-04'): WireLayout {
  const cells: WireLayout['cells'] = Array.from({ length: hall.rows }, () => Array.from({ length: hall.cols }, () => 'empty' as const));
  const seats: WireLayout['seats'] = [];
  for (const b of hall.blocks) {
    for (const [r, cols] of Object.entries(b.rows)) for (const c of cols) { cells[Number(r)]![b.x + c] = 'seat'; seats.push({ id: fixtureSeatId({ block: b.id, row: Number(r), col: c }), row: Number(r), col: b.x + c }); }
    for (const [r, cols] of Object.entries(b.bimahCells ?? {})) for (const c of cols) cells[Number(r)]![b.x + c] = 'bimah';
  }
  seats.sort((a, b) => a.row - b.row || a.col - b.col);
  const blocks = [...hall.blocks].sort((a, b) => a.x - b.x).map((b) => ({ name: b.name, colStart: b.x, colEnd: b.x + b.cols - 1 }));
  return { effectiveFrom, rows: hall.rows, cols: hall.cols, cells, blocks, rowLabels: Array.from({ length: hall.rows }, (_, r) => rowLabel(r)), seats };
}

type Rec = { by: 'member' | 'gabbai' | 'tech'; at: number };

export function createSeatsFixture(variant: SeatVariant, card: string | null, friday: string) {
  const h = fixtureSeatHall();
  const mine = variant === 'split' ? MINE.split : variant === 'none' ? [] : MINE.default;
  const allocations: Allocation[] = [{ ...h.allocations[0]!, seats: mine }, ...h.allocations.slice(1)];
  const assignments: Record<string, string> = {};
  const households: Record<string, string> = {};
  for (const a of allocations) { households[`family:${a.householdId}`] = a.householdId === 'me' ? 'משפחת דוגמה' : `משפחת ${a.name}`; for (const s of a.seats) assignments[fixtureSeatId(s)] = `family:${a.householdId}`; }
  const state: Record<WirePrayer, Map<string, Rec>> = { erev: new Map(), day: new Map() };
  const updatedAt: Record<WirePrayer, number> = { erev: 1_790_000_000_000, day: 1_790_000_000_000 };
  for (const a of allocations.slice(1)) for (const s of a.seats) {
    if (h.released.arvit.has(seatKey(s))) state.erev.set(fixtureSeatId(s), { by: 'member', at: 1_790_000_000_000 });
    if (h.released.shacharit.has(seatKey(s))) state.day.set(fixtureSeatId(s), { by: 'member', at: 1_790_000_000_000 });
  }
  if (variant === 'gabbai' && mine[2]) state.erev.set(fixtureSeatId(mine[2]), { by: 'gabbai', at: 1_790_000_100_000 });
  if (card === 'seats-gabbai' && mine[2]) state.erev.set(fixtureSeatId(mine[2]), { by: 'gabbai', at: 1_790_000_100_000 });
  if (card === 'seats-done' && mine[2]) state.erev.set(fixtureSeatId(mine[2]), { by: 'member', at: 1_790_000_100_000 });

  // Who has answered: every other household with an even number; his family only for the "done"/gabbai cards.
  const answered: Record<WirePrayer, Map<string, number>> = { erev: new Map(), day: new Map() };
  allocations.slice(1).forEach((a, i) => { if (i % 2 === 0) { answered.erev.set(`family:${a.householdId}`, 1_790_000_000_000); answered.day.set(`family:${a.householdId}`, 1_790_000_000_000); } });
  if (card === 'seats-done' || card === 'seats-gabbai' || variant === 'gabbai') for (const p of ['erev', 'day'] as const) answered[p].set('family:me', 1_790_000_100_000);

  const open = variant !== 'closed';
  const deadline = () => (open ? israelInstant(friday, '12:00') : new Date(Date.now() - 3_600_000)).toISOString();
  const myIds = () => new Set(mine.map(fixtureSeatId));
  const cut = () => memberView(h.hall, allocations, 'me');
  const idOfKey = (key: string): string => fixtureSeatId(parseSeatKey(key)!);
  const stateOf = (p: WirePrayer, id: string): 'kept' | 'released' => (state[p].has(id) ? 'released' : 'kept');

  function memberWire(): MemberWire {
    const base = { week: friday, deadline: deadline(), open };
    const view = cut();
    if (!view.seatCount) return { ...base, seats: 0 };
    const frames: WireFrame[] = view.frames.map((f) => ({
      blockName: f.blockName, cols: f.cols, rowFrom: rowLabel(f.rowFrom), rowTo: rowLabel(f.rowTo),
      rows: f.rows.map((r) => ({
        label: rowLabel(r.row), mine: r.mine, bimah: r.bimah,
        cells: r.cells.map((c) => (c.kind === 'mine' ? { kind: 'mine' as const, k: c.k, n: c.n, state: { erev: stateOf('erev', idOfKey(c.key)), day: stateOf('day', idOfKey(c.key)) } } : { kind: c.kind })),
      })),
    }));
    const flagged = [...myIds()].some((id) => state.erev.get(id)?.by === 'gabbai' || state.day.get(id)?.by === 'gabbai');
    return { ...base, seats: view.seatCount, updatedByGabbai: flagged, updatedAt: { ...updatedAt }, answered: { erev: answered.erev.has('family:me'), day: answered.day.has('family:me') }, frames };
  }

  /** The family's seats by order k (the server's order). */
  function myOrder(): string[] {
    const keys: Array<[number, string]> = [];
    for (const f of cut().frames) for (const r of f.rows) for (const c of r.cells) if (c.kind === 'mine') keys.push([c.k, idOfKey(c.key)]);
    return keys.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }

  function putMine(body: { week: string; prayer: WirePrayer; released: number[]; ifUpdatedAt: number | null }): MemberWire {
    if (!open) throw new ApiCodeError(403, 'deadline_passed');
    if (!mine.length) throw new ApiCodeError(404, 'no_seats');
    if (body.ifUpdatedAt !== updatedAt[body.prayer]) throw new ApiCodeError(409, 'week_changed');
    const order = myOrder();
    const want = new Set(body.released.map((k) => order[k - 1]).filter((x): x is string => !!x));
    for (const id of order) { if (want.has(id)) { if (!state[body.prayer].has(id)) state[body.prayer].set(id, { by: 'member', at: Date.now() }); } else state[body.prayer].delete(id); }
    answered[body.prayer].set('family:me', Date.now());
    updatedAt[body.prayer] += 1000;
    return memberWire();
  }

  function adminWeek(): WeekWire {
    const prayerOut = (p: WirePrayer) => ({ seats: Object.fromEntries([...state[p]].map(([id, r]) => [id, { released: true, by: r.by, at: r.at }])), requests: {}, canUndo: false, answered: Object.fromEntries(answered[p]), updatedAt: updatedAt[p] });
    return { week: friday, deadline: deadline(), open, layout: hallLayout(h.hall), assignments, households, prayers: { erev: prayerOut('erev'), day: prayerOut('day') } };
  }

  function putWeek(body: OnBehalfBody): { updatedAt: number } {
    if (body.ifUpdatedAt !== updatedAt[body.prayer]) throw new ApiCodeError(409, 'week_changed');
    for (const [id, want] of Object.entries(body.released)) {
      if (!assignments[id]) throw new ApiCodeError(400, 'invalid_released');
      if (want) state[body.prayer].set(id, { by: 'gabbai', at: Date.now() }); else state[body.prayer].delete(id);
      answered[body.prayer].set(assignments[id]!, Date.now());
    }
    updatedAt[body.prayer] += 1000;
    return { updatedAt: updatedAt[body.prayer] };
  }
  return { memberWire, putMine, adminWeek, putWeek };
}
