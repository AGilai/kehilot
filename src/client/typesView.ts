import { matchesWords, queryWords, searchNorm } from '../search/normalize.ts';
import type { CachedMessage } from '../search/cache.ts';
import { channelLabel } from './channelsView.ts';
import type { Channel, Message, MessageType, Role, TypeRule, TypeRules } from './types.ts';

/** The one order of types everywhere (UX §12.1). `chat` belongs to conversation channels and is not a type to pick. */
export const TYPE_ORDER = ['general', 'weekly', 'event', 'celebration', 'condolence'] as const;
export type PickableType = (typeof TYPE_ORDER)[number];

/** Compose: exactly the types the server says this person may post in the channel, in the fixed order. */
export function composeTypes(channel: Pick<Channel, 'postableTypes'> | undefined): PickableType[] {
  const allowed = new Set<string>(channel?.postableTypes ?? []);
  return TYPE_ORDER.filter(x => allowed.has(x));
}

/** The channel chip row (and the channel in the message meta line) only exists when there is more than one channel. */
export const showChannelChips = (channels: Pick<Channel, 'channelId'>[]): boolean => channels.length > 1;

/** "{type} · {time}", with the channel in the middle when given (several channels). */
export const metaLine = (type: string, time: string, channel: string | null): string =>
  channel ? `${type} · ${channel} · ${time}` : `${type} · ${time}`;

/**
 * The type chips of the Messages filter. A listener cannot see celebration/condolence while the gabbai
 * hides them (the app does not know the rule), so those two show only once such a message is in hand.
 */
export function filterTypeChips(role: Role | undefined, seen: Pick<Message, 'type'>[]): PickableType[] {
  if (role !== 'listener') return [...TYPE_ORDER];
  const present = new Set(seen.map(m => m.type));
  return TYPE_ORDER.filter(x => (x !== 'celebration' && x !== 'condolence') || present.has(x));
}

/**
 * Text AND types. Text: every word must occur (the cache search's matcher, so niqqud, final letters, quotes
 * and case are ignored); blank text matches all. Types: any of the selected; none selected matches all.
 */
export function filterMessages<M extends Pick<Message, 'type' | 'title' | 'body' | 'authorName' | 'targetName'>>(list: M[], f: { text: string; types: readonly MessageType[] }): M[] {
  const words = queryWords(f.text);
  if (words.length === 0 && f.types.length === 0) return list;
  return list.filter(m => (f.types.length === 0 || f.types.includes(m.type)) && (words.length === 0 || matchesWords(searchNorm(m), words)));
}

/** A message rebuilt from its archive copy: text only, enough for a list row. */
export function fromCached(c: CachedMessage): Message {
  return { messageId: c.messageId, channelId: c.channelId, type: c.type, title: c.title, body: c.body, authorId: '', authorName: c.authorName,
    authorKind: 'management', joinCount: 0, ...(c.targetName ? { targetName: c.targetName } : {}) };
}

/** The feed's matches plus archive hits the feed does not hold, newest first. */
export function mergeArchive(feed: Message[], archive: CachedMessage[]): Message[] {
  const have = new Set(feed.map(m => m.messageId));
  const extra = archive.filter(c => !have.has(c.messageId)).map(fromCached);
  return [...feed, ...extra].sort((a, b) => (a.messageId < b.messageId ? 1 : a.messageId > b.messageId ? -1 : 0));
}

export const DEFAULT_RULE: TypeRule = { post: 'broadcasters', listeners: false };

/** One change in the "message types" settings: always both keys of that type's rule (the server is strict). */
export function typeRuleBody(rules: TypeRules | undefined, type: 'celebration' | 'condolence', patch: Partial<TypeRule>): { typeRules: TypeRules } {
  return { typeRules: { [type]: { ...DEFAULT_RULE, ...rules?.[type], ...patch } } };
}

/** The top line of a message row / detail: "{type} · {time}", the channel in the middle with several channels; chat keeps its channel name. */
export function messageMeta(m: Pick<Message, 'type' | 'channelId'>, channels: Channel[], when: string, t: (key: string) => string): string {
  const c = channels.find(x => x.channelId === m.channelId);
  const name = c ? channelLabel(c, t) : '';
  if (m.type === 'chat') return `${name} · ${when}`;
  return metaLine(t(`compose.types.${m.type}`), when, showChannelChips(channels) ? name : null);
}

/** After a 403 on publish, with the refreshed list of postable types: which text, and whether "change to a regular message" is offered. */
export function refusalBanner(postable: readonly MessageType[], current: MessageType): { text: 'refused' | 'refusedAll'; asGeneral: boolean } {
  if (postable.length === 0) return { text: 'refusedAll', asGeneral: false };
  return { text: 'refused', asGeneral: postable.includes('general') && current !== 'general' };
}
