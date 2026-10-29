// The member's seat form (UX §15.10) as a pure model: which seats a count frees, the draft of both prayers, the footer
// button, the hint line and the circle layout. No React, no network.
import type { Prayer } from './release.ts';
import { PRAYER_LIST } from './wire.ts';
import type { MemberSeats, SaveResult, SeatFrame } from './wire.ts';

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));
const other = (p: Prayer): Prayer => (p === 'arvit' ? 'shacharit' : 'arvit');

// ---------------------------------------------------------------- seats and order

/** A count frees the first `count` seats of the server's free order. */
export function autoRelease(m: MemberSeats, count: number): Set<string> {
  return new Set(m.freeOrder.slice(0, Math.max(0, Math.min(count, m.freeOrder.length))));
}
/** Is this set exactly what tapping its size would free? */
export const isAutoChoice = (m: MemberSeats, released: ReadonlySet<string>): boolean => sameSet(released, autoRelease(m, released.size));
/** The head's seat (the aisle seat, freed last). */
export const headKey = (m: MemberSeats): string | null => m.freeOrder[m.freeOrder.length - 1] ?? null;
/** The labels of the frame's rows that hold his seats. A null label (the front row) comes back as ''. */
export const mineRowLabels = (f: SeatFrame): string[] => f.rows.filter((r) => r.mine).map((r) => r.label ?? '');

// ---------------------------------------------------------------- draft

export type PrayerDraft = { released: Set<string>; answered: boolean; custom: boolean };
export type FormDraft = Record<Prayer, PrayerDraft>;

export function initDraft(m: MemberSeats): FormDraft {
  const one = (p: Prayer): PrayerDraft => ({ released: new Set(m.released[p]), answered: m.answered[p], custom: !isAutoChoice(m, m.released[p]) });
  return { arvit: one('arvit'), shacharit: one('shacharit') };
}
export function pickCount(d: FormDraft, m: MemberSeats, p: Prayer, n: number): FormDraft {
  return { ...d, [p]: { released: autoRelease(m, n), answered: true, custom: false } };
}
export function tapChair(d: FormDraft, m: MemberSeats, p: Prayer, key: string): FormDraft {
  const released = new Set(d[p].released);
  if (released.has(key)) released.delete(key); else released.add(key);
  return { ...d, [p]: { released, answered: true, custom: !isAutoChoice(m, released) } };
}
/** "Same as Friday night": shacharit becomes a copy of arvit. */
export function copyArvit(d: FormDraft): FormDraft {
  return { ...d, shacharit: { released: new Set(d.arvit.released), answered: d.arvit.answered, custom: d.arvit.custom } };
}
/** Does the draft differ from what the server has for that prayer? */
export const changed = (d: FormDraft, m: MemberSeats, p: Prayer): boolean => !sameSet(d[p].released, m.released[p]);
/** What a send must save: the prayers he answered that changed, or that the server doesn't have as answered yet. */
export function saveChoices(d: FormDraft, m: MemberSeats): Partial<Record<Prayer, ReadonlySet<string>>> {
  const out: Partial<Record<Prayer, ReadonlySet<string>>> = {};
  for (const p of PRAYER_LIST) if (d[p].answered && (changed(d, m, p) || !m.answered[p])) out[p] = d[p].released;
  return out;
}

// ---------------------------------------------------------------- screen state

export type FormMode = 'noSeats' | 'notSent' | 'closed' | 'answered' | 'new';
export function formMode(m: MemberSeats): FormMode {
  if (m.seatCount === 0) return 'noSeats';
  const some = m.answered.arvit || m.answered.shacharit;
  if (!m.open) return some ? 'closed' : 'notSent';
  return m.answered.arvit && m.answered.shacharit ? 'answered' : 'new';
}

export type Footer = { kind: 'next'; to: Prayer } | { kind: 'send'; enabled: boolean } | { kind: 'sendChanges'; enabled: boolean };
export function footerOf(d: FormDraft, m: MemberSeats, selected: Prayer): Footer | null {
  if (!m.open) return null;
  if (m.answered.arvit && m.answered.shacharit) return { kind: 'sendChanges', enabled: PRAYER_LIST.some((p) => changed(d, m, p)) };
  if (d[selected].answered && !d[other(selected)].answered) return { kind: 'next', to: other(selected) };
  return { kind: 'send', enabled: d.arvit.answered && d.shacharit.answered };
}

export type Hint = 'none' | 'zero' | 'some' | 'someRear' | 'all' | 'custom' | 'sent';
export function hintOf(pd: PrayerDraft, n: number, multiRow: boolean, locked: boolean): Hint {
  if (locked) return 'sent';
  if (!pd.answered) return 'none';
  if (pd.custom) return 'custom';
  if (pd.released.size === 0) return 'zero';
  if (pd.released.size >= n) return 'all';
  return multiRow ? 'someRear' : 'some';
}

export type SegState = { kind: 'unanswered' } | { kind: 'all' } | { kind: 'none' } | { kind: 'free'; n: number };
export function segState(pd: PrayerDraft, n: number): SegState {
  if (!pd.answered) return { kind: 'unanswered' };
  if (pd.released.size === 0) return { kind: 'all' };
  return pd.released.size >= n ? { kind: 'none' } : { kind: 'free', n: pd.released.size };
}

/**
 * The circles 0..n. Up to 5 seats: 52 with 12 between, squeezed down to 4 when the row is tight. 6-7 seats: 44 spread
 * over the width (7 seats at 358 leave no gap, the rings themselves separate them). Past that they wrap.
 */
export function circleLayout(n: number, width: number): { size: number; gap: number; wrap: boolean } {
  const count = n + 1;
  const room = (size: number, min: number): boolean => count * size + n * min <= width;
  const spread = (size: number, cap: number): number => (n === 0 ? cap : Math.min(cap, Math.floor((width - count * size) / n)));
  if (room(52, 4)) return { size: 52, gap: spread(52, 12), wrap: false };
  if (room(44, 0)) return { size: 44, gap: spread(44, Infinity), wrap: false };
  return { size: 44, gap: 8, wrap: true };
}

/** After "Send": saved closes the screen, a changed week keeps it open, a failure (null) leaves it. */
export const afterSend = (r: SaveResult | null): 'close' | 'stale' | 'none' => (!r ? 'none' : r.kind === 'saved' ? 'close' : 'stale');
