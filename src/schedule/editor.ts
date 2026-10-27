// Pure logic of the gabbai's schedule editor (UX-DESIGN §14.2): the draft and its reducer, validation that mirrors the server
// (server/cloud/schedule_rules.py, same limits and same `field` paths), the save diff, the formula builder's explanation and warnings,
// time-field parsing and the week list. No React here; tests/scheduleEditor.test.ts.
import { anchorDates, formatClock, parseClock, roundMinutes } from './formula.ts';
import { ANCHORS } from './types.ts';
import type {
  Clock, ComputedRow, ComputedWeek, ExtraRow, Formula, Row, RowOverride, Section, ScheduleWeek, ShabbatDay, Text, Time, WeekOverrides, ZmanimFor,
} from './types.ts';
import { evaluate } from './formula.ts';
import { addDays, scheduleWeekOf } from './week.ts';

// ---- limits (server/cloud/schedule_rules.py) ----------------------------------------------------------------------

export const LIMITS = { sections: 12, rows: 40, label: 60, note: 200, overrideRows: 200, extraRows: 40, offsetMinutes: 720 } as const;
const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]');
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const SHABBAT_DAYS = ['friday', 'shabbat'];
const WEEKDAY_DAYS = ['earliest', 'latest'];
const STEPS = [1, 5, 10, 15];
const cp = (value: string) => [...value].length;

// ---- the draft --------------------------------------------------------------------------------------------------

export type Draft = { sections: Section[]; weekOverrides: Record<string, WeekOverrides> };
export type EditorState = {
  /** What the server holds (the diff and "unsaved" are measured against it). */
  saved: Draft;
  draft: Draft;
  /** Earlier drafts for Ctrl+Z, newest last. */
  past: Draft[];
  /** The `updatedAt` the editor loaded (sent back as `ifUpdatedAt`); null = nothing saved yet. */
  updatedAt: number | null;
  /** Key of the last edit: consecutive edits with the same key (typing in one field) are one undo step. */
  lastKey: string | null;
};

export function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canon((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function initialEditorState(doc: { sections: Section[]; weekOverrides: Record<string, WeekOverrides>; updatedAt: number | null }): EditorState {
  const saved: Draft = { sections: doc.sections, weekOverrides: doc.weekOverrides };
  return { saved, draft: saved, past: [], updatedAt: doc.updatedAt, lastKey: null };
}

export const isDirty = (state: EditorState): boolean => canon(state.saved) !== canon(state.draft);

// ---- formula pieces ------------------------------------------------------------------------------------------------

export type FormulaPatch = {
  anchor?: Formula['anchor']; day?: Formula['day']; minutes?: number; direction?: 'before' | 'after';
  roundMode?: 'none' | 'down' | 'up' | 'nearest'; roundStep?: 1 | 5 | 10 | 15;
  notEarlierThan?: Clock | null; notLaterThan?: Clock | null;
};

export function applyFormulaPatch(formula: Formula, patch: FormulaPatch): Formula {
  const out: Formula = { ...formula, offset: { ...formula.offset }, rounding: formula.rounding };
  if (patch.anchor) out.anchor = patch.anchor;
  if (patch.day) out.day = patch.day;
  if (patch.minutes !== undefined && Number.isFinite(patch.minutes)) out.offset.minutes = Math.min(LIMITS.offsetMinutes, Math.max(0, Math.round(patch.minutes)));
  if (patch.direction) out.offset.direction = patch.direction;
  if (patch.roundMode !== undefined) {
    out.rounding = patch.roundMode === 'none' ? { mode: 'none' } : { mode: patch.roundMode, step: patch.roundStep ?? (formula.rounding.mode === 'none' ? 5 : formula.rounding.step) };
  } else if (patch.roundStep !== undefined && formula.rounding.mode !== 'none') {
    out.rounding = { mode: formula.rounding.mode, step: patch.roundStep };
  }
  for (const key of ['notEarlierThan', 'notLaterThan'] as const) {
    if (patch[key] === undefined) continue;
    if (patch[key] === null) delete out[key]; else out[key] = patch[key] as Clock;
  }
  return out;
}

export const defaultFormula = (sectionKind: Section['kind']): Formula => ({
  anchor: 'sunset', day: sectionKind === 'shabbat' ? 'shabbat' : 'earliest', offset: { minutes: 0, direction: 'before' }, rounding: { mode: 'none' },
});
export const timeOfKind = (kind: Time['kind'], sectionKind: Section['kind'], at: Clock = '12:00'): Time =>
  kind === 'none' ? { kind: 'none' } : kind === 'fixed' ? { kind: 'fixed', at } : { kind: 'formula', formula: defaultFormula(sectionKind) };

/** A formula's day source must fit the section it sits in (friday/shabbat vs earliest/latest). */
function fitTime(time: Time, sectionKind: Section['kind']): Time {
  if (time.kind !== 'formula') return time;
  const wanted = sectionKind === 'shabbat' ? SHABBAT_DAYS : WEEKDAY_DAYS;
  return wanted.includes(time.formula.day) ? time : { kind: 'formula', formula: { ...time.formula, day: defaultFormula(sectionKind).day } };
}

// ---- the reducer -----------------------------------------------------------------------------------------------------

export type RowPatch = { label?: Text; note?: string | null; day?: ShabbatDay | null; role?: 'candles' | null };
export type EditorAction =
  | { type: 'reset'; doc: { sections: Section[]; weekOverrides: Record<string, WeekOverrides>; updatedAt: number | null } }
  | { type: 'discard' }
  | { type: 'undo' }
  | { type: 'restore'; draft: Draft }
  | { type: 'saved'; snapshot: Draft; updatedAt: number }
  | { type: 'addSection'; id: string; kind: Section['kind']; title: Text }
  | { type: 'renameSection'; id: string; title: Text; key?: string }
  | { type: 'moveSection'; id: string; delta: number }
  | { type: 'deleteSection'; id: string }
  | { type: 'addRow'; sectionId: string; id: string; label: Text; afterRowId?: string | null; time?: Time; day?: ShabbatDay }
  | { type: 'editRow'; rowId: string; patch: RowPatch; key?: string }
  | { type: 'setTimeKind'; rowId: string; kind: Time['kind']; at?: Clock }
  | { type: 'setFixedTime'; rowId: string; at: Clock; key?: string }
  | { type: 'setFormula'; rowId: string; patch: FormulaPatch; key?: string }
  | { type: 'moveRow'; rowId: string; delta: number }
  | { type: 'moveRowTo'; rowId: string; sectionId: string; index: number }
  | { type: 'duplicateRow'; rowId: string; id: string }
  | { type: 'deleteRow'; rowId: string }
  | { type: 'setOverride'; friday: string; rowId: string; override: RowOverride | null; key?: string }
  | { type: 'addExtra'; friday: string; extra: ExtraRow }
  | { type: 'editExtra'; friday: string; id: string; patch: Partial<Omit<ExtraRow, 'id' | 'sectionId'>>; key?: string }
  | { type: 'deleteExtra'; friday: string; id: string };

const UNDO_LIMIT = 100;

function moved<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list;
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item!);
  return out;
}

