// The seating API's wire shapes and the pure logic around them (server/API.md "Seating, weekly release"):
// the member's cut, the 409 re-apply rule, the Home card rules, the gabbai's print model (bimah and ark from the
// server's cells) and the on-behalf payload. Nothing here touches the network or React.
import type { Prayer } from './release.ts';

export type WirePrayer = 'erev' | 'day';
/** The client says arvit/shacharit, the server erev/day. */
export const toWire = (p: Prayer): WirePrayer => (p === 'arvit' ? 'erev' : 'day');
export const PRAYER_LIST: Prayer[] = ['arvit', 'shacharit'];

// ---------------------------------------------------------------- member

export type WireCell =
  | { kind: 'gap' } | { kind: 'bimah' } | { kind: 'other' }
  | { kind: 'mine'; k: number; n: number; state: Record<WirePrayer, 'kept' | 'released'> };
export type WireRow = { label: string | null; mine: boolean; bimah: boolean; cells: WireCell[] };
export type WireFrame = { blockName: string; cols: number; rowFrom: string | null; rowTo: string | null; rows: WireRow[] };
/** `GET/PUT …/seats/me`. A family with no seats gets `seats: 0` and nothing else. */
export type MemberWire = {
  week: string; deadline: string; open: boolean; seats: number;
  updatedByGabbai?: boolean; updatedAt?: Record<WirePrayer, number | null>; /** His family has answered that prayer (any successful save, even with no seat change, or a gabbai's on-behalf save). */ answered?: Record<WirePrayer, boolean>; frames?: WireFrame[];
};

/** `mine` is the only cell that carries an identity: its order k, which is also the key the page toggles by. */
export type SeatCell = { kind: 'gap' } | { kind: 'bimah' } | { kind: 'other' } | { kind: 'mine'; key: string; k: number; n: number };
export type SeatRow = { label: string | null; mine: boolean; bimah: boolean; cells: SeatCell[] };
export type SeatFrame = { id: string; blockName: string; cols: number; rowFrom: string | null; rowTo: string | null; rows: SeatRow[] };
export type MemberSeats = {
  week: string;
  deadline: Date;
  open: boolean;
  seatCount: number;
  updatedByGabbai: boolean;
  updatedAt: Record<Prayer, number | null>;
  answered: Record<Prayer, boolean>;
  frames: SeatFrame[];
  /** The orders (as strings) of his seats that are released, per prayer. */
  released: Record<Prayer, Set<string>>;
};

export function memberFromWire(w: MemberWire): MemberSeats {
  const released: Record<Prayer, Set<string>> = { arvit: new Set(), shacharit: new Set() };
  const frames: SeatFrame[] = (w.frames ?? []).map((f, i) => ({
    id: `${i}:${f.blockName}`,
    blockName: f.blockName,
    cols: f.cols,
    rowFrom: f.rowFrom,
    rowTo: f.rowTo,
    rows: f.rows.map((r): SeatRow => ({
      label: r.label,
      mine: r.mine,
      bimah: r.bimah,
      cells: r.cells.map((c): SeatCell => {
        if (c.kind !== 'mine') return { kind: c.kind } as SeatCell;
        for (const p of PRAYER_LIST) if (c.state[toWire(p)] === 'released') released[p].add(String(c.k));
        return { kind: 'mine', key: String(c.k), k: c.k, n: c.n };
      }),
    })),
  }));
  return {
    week: w.week,
    deadline: new Date(w.deadline),
    open: w.open,
    seatCount: w.seats,
    updatedByGabbai: !!w.updatedByGabbai,
    updatedAt: { arvit: w.updatedAt?.erev ?? null, shacharit: w.updatedAt?.day ?? null },
    answered: { arvit: !!w.answered?.erev, shacharit: !!w.answered?.day },
    frames,
    released,
  };
}

/** The page cuts only what the family holds; a payload without seats means no card and the "no seats" page. */
export const holdsSeats = (m: MemberSeats | null): boolean => !!m && m.seatCount > 0;

const orders = (set: ReadonlySet<string>): number[] => [...set].map(Number).sort((a, b) => a - b);

