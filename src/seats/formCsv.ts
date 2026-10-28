/**
 * The old Google Form's responses tab (UX-DESIGN §16.6; pure). Columns are found by the words in their header, never by position, so a
 * reordered or renamed-a-little Form still reads. Timestamps are "M/D/YYYY H:MM:SS" (D/M when the file says so), ISO, or Google's serial
 * numbers; they carry no zone, so everything here compares "wall clock" values (milliseconds as if UTC) and never touches the time zone.
 */
import { MAX_FILE_BYTES } from '../import/parse.ts';
import { normalizeName } from './match.ts';
import { DEFAULT_DEADLINE_HM } from './window.ts';

export type FormEvent = 'erev' | 'day' | 'hag' | 'megila';
/** The Form's three request columns, in this order. Keys of `requests` on the wire. */
export const AREAS = ['נשים · בית הכנסת', 'גברים · אולם', 'נשים · אולם'] as const;
export const FORM_EVENTS: FormEvent[] = ['erev', 'day', 'hag', 'megila'];

export type FormAnswer = {
  /** 1-based line of the file (the header is line 1), for messages. */
  line: number;
  /** Wall-clock milliseconds, null when the cell could not be read. */
  at: number | null;
  name: string;
  /** A blank cell has no entry. */
  counts: Partial<Record<FormEvent, number>>;
  requests: Record<string, number>;
  /** How many earlier answers of the same household this one replaced (set by `latestPerName`). */
  earlier?: number;
};
export type ColumnKey = 'stamp' | 'name' | FormEvent | 'req0' | 'req1' | 'req2';
export type FormParse =
  | { ok: true; answers: FormAnswer[]; columns: Partial<Record<ColumnKey, string>>; unknownHeaders: string[]; unreadable: number; dateOrder: 'mdy' | 'dmy' }
  | { ok: false; problem: 'empty' | 'no-timestamp' | 'no-name' | 'no-counts' };

// ---------------------------------------------------------------- CSV

/** Comma, semicolon or tab separated (decided by the first line); quotes, doubled quotes, newlines inside quotes, a BOM. */
export function splitCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = (() => {
    let q = false, i = 0;
    for (; i < text.length; i++) { const c = text[i]; if (c === '"') q = !q; else if (!q && (c === '\n' || c === '\r')) break; }
    return text.slice(0, i);
  })();
  const count = (ch: string) => { let q = false, n = 0; for (const c of firstLine) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const sep = (['\t', ';', ','] as const).map((ch) => ({ ch, n: count(ch) })).sort((a, b) => b.n - a.n)[0]!;
  const delim = sep.n > 0 ? sep.ch : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, i = 0;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) endCell();
    else if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else if (c === '\n') endRow();
    else cell += c;
    i++;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

// ---------------------------------------------------------------- timestamps

const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
const wall = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number | null => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
};

