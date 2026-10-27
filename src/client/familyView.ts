import type { FamilyView, TargetFamily } from './types.ts';

export const MAX_CHILDREN = 20;
const MIN_BIRTH = '1900-01-01'; // same range as the server (families.clean_child)

/** Typed `d.m.yyyy` (or `dd.mm.yyyy`) → `YYYY-MM-DD`. Empty is allowed. `today` is `YYYY-MM-DD`. */
export function parseBirthDate(typed: string, today: string): { ok: string } | { error: 'invalid' | 'future' } {
  const s = typed.trim();
  if (!s) return { ok: '' };
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (!m) return { error: 'invalid' };
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) return { error: 'invalid' };
  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (iso < MIN_BIRTH) return { error: 'invalid' };
  if (iso > today) return { error: 'future' };
  return { ok: iso };
}

/** `YYYY-MM-DD` → `d.m.yyyy`. */
export function formatBirthDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}.${m}.${y}`;
}

export type FamilyState = 'linked' | 'received' | 'sent' | 'declined' | 'expired' | 'alone';

/** What the action area of the family card shows, in priority order. */
export function familyState(v: FamilyView): FamilyState {
  if (v.adults.length > 1) return 'linked';
  if (v.received.length > 0) return 'received';
  if (v.sent?.state === 'pending') return 'sent';
  if (v.sent?.state === 'declined') return 'declined';
  if (v.sent?.state === 'expired') return 'expired';
  return 'alone';
}

export const canAddChild = (v: FamilyView): boolean => v.children.length < MAX_CHILDREN;

const collator = new Intl.Collator('he');

/** Blessing-picker rows: one per family, the name over the adults' first names (never children), sorted by name. */
export function familyRows(rows: TargetFamily[], t: (key: string, p?: Record<string, string | number>) => string): { id: string; title: string; subtitle: string }[] {
  return [...rows].sort((a, b) => collator.compare(a.name, b.name)).map(f => ({
    id: f.familyId,
    title: f.name,
    subtitle: f.firstNames.length >= 2 ? t('compose.familyAnd', { a: f.firstNames[0]!, b: f.firstNames[1]! }) : (f.firstNames[0] ?? ''),
  }));
}

/** The picker search: the family name or any adult's first name contains the typed text. */
export function filterFamilies(rows: TargetFamily[], q: string): TargetFamily[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(f => f.name.toLowerCase().includes(s) || f.firstNames.some(n => n.toLowerCase().includes(s)));
}
