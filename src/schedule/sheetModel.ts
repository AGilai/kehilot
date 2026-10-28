// The weekly sheet "Classic two columns" (docs/UX-DESIGN.md §14.5, frame P23): the pure model both renderers use
// (Sheet.tsx on screen and the web print page, sheetHtml.ts for the phone's PDF) and the fitting rules. No React.
// The sheet is a printed Hebrew paper by design: its wording is fixed Hebrew, not the app's language.
import { dualDate } from '../dates.ts';
import type { SheetGroup } from '../client/types.ts';
import { candleLine, candleRowTime, clockLabel, dateRange } from './memberView.ts';
import { parashaOf } from './parasha.ts';
import type { ComputedRow, ComputedWeek, ScheduleDoc } from './types.ts';

export type SheetVariant = 'a4' | 'square';

/** Fixed colours: the paper never goes dark. */
export const PAPER = {
  paper: '#FCFCF9', ink: '#151A33', tek: '#2A3F94', soft: '#E7EBF6', line: '#C3CADF', pom: '#A32A47', mute: '#4B516E',
} as const;

export const SHEET_TEXT = {
  title: 'שבת פרשת', titleNoParasha: 'שבת קודש', candles: 'הדלקת נרות', candlesShort: 'נרות', weekdaysDefault: 'ימי החול', shabbatDefault: 'שבת קודש',
  weekdayDays: 'א׳–ה׳', footnote: '* שינוי לשבוע זה', blessing: 'שבת שלום ומבורך', kehila: 'קהילת', mazalTov: 'מזל טוב', more: 'ועוד {n} ברכות באפליקציה', squareFamily: 'משפחת', squareMore: '… ועוד {n}',
} as const;

/** Lines the sheet holds: at most this many mazal tov (condolences count with them) and events; the rest is "ועוד n". */
export const MAX_MAZAL = 6;
export const MAX_EVENTS = 3;

export type Pinned = { title?: string; line?: string; imageUri?: string };

export type SheetRow =
  | { kind: 'row'; id: string; label: string; time: string; override: boolean; gap: boolean }
  | { kind: 'text'; id: string; label: string; override: boolean; gap: boolean };
export type SheetBand = { kind: 'candles'; label: string; cities: Array<{ name: string | null; time: string }> } | { kind: 'dates'; days: string; range: string };
export type SheetColumn = { title: string; band: SheetBand | null; rows: SheetRow[] };
export type MazalPart = { text: string; bold: boolean };
/** One printed line: the main line (the surname bold), the sub line, the blessing, an icon; `cancelled` events keep their line, struck. */
export type SheetLineItem = { id: string; group: SheetGroup; main: MazalPart[]; sub: string; blessing: string; icon: 'heart' | 'star' | null; cancelled: boolean };

export type SheetModel = {
  variant: SheetVariant;
  parasha: string | null;
  hebrewDate: string;
  kehilaName: string;
  initial: string;
  logoUri: string | null;
  shabbat: SheetColumn | null;
  weekday: SheetColumn | null;
  /** Mazal tov, then condolences, in the weekday column. */
  mazalTov: SheetLineItem[];
  /** Events, in the start cell (under the picture, or heading the cell without one). The square sheet has none. */
  events: SheetLineItem[];
  pinned: Pinned | null;
  footnote: boolean;
};

export type SheetInput = {
  doc: ScheduleDoc;
  week: ComputedWeek;
  kehilaName: string;
  logoUri: string | null;
  /** The items in state `in`, in order (the model groups them). */
  items: SheetLineItem[];
  pinned?: Pinned | null;
  variant: SheetVariant;
};