function normalizedText(text: Text): Text {
  return text.en === undefined || text.en === '' ? { he: text.he } : { he: text.he, en: text.en };
}

function mapRow(sections: Section[], rowId: string, fn: (row: Row, section: Section) => Row): Section[] {
  return sections.map(section => (section.rows.some(r => r.id === rowId) ? { ...section, rows: section.rows.map(r => (r.id === rowId ? fn(r, section) : r)) } : section));
}

/** Weeks with nothing left in them are dropped, so "back to what was saved" is a clean state. */
function pruned(weekOverrides: Record<string, WeekOverrides>): Record<string, WeekOverrides> {
  const out: Record<string, WeekOverrides> = {};
  for (const [friday, week] of Object.entries(weekOverrides)) {
    const next: WeekOverrides = {};
    if (week.rows && Object.keys(week.rows).length) next.rows = week.rows;
    if (week.extra && week.extra.length) next.extra = week.extra;
    if (next.rows || next.extra) out[friday] = next;
  }
  return out;
}

function withWeek(draft: Draft, friday: string, fn: (week: WeekOverrides) => WeekOverrides): Draft {
  return { ...draft, weekOverrides: pruned({ ...draft.weekOverrides, [friday]: fn(draft.weekOverrides[friday] ?? {}) }) };
}