export function parseStamp(raw: string, order: 'mdy' | 'dmy'): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n >= 30000 && n <= 80000 ? SERIAL_EPOCH + Math.round(n * 86_400_000 / 1000) * 1000 : null;
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return wall(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  const [a, b] = [+m[1]!, +m[2]!];
  return order === 'mdy' ? wall(+m[3]!, a, b, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : wall(+m[3]!, b, a, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

// ---------------------------------------------------------------- columns

const clean = (h: string) => h.normalize('NFKC').replace(/[֑-ׇ‎‏]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Which logical column a header is, by its words. Request columns are checked first: they name an area ("נשים", "גברים", "אולם"). */
export function columnOf(header: string): ColumnKey | null {
  const h = clean(header);
  if (!h) return null;
  if (/חותמת|timestamp/.test(h)) return 'stamp';
  const women = /נשים/.test(h), men = /גברים/.test(h), hall = /אולם/.test(h), shul = /בית הכנסת|ביהכ"נ|ביהכנ/.test(h);
  if (women && (shul || !hall)) return 'req0';
  if (men && hall) return 'req1';
  if (women && hall) return 'req2';
  if (/ערב שבת/.test(h)) return 'erev';
  if (/יום שבת|שבת בבוקר|שחרית/.test(h)) return 'day';
  if (/מגילה/.test(h)) return 'megila';
  if (/(^|\s)חג(\s|$|:|·)/.test(h)) return 'hag';
  if (/^(שם|השם|שם מלא|שם משפחה|שם המשפחה|שם הקהילה|name)(\s|$|:)/.test(h) || h === 'שם') return 'name';
  return null;
}

const toCount = (raw: string): number | null | undefined => {
  const s = raw.trim();
  if (s === '') return undefined;
  return /^\d{1,4}$/.test(s) ? Number(s) : null;
};

export const parseFormCsv = (input: string): FormParse => parseFormTable(splitCsv(input));

/** The same from rows already split (an .xlsx tab read by the importer). */
export function parseFormTable(table: string[][]): FormParse {
  if (table.length === 0) return { ok: false, problem: 'empty' };
  const header = table[0]!;
  const at: Partial<Record<ColumnKey, number>> = {};
  const names: Partial<Record<ColumnKey, string>> = {};
  const unknownHeaders: string[] = [];
  header.forEach((h, i) => {
    const key = columnOf(h);
    if (key && at[key] === undefined) { at[key] = i; names[key] = h.trim(); } else if (h.trim()) unknownHeaders.push(h.trim());
  });
  if (at.stamp === undefined) return { ok: false, problem: 'no-timestamp' };
  if (at.name === undefined) return { ok: false, problem: 'no-name' };
  if (FORM_EVENTS.every((e) => at[e] === undefined)) return { ok: false, problem: 'no-counts' };

  // day-first or month-first: any value above 12 decides; otherwise the Form's own M/D
  let order: 'mdy' | 'dmy' = 'mdy';
  let dayFirst = false, monthFirst = false;
  for (const r of table.slice(1)) {
    const m = /^(\d{1,2})[/.](\d{1,2})[/.]\d{4}/.exec((r[at.stamp] ?? '').trim());
    if (m) { if (+m[1]! > 12) dayFirst = true; if (+m[2]! > 12) monthFirst = true; }
  }
  if (dayFirst && !monthFirst) order = 'dmy';

  let unreadable = 0;
  const answers: FormAnswer[] = [];
  table.slice(1).forEach((r, idx) => {
    const name = (r[at.name!] ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const counts: FormAnswer['counts'] = {};
    for (const e of FORM_EVENTS) {
      if (at[e] === undefined) continue;
      const v = toCount(r[at[e]!] ?? '');
      if (v === null) unreadable++; else if (v !== undefined) counts[e] = v;
    }
    const requests: Record<string, number> = {};
    (['req0', 'req1', 'req2'] as const).forEach((key, n) => {
      if (at[key] === undefined) return;
      const v = toCount(r[at[key]!] ?? '');
      if (v === null) unreadable++; else if (v !== undefined && v > 0) requests[AREAS[n]!] = Math.min(v, 99);
    });
    answers.push({ line: idx + 2, at: parseStamp(r[at.stamp!] ?? '', order), name, counts, requests });
  });
  return { ok: true, answers, columns: names, unknownHeaders, unreadable, dateOrder: order };
}

// ---------------------------------------------------------------- the week

/**
 * The answers of the Shabbat whose Friday is `friday`: after the previous Friday's deadline (`hm`, the Kehila's `seatDeadline`, Israel
 * wall clock) up to and including this Friday's deadline (an answer exactly at a deadline belongs to the earlier week), so a Saturday-night answer counts for the coming Shabbat. Wall clock on both sides, so a week
 * that crosses a clock change needs no hour arithmetic.
 */
export function weekWindow(friday: string, hm = DEFAULT_DEADLINE_HM): { from: number; to: number } {
  const [y, m, d] = friday.split('-').map(Number) as [number, number, number];
  const [h, mi] = hm.split(':').map(Number) as [number, number];
  return { from: Date.UTC(y, m - 1, d - 7, h, mi), to: Date.UTC(y, m - 1, d, h, mi) };
}

/** "HH:MM" in Israel of the server's ISO deadline; the default deadline when it cannot be read. */
export function deadlineHm(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return DEFAULT_DEADLINE_HM;
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(t);
  return `${p.find((x) => x.type === 'hour')!.value}:${p.find((x) => x.type === 'minute')!.value}`;
}

/** True when pasted text is over the file limit (UTF-8 bytes), like the file picker. */
export const textTooBig = (text: string): boolean => new TextEncoder().encode(text).length > MAX_FILE_BYTES;

export function inWeek(answers: FormAnswer[], friday: string, hm = DEFAULT_DEADLINE_HM): { rows: FormAnswer[]; older: number; later: number; undated: number } {
  const { from, to } = weekWindow(friday, hm);
  const out = { rows: [] as FormAnswer[], older: 0, later: 0, undated: 0 };
  for (const a of answers) {
    if (a.at === null) out.undated++;
    else if (a.at <= from) out.older++;
    else if (a.at > to) out.later++;
    else out.rows.push(a);
  }
  return out;
}

/** One answer per household (`key` of its name): the latest by timestamp, a tie going to the later line. `duplicates` counts the replaced ones. */
export function latestPerName(rows: FormAnswer[], key: (name: string) => string = normalizeName): { latest: FormAnswer[]; duplicates: number } {
  const best = new Map<string, FormAnswer>();
  let duplicates = 0;
  for (const a of rows) {
    const k = key(a.name);
    const cur = best.get(k);
    if (!cur) { best.set(k, { ...a, earlier: 0 }); continue; }
    duplicates++;
    const newer = (a.at ?? 0) > (cur.at ?? 0) || ((a.at ?? 0) === (cur.at ?? 0) && a.line > cur.line);
    best.set(k, newer ? { ...a, earlier: (cur.earlier ?? 0) + 1 } : { ...cur, earlier: (cur.earlier ?? 0) + 1 });
  }
  return { latest: [...best.values()].sort((a, b) => a.line - b.line), duplicates };
}

export type AreaTotal = { area: string; seats: number; households: number };
export function areaTotals(rows: FormAnswer[]): AreaTotal[] {
  return AREAS.flatMap((area) => {
    const asking = rows.filter((r) => (r.requests[area] ?? 0) > 0);
    return asking.length ? [{ area, seats: asking.reduce((n, r) => n + r.requests[area]!, 0), households: asking.length }] : [];
  });
}

// ---------------------------------------------------------------- template

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
/** The same columns as the Form, with invented sample rows. UTF-8 with a BOM so Excel shows Hebrew. */
export function formTemplateCsv(): string {
  const head = ['חותמת זמן', 'שם', 'ערב שבת · מקומות שלא אצטרך', 'יום שבת · מקומות שלא אצטרך', 'חג · כמה מהמקומות יתפנו', 'מגילה · כמה מהמקומות יתפנו', ...AREAS];
  const rows = [['10/29/2026 20:41:05', 'בדיוני שמעון', '1', '0', '', '', '', '', ''], ['10/30/2026 8:12:00', 'דוגמה יואב', '2', '2', '', '', '', '1', '']];
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