const MORNING_GAP_MINUTES = 180;
const clock = (value: string | null): number | null => {
  const m = value ? /^(\d\d):(\d\d)$/.exec(value) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** A small space before a row when it starts a new group: after a text line, on a new day, or 3+ hours after the previous row. */
function withGaps(rows: ComputedRow[]): SheetRow[] {
  const out: SheetRow[] = [];
  let prev: ComputedRow | null = null;
  rows.forEach((row, i) => {
    const text = row.source === 'text' || row.time === null;
    const override = row.source === 'override';
    const pt = prev ? clock(prev.time) : null;
    const t = clock(row.time);
    let gap = false;
    if (i > 0 && prev) {
      gap = prev.source === 'text' || prev.time === null || (!!row.day && !!prev.day && row.day !== prev.day) || (pt !== null && t !== null && t - pt >= MORNING_GAP_MINUTES);
    }
    out.push(text ? { kind: 'text', id: row.id, label: row.label.he, override, gap } : { kind: 'row', id: row.id, label: row.label.he, time: clockLabel(row.time!), override, gap });
    prev = row;
  });
  return out;
}

/** The title split so the family name is bold; the whole title when the name is not in it. */
export function mazalParts(title: string, family?: string): MazalPart[] {
  const i = family ? title.indexOf(family) : -1;
  if (!family || i < 0) return [{ text: title, bold: false }];
  return [
    ...(i > 0 ? [{ text: title.slice(0, i), bold: false }] : []),
    { text: family, bold: true },
    ...(i + family.length < title.length ? [{ text: title.slice(i + family.length), bold: false }] : []),
  ];
}

export function sheetModel(input: SheetInput): SheetModel {
  const { doc, week, variant } = input;
  const column = (kind: 'shabbat' | 'weekday'): SheetColumn | null => {
    const sections = week.sections.filter(s => s.kind === kind);
    if (!sections.length) return null;
    const rows: ComputedRow[] = [];
    sections.forEach((section, i) => {
      // A second section of the same kind continues the column; its title becomes a text line.
      if (i > 0) rows.push({ id: `${section.id}-title`, label: section.title, time: null, source: 'text' });
      rows.push(...section.rows.filter(r => r.role !== 'candles'));
    });
    let band: SheetBand | null = null;
    if (kind === 'shabbat') {
      const cities = candleLine(doc, week.week, candleRowTime(week)).map(c => ({ name: c.name ? c.name.he : null, time: clockLabel(c.time) }));
      band = cities.length ? { kind: 'candles', label: variant === 'square' ? SHEET_TEXT.candlesShort : SHEET_TEXT.candles, cities } : null;
    } else band = { kind: 'dates', days: SHEET_TEXT.weekdayDays, range: dateRange(week.week.weekdays[0]!, week.week.weekdays[4]!) };
    return { title: sections[0]!.title.he || (kind === 'shabbat' ? SHEET_TEXT.shabbatDefault : SHEET_TEXT.weekdaysDefault), band, rows: withGaps(rows) };
  };
  const shabbat = column('shabbat');
  const weekday = column('weekday');
  const name = input.kehilaName.trim();
  return {
    variant,
    parasha: parashaOf(week.week.shabbat, 'he'),
    hebrewDate: dualDate(week.week.shabbat, 'he', { year: true }),
    kehilaName: name,
    initial: [...name.replace(/^קהילת\s+/, '')][0] ?? '',
    logoUri: input.logoUri,
    shabbat, weekday,
    mazalTov: [...input.items.filter(i => i.group === 'mazal'), ...input.items.filter(i => i.group === 'condolence')],
    events: variant === 'a4' ? input.items.filter(i => i.group === 'events') : [],
    pinned: variant === 'a4' && input.pinned && (input.pinned.imageUri || input.pinned.title || input.pinned.line) ? input.pinned : null,
    footnote: [shabbat, weekday].some(c => c?.rows.some(r => r.override)),
  };
}

// ---- layout numbers shared by the renderers ---------------------------------------------------------------------------

export type SheetFit = {
  rowFont: number;
  mazalFont: number;
  /** 1 = the 4:3 picture at full size; down to 0.3. */
  imageScale: number;
  dropImage: boolean;
  /** The blessing lines are left off (the first step, before anything else shrinks). */
  dropBlessings: boolean;
  /** Mazal tov (and condolence) lines left off to fit, from the end of the first `MAX_MAZAL`. */
  droppedMazal: number;
  /** Event lines left off to fit, from the end of the first `MAX_EVENTS`. */
  droppedEvents: number;
  /** What was left off to fit, for the editor to show: the picture, mazal tov and events (by id). Never dropped silently. Lines over the max are in `out` only. */
  dropped: Array<{ kind: 'image' } | { kind: 'mazal'; id: string } | { kind: 'event'; id: string }>;
  /** Ids of the lines left off, over the max first, then the ones dropped to fit (mazal, then events). */
  out: string[];
  /** `out.length`: the sheet says "ועוד {n} ברכות באפליקציה" when it is above 0. */
  more: number;
  /** Tightest row spacing, the last squeeze before dropping anything. */
  tight: boolean;
  /** Uniform shrink of everything inside the frame (1 = none); below 1 only when the sheet is too long. */
  scale: number;
  /** Too long for the normal steps: the editor shows "הגיליון ארוך מעמוד אחד". */
  overflow: boolean;
};

export type SheetLayout = {
  w: number; h: number; padTop: number; padSide: number; padBottom: number; frameInset: number;
  logo: number; titleSize: number; hdateSize: number; h2Size: number; bandSize: number; bandTimeSize: number;
  rowFont: number; timeFont: number; rowPad: number; gap: number; textFont: number; mazalFont: number; footFont: number; spine: number; colGap: number;
  colW: number; bodyW: number;
};

export function sheetLayout(variant: SheetVariant, fit: Pick<SheetFit, 'rowFont' | 'mazalFont' | 'tight'>): SheetLayout {
  const a = variant === 'a4';
  const w = a ? 595 : 540;
  const padSide = a ? 36 : 24;
  const spine = 22, colGap = 14;
  const bodyW = w - 2 * padSide;
  return {
    w, h: a ? 842 : 540, padTop: a ? 34 : 22, padSide, padBottom: a ? 26 : 16, frameInset: a ? 12 : 8,
    logo: a ? 66 : 44, titleSize: a ? 38 : 28, hdateSize: a ? 12.5 : 11, h2Size: a ? 17 : 14, bandSize: a ? 12.5 : 11, bandTimeSize: a ? 15 : 13,
    rowFont: fit.rowFont, timeFont: fit.rowFont + 0.5, rowPad: fit.tight ? 1.5 : a ? 3.5 : 1.5, gap: fit.tight ? 3 : a ? 7 : 3,
    textFont: a ? Math.min(12.5, fit.rowFont) : Math.min(11, fit.rowFont), mazalFont: fit.mazalFont, footFont: 9.5, spine, colGap,
    colW: (bodyW - spine - 2 * colGap) / 2, bodyW,
  };
}

/** The uniform shrink never goes below this. */
export const SCALE_FLOOR = 0.75;

export const BASE_FIT = (variant: SheetVariant): SheetFit => ({
  rowFont: variant === 'a4' ? 14.5 : 12.5, mazalFont: variant === 'a4' ? 13 : 11.5, imageScale: 1, dropImage: false, dropBlessings: false, droppedMazal: 0, droppedEvents: 0, dropped: [], out: [], more: 0, tight: false, scale: 1, overflow: false,
});

const GLYPH = 0.49; // average Hebrew/digit advance in em, Heebo (measured in Chromium: ~0.47 for running Hebrew)
const LINE = 1.35;

/** Lines `text` takes in `width` pt at `font` pt (greedy word wrap; a word longer than the line breaks). */
export function textLines(text: string, font: number, width: number): number {
  if (!text) return 0;
  const per = Math.max(1, Math.floor(width / (font * GLYPH)));
  let lines = 1, cur = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur === 0) cur = word.length; else if (cur + 1 + word.length <= per) cur += 1 + word.length; else { lines++; cur = word.length; }
    while (cur > per) { lines++; cur -= per; }
  }
  return lines;
}

