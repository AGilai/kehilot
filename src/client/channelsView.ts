import type { Channel, ChannelFields, Role } from './types.ts';

const DEFAULT_KEYS = ['announcements', 'simchas', 'condolences'];

/** The name to show: the three seeded keys are localised, any other name is shown as stored. */
export function channelLabel(c: Pick<Channel, 'name'>, t: (key: string) => string): string {
  return DEFAULT_KEYS.includes(c.name) ? t(`channel.default.${c.name}`) : c.name;
}

/** The name to send when the admin sheet saves: a name still equal to the shown label keeps the stored key, so it keeps localising. */
export function channelSaveName(c: Pick<Channel, 'name'>, typed: string, t: (key: string) => string): string {
  const name = typed.trim();
  return DEFAULT_KEYS.includes(c.name) && name === channelLabel(c, t) ? c.name : name;
}

export const CHAT_LIMIT_DEFAULT = 30;
export const CHAT_LIMIT_MAX = 200;

/** The form of the channel sheet: the stored fields of a channel, or the defaults of a new one. */
export function channelForm(c?: Channel): ChannelFields {
  if (!c) return { name: '', listenersCanRead: false, postPolicy: 'management', groups: [], conversation: false, chatHourlyLimit: CHAT_LIMIT_DEFAULT };
  return { name: c.name, listenersCanRead: c.listenersCanRead, postPolicy: c.postPolicy, groups: c.groups ?? [], conversation: c.conversation, chatHourlyLimit: c.chatHourlyLimit };
}

/** Groups or a conversation close the channel to listeners: the toggle is off and disabled. */
export function lockListeners(f: Pick<ChannelFields, 'groups' | 'conversation'>): boolean {
  return f.groups.length > 0 || f.conversation;
}

/** Which line explains the lock (groups win over conversation), or null when the toggle is free. */
export function lockNote(f: Pick<ChannelFields, 'groups' | 'conversation'>): 'groups' | 'conversation' | null {
  return f.groups.length > 0 ? 'groups' : f.conversation ? 'conversation' : null;
}

/** The last group was removed: the channel opens to all members, so the gabbai confirms first. */
export function needsOpenConfirm(before: Pick<ChannelFields, 'groups'>, after: Pick<ChannelFields, 'groups'>): boolean {
  return before.groups.length > 0 && after.groups.length === 0;
}

/** A whole number from 0 to 200; anything else that is not a number gives the default. */
export function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return CHAT_LIMIT_DEFAULT;
  return Math.min(CHAT_LIMIT_MAX, Math.max(0, Math.trunc(n)));
}

/** Always carries `groups` and `conversation` (a missing key would keep the stored value); the limit only for a conversation. */
export function toRequest(f: ChannelFields): ChannelFields {
  const out: ChannelFields = {
    name: f.name.trim(),
    listenersCanRead: lockListeners(f) ? false : f.listenersCanRead,
    postPolicy: f.postPolicy,
    groups: f.groups,
    conversation: f.conversation,
  };
  if (f.conversation) out.chatHourlyLimit = clampLimit(f.chatHourlyLimit ?? CHAT_LIMIT_DEFAULT);
  return out;
}

type Person = { role: Role; isAdmin: boolean };

/** Removing another admin from a group is for gabbaim only; a listener cannot administer. */
export function canRemoveFromGroup(caller: Role | undefined, target: Person): boolean {
  if (caller === 'gabbai') return true;
  if (caller !== 'member') return false;
  return !(target.isAdmin || target.role === 'gabbai');
}

/** Only a member who is not yet an admin can be appointed (a gabbai already administers every group). */
export function canAppoint(target: Person): boolean {
  return target.role === 'member' && !target.isAdmin;
}

/** The first of `ids` with at least one pending request; a group that fails to load is skipped. */
export async function firstWithPending(ids: string[], count: (id: string) => Promise<number>): Promise<string | null> {
  for (const id of ids) {
    try { if ((await count(id)) > 0) return id; } catch { /* skip it */ }
  }
  return null;
}

/** The sheet has unsaved changes (groups compare as a set; the limit counts only for a conversation). */
export function isDirty(initial: ChannelFields, form: ChannelFields): boolean {
  const g = (f: ChannelFields) => [...new Set(f.groups)].sort().join('\u0000');
  if (initial.name !== form.name || initial.listenersCanRead !== form.listenersCanRead || initial.postPolicy !== form.postPolicy) return true;
  if (initial.conversation !== form.conversation || g(initial) !== g(form)) return true;
  return form.conversation && initial.chatHourlyLimit !== form.chatHourlyLimit;
}

/** Where an admin screen goes when its call is refused with 403 (the admin rights ended); null for any other error. */
export function exitTarget(code: unknown, from: 'group' | 'limit'): 'me' | 'chat' | null {
  if (code !== 'forbidden') return null;
  return from === 'group' ? 'me' : 'chat';
}