function editDraft(draft: Draft, action: EditorAction): Draft {
  switch (action.type) {
    case 'addSection':
      return { ...draft, sections: [...draft.sections, { id: action.id, kind: action.kind, title: normalizedText(action.title), rows: [] }] };
    case 'renameSection':
      return { ...draft, sections: draft.sections.map(s => (s.id === action.id ? { ...s, title: normalizedText(action.title) } : s)) };
    case 'moveSection': {
      const from = draft.sections.findIndex(s => s.id === action.id);
      return { ...draft, sections: moved(draft.sections, from, from + action.delta) };
    }
    case 'deleteSection': {
      const gone = draft.sections.find(s => s.id === action.id);
      if (!gone) return draft;
      const rowIds = new Set(gone.rows.map(r => r.id));
      const weekOverrides: Record<string, WeekOverrides> = {};
      for (const [friday, week] of Object.entries(draft.weekOverrides)) {
        const rows = Object.fromEntries(Object.entries(week.rows ?? {}).filter(([id]) => !rowIds.has(id)));
        weekOverrides[friday] = { rows, extra: (week.extra ?? []).filter(e => e.sectionId !== action.id) };
      }
      return { sections: draft.sections.filter(s => s.id !== action.id), weekOverrides: pruned(weekOverrides) };
    }
    case 'addRow': {
      const section = draft.sections.find(s => s.id === action.sectionId);
      if (!section) return draft;
      const row: Row = { id: action.id, label: normalizedText(action.label), time: fitTime(action.time ?? timeOfKind('fixed', section.kind), section.kind) };
      if (action.day && section.kind === 'shabbat') row.day = action.day;
      const at = action.afterRowId ? section.rows.findIndex(r => r.id === action.afterRowId) : -1;
      const rows = section.rows.slice();
      rows.splice(at >= 0 ? at + 1 : rows.length, 0, row);
      return { ...draft, sections: draft.sections.map(s => (s === section ? { ...s, rows } : s)) };
    }
    case 'editRow':
      return {
        ...draft,
        sections: mapRow(draft.sections, action.rowId, row => {
          const next: Row = { ...row };
          const p = action.patch;
          if (p.label) next.label = normalizedText(p.label);
          if (p.note !== undefined) { if (p.note === null || p.note === '') delete next.note; else next.note = p.note; }
          if (p.day !== undefined) { if (p.day === null) delete next.day; else next.day = p.day; }
          if (p.role !== undefined) { if (p.role === null) delete next.role; else next.role = p.role; }
          return next;
        }),
      };
    case 'setTimeKind':
      return {
        ...draft,
        sections: mapRow(draft.sections, action.rowId, (row, section) => (row.time.kind === action.kind ? row : { ...row, time: timeOfKind(action.kind, section.kind, action.at) })),
      };
    case 'setFixedTime':
      return { ...draft, sections: mapRow(draft.sections, action.rowId, row => ({ ...row, time: { kind: 'fixed', at: action.at } })) };
    case 'setFormula':
      return {
        ...draft,
        sections: mapRow(draft.sections, action.rowId, (row, section) => {
          const base = row.time.kind === 'formula' ? row.time.formula : defaultFormula(section.kind);
          return { ...row, time: fitTime({ kind: 'formula', formula: applyFormulaPatch(base, action.patch) }, section.kind) };
        }),
      };
    case 'moveRow': {
      const section = draft.sections.find(s => s.rows.some(r => r.id === action.rowId));
      if (!section) return draft;
      const from = section.rows.findIndex(r => r.id === action.rowId);
      const rows = moved(section.rows, from, from + action.delta);
      return rows === section.rows ? draft : { ...draft, sections: draft.sections.map(s => (s === section ? { ...s, rows } : s)) };
    }
    case 'moveRowTo': {
      const from = draft.sections.find(s => s.rows.some(r => r.id === action.rowId));
      const row = from?.rows.find(r => r.id === action.rowId);
      const target = draft.sections.find(s => s.id === action.sectionId);
      if (!from || !row || !target) return draft;
      let fitted: Row = row;
      if (from.kind !== target.kind) {
        fitted = { ...row, time: fitTime(row.time, target.kind) };
        if (target.kind !== 'shabbat') delete fitted.day;
      }
      const without = (s: Section) => s.rows.filter(r => r.id !== action.rowId);
      return {
        ...draft,
        sections: draft.sections.map(s => {
          if (s === target) { const rows = without(s); rows.splice(Math.max(0, Math.min(action.index, rows.length)), 0, fitted); return { ...s, rows }; }
          return s === from ? { ...s, rows: without(s) } : s;
        }),
      };
    }
    case 'duplicateRow': {
      const section = draft.sections.find(s => s.rows.some(r => r.id === action.rowId));
      const row = section?.rows.find(r => r.id === action.rowId);
      if (!section || !row) return draft;
      const copy: Row = { ...row, id: action.id };
      delete copy.role; // there is one candle-lighting row
      const rows = section.rows.slice();
      rows.splice(rows.indexOf(row) + 1, 0, copy);
      return { ...draft, sections: draft.sections.map(s => (s === section ? { ...s, rows } : s)) };
    }
    case 'deleteRow': {
      if (!draft.sections.some(s => s.rows.some(r => r.id === action.rowId))) return draft;
      const weekOverrides: Record<string, WeekOverrides> = {};
      for (const [friday, week] of Object.entries(draft.weekOverrides)) {
        const rows = Object.fromEntries(Object.entries(week.rows ?? {}).filter(([id]) => id !== action.rowId));
        weekOverrides[friday] = { rows, extra: (week.extra ?? []).map(e => (e.afterRowId === action.rowId ? { ...e, afterRowId: null } : e)) };
      }
      return { sections: draft.sections.map(s => ({ ...s, rows: s.rows.filter(r => r.id !== action.rowId) })), weekOverrides: pruned(weekOverrides) };
    }
    case 'setOverride':
      return withWeek(draft, action.friday, week => {
        const rows = { ...(week.rows ?? {}) };
        if (action.override === null) delete rows[action.rowId];
        else if (action.override.kind === 'hide') rows[action.rowId] = { kind: 'hide' };
        else {
          const o: RowOverride = { kind: 'time', at: action.override.at };
          if (action.override.note) o.note = action.override.note;
          rows[action.rowId] = o;
        }
        return { ...week, rows };
      });
    case 'addExtra':
      return withWeek(draft, action.friday, week => ({ ...week, extra: [...(week.extra ?? []), { ...action.extra, label: normalizedText(action.extra.label) }] }));
    case 'editExtra':
      return withWeek(draft, action.friday, week => ({
        ...week,
        extra: (week.extra ?? []).map(e => {
          if (e.id !== action.id) return e;
          const next: ExtraRow = { ...e, ...action.patch };
          next.label = normalizedText(next.label);
          if (!next.note) delete next.note;
          return next;
        }),
      }));
    case 'deleteExtra':
      return withWeek(draft, action.friday, week => ({ ...week, extra: (week.extra ?? []).filter(e => e.id !== action.id) }));
    default:
      return draft;
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'reset': return initialEditorState(action.doc);
    case 'discard': return { ...state, draft: state.saved, past: [], lastKey: null };
    case 'restore': return { ...state, draft: action.draft, lastKey: null };
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      return previous ? { ...state, draft: previous, past: state.past.slice(0, -1), lastKey: null } : state;
    }
    case 'saved': {
      // Edits made while the save ran stay in the draft and stay dirty.
      return { ...state, saved: action.snapshot, updatedAt: action.updatedAt, lastKey: null };
    }
    default: {
      const draft = editDraft(state.draft, action);
      if (canon(draft) === canon(state.draft)) return state;
      const key = 'key' in action && action.key ? action.key : null;
      const sameStep = key !== null && key === state.lastKey;
      return { ...state, draft, past: sameStep ? state.past : [...state.past, state.draft].slice(-UNDO_LIMIT), lastKey: key };
    }
  }
}