const timeWidth = (timeFont: number) => 5 * timeFont * GLYPH;

function columnHeight(column: SheetColumn, L: SheetLayout): number {
  let h = L.h2Size * 1.6 + 4;
  const b = column.band;
  if (b) {
    const text = b.kind === 'candles' ? [b.label, ...b.cities.map(c => `${c.name ?? ''} ${c.time}`)].join(' · ') : `${b.days} · ${b.range}`;
    h += textLines(text, L.bandSize, L.colW - 8) * L.bandSize * LINE + 10 + 8;
  }
  for (const row of column.rows) {
    if (row.gap) h += L.gap;
    if (row.kind === 'text') h += textLines(row.label + (row.override ? ' *' : ''), L.textFont, L.colW - 16) * L.textFont * LINE + 6;
    else h += textLines(row.label + (row.override ? ' *' : ''), L.rowFont, L.colW - timeWidth(L.timeFont) - 6 - 14) * L.rowFont * LINE + 2 * L.rowPad;
  }
  return h;
}

/** What the sheet holds with `fit`: the first `MAX_*` lines minus the dropped ones, and the ids left off (a4 only has a max and events). */
export function shownItems(model: SheetModel, fit: Pick<SheetFit, 'droppedMazal' | 'droppedEvents'>): { mazal: SheetLineItem[]; events: SheetLineItem[]; out: string[] } {
  const a = model.variant === 'a4';
  const within = a ? model.mazalTov.slice(0, MAX_MAZAL) : model.mazalTov;
  const withinEvents = model.events.slice(0, MAX_EVENTS);
  const mazal = within.slice(0, within.length - fit.droppedMazal);
  const events = withinEvents.slice(0, withinEvents.length - fit.droppedEvents);
  return {
    mazal, events,
    out: [
      ...model.mazalTov.slice(within.length), ...model.events.slice(withinEvents.length),
      ...within.slice(mazal.length), ...withinEvents.slice(events.length),
    ].map(i => i.id),
  };
}

