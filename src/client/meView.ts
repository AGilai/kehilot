import { aliyahName, prayerName } from '../tree/names.ts';
import type { Person } from '../tree/types.ts';

export type MyTreeName = { label: 'aliyah' | 'mi'; text: string; missing: ('father' | 'mother' | 'first')[] };

/** §18.2: my name from the tree. Men: the aliyah name; women: the Mi Sheberach name (women never get an aliyah label). */
export function myTreeName(people: Person[]): MyTreeName | null {
  const me = people.find(p => p.relation === 'self');
  if (!me) return null;
  const man = me.gender === 'm';
  const n = man ? aliyahName(people, me.id) : prayerName(people, me.id);
  return { label: man ? 'aliyah' : 'mi', text: n.text, missing: n.missing };
}

/** Initials for the avatar disc: the first letter of the first and the last name. */
export function initials(first: string, last: string): string {
  return [first, last].map(s => [...s.trim()][0] ?? '').join('');
}

/** "ברשימת הטלפונים" value: null without a number (shown as "—"). */
export function listState(phone: string | null | undefined, showPhone: boolean): 'toAll' | 'gabbaimOnly' | null {
  return !phone ? null : showPhone ? 'toAll' : 'gabbaimOnly';
}

/** The muted count for the notification row: how many channels, message types and members are muted. */
export function mutedCount(n: { mutedChannels: string[]; mutedTypes: string[]; mutedMembers: string[] }): number {
  return n.mutedChannels.length + n.mutedTypes.length + n.mutedMembers.length;
}