/** `PUT …/seats/me`: the family's released set for one prayer, as orders 1..n. `ifUpdatedAt` is what the last read said for that prayer. */
export function memberPutBody(week: string, prayer: Prayer, released: ReadonlySet<string>, updatedAt: number | null): { week: string; prayer: WirePrayer; released: number[]; ifUpdatedAt: number | null } {
  return { week, prayer: toWire(prayer), released: orders(released), ifUpdatedAt: updatedAt };
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

/** Are his own seats exactly as they were (same count, same released set for both prayers)? */
export function sameOwnSeats(a: MemberSeats, b: MemberSeats): boolean {
  return a.seatCount === b.seatCount && PRAYER_LIST.every((p) => sameSet(a.released[p], b.released[p]));
}

/**
 * A 409 `week_changed` can come from another family's change (the week item is shared). After a re-read: if his own
 * seats are unchanged and the week is still open, apply his choice again, silently; otherwise show the updated state.
 */
export function conflictOutcome(before: MemberSeats, fresh: MemberSeats): 'retry' | 'updated' {
  return fresh.open && fresh.seatCount > 0 && sameOwnSeats(before, fresh) ? 'retry' : 'updated';
}

export type SaveDeps = { put: (body: ReturnType<typeof memberPutBody>) => Promise<MemberSeats>; reread: () => Promise<MemberSeats> };
export type SaveResult = { kind: 'saved'; data: MemberSeats } | { kind: 'updated'; data: MemberSeats };
const isWeekChanged = (e: unknown): boolean => !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'week_changed';

/** Save one prayer with the retry rule: one silent retry after a re-read when only others' seats changed, else "updated". */
export async function saveRelease(deps: SaveDeps, base: MemberSeats, prayer: Prayer, choice: ReadonlySet<string>): Promise<SaveResult> {
  try {
    return { kind: 'saved', data: await deps.put(memberPutBody(base.week, prayer, choice, base.updatedAt[prayer])) };
  } catch (e) {
    if (!isWeekChanged(e)) throw e;
  }
  const fresh = await deps.reread();
  if (conflictOutcome(base, fresh) === 'updated') return { kind: 'updated', data: fresh };
  try {
    return { kind: 'saved', data: await deps.put(memberPutBody(fresh.week, prayer, choice, fresh.updatedAt[prayer])) };
  } catch (e) {
    if (!isWeekChanged(e)) throw e;
  }
  return { kind: 'updated', data: await deps.reread() };
}

// ---------------------------------------------------------------- Home card

export type CardModel = { state: 'ask' | 'done' | 'byGabbai'; count: number; deadline: Date; free: Record<Prayer, number> };
const DAY_MS = 86_400_000;

/**
 * The Home card: only to a family that holds seats, from a day before the server's deadline (the reminder, default Thursday
 * 12:00 for a Friday 12:00 deadline) until the deadline. `always` is the fixtures preview (UX §15.4: no timer).
 * Done when the server says both prayers are answered (a saved "yes" counts); a gabbai's change shows "a gabbai updated".
 */
export function cardModel(m: MemberSeats | null, now: Date, always = false): CardModel | null {
  if (!m || m.seatCount <= 0) return null;
  const t = now.getTime();
  if (!always && !(m.open && t < m.deadline.getTime() && t >= m.deadline.getTime() - DAY_MS)) return null;
  const free = { arvit: m.released.arvit.size, shacharit: m.released.shacharit.size };
  const state = m.updatedByGabbai ? 'byGabbai' : m.answered.arvit && m.answered.shacharit ? 'done' : 'ask';
  return { state, count: m.seatCount, deadline: m.deadline, free };
}

/** "Yes, everyone's coming": the current released set for both prayers, saved as the answer (usually nothing is released). */
export const yesChoices = (m: MemberSeats): Record<Prayer, ReadonlySet<string>> => ({ arvit: m.released.arvit, shacharit: m.released.shacharit });

// ---------------------------------------------------------------- gabbai: week, print, on behalf

export type CellKind = 'seat' | 'aisle' | 'bimah' | 'ark' | 'empty';
export type WireLayout = {
  effectiveFrom: string; rows: number; cols: number; cells: CellKind[][];
  blocks: { name: string; colStart: number; colEnd: number }[];
  rowLabels: (string | null)[]; seats: { id: string; row: number; col: number }[];
};
export type WirePrayerState = { /** Households holding seats that answered, ref to ms. */ answered?: Record<string, number>; seats: Record<string, { released: boolean; by: 'member' | 'gabbai'; at: number | null }>; requests: unknown; canUndo: boolean; updatedAt: number | null };
/** `GET …/admin/seats/week/{week}`. */
export type WeekWire = {
  week: string; deadline: string; open: boolean; layout: WireLayout;
  assignments: Record<string, string>; households: Record<string, string>;
  prayers: Record<WirePrayer, WirePrayerState>;
};

export type Rect = { row: number; col: number; rows: number; cols: number };

/** Merge the cells of one kind into rectangles: a run in a row joins the run above when it has the same columns. */
export function kindRects(cells: CellKind[][], kind: CellKind): Rect[] {
  const done: Rect[] = [];
  let open: Rect[] = [];
  cells.forEach((line, row) => {
    const runs: Array<[number, number]> = [];
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== kind) continue;
      let e = c;
      while (line[e + 1] === kind) e++;
      runs.push([c, e]);
      c = e;
    }
    const next: Rect[] = [];
    for (const [s, e] of runs) {
      const above = open.find((r) => r.row + r.rows === row && r.col === s && r.col + r.cols - 1 === e);
      if (above) { above.rows++; next.push(above); } else next.push({ row, col: s, rows: 1, cols: e - s + 1 });
    }
    for (const r of open) if (!next.includes(r)) done.push(r);
    open = next;
  });
  return [...done, ...open].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** `pending`: a family's seat whose family has not answered this prayer yet. */