/** Where the bottom area puts things (a4): the picture and events share the start cell; mazal tov spans both columns only with neither. */
export function placement(model: SheetModel, fit: SheetFit): { note: boolean; events: boolean; mazalSpansBoth: boolean } {
  const p = model.pinned;
  const note = !!p && ((!!p.imageUri && !fit.dropImage) || !!p.title || !!p.line);
  const events = shownItems(model, fit).events.length > 0;
  return { note, events, mazalSpansBoth: !note && !events };
}

const plain = (parts: MazalPart[]) => parts.map(p => p.text).join('');

/** The square sheet's one band: "מזל טוב: משפחת א · משפחת ב · … ועוד n" (four families at most; no events). */
export function squareBand(items: SheetLineItem[]): string {
  if (!items.length) return '';
  const name = (i: SheetLineItem) => i.main.find(p => p.bold)?.text ?? plain(i.main);
  const rest = items.length - 4;
  return `${SHEET_TEXT.mazalTov}: ${items.slice(0, 4).map(i => `${SHEET_TEXT.squareFamily} ${name(i)}`).join(' · ')}${rest > 0 ? ` · ${SHEET_TEXT.squareMore.replace('{n}', String(rest))}` : ''}`;
}

function linesHeight(items: SheetLineItem[], L: SheetLayout, width: number, dropBlessings: boolean): number {
  let h = 0;
  items.forEach((item, i) => {
    const lines = textLines(plain(item.main), L.mazalFont, width - 8) + textLines(item.sub, L.mazalFont, width - 8) + (dropBlessings ? 0 : textLines(item.blessing, L.mazalFont, width - 8));
    h += lines * L.mazalFont * 1.45 + 4 + (i > 0 ? 17 : 0);
  });
  return h;
}
function bandMazalHeight(items: SheetLineItem[], L: SheetLayout): number {
  if (!items.length) return 0;
  return textLines(squareBand(items), L.mazalFont, L.bodyW - 4) * L.mazalFont * 1.45 + 2 + 6 + 6;
}
const noteHeight = (pinned: Pinned, L: SheetLayout, scale: number, dropImage: boolean): number => {
  const caption = (pinned.title ? 17 * 1.4 : 0) + (pinned.line ? textLines(pinned.line, 11, L.colW - 12) * 11 * LINE : 0);
  if (pinned.imageUri && !dropImage) return (L.colW * 3 / 4) * scale + 3 + (caption ? caption + 8 : 0);
  return caption ? caption + 20 : 0;
};

/** Height (pt) the sheet needs with `fit` applied; compare with the page height. Slightly pessimistic on purpose. */
export function neededHeight(model: SheetModel, fit: SheetFit): number {
  const L = sheetLayout(model.variant, fit);
  const a = model.variant === 'a4';
  const header = (a ? 66 : 50) + (a ? 10 : 4);
  const rule = a ? 25 : 17;
  const footer = L.footFont * LINE + (a ? 15 : 11) + 1;
  const cols = Math.max(model.shabbat ? columnHeight(model.shabbat, L) : 0, model.weekday ? columnHeight(model.weekday, L) : 0);
  const shown = shownItems(model, fit);
  const pinned = model.pinned && !(fit.dropImage && !model.pinned.title && !model.pinned.line) ? model.pinned : null;
  const more = shown.out.length ? L.footFont * LINE + 4 : 0;
  let bottom = 0;
  if (a) {
    const place = placement(model, fit);
    const note = pinned ? noteHeight(pinned, L, fit.imageScale, fit.dropImage) : 0;
    const events = shown.events.length ? linesHeight(shown.events, L, L.colW, true) : 0;
    const start = note + (note && events ? 8 : 0) + events;
    const mazal = shown.mazal.length ? linesHeight(shown.mazal, L, place.mazalSpansBoth ? L.bodyW : L.colW, fit.dropBlessings) : 0;
    bottom = start || mazal ? Math.max(start, mazal) + 26 + 4 : 30;
  } else bottom = bandMazalHeight(shown.mazal, L);
  return L.padTop + L.padBottom + (header + rule + cols + bottom + more + footer + 4) * fit.scale;
}

