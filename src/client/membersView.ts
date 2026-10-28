import { isManagement } from './roles.ts';
import { normalize } from '../search/normalize.ts';
import { formatPhone, telUrl, whatsappUrl } from './phone.ts';
import type { AdminFamily, MemberRow, Role } from './types.ts';

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
  return isManagement(role) ? { manage: true, nav } : { manage: false, nav: { tab: 'home' }, left: true };
}

/** A request to enter management mode is read once (a remount never replays it) and only counts for a gabbai. */
export function takeManageEntry(holder: { current: number | null }, role: Role | undefined): boolean {
  const v = holder.current;
  holder.current = null;
  return v !== null && isManagement(role);
}

/** Group IDs of a person that still exist in the Kehila's group list. */
export function existingGroups(ids: string[], all: string[]): string[] {
  return ids.filter(i => all.includes(i));
}

/** P11 line of one person: the partner's name (null when alone) and how many children the family has. */
export function familyLine(userId: string, families: AdminFamily[]): { partnerName: string | null; children: number } {
  const f = families.find(x => x.adults.some(a => a.userId === userId));
  if (!f) return { partnerName: null, children: 0 };
  return { partnerName: f.adults.find(a => a.userId !== userId)?.displayName ?? null, children: f.children.length };
}

/** Members and gabbaim whose family has one adult (or none yet), without the person being linked. */
export function linkCandidates(members: MemberRow[], families: AdminFamily[], exceptUserId: string): MemberRow[] {
  return members.filter(m => m.role !== 'listener' && m.userId !== exceptUserId
    && !families.some(f => f.adults.length > 1 && f.adults.some(a => a.userId === m.userId)));
}

/** P11 / §18.3: one adult's phone as the gabbai sees it: the number, `tel:`, the wa.me link (digits only) and the list state. */
export type PhoneRow = { display: string; tel: string; wa: string; list: 'all' | 'gabbaim' };
export function phoneRow(phone: string | null | undefined, showPhone: boolean | undefined): PhoneRow | null {
  if (!phone) return null;
  return { display: formatPhone(phone), tel: telUrl(phone), wa: whatsappUrl(phone), list: showPhone ? 'all' : 'gabbaim' };
}

/** The adults of a family with their phone rows, joined to the member list by userId (no member or no number: `phone` is null). */
export function adultPhones(family: AdminFamily, members: Array<Pick<MemberRow, 'userId' | 'phone' | 'showPhone'>>): Array<{ userId: string; displayName: string; phone: PhoneRow | null }> {
  return family.adults.map(a => {
    const m = members.find(x => x.userId === a.userId);
    return { userId: a.userId, displayName: a.displayName, phone: phoneRow(m?.phone, m?.showPhone) };
  });
}