export type PrintState = 'taken' | 'released' | 'free' | 'pending';
export type Counts = { taken: number; released: number; free: number; pending: number };
export type LayoutPrintSeat = { id: string; row: number; col: number; state: PrintState; ref: string | null; name?: string };
export type LayoutPrint = {
  rows: number; cols: number; rowLabels: (string | null)[];
  seats: LayoutPrintSeat[]; bimah: Rect[]; ark: Rect[];
  blocks: ({ name: string; colStart: number; colEnd: number } & Counts)[]; total: Counts;
};

/** The whole hall for one prayer from the server's layout: bimah and ark are the layout's own cells, never whole rows. Names only on request. */
export function layoutPrint(w: WeekWire, prayer: Prayer, opts: { names?: boolean } = {}): LayoutPrint {
  const L = w.layout;
  const state = w.prayers[toWire(prayer)]?.seats ?? {};
  const answered = w.prayers[toWire(prayer)]?.answered ?? {};
  const empty = (): Counts => ({ taken: 0, released: 0, free: 0, pending: 0 });
  const total = empty();
  const blocks = L.blocks.map((b) => ({ ...b, ...empty() }));
  const seats = L.seats.map((s): LayoutPrintSeat => {
    const ref = w.assignments[s.id] ?? null;
    const st: PrintState = !ref ? 'free' : state[s.id]?.released ? 'released' : ref.startsWith('family:') && !answered[ref] ? 'pending' : 'taken';
    total[st]++;
    const b = blocks.find((x) => s.col >= x.colStart && s.col <= x.colEnd);
    if (b) b[st]++;
    return { id: s.id, row: s.row, col: s.col, state: st, ref, ...(opts.names && ref && w.households[ref] ? { name: w.households[ref] } : {}) };
  });
  return { rows: L.rows, cols: L.cols, rowLabels: L.rowLabels, seats, bimah: kindRects(L.cells, 'bimah'), ark: kindRects(L.cells, 'ark'), blocks, total };
}

