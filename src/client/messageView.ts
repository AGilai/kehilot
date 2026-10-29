import { dualDate, israelDate } from '../dates.ts';
import { sortId } from './feed.ts';
import type { FeedState } from './feed.ts';
import { isAdult, isManagement } from './roles.ts';
import type { Channel, Kehila, Lang, Message, MessageType, NotifyPrefs, PostMessageBody, TemplateFields, TemplateId } from './types.ts';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * True when the app should not alert for this message (the "mine" view leaves it out, "all" flags it):
 * a muted channel, type or member, a member broadcast under `management_only`, a conversation channel the
 * user did not opt into, or a channel outside the caller's audience. The server decides visibility; this
 * only mirrors the user's own choices.
 */
export function isMuted(m: Message, notify: NotifyPrefs, channels: Channel[]): boolean {
  if (notify.mutedChannels.includes(m.channelId)) return true;
  if (notify.mutedTypes.includes(m.type)) return true;
  if (m.authorKind === 'member') {
    if (notify.mutedMembers.includes(m.authorId)) return true;
    // Chat is not a broadcast: opting into a chat channel is the member's own choice.
    if (m.type !== 'chat' && notify.membersBroadcasts === 'management_only') return true;
  }
  // A channel the user can no longer read (or does not know yet) fails closed: never shown as theirs.
  const ch = channels.find(c => c.channelId === m.channelId);
  if (!ch) return true;
  if (ch.conversation && !notify.chatChannels.includes(ch.channelId)) return true;
  return !ch.inAudience;
}

export type ListOptions = { mode: 'mine' | 'all'; channelId?: string; notify: NotifyPrefs; channels: Channel[] };

/** Messages newest first, only of channels in `o.channels`. `mine` drops muted ones; `all` keeps them (use `isMuted` to flag). */
export function visibleList(feed: FeedState, o: ListOptions): Message[] {
  const out: Message[] = [];
  for (const id of feed.order) {
    const m = feed.messages[id];
    if (!m) continue;
    if (o.channelId !== undefined && m.channelId !== o.channelId) continue;
    if (!o.channels.some(c => c.channelId === m.channelId)) continue;
    if (o.mode === 'mine' && isMuted(m, o.notify, o.channels)) continue;
    out.push(m);
  }
  return out;
}

/** "Mine" view only; muted messages are never counted. A message without `read` counts as unread; chat messages are not tracked. */
export function unreadCount(feed: FeedState, notify: NotifyPrefs, channels: Channel[]): number {
  return visibleList(feed, { mode: 'mine', notify, channels }).filter(m => m.type !== 'chat' && !m.read).length;
}

export function joinLabel(type: MessageType, joinCount: number, t: T): string {
  return type === 'condolence' ? t('join.condolence') : t('join.celebration', { n: joinCount });
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Creation time (ms) encoded in a ULID, or NaN. */
export function ulidTime(id: string): number {
  let n = 0;
  for (const ch of id.slice(0, 10).toUpperCase()) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) return NaN;
    n = n * 32 + v;
  }
  return id.length >= 10 ? n : NaN;
}

export { sortId };

export const messageDay = (id: string): string => {
  const ms = ulidTime(id);
  return Number.isFinite(ms) ? israelDate(new Date(ms)) : '';
};

/** Groups a newest-first list by Israel day (day keys `YYYY-MM-DD`) of `sortId`: a bumped message sits under the bump's day. */
export function groupByDay(list: Message[]): { day: string; items: Message[] }[] {
  const out: { day: string; items: Message[] }[] = [];
  for (const m of list) {
    const day = messageDay(sortId(m));
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(m); else out.push({ day, items: [m] });
  }
  return out;
}

export const timeOfDay = (id: string): string => {
  const ms = ulidTime(id);
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
};

const UPDATABLE: readonly MessageType[] = ['event', 'condolence'];

/**
 * Who sees the update action: the author, management, and for a condolence an adult of the family it names
 * (`k.familyId === m.targetFamilyId`). Events and condolences only. The server decides; this only hides the button.
 */
export function canUpdate(m: Message, me: string, k: Pick<Kehila, 'role'> & { familyId?: string | null }): boolean {
  if (!UPDATABLE.includes(m.type) || !isAdult(k.role)) return false;
  if (isManagement(k.role) || m.authorId === me) return true;
  return m.type === 'condolence' && !!m.targetFamilyId && k.familyId === m.targetFamilyId;
}

