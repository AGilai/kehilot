/**
 * Holders without an account and link suggestions (UX-DESIGN §16.7, frame P30; pure). Nothing is linked here: a suggestion is only a
 * line for a gabbai, and a link is one explicit call (`POST …/holders/{id}/link`). Holder records are personal data: they live in this
 * screen's memory only, never in logs.
 */
import type { SeatHolder } from '../client/endpoints.ts';
import { normalizePhone } from '../client/phone.ts';

/** `GET …/admin/seating/link-suggestions` (strongest first). */
export type LinkSuggestion = { holderId: string; holderName: string; familyId: string; familyName: string; why: string; level: 'exact' | 'likely'; familyHoldsSeats: boolean };
export type LinkSuggestions = { count: number; suggestions: LinkSuggestion[] };
/** `GET …/admin/requests` rows: top three, before any family exists. */
export type RequestSuggestion = { holderId: string; holderName: string; why: string; level: 'exact' | 'likely' };

export const MAX_HOLDER_NAME = 60;

export type HolderBodyResult = { ok: true; body: { name: string; phone?: string } } | { ok: false; field: 'name' | 'phone' };
export function holderBody(name: string, phone: string): HolderBodyResult {
  const n = name.trim();
  if (!n || [...n].length > MAX_HOLDER_NAME) return { ok: false, field: 'name' };
  const p = phone.trim();
  if (!p) return { ok: true, body: { name: n } };
  const e164 = normalizePhone(p);
  return e164 ? { ok: true, body: { name: n, phone: e164 } } : { ok: false, field: 'phone' };
}

/** Seats per household ref (`family:…`, `holder:…`), from one layout version's assignments. */
export function seatCountsByRef(assignments: Record<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const ref of Object.values(assignments)) out.set(ref, (out.get(ref) ?? 0) + 1);
  return out;
}
/** Seats per holder id. */
export function seatCountsByHolder(assignments: Record<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [ref, n] of seatCountsByRef(assignments)) if (ref.startsWith('holder:')) out.set(ref.slice(7), n);
  return out;
}

// ---------------------------------------------------------------- "not the same family" (kept on this device)

export const dismissKey = (holderId: string, familyId: string): string => `${holderId}|${familyId}`;
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const storeKey = (kehilaId: string) => `kehilot.seatLinkDismissed.${kehilaId}`;
export function loadDismissed(store: Store | undefined, kehilaId: string): Set<string> {
  try {
    const raw = store?.getItem(storeKey(kehilaId));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}
export function saveDismissed(store: Store | undefined, kehilaId: string, set: ReadonlySet<string>): void {
  try { store?.setItem(storeKey(kehilaId), JSON.stringify([...set])); } catch { /* storage unavailable: the hint comes back next time */ }
}
export const visibleSuggestions = (list: LinkSuggestion[], dismissed: ReadonlySet<string>): LinkSuggestion[] =>
  list.filter((s) => !dismissed.has(dismissKey(s.holderId, s.familyId)));

// ---------------------------------------------------------------- the list

export type HolderRow = { holder: SeatHolder; seats: number; suggestion?: LinkSuggestion };
export function holderRows(holders: SeatHolder[], seats: ReadonlyMap<string, number>, suggestions: LinkSuggestion[], onlySuggested: boolean): HolderRow[] {
  const first = new Map<string, LinkSuggestion>();
  for (const s of suggestions) if (!first.has(s.holderId)) first.set(s.holderId, s);
  return [...holders]
    .sort((a, b) => Number(first.has(b.holderId)) - Number(first.has(a.holderId)) || a.name.localeCompare(b.name, 'he') || a.holderId.localeCompare(b.holderId))
    .map((holder): HolderRow => ({ holder, seats: seats.get(holder.holderId) ?? 0, ...(first.has(holder.holderId) ? { suggestion: first.get(holder.holderId)! } : {}) }))
    .filter((r) => !onlySuggested || r.suggestion);
}

const STRONG = new Set(['phone-surname', 'phone']);
const KNOWN = new Set(['phone-surname', 'surname-initial', 'phone', 'spelling', 'surname-only', 'surname-other-initial']);
/** The i18n key suffix of a server reason; weak = no phone to compare ("בלי טלפון להשוואה"). */
export function whyKey(why: string): { key: string; weak: boolean } {
  return { key: KNOWN.has(why) ? why : 'other', weak: !STRONG.has(why) };
}

// ---------------------------------------------------------------- linking

/** The result is the union of both seat sets (ruling 7); a household that already holds seats gets the extra panel. */
export function linkOutcome(holderSeats: number, familySeats: number): { total: number; family: number; union: boolean } {
  return { total: holderSeats + familySeats, family: familySeats, union: familySeats > 0 };
}

export type LinkError = 'changed' | 'retry' | 'gone' | 'other';
export function linkError(e: unknown): LinkError {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'holder_changed') return 'changed';
  if (code === 'try_again') return 'retry';
  if (code === 'holder_not_found' || code === 'family_not_found') return 'gone';
  return 'other';
}
