import type { ScheduleDoc } from './types.ts';

export const SCHEDULE_CACHE_PREFIX = 'kehilot.schedule.v1.';
export const scheduleCacheKey = (kehilaId: string) => `${SCHEDULE_CACHE_PREFIX}${kehilaId}`;

/** A saved copy is only used if it is a schedule document (sections array) with a saved-at time. */
export function parseCached(raw: string | null): { doc: ScheduleDoc; savedAt: number } | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value.savedAt === 'number' && value.doc && Array.isArray(value.doc.sections) && value.doc.location && value.doc.sheet) return value;
  } catch { /* a corrupt copy is no copy */ }
  return null;
}

export type ScheduleState =
  | { status: 'loading' }
  | { status: 'ready'; doc: ScheduleDoc; /** Set when the doc is the copy kept on this device (the fetch failed): when it was saved. */ cachedAt: number | null }
  | { status: 'error' };

/** What a screen may show for `kehilaId`: state loaded for another Kehila reads as loading, never as stale data. */
export function stateFor(held: { kehilaId: string | null; state: ScheduleState }, kehilaId: string | null): ScheduleState {
  return held.kehilaId === kehilaId ? held.state : { status: 'loading' };
}