/** HH:MM when `ms` is today (Israel), else `d.m`. */
function stampText(ms: number, now: number): string {
  const day = israelDate(new Date(ms));
  if (day === israelDate(new Date(now))) return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  const [, mo, d] = day.split('-').map(Number);
  return `${d}.${mo}`;
}

/** "עודכן {time}" (condolence) or "שונה {time}" (event) for the meta line; null when never updated. */
export function updatedMeta(m: Message, t: T, now: number = Date.now()): string | null {
  if (m.updatedAt === undefined) return null;
  const time = stampText(m.updatedAt * 1000, now);
  if (m.type === 'condolence') return t('msg.updated', { time });
  if (m.type === 'event') return t('msg.changed', { time });
  return null;
}

/** The card's closing line, only for a condolence updated to "with shiva details". */
export function updatedLine(m: Message, t: T, now: number = Date.now()): string | null {
  if (m.type !== 'condolence' || m.fields?.variant !== 'full' || m.updatedAt === undefined) return null;
  return t('msg.updatedLine', { time: stampText(m.updatedAt * 1000, now), first: stampText(ulidTime(m.messageId), now) });
}

export const isCancelled = (m: Pick<Message, 'type' | 'fields'>): boolean => m.type === 'event' && m.fields?.cancelled === true;

const WORDS: Record<Lang, { time: string; date: string; place: string }> = {
  he: { time: 'בשעה', date: 'ביום', place: 'במקום' },
  en: { time: 'at', date: 'on', place: 'place:' },
};

/** The changed values of an event, the first-posted one struck: "בשעה ~~20:30~~ 21:00". Null when nothing changed. */
export function eventChangeParts(m: Pick<Message, 'type' | 'fields' | 'changed'>, lang: Lang = 'he'): Array<{ text: string; struck: boolean }> | null {
  if (m.type !== 'event' || !m.changed) return null;
  const w = WORDS[lang];
  const out: Array<{ text: string; struck: boolean }> = [];
  for (const key of ['time', 'date', 'place'] as const) {
    const old = m.changed[key];
    if (old === undefined) continue;
    const now = String(m.fields?.[key] ?? '');
    const show = (v: string) => (key === 'date' ? dualDate(v, lang) : v);
    out.push({ text: `${out.length ? ' · ' : ''}${w[key]} `, struck: false }, { text: show(old), struck: true }, { text: ` ${show(now)}`, struck: false });
  }
  return out.length ? out : null;
}

/** The screen-reader text of `eventChangeParts` (a strike is not read): "בשעה 20:30 ← 21:00". */
export const eventChangeLabel = (parts: Array<{ text: string; struck: boolean }>): string => parts.map(p => (p.struck ? `${p.text} ←` : p.text)).join('');

export const TITLE_MAX = 120;
export const BODY_MAX = 4000;
export const CHAT_MAX = 1000;
const cp = (s: string) => [...s].length;

/** Channels the caller may broadcast to. A conversation channel is written to in its chat view, not here. */
export function postableChannels(channels: Channel[]): Channel[] {
  return channels.filter(c => c.canPost && !c.conversation);
}

/** Only a celebration or a condolence is about a family. */
export const needsTarget = (type: MessageType): boolean => type === 'celebration' || type === 'condolence';

export function canSendChat(body: string, hasImage: boolean): boolean {
  return cp(body) <= CHAT_MAX && (body.trim().length > 0 || hasImage);
}

export type Draft = { type: MessageType; channelId: string | null; title: string; body: string; targetMemberId: string | null; /** The family the blessing is about; goes with one of its adults as `targetMemberId`. */ targetFamilyId?: string | null };

export function canPublish(d: Draft): boolean {
  return !!d.channelId && d.title.trim().length > 0 && cp(d.title) <= TITLE_MAX && cp(d.body) <= BODY_MAX
    && (!needsTarget(d.type) || !!d.targetMemberId);
}

/** The request body; the target goes only with types that take one, empty optional fields are left out. */
export function postBody(d: Draft, imageUploadId: string | undefined, tpl?: { templateId: TemplateId; fields: TemplateFields }): PostMessageBody {
  const out: PostMessageBody = { channelId: d.channelId!, type: d.type, title: d.title.trim() };
  if (d.body.trim()) out.body = d.body;
  if (needsTarget(d.type) && d.targetMemberId) {
    out.targetMemberId = d.targetMemberId;
    if (d.targetFamilyId) out.targetFamilyId = d.targetFamilyId;
  }
  if (imageUploadId) out.imageUploadId = imageUploadId;
  if (tpl) { out.templateId = tpl.templateId; out.fields = tpl.fields; }
  return out;
}
