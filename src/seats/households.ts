/**
 * Households of the map editor (pure): registered families, holders without an account and the holders this draft is about to create,
 * with their seat counts. Counts only: no seat numbers anywhere (owner ruling). A family's cell name is the surname, plus the head's
 * initial when another family shares the surname.
 */
import type { AdminFamily } from '../client/types.ts';
import { countsByRef, seatsOf } from './editModel.ts';
import type { Draft } from './editModel.ts';
import { parsePos } from './grid.ts';
import { holderOwner, seatOwnerLabel } from './ownerLabel.ts';
import type { SeatOwner } from './ownerLabel.ts';

export type Household = {
  ref: string; kind: 'family' | 'holder'; /** In the cell: surname[ initial.] */ short: string; /** In the list: surname and first names. */ full: string;
  count: number; noAccount: boolean; blocks: string[]; pending: boolean;
};
type HolderIn = { holderId: string; name: string };

export const firstName = (f: AdminFamily, i: number): string => {
  const n = (f.adults[i]?.displayName ?? '').trim();
  return n.endsWith(` ${f.name}`) ? n.slice(0, -f.name.length - 1).trim() : n.split(' ')[0] ?? '';
};
/** Blocks (by name) in which the household holds seats, right to left as in the room. */
export function blocksOfRef(d: Draft, ref: string): string[] {
  const cols = new Set(seatsOf(d, ref).map((p) => parsePos(p).c));
  return d.layout.blocks.filter((b) => [...cols].some((c) => c >= b.colStart && c <= b.colEnd)).map((b) => b.name).reverse();
}

export function households(d: Draft, families: AdminFamily[], holders: HolderIn[], and = ' ו'): Household[] {
  const counts = countsByRef(d);
  const out: Household[] = [];
  const entries: Array<{ owner: SeatOwner; ref: string; kind: Household['kind']; full: string; noAccount: boolean; pending: boolean }> = [];
  for (const f of families) {
    const first = firstName(f, 0);
    const firsts = [first, firstName(f, 1)].filter(Boolean).join(and);
    entries.push({ owner: { surname: f.name, first }, ref: `family:${f.familyId}`, kind: 'family', full: firsts ? `${f.name} · ${firsts}` : f.name, noAccount: false, pending: false });
  }
  for (const h of holders) entries.push({ owner: holderOwner(h.name), ref: `holder:${h.holderId}`, kind: 'holder', full: h.name, noAccount: true, pending: false });
  for (const h of d.holders) entries.push({ owner: holderOwner(h.name), ref: `new:${h.key}`, kind: 'holder', full: h.name, noAccount: true, pending: true });
  const all = entries.map((e) => e.owner);
  for (const e of entries) out.push({ ref: e.ref, kind: e.kind, short: seatOwnerLabel(e.owner, all) || e.full, full: e.full, count: counts.get(e.ref) ?? 0, noAccount: e.noAccount, blocks: blocksOfRef(d, e.ref), pending: e.pending });
  return out.sort((a, b) => a.full.localeCompare(b.full, 'he'));
}

export type HouseholdFilter = 'all' | 'none' | 'noAccount';
export function filterHouseholds(rows: Household[], query: string, chip: HouseholdFilter): Household[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (chip === 'all' || (chip === 'none' ? r.count === 0 : r.noAccount)) && (!q || r.full.toLowerCase().includes(q) || r.short.toLowerCase().includes(q)));
}