// ---- change counting and the save diff ----------------------------------------------------------------------------------

function rowIndex(draft: Draft): Map<string, { row: Row; section: string }> {
  const out = new Map<string, { row: Row; section: string }>();
  for (const s of draft.sections) for (const row of s.rows) out.set(row.id, { row, section: s.id });
  return out;
}
const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** The "n unsaved changes" number: sections, rows and week entries that differ from what is saved; a reorder counts once per list. */
export function changeCount(state: EditorState): number {
  const { saved, draft } = state;
  let n = 0;
  const savedSections = new Map(saved.sections.map(s => [s.id, s]));
  const draftSections = new Map(draft.sections.map(s => [s.id, s]));
  for (const id of new Set([...savedSections.keys(), ...draftSections.keys()])) {
    const a = savedSections.get(id);
    const b = draftSections.get(id);
    if (!a || !b || a.kind !== b.kind || canon(a.title) !== canon(b.title)) n++;
  }
  const commonSections = (list: Section[], other: Map<string, Section>) => list.filter(s => other.has(s.id)).map(s => s.id);
  if (!sameOrder(commonSections(saved.sections, draftSections), commonSections(draft.sections, savedSections))) n++;
  const savedRows = rowIndex(saved);
  const draftRows = rowIndex(draft);
  for (const id of new Set([...savedRows.keys(), ...draftRows.keys()])) {
    const a = savedRows.get(id);
    const b = draftRows.get(id);
    if (!a || !b || a.section !== b.section || canon(a.row) !== canon(b.row)) n++;
  }
  for (const s of draft.sections) {
    const before = savedSections.get(s.id);
    if (!before) continue;
    const ids = (list: Row[], other: Row[]) => list.filter(r => other.some(o => o.id === r.id) && savedRows.get(r.id)?.section === draftRows.get(r.id)?.section).map(r => r.id);
    if (!sameOrder(ids(before.rows, s.rows), ids(s.rows, before.rows))) n++;
  }
  for (const friday of new Set([...Object.keys(saved.weekOverrides), ...Object.keys(draft.weekOverrides)])) {
    const a = saved.weekOverrides[friday] ?? {};
    const b = draft.weekOverrides[friday] ?? {};
    for (const id of new Set([...Object.keys(a.rows ?? {}), ...Object.keys(b.rows ?? {})])) if (canon(a.rows?.[id]) !== canon(b.rows?.[id])) n++;
    const ea = new Map((a.extra ?? []).map(e => [e.id, e]));
    const eb = new Map((b.extra ?? []).map(e => [e.id, e]));
    for (const id of new Set([...ea.keys(), ...eb.keys()])) if (canon(ea.get(id)) !== canon(eb.get(id))) n++;
  }
  return n;
}

export type SaveDiff = { sections: boolean; weeks: Array<{ friday: string; overrides: WeekOverrides | null }> };
/** What to send: the schedule (full replace) if its sections changed, and each changed week (`null` = delete that week's overrides). */
export function saveDiff(saved: Draft, draft: Draft): SaveDiff {
  const weeks: SaveDiff['weeks'] = [];
  for (const friday of [...new Set([...Object.keys(saved.weekOverrides), ...Object.keys(draft.weekOverrides)])].sort()) {
    if (canon(saved.weekOverrides[friday] ?? null) !== canon(draft.weekOverrides[friday] ?? null)) weeks.push({ friday, overrides: draft.weekOverrides[friday] ?? null });
  }
  return { sections: canon(saved.sections) !== canon(draft.sections), weeks };
}

/** The sections as the server stores them: names and notes trimmed, empty English names and notes left out. */
export function cleanSections(sections: Section[]): Section[] {
  const text = (t: Text): Text => normalizedText({ he: t.he.trim(), en: t.en?.trim() });
  return sections.map(s => ({
    ...s, title: text(s.title),
    rows: s.rows.map(r => {
      const { note, ...rest } = r;
      const out: Row = { ...rest, label: text(r.label) };
      if (note && note.trim()) out.note = note.trim();
      return out;
    }),
  }));
}

