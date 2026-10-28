// Pure helpers over the server's weekly sheet items (docs/UX-DESIGN.md §19.3): an item as a sheet line, the printed list, Home's rows.
import { mazalParts } from '../schedule/sheetModel.ts';
import { buildSheetLine } from './templates.ts';
import type { SheetLine } from './templates.ts';
import type { SheetGroup, SheetItem, SheetPage } from './types.ts';

/** The line the sheet prints for `item`: a stored override line (first line main with the bold part, second line sub), else the template. */
export function lineOf(item: SheetItem): SheetLine {
  const icon = item.type === 'celebration' ? 'heart' : null;
  if (item.line) {
    const [first = '', ...rest] = item.line.text.split('\n');
    return { main: mazalParts(first, item.line.bold || undefined), sub: rest.join(' ').trim(), blessing: '', icon, cancelled: false };
  }
  if (item.message) return buildSheetLine(item.message);
  return { main: [], sub: '', blessing: '', icon, cancelled: false };
}

/** What the printed sheet and Home hold: the items in state `in`, in the server's order. */
export const inItems = (page: SheetPage): SheetItem[] => page.items.filter(i => i.state === 'in');

const ORDER: SheetGroup[] = ['mazal', 'condolence', 'events'];

/** Home's rows: mazal tov, then condolences, then events (each group in its order), at most `max`; `more` is what is left out. */
export function homeRows(items: SheetItem[], max = 5): { rows: SheetItem[]; more: number } {
  const ordered = ORDER.flatMap(g => items.filter(i => i.group === g));
  return { rows: ordered.slice(0, max), more: Math.max(0, ordered.length - max) };
}