export type PrintGeometry = { cellW: number; cellH: number; gap: number; pitch: number; rowW: number; rowPitch: number; head: number; hallW: number; hallH: number };
/** The hall on an A4 landscape page: shrinks cells so any layout (up to 40 x 60) fits the page's inner box. */
export function printGeometry(rows: number, cols: number, maxW = 1055, maxH = 410): PrintGeometry {
  const gap = 2, head = 22, rowW = 30;
  const cellW = Math.max(8, Math.min(32, Math.floor((maxW - 2 * rowW - 4) / Math.max(1, cols)) - gap));
  const rowPitch = Math.max(8, Math.min(28, Math.floor((maxH - head) / Math.max(1, rows))));
  const pitch = cellW + gap;
  return { cellW, cellH: rowPitch - 4, gap, pitch, rowW, rowPitch, head, hallW: rowW * 2 + cols * pitch + 4, hallH: head + rows * rowPitch };
}

export type HouseholdSeat = { id: string; row: number; col: number; blockName: string; rowLabel: string | null; k: number; n: number };
export type Household = { ref: string; name: string; seats: HouseholdSeat[] };

/** The server's order for a family: blocks right to left, rows front to back, columns right to left. */
export function householdsOf(w: WeekWire): Household[] {
  const L = w.layout;
  const blockIdx = (col: number) => L.blocks.findIndex((b) => col >= b.colStart && col <= b.colEnd);
  const byRef = new Map<string, { id: string; row: number; col: number }[]>();
  for (const s of L.seats) {
    const ref = w.assignments[s.id];
    if (!ref) continue;
    const list = byRef.get(ref);
    if (list) list.push(s); else byRef.set(ref, [s]);
  }
  const out: Household[] = [];
  for (const [ref, list] of byRef) {
    const sorted = [...list].sort((a, b) => blockIdx(b.col) - blockIdx(a.col) || a.row - b.row || b.col - a.col);
    out.push({
      ref, name: w.households[ref] ?? '',
      seats: sorted.map((s, i) => ({ id: s.id, row: s.row, col: s.col, blockName: L.blocks[blockIdx(s.col)]?.name ?? '', rowLabel: L.rowLabels[s.row] ?? null, k: i + 1, n: sorted.length })),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'he') || a.ref.localeCompare(b.ref));
}

/** Seat ids of the household that are released now, for one prayer. */
export function releasedNow(w: WeekWire, prayer: Prayer, h: Household): Set<string> {
  const st = w.prayers[toWire(prayer)]?.seats ?? {};
  return new Set(h.seats.filter((s) => st[s.id]?.released).map((s) => s.id));
}

export type OnBehalfBody = { prayer: WirePrayer; released: Record<string, boolean>; ifUpdatedAt: number | null };
/** True for a family household that has not answered this prayer yet (the print draws its seats as pending). */
export const isPending = (w: WeekWire, prayer: Prayer, h: Household): boolean => h.ref.startsWith('family:') && !w.prayers[toWire(prayer)]?.answered?.[h.ref];

/** `PUT …/admin/seats/week/{week}`: only the seats whose state differs from the current one; null when nothing changed. */
export function onBehalfBody(w: WeekWire, prayer: Prayer, h: Household, released: ReadonlySet<string>): OnBehalfBody | null {
  const now = releasedNow(w, prayer, h);
  const changes: Record<string, boolean> = {};
  for (const s of h.seats) if (now.has(s.id) !== released.has(s.id)) changes[s.id] = released.has(s.id);
  return Object.keys(changes).length ? { prayer: toWire(prayer), released: changes, ifUpdatedAt: w.prayers[toWire(prayer)]?.updatedAt ?? null } : null;
}

/** Who last changed the household's seats for this prayer (gabbaim see it; the member only sees "a gabbai updated"). */
export function lastBy(w: WeekWire, prayer: Prayer, h: Household): 'member' | 'gabbai' | null {
  const st = w.prayers[toWire(prayer)]?.seats ?? {};
  let best: { at: number; by: 'member' | 'gabbai' } | null = null;
  for (const s of h.seats) { const r = st[s.id]; if (r && (!best || (r.at ?? 0) >= best.at)) best = { at: r.at ?? 0, by: r.by }; }
  return best?.by ?? null;
}

/** 404 `layout_not_found` means no layout is saved for the week: the gabbai sees an empty state that points to the editor. */
export const isNoLayout = (e: unknown): boolean => !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'layout_not_found';
