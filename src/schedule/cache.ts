import type { ScheduleDoc } from './types.ts';

export const scheduleCacheKey = (kehilaId: string) => `kehilot.schedule.v1.${kehilaId}`;

/** A saved copy is only used if it is a schedule document (sections array) with a saved-at time. */
export function parseCached(raw: string | null): { doc: ScheduleDoc; savedAt: number } | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value.savedAt === 'number' && value.doc && Array.isArray(value.doc.sections) && value.doc.location && value.doc.sheet) return value;
  } catch { /* a corrupt copy is no copy */ }
  return null;
}
