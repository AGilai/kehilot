import type { FeedState } from './feed.ts';
import { isMuted, visibleList } from './messageView.ts';
import { TYPE_ORDER, filterMessages, mergeArchive } from './typesView.ts';
import type { CachedMessage } from '../search/cache.ts';
import type { Channel, Message, MessageType, NotifyPrefs } from './types.ts';

/** Pure logic of the Messages filter (UX §12.8): the type control, the counts, the muted switch. */

/** The muted switch is stored where the old "mine / all" choice was: 'all' = muted shown, anything else = not. */
export const showMutedKey = (userId: string, kehilaId: string) => `kehilot.filter.${userId}.${kehilaId}`;
export const showMutedFromStored = (v: string | null): boolean => v === 'all';
export const showMutedToStored = (on: boolean): 'all' | 'mine' => (on ? 'all' : 'mine');

type T = (key: string, params?: Record<string, string | number>) => string;
const SUMMARY_MAX = 22;

/** "אירוע, מזל טוב" (up to two names, at most 22 characters) or "{first} ועוד {n}"; names in the fixed type order. */
export function typeSummary(selected: readonly MessageType[], label: (x: MessageType) => string, t: T): string {
  const names = TYPE_ORDER.filter(x => selected.includes(x)).map(label);
  if (names.length === 0) return '';
  const joined = names.join(', ');
  if (names.length <= 2 && joined.length <= SUMMARY_MAX) return joined;
  return t('messages.type.more', { first: names[0]!, n: names.length - 1 });
}

/** Selection in the fixed order, only types the person can see; everything selected is the same as nothing. */
export function normalizeTypes(selected: readonly MessageType[], visible: readonly MessageType[]): MessageType[] {
  const out = TYPE_ORDER.filter(x => selected.includes(x) && visible.includes(x));
  return out.length === visible.length ? [] : out;
}

export function toggleType(selected: readonly MessageType[], x: MessageType, visible: readonly MessageType[]): MessageType[] {
  return normalizeTypes(selected.includes(x) ? selected.filter(y => y !== x) : [...selected, x], visible);
}

export function typeCounts(rows: readonly Pick<Message, 'type'>[], visible: readonly MessageType[]): { total: number; byType: Record<string, number> } {
  const byType: Record<string, number> = Object.fromEntries(visible.map(x => [x, 0]));
  for (const m of rows) if (m.type in byType) byType[m.type]!++;
  return { total: Object.values(byType).reduce((a, b) => a + b, 0), byType };
}

/** A 0 row is disabled unless already selected, so a selection can always be undone. */
export const rowDisabled = (count: number, selected: boolean): boolean => count === 0 && !selected;

/** i18n key of the sheet's bottom button for `n` results. */
export const showLabel = (n: number): 'common.close' | 'messages.type.showOne' | 'messages.type.show' =>
  n === 0 ? 'common.close' : n === 1 ? 'messages.type.showOne' : 'messages.type.show';

export type FilterState = { text: string; types: MessageType[]; channelId: string | null; showMuted: boolean };
/** "ניקוי הסינון": text, types and channel. The muted switch is a remembered view setting and stays. */
export const clearFilters = (s: FilterState): FilterState => ({ ...s, text: '', types: [], channelId: null });

type Facet = { text: string; channelId: string | null; showMuted: boolean; notify: NotifyPrefs; channels: Channel[] };

/** Mode (muted switch) AND channel AND text, newest first as given; types are left out on purpose (the type list's counts). */
export function facetRows(rows: readonly Message[], f: Facet): Message[] {
  const inScope = rows.filter(m => (f.channelId === null || m.channelId === f.channelId) && (f.showMuted || !isMuted(m, f.notify, f.channels)));
  return filterMessages(inScope, { text: f.text, types: [] });
}

/** Muted rows that match channel, text and the given types: what the switch would add. */
export function mutedCount(rows: readonly Message[], f: Facet, types: readonly MessageType[]): number {
  return filterMessages(rows.filter(m => (f.channelId === null || m.channelId === f.channelId) && isMuted(m, f.notify, f.channels)), { text: f.text, types }).length;
}

/**
 * Every message the person may see, muted ones included, newest first: the feed (all readable channels) plus archive
 * rows the feed does not hold. Archive rows are read (older than the feed window) and keep their author, so the mute
 * rules treat them like feed rows.
 */
export function archiveBase(feed: FeedState, archive: readonly CachedMessage[], notify: NotifyPrefs, channels: Channel[]): Message[] {
  return mergeArchive(visibleList(feed, { mode: 'all', notify, channels }), archive.filter(c => channels.some(x => x.channelId === c.channelId)));
}
