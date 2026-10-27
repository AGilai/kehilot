import type { RoleTag } from './types.ts';

/** Limits the server enforces (server/API.md, role tags). */
export const MAX_TAGS = 20;
export const TAG_NAME_MAX = 24;

export type TagNameCheck = { ok: true; name: string } | { ok: false; error: 'required' | 'tooLong' | 'duplicate' | 'invalid' };

const key = (s: string) => s.trim().toLowerCase();

/** Same rules as the server: trimmed, 1-24 code points, no control or line/bidi-control characters, unique ignoring case. `exceptId`: the tag being renamed. */
export function validateTagName(raw: string, existing: Array<{ tagId: string; name: string }>, exceptId?: string): TagNameCheck {
  const name = raw.trim();
  if (!name) return { ok: false, error: 'required' };
  if ([...name].length > TAG_NAME_MAX) return { ok: false, error: 'tooLong' };
  if (/[\p{Cc}\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/u.test(name)) return { ok: false, error: 'invalid' };
  if (existing.some(x => x.tagId !== exceptId && key(x.name) === key(name))) return { ok: false, error: 'duplicate' };
  return { ok: true, name };
}

export const canAddTag = (existing: unknown[]): boolean => existing.length < MAX_TAGS;

/**
 * Starter suggestions to show. Only while the manage sheet was opened on an empty list (`startedEmpty`); each tap adds one,
 * so the ones already added are left out. A Kehila that opened it with tags never sees them.
 */
export function starterToOffer(suggestions: string[], existing: Array<{ name: string }>, startedEmpty: boolean): string[] {
  if (!startedEmpty) return [];
  const have = new Set(existing.map(x => key(x.name)));
  return suggestions.map(s => s.trim()).filter(s => s && !have.has(key(s)));
}

/** Chips of one person: by name (Hebrew collation), the same everywhere. */
export function sortTags<T extends { name: string }>(tags: T[]): T[] {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** Body of PUT .../members/{userId}/tags: distinct IDs that still exist in the Kehila's list. */
export function assignmentBody(ids: string[], all: Array<{ tagId: string }>): { tagIds: string[] } {
  const known = new Set(all.map(x => x.tagId));
  return { tagIds: [...new Set(ids)].filter(i => known.has(i)) };
}

export const toggleId = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

/** One text for a screen reader instead of one stop per chip. */
export const tagListLabel = (tags: RoleTag[]): string => sortTags(tags).map(x => x.name).join(', ');
