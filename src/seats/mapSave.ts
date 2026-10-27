/**
 * Load, save and conflict handling of the map editor (UX-DESIGN §16.5), pure of UI (the API is injected). A save carries the version
 * it started from. Before any write the editor checks that version is still the newest one (layout and assignments); a newer one is
 * a conflict, never an overwrite. `rebaseLatest` re-reads the newer version and re-applies the local change set on top of it.
 */
import type { SeatLayout, SeatLayoutRow } from '../client/endpoints.ts';
import { draftFromVersion, layoutBodyOf, assignmentsOf, rebaseOnto, usedHolders } from './editModel.ts';
import type { Draft, Overlap } from './editModel.ts';
import { currentShabbatFriday } from './effectiveFrom.ts';
import { israelDate } from '../dates.ts';
import { runSave } from './runSave.ts';
import type { MadeHolder, SaveApi, SaveCarry, SaveProgress, SaveResult } from './runSave.ts';

/** A version as opened: its date, the guards (`updatedAt` of the layout and of its assignments) and the draft it gave. */
export type Version = { from: string; updatedAt: number; assignUpdatedAt: number | null; draft: Draft };
export type MapApi = SaveApi & {
  layouts(): Promise<SeatLayoutRow[]>;
  layout(from: string): Promise<SeatLayout>;
  assignments(from: string): Promise<{ assignments: Record<string, string>; updatedAt: number | null }>;
};

export async function loadVersion(api: Pick<MapApi, 'layout' | 'assignments'>, from: string): Promise<Version> {
  const [layout, asg] = await Promise.all([api.layout(from), api.assignments(from)]);
  return { from, updatedAt: layout.updatedAt, assignUpdatedAt: asg.updatedAt, draft: draftFromVersion(layout, asg.assignments) };
}

/** Versions earlier than the current Shabbat are read-only on the server (400 layout_in_past). */
export const isPastVersion = (from: string, now: Date): boolean => from < currentShabbatFriday(israelDate(now));

export type HistoryRow = { n: number; from: string; until: string | null; updatedAt: number; seats: number; assigned: number; current: boolean; scheduled: boolean; readOnly: boolean };
/** Newest first. `n` counts from the oldest; `until` is the day before the next version starts' Friday (the next version's date). */
export function historyRows(layouts: SeatLayoutRow[], now: Date): HistoryRow[] {
  const asc = [...layouts].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  return asc.map((l, i) => ({
    n: i + 1, from: l.effectiveFrom, until: asc[i + 1]?.effectiveFrom ?? null, updatedAt: l.updatedAt, seats: l.seats, assigned: l.assigned, current: l.current,
    scheduled: !l.current && l.effectiveFrom > currentShabbatFriday(israelDate(now)) && !asc.some((x) => x.current && x.effectiveFrom >= l.effectiveFrom),
    readOnly: isPastVersion(l.effectiveFrom, now),
  })).reverse();
}
/** The version the editor opens: the one in effect, else the newest. */
export const versionToOpen = (layouts: SeatLayoutRow[]): string | null => layouts.find((l) => l.current)?.effectiveFrom ?? [...layouts].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]?.effectiveFrom ?? null;
/** A future version scheduled after the one open (for the editor's banner). */
export const scheduledAfter = (layouts: SeatLayoutRow[], openFrom: string): string | null => layouts.filter((l) => l.effectiveFrom > openFrom).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0]?.effectiveFrom ?? null;

const conflict = (carry: SaveCarry, stage: 'layout' | 'assignments', code: string): SaveResult => ({ ok: false, stage, code, conflict: true, carry, made: [] });

/** Is the version the draft started from still the newest one? Reads only. */
export async function newerExists(api: Pick<MapApi, 'layouts' | 'assignments'>, base: Version, target: string): Promise<'layout' | 'assignments' | null> {
  if (target !== base.from) return null;
  const row = (await api.layouts()).find((l) => l.effectiveFrom === base.from);
  if (row && row.updatedAt !== base.updatedAt) return 'layout';
  if (row) { const a = await api.assignments(base.from); if (a.updatedAt !== base.assignUpdatedAt) return 'assignments'; }
  return null;
}

/** Save the draft as the version effective from `from` (the opened version's date: in place; another date: a new version). */
export async function saveMap(p: { api: MapApi; draft: Draft; base: Version | null; from: string; carry: SaveCarry; known: MadeHolder[]; overwrite?: boolean; onProgress: (x: SaveProgress) => void }): Promise<SaveResult> {
  const { api, draft, base, from } = p;
  let guard: number | null;
  try {
    const rows = await api.layouts();
    guard = rows.find((l) => l.effectiveFrom === from)?.updatedAt ?? null;
    if (base && !p.overwrite) {
      const stale = await newerExists(api, base, from);
      if (stale && !p.carry.layout) return conflict(p.carry, stale, stale === 'layout' ? 'layout_changed' : 'assignments_changed');
      if (!stale && base.from === from) guard = base.updatedAt;
    }
  } catch (e) {
    const x = e as { code?: unknown } | null;
    return { ok: false, stage: 'layout', code: typeof x?.code === 'string' ? x.code : 'generic', conflict: false, carry: p.carry, made: [] };
  }
  return runSave({ from, layoutGuard: guard, holders: usedHolders(draft), layout: layoutBodyOf(draft), assign: (seats, created) => assignmentsOf(draft, seats, created) }, api, p.carry, p.onProgress, p.known);
}

/** Re-read the newer version of `from` and put the local change set on top of it. The newer version becomes the base. */
export async function rebaseLatest(api: Pick<MapApi, 'layout' | 'assignments'>, base: Version, mine: Draft, from: string, pick: Record<string, 'mine' | 'theirs'> = {}): Promise<{ version: Version; draft: Draft; overlaps: Overlap[] }> {
  const version = await loadVersion(api, from);
  const baseDraft = base.draft;
  const r = rebaseOnto(version.draft, baseDraft, mine, pick);
  return { version, draft: r.draft, overlaps: r.overlaps };
}

/** "27/10 19:42" in Israel time. */
export function whenLabel(ms: number): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `⁦${g('day')}/${g('month')} ${g('hour')}:${g('minute')}⁩`;
}
