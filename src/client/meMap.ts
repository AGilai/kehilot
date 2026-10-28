import { roleFeatures } from './roleView.ts';
import type { Role } from './types.ts';

/**
 * §18.2 / §18.2a as data: what Me and the Kehila menu hold for a role. The screens render from these lists, and the
 * inventory test (tests/meInventory.test.ts) checks that every §18.1 item still has a reachable destination.
 * Me never edits: its rows are links, action rows (each opens a confirm) and the inline language switch.
 */
export type MeRowKind = 'nav' | 'action' | 'danger' | 'langSwitch';
export type MeRow = { id: string; kind: MeRowKind };
export type MeSection = { id: 'mine' | 'notify' | 'account'; rows: MeRow[] };
export type MeLayout = { card: { phone: boolean; tree: boolean }; sections: MeSection[] };

export function meLayout(role: Role | undefined): MeLayout {
  const f = roleFeatures(role);
  return {
    // The card: name and role always; phone lines and the tree (family line + button) for members and gabbaim only.
    card: { phone: f.phoneList, tree: f.family },
    sections: [
      { id: 'mine', rows: [{ id: 'groups', kind: 'nav' }] },
      { id: 'notify', rows: [{ id: 'prefs', kind: 'nav' }, { id: 'lang', kind: 'langSwitch' }] },
      { id: 'account', rows: [{ id: 'privacy', kind: 'nav' }, { id: 'leave', kind: 'action' }, { id: 'signOut', kind: 'action' }, { id: 'delete', kind: 'danger' }] },
    ],
  };
}

export type MenuRowId = 'manage' | 'tree' | 'phoneList' | 'invite' | 'about';
export type MenuAction = 'manage' | 'tree' | 'phoneList' | 'invite';

/** The rows of the Kehila menu's first card, in order, for a role. */
export function menuRows(role: Role | undefined): MenuRowId[] {
  const f = roleFeatures(role);
  const rows: MenuRowId[] = [];
  if (f.management) rows.push('manage');
  if (f.family) rows.push('tree');
  if (f.phoneList) rows.push('phoneList');
  if (role === 'member' || role === 'gabbai') rows.push('invite');
  rows.push('about');
  return rows;
}

/** Where the Kehila menu's screen rows go (Main reads the request once). */
export function menuTarget(a: MenuAction, role: Role | undefined): 'overview' | 'tree' | 'phoneList' | 'myInvite' | null {
  const ok = menuRows(role).includes(a);
  if (!ok) return null;
  return a === 'manage' ? 'overview' : a === 'tree' ? 'tree' : a === 'phoneList' ? 'phoneList' : 'myInvite';
}

/** §18.1 Me items (rows 1-19 and the switcher): where each one lives now. */
export const MIGRATED = {
  'me.1 manage mode': { menu: 'manage' },
  'me.2 name': { tree: 'me', listener: 'account.privacy' },
  'me.3 role tags': { card: 'tags' },
  'me.4 phone': { tree: 'me', card: 'phone' },
  'me.5 list switch': { tree: 'me', card: 'inList' },
  'me.6 open phone list': { menu: 'phoneList' },
  'me.7 partner': { tree: 'partner' },
  'me.8 children': { tree: 'children' },
  'me.9 tree entry': { card: 'treeButton', menu: 'tree' },
  'me.10 language': { me: 'notify.lang' },
  'me.switcher': { menu: 'kehilot' },
  'me.11 groups I manage': { me: 'mine.groups' },
  'me.12 groups list': { me: 'mine.groups' },
  'me.13 invite listener': { menu: 'invite' },
  'me.14 my links': { menu: 'invite' },
  'me.15 notification prefs': { me: 'notify.prefs' },
  'me.16 privacy and data': { menu: 'about', me: 'account.privacy' },
  'me.17 leave Kehila': { me: 'account.leave' },
  'me.18 sign out': { me: 'account.signOut' },
  'me.19 delete account': { me: 'account.delete' },
} as const;
