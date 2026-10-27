// Pure helpers around the sheet: building it from the session's data, and the print page's URL.
import type { Message } from '../client/types.ts';
import { sheetModel, weekCelebrations } from './sheetModel.ts';
import type { Pinned, SheetModel, SheetVariant } from './sheetModel.ts';
import type { ComputedWeek, ScheduleDoc } from './types.ts';

export type SheetSource = { kehilaName: string; logoUri: string | null; messages: Message[]; pinned?: Pinned | null };

/** The sheet of a computed week. The mazal tov are the `celebration` messages in `source.messages`: a guest whose type rules hide them has none. */
export function buildSheet(doc: ScheduleDoc, computed: ComputedWeek, source: SheetSource, variant: SheetVariant = 'a4'): SheetModel {
  return sheetModel({
    doc, week: computed, kehilaName: source.kehilaName, logoUri: source.logoUri, variant, pinned: source.pinned ?? null,
    celebrations: weekCelebrations(source.messages, computed.week),
  });
}

/** "?print=schedule&week=0|1&variant=a4|square" (fixture params such as role and now are kept so the new tab shows the same Kehila and clock). */
export function printPageUrl(search: string, pathname: string, weekIndex: 0 | 1, variant: SheetVariant = 'a4'): string {
  const q = new URLSearchParams(search);
  q.delete('screen');
  q.set('print', 'schedule');
  q.set('week', String(weekIndex));
  if (variant !== 'a4') q.set('variant', variant); else q.delete('variant');
  return `${pathname}?${q.toString()}`;
}

export type PrintRequest = { weekIndex: 0 | 1; variant: SheetVariant };
export function parsePrintRequest(search: string): PrintRequest | null {
  const q = new URLSearchParams(search);
  if (q.get('print') !== 'schedule') return null;
  return { weekIndex: q.get('week') === '1' ? 1 : 0, variant: q.get('variant') === 'square' ? 'square' : 'a4' };
}
