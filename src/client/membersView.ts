import { normalize } from '../search/normalize.ts';
import type { MemberRow, Role } from './types.ts';

export type MemberFilter = { query: string; role?: Role; canBroadcast?: boolean; group?: string };

/** Name search (case, niqqud, final letters ignored) combined with role, broadcast right and group. */
export function filterMembers(rows: MemberRow[], f: MemberFilter): MemberRow[] {
  const words = normalize(f.query).split(' ').filter(Boolean);
  return rows.filter(r => {
    if (f.role !== undefined && r.role !== f.role) return false;
    if (f.canBroadcast !== undefined && r.canBroadcast !== f.canBroadcast) return false;
    if (f.group !== undefined && !r.groups.includes(f.group)) return false;
    if (words.length === 0) return true;
    const name = normalize(r.displayName);
    return words.every(w => name.includes(w));
  });
}

/** How many members "allow all / block all" would change. Gabbaim and listeners are never counted. */
export function bulkCount(rows: MemberRow[], allow: boolean): number {
  return rows.filter(r => r.role === 'member' && r.canBroadcast !== allow).length;
}

type AdminNav = { tab: string };
/** Management mode needs the gabbai role; without it the app returns to Home (`left`: show a toast). */
export function adminGuard<N extends AdminNav>(role: Role | undefined, nav: N): { manage: boolean; nav: N | { tab: 'home' }; left?: true } {
  return role === 'gabbai' ? { manage: true, nav } : { manage: false, nav: { tab: 'home' }, left: true };
}

/** A request to enter management mode is read once (a remount never replays it) and only counts for a gabbai. */
export function takeManageEntry(holder: { current: number | null }, role: Role | undefined): boolean {
  const v = holder.current;
  holder.current = null;
  return v !== null && role === 'gabbai';
}

/** Group IDs of a person that still exist in the Kehila's group list. */
export function existingGroups(ids: string[], all: string[]): string[] {
  return ids.filter(i => all.includes(i));
}
