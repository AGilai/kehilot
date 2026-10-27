/**
 * The matching step's state (pure; UX-DESIGN §16.3): one decision per household key of the paste, one choice per
 * two-names cell. Nothing is linked silently: bulk confirm only fills rows that have no decision yet.
 */
import { normalizePhone } from '../client/phone.ts';
import type { MatchResult } from './match.ts';
import type { ParsedFamily, ParsedHall, SeatCell, UnassignedCell, UnknownCell } from './paste.ts';

export type Decision =
  | { kind: 'family'; id: string }
  | { kind: 'holder'; id: string }
  /** A holder without an account, created at save. Phone is optional ('' = none). */
  | { kind: 'new'; name: string; phone: string }
  /** The seats stay free (no household). */
  | { kind: 'skip' };

/** a / b / c = the 1st / 2nd / 3rd name of a two-names cell; free = mark the seat free. */
export type CellChoice = 'a' | 'b' | 'c' | 'free';
export type MatchState = { decisions: Record<string, Decision>; cells: Record<string, CellChoice> };
export type MatchAction =
  | { type: 'decide'; key: string; decision: Decision }
  | { type: 'clear'; key: string }
  /** Bulk confirm: adds decisions for keys that have none. */
  | { type: 'merge'; decisions: Record<string, Decision> }
  | { type: 'cell'; row: number; col: number; choice: CellChoice | null }
  | { type: 'reset' };

export const initialMatchState = (): MatchState => ({ decisions: {}, cells: {} });
export const cellKey = (row: number, col: number) => `${row},${col}`;
export const MAX_HOLDER_NAME = 60;

export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case 'decide': return { ...state, decisions: { ...state.decisions, [action.key]: action.decision } };
    case 'clear': {
      const { [action.key]: _gone, ...rest } = state.decisions;
      return { ...state, decisions: rest };
    }
    case 'merge': {
      const decisions = { ...state.decisions };
      for (const [k, d] of Object.entries(action.decisions)) if (!(k in decisions)) decisions[k] = d;
      return { ...state, decisions };
    }
    case 'cell': {
      const cells = { ...state.cells };
      if (action.choice) cells[cellKey(action.row, action.col)] = action.choice; else delete cells[cellKey(action.row, action.col)];
      return { ...state, cells };
    }
    case 'reset': return initialMatchState();
  }
}

export function isDecisionValid(d: Decision | undefined): boolean {
  if (!d) return false;
  if (d.kind !== 'new') return true;
  const name = d.name.trim();
  if (!name || [...name].length > MAX_HOLDER_NAME) return false;
  return d.phone.trim() === '' || normalizePhone(d.phone.trim()) !== null;
}

/** The decisions "אישור n ההתאמות" would add: exactly one registered/holder candidate, level exact, row still undecided. */
export function exactDecisions(results: MatchResult[], state: MatchState): Record<string, Decision> {
  const out: Record<string, Decision> = {};
  for (const r of results) {
    if (state.decisions[r.familyKey] || r.level !== 'exact' || r.ambiguous) continue;
    const c = r.candidates[0];
    if (!c || c.level !== 'exact') continue;
    out[r.familyKey] = c.kind === 'family' ? { kind: 'family', id: c.id } : { kind: 'holder', id: c.id };
  }
  return out;
}

export type TwoNamesCell = { row: number; col: number; raw: string; parts: (SeatCell | UnassignedCell | null)[] };
export function twoNameCells(parsed: ParsedHall): TwoNamesCell[] {
  const out: TwoNamesCell[] = [];
  parsed.grid.forEach((r, row) => r.forEach((c, col) => {
    if (c.kind === 'unknown' && c.reason === 'two-names') out.push({ row, col, raw: c.raw, parts: (c as UnknownCell).parts ?? [] });
  }));
  return out;
}

const INDEX = { a: 0, b: 1, c: 2 } as const;
/** What a two-names cell becomes under a choice: a seat of one name, a free seat, or null (undecided / unreadable part). */
export function resolveTwoNames(cell: TwoNamesCell, choice: CellChoice | undefined): SeatCell | UnassignedCell | null {
  if (!choice) return null;
  if (choice === 'free') return { kind: 'unassigned' };
  return cell.parts[INDEX[choice]] ?? { kind: 'unassigned' };
}

/** The households the matching list shows: the paste's own, plus the names chosen from two-names cells. */
export function effectiveFamilies(parsed: ParsedHall, cells: Record<string, CellChoice>): ParsedFamily[] {
  const byKey = new Map<string, ParsedFamily>(parsed.families.map((f) => [f.familyKey, { ...f, seats: [...f.seats], blocks: [...f.blocks] }]));
  const blockOf = (col: number) => parsed.blocks.findIndex((b) => col >= b.colStart && col <= b.colEnd);
  for (const cell of twoNameCells(parsed)) {
    const r = resolveTwoNames(cell, cells[cellKey(cell.row, cell.col)]);
    if (!r || r.kind !== 'seat') continue;
    let f = byKey.get(r.familyKey);
    if (!f) {
      f = { familyKey: r.familyKey, displayName: r.displayName, family: r.family, initial: r.initial, seats: [], blocks: [] };
      byKey.set(r.familyKey, f);
    }
    f.seats.push({ row: cell.row, col: cell.col, order: r.order });
    const b = blockOf(cell.col);
    if (b >= 0 && !f.blocks.includes(b)) f.blocks.push(b);
  }
  return [...byKey.values()];
}

export function undecided(parsed: ParsedHall, state: MatchState): { families: string[]; cells: string[] } {
  return {
    families: effectiveFamilies(parsed, state.cells).filter((f) => !isDecisionValid(state.decisions[f.familyKey])).map((f) => f.familyKey),
    cells: twoNameCells(parsed).filter((c) => !state.cells[cellKey(c.row, c.col)]).map((c) => cellKey(c.row, c.col)),
  };
}
export function remaining(parsed: ParsedHall, state: MatchState): number {
  const u = undecided(parsed, state);
  return u.families.length + u.cells.length;
}