/** The frame's inner box: its size before the uniform shrink (so that after `scale` it fills the page's content area exactly). */
export function innerBox(variant: SheetVariant, fit: Pick<SheetFit, 'scale' | 'rowFont' | 'mazalFont' | 'tight'>): { w: number; h: number } {
  const L = sheetLayout(variant, fit);
  return { w: L.bodyW / fit.scale, h: (L.h - L.padTop - L.padBottom) / fit.scale };
}

/** §14.5 and §19.3: lines over `MAX_MAZAL`/`MAX_EVENTS` are out from the start -> blessings dropped -> mazal tov to 12 -> the picture down to 30% -> row
 *  font down to its floor -> squeeze spacing -> uniform shrink to 82% (overflow) -> drop the picture, then mazal tov (with condolences) from the end,
 *  then events from the end -> shrink to fit (floor 75%). The first step that fits wins. Never a second page, never a clipped row; `overflow` tells
 *  the editor to show the banner, and `out`/`more` say what was left off ("ועוד n ברכות באפליקציה"). */
export function fitSheet(model: SheetModel): SheetFit {
  const a = model.variant === 'a4';
  const dims = sheetLayout(model.variant, BASE_FIT(model.variant));
  const base = BASE_FIT(model.variant);
  const hasBlessings = a && shownItems(model, base).mazal.some(i => i.blessing !== '');
  const steps: SheetFit[] = [{ ...base }];
  const lean = hasBlessings ? { ...base, dropBlessings: true } : base;
  if (hasBlessings) steps.push(lean);
  const small = { ...lean, mazalFont: a ? 12 : 11 };
  steps.push(small);
  if (model.pinned?.imageUri) for (const imageScale of [0.8, 0.6, 0.45, 0.3]) steps.push({ ...small, imageScale });
  const imageScale = model.pinned?.imageUri ? 0.3 : 1;
  const floor = 12.5;
  for (let rowFont = base.rowFont - 0.5; rowFont >= floor - 1e-9; rowFont -= 0.5) steps.push({ ...small, imageScale, rowFont });
  const squeezed = { ...small, imageScale, rowFont: floor, tight: true };
  steps.push(squeezed);
  for (const scale of [0.94, 0.88, 0.82]) steps.push({ ...squeezed, scale, overflow: true });
  const shrunk = { ...squeezed, scale: 0.82, overflow: true };
  const kept = shownItems(model, base);
  if (model.pinned?.imageUri) steps.push({ ...shrunk, dropImage: true });
  for (let n = 1; n <= kept.mazal.length; n++) steps.push({ ...shrunk, dropImage: !!model.pinned?.imageUri, droppedMazal: n });
  for (let n = 1; n <= kept.events.length; n++) steps.push({ ...shrunk, dropImage: !!model.pinned?.imageUri, droppedMazal: kept.mazal.length, droppedEvents: n });
  const named = (step: SheetFit): SheetFit => {
    const shown = shownItems(model, step);
    const within = a ? model.mazalTov.slice(0, MAX_MAZAL) : model.mazalTov;
    const out = shown.out;
    return {
      ...step, out, more: out.length,
      dropped: [
        ...(step.dropImage && model.pinned?.imageUri ? [{ kind: 'image' as const }] : []),
        ...within.slice(shown.mazal.length).map(item => ({ kind: 'mazal' as const, id: item.id })),
        ...model.events.slice(0, MAX_EVENTS).slice(shown.events.length).map(item => ({ kind: 'event' as const, id: item.id })),
      ],
    };
  };
  for (const step of steps) {
    if (neededHeight(model, step) <= dims.h) return named(step);
  }
  // Nothing fits at 82%: shrink until it does, never below 75%; past that the sheet stays `overflow` (the editor says so).
  const last = steps[steps.length - 1]!;
  const content = (neededHeight(model, { ...last, scale: 1 }) - dims.padTop - dims.padBottom);
  return named({ ...last, scale: Math.max(SCALE_FLOOR, Math.min(0.82, Math.floor(((dims.h - dims.padTop - dims.padBottom) / content) * 100) / 100)), overflow: true });
}