// ---- validation -----------------------------------------------------------------------------------------------------------

export type IssueCode = 'required' | 'tooLong' | 'unsafe' | 'range' | 'count' | 'duplicate' | 'format' | 'unknown';
export type Issue = { path: string; code: IssueCode; limit?: number };

class Collector {
  issues: Issue[] = [];
  add(path: string, code: IssueCode, limit?: number) { this.issues.push(limit === undefined ? { path, code } : { path, code, limit }); }
  string(value: unknown, max: number, path: string, required: boolean) {
    if (typeof value !== 'string') { this.add(path, 'format'); return; }
    if (UNSAFE.test(value)) { this.add(path, 'unsafe'); return; }
    const v = value.trim();
    if (required && !v) this.add(path, 'required');
    else if (cp(v) > max) this.add(path, 'tooLong', max);
  }
  text(value: Text | undefined, path: string) {
    if (!value || typeof value !== 'object') { this.add(path, 'format'); return; }
    this.string(value.he, LIMITS.label, `${path}.he`, true);
    if (value.en !== undefined) this.string(value.en, LIMITS.label, `${path}.en`, false);
  }
  clock(value: unknown, path: string) { if (typeof value !== 'string' || !CLOCK.test(value)) this.add(path, 'format'); }
  ident(value: unknown, path: string, seen?: Set<string>) {
    if (typeof value !== 'string' || !ID.test(value)) { this.add(path, 'format'); return; }
    if (seen) { if (seen.has(value)) this.add(path, 'duplicate'); seen.add(value); }
  }
}

function checkTime(c: Collector, time: Time | undefined, path: string, days: string[]) {
  if (!time || typeof time !== 'object') { c.add(path, 'format'); return; }
  if (time.kind === 'none') return;
  if (time.kind === 'fixed') { c.clock(time.at, `${path}.at`); return; }
  if (time.kind !== 'formula') { c.add(`${path}.kind`, 'format'); return; }
  const f = time.formula;
  const p = `${path}.formula`;
  if (!f) { c.add(p, 'format'); return; }
  if (!(ANCHORS as readonly string[]).includes(f.anchor)) c.add(`${p}.anchor`, 'format');
  if (!days.includes(f.day)) c.add(`${p}.day`, 'format');
  const m = f.offset?.minutes;
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > LIMITS.offsetMinutes) c.add(`${p}.offset.minutes`, 'range', LIMITS.offsetMinutes);
  if (f.offset?.direction !== 'before' && f.offset?.direction !== 'after') c.add(`${p}.offset.direction`, 'format');
  const r = f.rounding;
  if (!r || (r.mode !== 'none' && r.mode !== 'down' && r.mode !== 'up' && r.mode !== 'nearest')) c.add(`${p}.rounding.mode`, 'format');
  else if (r.mode !== 'none' && !STEPS.includes((r as { step: number }).step)) c.add(`${p}.rounding.step`, 'format');
  if (f.notEarlierThan !== undefined) c.clock(f.notEarlierThan, `${p}.notEarlierThan`);
  if (f.notLaterThan !== undefined) c.clock(f.notLaterThan, `${p}.notLaterThan`);
}

/** Every problem the server would refuse, with the server's `field` paths (`sections[0].rows[2].time.formula.anchor`). */
export function validateSections(sections: Section[]): Issue[] {
  const c = new Collector();
  if (sections.length > LIMITS.sections) { c.add('sections', 'count', LIMITS.sections); return c.issues; }
  const sectionIds = new Set<string>();
  const rowIds = new Set<string>();
  sections.forEach((s, i) => {
    const path = `sections[${i}]`;
    c.ident(s.id, `${path}.id`, sectionIds);
    c.text(s.title, `${path}.title`);
    if (s.rows.length > LIMITS.rows) c.add(`${path}.rows`, 'count', LIMITS.rows);
    s.rows.forEach((row, j) => {
      const rp = `${path}.rows[${j}]`;
      c.ident(row.id, `${rp}.id`, rowIds);
      c.text(row.label, `${rp}.label`);
      if (row.note !== undefined) c.string(row.note, LIMITS.note, `${rp}.note`, false);
      if (row.day !== undefined && (s.kind !== 'shabbat' || !SHABBAT_DAYS.includes(row.day))) c.add(`${rp}.day`, 'format');
      checkTime(c, row.time, `${rp}.time`, s.kind === 'shabbat' ? SHABBAT_DAYS : WEEKDAY_DAYS);
    });
  });
  return c.issues;
}

