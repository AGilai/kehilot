// Pure helpers over the server's weekly sheet items (docs/UX-DESIGN.md §19.3): an item as a sheet line, the printed list, Home's rows.
import { dualDate } from '../dates.ts';
import { MAX_EVENTS, MAX_MAZAL, mazalParts, shownItems } from '../schedule/sheetModel.ts';
import type { SheetFit, SheetModel } from '../schedule/sheetModel.ts';
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

// ---- the management screen (§19.3, P44) ----------------------------------------------------------------------------------

/** The three meters and the fit card's verdict. `n` counts what is on the sheet after the fit; `over` is how many lines it left off. */
export function meters(model: SheetModel, fit: SheetFit): { mazal: { n: number; max: 6 }; events: { n: number; max: 3 }; image: boolean; fits: boolean; over: number } {
  const shown = shownItems(model, fit);
  const over = fit.out.length;
  return {
    mazal: { n: shown.mazal.length, max: MAX_MAZAL as 6 }, events: { n: shown.events.length, max: MAX_EVENTS as 3 },
    image: !!model.pinned?.imageUri && !fit.dropImage, fits: over === 0, over,
  };
}

export type Row = { item: SheetItem; out: boolean; index: number; count: number };

/** What the lists show: the items waiting, the lines in each group (with whether the fit left them off, their place and the group's size) and the removed ones by group. */
export function groupsForScreen(page: SheetPage, fit: SheetFit): { pending: SheetItem[]; mazal: Row[]; condolence: Row[]; events: Row[]; removed: Record<SheetGroup, SheetItem[]> } {
  const out = new Set(fit.out);
  const rows = (group: SheetGroup): Row[] => {
    const list = page.items.filter(i => i.group === group && i.state === 'in');
    return list.map((item, at) => ({ item, out: out.has(item.itemId), index: at + 1, count: list.length }));
  };
  const removed = (group: SheetGroup) => page.items.filter(i => i.group === group && i.state === 'removed');
  return {
    pending: page.items.filter(i => i.state === 'pending'),
    mazal: rows('mazal'), condolence: rows('condolence'), events: rows('events'),
    removed: { mazal: removed('mazal'), condolence: removed('condolence'), events: removed('events') },
  };
}

/** The source Tag of a row: `sheetItems.src.*`; an approved item adds the approver's name. */
export function sourceTag(item: SheetItem, t: (key: string, params?: Record<string, string | number>) => string): { label: string; tone: 'olive' | 'tekhelet' | 'gold' | 'plain' } {
  switch (item.source) {
    case 'auto': return { label: t('sheetItems.src.auto'), tone: 'olive' };
    case 'approved': return { label: item.approvedBy ? `${t('sheetItems.src.approved')} · ${item.approvedBy}` : t('sheetItems.src.approved'), tone: 'olive' };
    case 'byGabbai': return { label: t(item.byRole === 'tech' ? 'sheetItems.src.byTech' : 'sheetItems.src.byGabbai'), tone: 'tekhelet' };
    case 'free': return { label: t('sheetItems.src.free'), tone: 'plain' };
    default: return { label: t('sheetItems.tagPending'), tone: 'gold' };
  }
}

/** The text of the line as the gabbai edits it (both lines, the second after a line break) and its bold token. */
export function lineText(item: SheetItem): { text: string; bold: string } {
  if (item.line) return { text: item.line.text, bold: item.line.bold };
  const line = lineOf(item);
  return { text: [line.main.map(p => p.text).join(''), line.sub].filter(Boolean).join('\n'), bold: line.main.find(p => p.bold)?.text ?? '' };
}

/** What is saved after an edit: the new text with the item's bold token, kept only while the text still holds it. */
export function editLine(item: SheetItem, text: string): { text: string; bold: string } {
  const { bold } = lineText(item);
  return { text, bold: bold && text.includes(bold) ? bold : '' };
}

/** "אתמול 21:10" / "היום 08:40"; further back the short date. Israel time. */
export function relativeWhen(seconds: number, nowMs: number, lang: 'he' | 'en', t: (key: string, params?: Record<string, string | number>) => string): string {
  const tz = 'Asia/Jerusalem';
  const loc = lang === 'en' ? 'en-GB' : 'he-IL';
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
  const clock = new Intl.DateTimeFormat(loc, { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(seconds * 1000));
  const diff = Math.round((Date.parse(day(nowMs)) - Date.parse(day(seconds * 1000))) / 86_400_000);
  if (diff >= 0 && diff <= 1) return t(diff === 0 ? 'sheetItems.when.today' : 'sheetItems.when.yesterday', { time: clock });
  return `${dualDate(day(seconds * 1000), lang)} ${clock}`;
}

/** The list after one item changed (state and/or line); the other items are untouched. Used on the latest list, never on a copy from an older render. */
export function patchItem(items: SheetItem[], itemId: string, patch: Partial<SheetItem>): SheetItem[] {
  return items.map(i => (i.itemId === itemId ? { ...i, ...patch } : i));
}

/** Waiting items over the weeks shown (current, next): the total and the first week that has any. A failed week (`null`) keeps `prev` for both. */
export function sheetPendingOf(weeks: string[], pages: Array<SheetPage | null>, prev: { n: number; week: string | null }): { n: number; week: string | null } {
  if (pages.length !== weeks.length || pages.some(p => !p)) return prev;
  const counts = pages.map(p => p!.items.filter(i => i.state === 'pending').length);
  const first = counts.findIndex(c => c > 0);
  return { n: counts.reduce((a, b) => a + b, 0), week: first >= 0 ? weeks[first]! : null };
}
