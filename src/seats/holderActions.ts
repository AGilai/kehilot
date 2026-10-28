/**
 * The map editor's actions on one household (pure): what the selection bar offers for the selected seats, the gabbai's own family for
 * the "זה אני" link shortcut, and the delete confirm's lines (seats per layout version, from `GET …/holders/{id}/seats`).
 */
import type { AdminFamily } from '../client/types.ts';
import type { Draft } from './editModel.ts';
import { isSeat } from './editModel.ts';
import type { Pos } from './grid.ts';
import { firstName } from './households.ts';
import { normalizeName } from './match.ts';
import { holderOwner } from './ownerLabel.ts';

/**
 * `assignTo`: "assign to <selected>" changes something (some selected seat is not the selected household's). `free`: occupied seats
 * in the selection ("פנוי" frees them). `owner`: the one household all the selected seats belong to (the bar names it), else null.
 */
export function selectionActions(d: Draft, keys: Pos[], selRef: string | null): { assignTo: boolean; free: number; owner: string | null } {
  const seats = keys.filter((p) => isSeat(d, p));
  const refs = seats.map((p) => d.assign[p] ?? null);
  const held = refs.filter((r): r is string => !!r);
  const owners = new Set(refs);
  return { assignTo: !!selRef && refs.some((r) => r !== selRef), free: held.length, owner: owners.size === 1 && held.length ? held[0]! : null };
}

/** The family of the signed-in gabbai, if he has one in the list. */
export function myFamily(families: AdminFamily[], userId: string | null | undefined): AdminFamily | null {
  if (!userId) return null;
  return families.find((f) => f.adults.some((a) => a.userId === userId)) ?? null;
}

/** Could this holder be that family? Same surname (spelling-normalised, "משפחת" prefix ignored), and the initial when the holder has one. */
export function isMine(holderName: string, family: AdminFamily | null): boolean {
  if (!family) return false;
  const owner = holderOwner(holderName);
  if (!owner.surname || normalizeName(owner.surname) !== normalizeName(family.name)) return false;
  if (!owner.first) return true;
  const initial = normalizeName(owner.first).slice(0, 1);
  return family.adults.some((_, i) => normalizeName(firstName(family, i)).startsWith(initial));
}

export type HolderSeats = { total: number; versions: { effectiveFrom: string; seats: number; past: boolean }[] };
export const deleteLines = (u: HolderSeats): { from: string; seats: number; past: boolean }[] => u.versions.filter((v) => v.seats > 0).map((v) => ({ from: v.effectiveFrom, seats: v.seats, past: v.past }));