/** Overrides of one week; paths as the server reports them (`rows.<id>.at`, `extra[0].label.he`). */
export function validateWeekOverrides(overrides: WeekOverrides): Issue[] {
  const c = new Collector();
  const rows = overrides.rows ?? {};
  if (Object.keys(rows).length > LIMITS.overrideRows) c.add('rows', 'count', LIMITS.overrideRows);
  for (const [id, o] of Object.entries(rows)) {
    const path = `rows.${id}`;
    if (!ID.test(id)) { c.add('rows.<id>', 'format'); continue; }
    if (o.kind === 'time') { c.clock(o.at, `${path}.at`); if (o.note !== undefined) c.string(o.note, LIMITS.note, `${path}.note`, false); }
  }
  const extra = overrides.extra ?? [];
  if (extra.length > LIMITS.extraRows) { c.add('extra', 'count', LIMITS.extraRows); return c.issues; }
  const seen = new Set<string>();
  extra.forEach((e, i) => {
    const path = `extra[${i}]`;
    c.ident(e.id, `${path}.id`, seen);
    c.ident(e.sectionId, `${path}.sectionId`);
    if (e.afterRowId) c.ident(e.afterRowId, `${path}.afterRowId`);
    c.text(e.label, `${path}.label`);
    if (e.note !== undefined) c.string(e.note, LIMITS.note, `${path}.note`, false);
    checkTime(c, e.time, `${path}.time`, [...SHABBAT_DAYS, ...WEEKDAY_DAYS]);
  });
  return c.issues;
}

export type IssueControl = 'sections' | 'rows' | 'id' | 'title' | 'label' | 'note' | 'rowDay' | 'time' | 'anchor' | 'day' | 'minutes' | 'direction' | 'rounding' | 'notEarlierThan' | 'notLaterThan';
export type IssueTarget = { sectionId: string | null; rowId: string | null; control: IssueControl };

function controlOf(rest: string): IssueControl {
  if (rest === 'id') return 'id';
  if (rest.startsWith('label')) return 'label';
  if (rest === 'note') return 'note';
  if (rest === 'day') return 'rowDay';
  if (rest.startsWith('time.formula.anchor')) return 'anchor';
  if (rest.startsWith('time.formula.day')) return 'day';
  if (rest.startsWith('time.formula.offset.minutes')) return 'minutes';
  if (rest.startsWith('time.formula.offset')) return 'direction';
  if (rest.startsWith('time.formula.rounding')) return 'rounding';
  if (rest.startsWith('time.formula.notEarlierThan')) return 'notEarlierThan';
  if (rest.startsWith('time.formula.notLaterThan')) return 'notLaterThan';
  return 'time';
}

/** Which section/row and which control a server (or local) `field` path points at, so the editor can mark it. */
export function issueTarget(path: string, sections: Section[]): IssueTarget {
  const m = /^sections\[(\d+)\](?:\.(.*))?$/.exec(path);
  if (!m) return { sectionId: null, rowId: null, control: 'sections' };
  const section = sections[Number(m[1])];
  if (!section) return { sectionId: null, rowId: null, control: 'sections' };
  const rest = m[2] ?? '';
  const r = /^rows(?:\[(\d+)\])?(?:\.(.*))?$/.exec(rest);
  if (r) {
    const row = r[1] !== undefined ? section.rows[Number(r[1])] : undefined;
    if (!row) return { sectionId: section.id, rowId: null, control: 'rows' };
    return { sectionId: section.id, rowId: row.id, control: controlOf(r[2] ?? '') };
  }
  return { sectionId: section.id, rowId: null, control: rest.startsWith('title') ? 'title' : rest === 'id' ? 'id' : 'title' };
}

/** The same for `invalid_overrides` paths: the row (rows.<id>.…) or the extra row (extra[i].…) and the control. */
export function overrideIssueTarget(path: string, overrides: WeekOverrides): { rowId: string | null; extraId: string | null; control: IssueControl } {
  const r = /^rows\.([^.]+)(?:\.(.*))?$/.exec(path);
  if (r) return { rowId: r[1]!, extraId: null, control: r[2] === 'note' ? 'note' : 'time' };
  const e = /^extra\[(\d+)\](?:\.(.*))?$/.exec(path);
  const extra = e ? overrides.extra?.[Number(e[1])] : undefined;
  if (extra) return { rowId: null, extraId: extra.id, control: controlOf(e![2] ?? '') };
  return { rowId: null, extraId: null, control: 'rows' };
}

// ---- time fields -------------------------------------------------------------------------------------------------------------

/** "830", "8:30", "08:30", "0830", "8.30" -> "08:30"; anything else null. */
export function parseClockInput(input: string): Clock | null {
  const text = input.trim().replace('.', ':');
  let h: string;
  let m: string;
  const colon = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (colon) { h = colon[1]!; m = colon[2]!; } else if (/^\d{3,4}$/.test(text)) { h = text.slice(0, -2); m = text.slice(-2); } else return null;
  const hh = Number(h);
  const mm = Number(m);
  return hh > 23 || mm > 59 ? null : formatClock(hh * 60 + mm);
}

export function nudgeClock(clock: Clock, delta: number): Clock {
  const at = parseClock(clock) ?? 0;
  return formatClock(Math.min(1439, Math.max(0, at + delta)));
}

