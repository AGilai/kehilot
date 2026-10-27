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
