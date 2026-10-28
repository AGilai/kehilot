import { seatEditorAllowed, seatPrintRole } from '../seats/access.ts';
import { isManagement } from './roles.ts';
import { scheduleEditorAllowed } from './roleView.ts';
import type { Role } from './types.ts';

/**
 * §18.3 as data: the six management groups (by weekly use) and the rows inside each, the "לטיפול עכשיו" items, in order.
 * The overview, the group screens and the wide sidebar render from this; tests/adminAreas.test.ts checks that every
 * management screen stays reachable. Nothing here touches React or the network.
 */
export type AreaId = 'prayers' | 'seats' | 'messages' | 'simchas' | 'people' | 'settings';
export const AREA_IDS: AreaId[] = ['prayers', 'seats', 'messages', 'simchas', 'people', 'settings'];

/** Where a row goes: a screen of Main, or a Sheet of the settings group. `null`: reserved, no destination yet. */
export type AreaTarget =
  | 'scheduleEditor' | 'seatPrint' | 'seatBehalf' | 'seatResponses' | 'seatTimes' | 'seatEditor' | 'seatHolders'
  | 'compose' | 'channels' | 'pushTexts' | 'simchas' | 'sheetItems'
  | 'approvals' | 'members' | 'membersTags' | 'groups' | 'invite' | 'import'
  | 'sheet:cap' | 'sheet:privacy' | 'sheet:terms';
export type BadgeKind = 'requests' | 'linkHints' | 'groupRequests' | 'sheetPending';
export type AreaRow = { id: string; target: AreaTarget | null; badge?: BadgeKind; section?: 'week' | 'every' | 'hall' };
export type Area = { id: AreaId; rows: AreaRow[] };

export function areas(role: Role | string | undefined): Area[] {
  if (!isManagement(role)) return [];
  const rows = (list: Array<AreaRow & { when?: boolean }>) => list.filter(r => r.when !== false).map(({ when: _w, ...r }) => r);
  return [
    { id: 'prayers', rows: rows([{ id: 'schedule', target: 'scheduleEditor', when: scheduleEditorAllowed(role) }, { id: 'sheet', target: 'sheetItems', badge: 'sheetPending', when: scheduleEditorAllowed(role) }]) },
    { id: 'seats', rows: rows([
      { id: 'print', target: 'seatPrint', section: 'week', when: seatPrintRole(role) },
      { id: 'behalf', target: 'seatBehalf', section: 'week', when: seatPrintRole(role) },
      { id: 'responses', target: 'seatResponses', section: 'week', when: seatEditorAllowed(role) },
      { id: 'times', target: 'seatTimes', section: 'every' },
      { id: 'editor', target: 'seatEditor', section: 'hall', when: seatEditorAllowed(role) },
      { id: 'holders', target: 'seatHolders', section: 'hall', badge: 'linkHints', when: seatEditorAllowed(role) },
    ]) },
    { id: 'messages', rows: [{ id: 'compose', target: 'compose' }, { id: 'channels', target: 'channels' }, { id: 'types', target: 'channels' }, { id: 'pushTexts', target: 'pushTexts' }] },
    { id: 'simchas', rows: [{ id: 'simchas', target: 'simchas' }, { id: 'aliyot', target: null }] },
    { id: 'people', rows: [
      { id: 'approvals', target: 'approvals', badge: 'requests' }, { id: 'members', target: 'members' }, { id: 'tags', target: 'membersTags' },
      { id: 'groups', target: 'groups', badge: 'groupRequests' }, { id: 'invite', target: 'invite' }, { id: 'import', target: 'import' },
    ] },
    { id: 'settings', rows: [{ id: 'cap', target: 'sheet:cap' }, { id: 'privacy', target: 'sheet:privacy' }, { id: 'terms', target: 'sheet:terms' }] },
  ];
}

/** Every destination the role's rows open. */
export function allowedTargets(role: Role | string | undefined): Set<AreaTarget> {
  const out = new Set<AreaTarget>();
  for (const a of areas(role)) for (const r of a.rows) if (r.target) out.add(r.target);
  return out;
}

export type Waiting = { requests: number; terms: boolean; linkHints: number; groupRequests: number; sheetPending: number };
export type TodoId = 'requests' | 'sheet' | 'terms' | 'linkHints' | 'groupRequests';
export type TodoItem = { id: TodoId; count: number; target: 'approvals' | 'sheetItems' | 'overview' | 'seatHolders' | 'groups' };

/** "לטיפול עכשיו": one item per thing that waits, most urgent first. Empty (the card is hidden) when nothing waits, and for non-gabbaim. */
export function todoItems(role: Role | string | undefined, w: Waiting): TodoItem[] {
  if (!isManagement(role)) return [];
  const out: TodoItem[] = [];
  if (w.requests > 0) out.push({ id: 'requests', count: w.requests, target: 'approvals' });
  if (w.sheetPending > 0) out.push({ id: 'sheet', count: w.sheetPending, target: 'sheetItems' });
  if (w.terms) out.push({ id: 'terms', count: 0, target: 'overview' });
  if (w.linkHints > 0) out.push({ id: 'linkHints', count: w.linkHints, target: 'seatHolders' });
  if (w.groupRequests > 0) out.push({ id: 'groupRequests', count: w.groupRequests, target: 'groups' });
  return out;
}

export const waitingAny = (role: Role | string | undefined, w: Waiting): boolean => todoItems(role, w).length > 0;