export function nextId(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
export const takenIds = (draft: Draft): Set<string> => {
  const out = new Set<string>();
  for (const s of draft.sections) { out.add(s.id); for (const r of s.rows) out.add(r.id); }
  for (const w of Object.values(draft.weekOverrides)) for (const e of w.extra ?? []) out.add(e.id);
  return out;
};

// ---- the result box ------------------------------------------------------------------------------------------------------------

const wrap = (minutes: number) => formatClock(((minutes % 1440) + 1440) % 1440);

export type Explanation = {
  /** The anchor on each day the formula looks at (Friday / Shabbat: one; Sun-Thu: five). */
  days: Array<{ date: string; anchor: Clock | null }>;
  /** Index in `days` of the day the result comes from (the earliest or the latest). */
  pick: number;
  steps: { anchor: Clock; afterOffset: Clock; rounded: Clock };
  /** A bound that decided the result, or null. */
  bound: 'notEarlierThan' | 'notLaterThan' | null;
  result: Clock | null;
};

export function explainFormula(formula: Formula, week: ScheduleWeek, zmanimFor: ZmanimFor): Explanation | null {
  const days = anchorDates(formula, week).map(date => ({ date, anchor: zmanimFor(date)?.[formula.anchor] ?? null }));
  const minutes = days.map(d => (d.anchor === null ? null : parseClock(d.anchor)));
  if (!days.length || minutes.some(m => m === null)) return null;
  const values = minutes as number[];
  const target = formula.day === 'latest' ? Math.max(...values) : Math.min(...values);
  const pick = values.indexOf(target);
  const offset = target + (formula.offset.direction === 'before' ? -1 : 1) * formula.offset.minutes;
  const rounded = roundMinutes(offset, formula.rounding);
  const earliest = formula.notEarlierThan ? parseClock(formula.notEarlierThan) : null;
  const latest = formula.notLaterThan ? parseClock(formula.notLaterThan) : null;
  const afterEarliest = earliest !== null ? Math.max(rounded, earliest) : rounded;
  const bound = latest !== null && afterEarliest > latest ? 'notLaterThan' : earliest !== null && rounded < earliest ? 'notEarlierThan' : null;
  return { days, pick, steps: { anchor: formatClock(target), afterOffset: wrap(offset), rounded: wrap(rounded) }, bound, result: evaluate(formula, week, zmanimFor) };
}

export type FormulaWarningCode = 'afterSunset' | 'earlyEnd' | 'lateCandles' | 'boundsCross' | 'boundWins';
export type FormulaWarning = { code: FormulaWarningCode; params: Record<string, string>; fix?: FormulaPatch };

/** Info-level warnings (never block saving): the direction risks of rounding, crossing bounds, a bound that always decides. */
export function formulaWarnings(formula: Formula, _kind: Section['kind'], week: ScheduleWeek, zmanimFor: ZmanimFor): FormulaWarning[] {
  const out: FormulaWarning[] = [];
  const e = explainFormula(formula, week, zmanimFor);
  const minutes = (c: Clock | null) => (c === null ? null : parseClock(c));
  const result = minutes(e?.result ?? null);
  const roundsLater = formula.rounding.mode === 'up' || formula.rounding.mode === 'nearest';
  const roundsEarlier = formula.rounding.mode === 'down' || formula.rounding.mode === 'nearest';
  const exact = e ? minutes(evaluate({ ...formula, rounding: { mode: 'none' } }, week, zmanimFor)) : null;
  const atAnchor = formula.offset.minutes === 0;

  if (e && result !== null && formula.anchor === 'sunset' && formula.offset.direction === 'before') {
    const sunset = e.days[e.pick]!.anchor!;
    if (result > parseClock(sunset)!) {
      const hit: FormulaWarning = { code: 'afterSunset', params: { time: e.result!, sunset, date: e.days[e.pick]!.date } };
      if (roundsLater) hit.fix = { roundMode: 'down' };
      out.push(hit);
    }
  }
  if (e && result !== null && exact !== null && (formula.anchor === 'shabbatEnd' || formula.anchor === 'tzeit') && (atAnchor || formula.offset.direction === 'after') && roundsEarlier && result < exact) {
    out.push({ code: 'earlyEnd', params: { time: e.result!, exact: formatClock(exact) }, fix: { roundMode: 'up' } });
  }
  if (e && result !== null && exact !== null && formula.anchor === 'candleLighting' && (atAnchor || formula.offset.direction === 'before') && roundsLater && result > exact) {
    out.push({ code: 'lateCandles', params: { time: e.result!, exact: formatClock(exact) }, fix: { roundMode: 'down' } });
  }
  const lo = formula.notEarlierThan ? parseClock(formula.notEarlierThan) : null;
  const hi = formula.notLaterThan ? parseClock(formula.notLaterThan) : null;
  if (lo !== null && hi !== null && lo > hi) out.push({ code: 'boundsCross', params: { earliest: formula.notEarlierThan!, latest: formula.notLaterThan! } });
  if ((lo !== null || hi !== null) && e) {
    const perDay = e.days.map(d => {
      const base = parseClock(d.anchor!)! + (formula.offset.direction === 'before' ? -1 : 1) * formula.offset.minutes;
      return roundMinutes(base, formula.rounding);
    });
    const outside = (v: number) => (lo !== null && v < lo) || (hi !== null && v > hi);
    if (perDay.every(outside)) out.push({ code: 'boundWins', params: {} });
  }
  return out;
}

// ---- a sheet that is too long -----------------------------------------------------------------------------------------------------

/** Rows worth hiding for a week, best first: text-only rows, then the longest names; never the candle row. */
export function hideSuggestions(week: ComputedWeek, limit: number): ComputedRow[] {
  const rows = week.sections.flatMap(s => s.rows).filter(r => r.role !== 'candles');
  const score = (r: ComputedRow) => (r.source === 'text' ? 1000 : 0) + cp(r.label.he);
  return rows.map((row, i) => ({ row, i })).sort((a, b) => score(b.row) - score(a.row) || a.i - b.i).slice(0, limit).map(x => x.row);
}

// ---- weeks ---------------------------------------------------------------------------------------------------------------------------

const offsetHours = (date: string): number => {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).formatToParts(new Date(`${date}T12:00:00Z`)).find(p => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  return Number(/GMT([+-]\d+)/.exec(part)?.[1] ?? 2);
};

/** 'summer' / 'winter' when Israel's clocks change at the start of or inside the week (the day before Friday counts: the switch is at 02:00). */
export function clockChangeIn(week: ScheduleWeek): 'summer' | 'winter' | null {
  const before = offsetHours(addDays(week.friday, -1));
  for (let i = 0; i <= 6; i++) {
    const now = offsetHours(addDays(week.friday, i));
    if (now !== before) return now > before ? 'summer' : 'winter';
  }
  return null;
}

export type WeekItem = { friday: string; shabbat: string; thursday: string; upcoming: boolean; clockChange: 'summer' | 'winter' | null };
/** The weeks the picker offers: from the current schedule week on; the first whose Shabbat has not passed is "the coming Shabbat". */
export function weekList(today: string, count: number): WeekItem[] {
  const start = scheduleWeekOf(today).friday;
  let upcomingSeen = false;
  return Array.from({ length: count }, (_, i) => {
    const w = scheduleWeekOf(addDays(start, i * 7));
    const upcoming = !upcomingSeen && w.shabbat >= today;
    if (upcoming) upcomingSeen = true;
    return { friday: w.friday, shabbat: w.shabbat, thursday: w.thursday, upcoming, clockChange: clockChangeIn(w) };
  });
}

/** The server sends week overrides for the current and the next schedule week only; those are the weeks "this week only" can be edited for. */
export function weekEditable(friday: string, today: string): boolean {
  const current = scheduleWeekOf(today).friday;
  return friday === current || friday === addDays(current, 7);
}

// ---- the classic structure --------------------------------------------------------------------------------------------------------------

/** "Start from the classic layout": Shabbat and weekday rows with the usual formulas (the editor marks them "to check"). */
export function classicSections(): Section[] {
  const row = (id: string, he: string, en: string, time: Time, more: Partial<Row> = {}): Row => ({ id, label: { he, en }, time, ...more });
  const at = (clock: Clock): Time => ({ kind: 'fixed', at: clock });
  const formula = (anchor: Formula['anchor'], day: Formula['day'], minutes: number, direction: 'before' | 'after', rounding: Formula['rounding'] = { mode: 'none' }): Time =>
    ({ kind: 'formula', formula: { anchor, day, offset: { minutes, direction }, rounding } });
  return [
    { id: 'shabbat', kind: 'shabbat', title: { he: 'שבת קודש', en: 'Shabbat' }, rows: [
      row('candles', 'הדלקת נרות', 'Candle lighting', formula('candleLighting', 'friday', 0, 'before'), { role: 'candles', day: 'friday' }),
      row('kabbalat', 'מנחה וקבלת שבת', 'Mincha and Kabbalat Shabbat', formula('candleLighting', 'friday', 10, 'after', { mode: 'nearest', step: 5 }), { day: 'friday' }),
      row('shacharit', 'שחרית', 'Shacharit', at('08:30')),
      row('classes', 'שיעורים לאחר התפילה', 'Classes after the service', { kind: 'none' }),
      row('mincha-s', 'מנחה', 'Mincha', formula('sunset', 'shabbat', 40, 'before', { mode: 'down', step: 5 })),
      row('shabbat-end', 'צאת השבת', 'Shabbat ends', formula('shabbatEnd', 'shabbat', 0, 'before', { mode: 'up', step: 1 })),
    ] },
    { id: 'weekday', kind: 'weekday', title: { he: 'תפילות ימי החול', en: 'Weekday prayers' }, rows: [
      row('w-shacharit1', 'שחרית מניין א׳', 'Shacharit, first minyan', at('06:15')),
      row('w-shacharit2', 'שחרית מניין ב׳', 'Shacharit, second minyan', at('08:00')),
      row('w-mincha', 'מנחה', 'Mincha', formula('sunset', 'earliest', 15, 'before', { mode: 'down', step: 5 })),
      row('w-arvit', 'ערבית', 'Maariv', formula('tzeit', 'latest', 0, 'after', { mode: 'up', step: 5 })),
    ] },
  ];
}
