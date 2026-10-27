/**
 * Households of the map editor (pure): registered families, holders without an account and the holders this draft is about to create,
 * with their seat counts. Counts only: no seat numbers anywhere (owner ruling). A family's cell name is the surname, plus the head's
 * initial when another family shares the surname.
 */
import type { AdminFamily } from '../client/types.ts';
import { countsByRef, seatsOf } from './editModel.ts';
import type { Draft } from './editModel.ts';
import { parsePos } from './grid.ts';

export type Household = {
  ref: string; kind: 'family' | 'holder'; /** In the cell: surname[ initial.] */ short: string; /** In the list: surname and first names. */ full: string;
  count: number; noAccount: boolean; blocks: string[]; pending: boolean;
};
type HolderIn = { holderId: string; name: string };

const firstName = (f: AdminFamily, i: number): string => {
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
  const sameName = (name: string) => families.filter((f) => f.name === name).length > 1;
  const out: Household[] = [];
  const mk = (ref: string, kind: Household['kind'], short: string, full: string, noAccount: boolean, pending: boolean) =>
    out.push({ ref, kind, short, full, count: counts.get(ref) ?? 0, noAccount, blocks: blocksOfRef(d, ref), pending });
  for (const f of families) {
    const first = firstName(f, 0);
    const firsts = [firstName(f, 0), firstName(f, 1)].filter(Boolean).join(and);
    mk(`family:${f.familyId}`, 'family', sameName(f.name) && first ? `${f.name} ${[...first][0]}.` : f.name, firsts ? `${f.name} · ${firsts}` : f.name, false, false);
  }
  for (const h of holders) mk(`holder:${h.holderId}`, 'holder', h.name, h.name, true, false);
  for (const h of d.holders) mk(`new:${h.key}`, 'holder', h.name, h.name, true, true);
  return out.sort((a, b) => a.full.localeCompare(b.full, 'he'));
}

export type HouseholdFilter = 'all' | 'none' | 'noAccount';
export function filterHouseholds(rows: Household[], query: string, chip: HouseholdFilter): Household[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (chip === 'all' || (chip === 'none' ? r.count === 0 : r.noAccount)) && (!q || r.full.toLowerCase().includes(q) || r.short.toLowerCase().includes(q)));
}
