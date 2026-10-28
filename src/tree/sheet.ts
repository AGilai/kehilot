import { barMitzvahSuggestion, batMitzvahDate, fromGregorian, monthsOf, shabbatOfWeek, toGregorian } from './dates.ts';
import type { ShabbatInfo } from './dates.ts';
import { MAX_GENERATIONS_UP, childrenOf, fatherOf, motherOf, tribeOf } from './relations.ts';
import type { FigureOptions, HebDate, MonthKey, Person, Relation, Tribe } from './types.ts';

// Pure state of the person sheet (UX-DESIGN §17.4). The sheet edits a Draft of one figure; `commit` writes it back into the
// whole `people` list (what PUT tree takes), creating or filling a parent figure when a missing parent name is typed.

export type Target = { id: string } | { create: { relation: Relation; of?: string; gender: 'm' | 'f' } };
/** A date being picked: any part may still be empty. Only day + month (year optional) is stored. */
export type DatePart = { day?: number; month?: MonthKey; year?: number };
export type BarMitzvah = NonNullable<Person['barMitzvah']>;
export type Draft = {
  id: string; relation: Relation; of?: string; gender: 'm' | 'f';
  hebrewFirst: string; surname: string; fatherName: string; motherName: string;
  tribe?: Tribe; birth: DatePart; deceased: boolean; ill: boolean; death: DatePart;
  barMitzvah?: BarMitzvah; figure?: FigureOptions;
};
export type SheetState = {
  /** The tree as loaded; the draft is applied on top of it by `commit`. */
  base: Person[]; draft: Draft; isNew: boolean;
  /** The first name as saved (to tell whether the name changed). */
  savedFirst: string;
  /** The draft as opened (what "changed" is measured against). */
  initial: Draft;
  /** The birth date changed while a hand-picked Shabbat is kept: ask whether to take the new suggestion. */
  takePrompt: boolean;
  /** A status button was pressed to turn ON: the inline question is open (§17.4, §17.15). */
  ask: 'deceased' | 'ill' | null;
};
export type SheetAction =
  | { type: 'text'; key: 'hebrewFirst' | 'surname' | 'fatherName' | 'motherName'; value: string }
  | { type: 'gender'; gender: 'm' | 'f' }
  | { type: 'tribe'; tribe: Tribe }
  | { type: 'birth'; part: DatePart }
  | { type: 'alive'; deceased: boolean }
  | { type: 'ill'; ill: boolean }
  /** The round candle / heart: on asks first (`ask`), off applies at once. */
  | { type: 'toggleStatus'; what: 'deceased' | 'ill' }
  | { type: 'confirmStatus' }
  | { type: 'cancelStatus' }
  | { type: 'death'; part: DatePart }
  | { type: 'shabbat'; info: ShabbatInfo }
  | { type: 'takeSuggestion' }
  | { type: 'keepManual' }
  | { type: 'figure'; figure: FigureOptions | undefined }
  /** The tree was reloaded underneath (somebody else saved): keep the draft, write it onto the new tree. */
  | { type: 'rebase'; base: Person[] };

const find = (tree: Person[], id?: string) => (id ? tree.find(p => p.id === id) : undefined);
const clean = (s?: string) => (s ?? '').trim();
const selfOf = (tree: Person[]) => tree.find(p => p.relation === 'self');
const spouseOf = (tree: Person[]) => tree.find(p => p.relation === 'spouse');

// --- dates -----------------------------------------------------------------------------------------------------

/** The Hebrew years the server accepts. */
const YEAR_RANGE = [5000, 6000] as const;
const MAX_DAYS: Record<MonthKey, number> = { nisan: 30, iyar: 29, sivan: 30, tamuz: 29, av: 30, elul: 29, tishrei: 30, cheshvan: 30, kislev: 30, tevet: 29, shevat: 30, adar: 29, adar_i: 30, adar_ii: 29 };
/** The last day of a Hebrew month; with a year, cheshvan/kislev are checked against the real calendar. */
export function maxDay(month: MonthKey, year?: number): number {
  if (year === undefined || !monthsOf(year).includes(month)) return MAX_DAYS[month];
  for (const day of [30, 29]) { try { toGregorian({ day, month, year }); return day; } catch { /* next */ } }
  return 29;
}
/** The stored form of a picked date: day and month are required, the year is optional. Anything less is not a date yet. */
export function dateOfPart(p: DatePart): HebDate | undefined {
  if (!p.day || !p.month) return undefined;
  return p.year !== undefined ? { day: p.day, month: p.month, year: p.year } : { day: p.day, month: p.month };
}
const partOf = (d?: HebDate): DatePart => (d ? { ...d } : {});
/** A picked change applied: an Adar that does not exist in the chosen year, or a day past the month's end, is cleared (never
 *  silently moved to another Adar or day). */
export function patchPart(prev: DatePart, patch: DatePart): DatePart {
  const next: DatePart = { ...prev, ...patch };
  for (const k of Object.keys(patch) as (keyof DatePart)[]) if (patch[k] === undefined) delete next[k];
  if (next.year !== undefined && next.month && !monthsOf(next.year).includes(next.month)) delete next.month;
  if (next.day && next.month && next.day > maxDay(next.month, next.year)) delete next.day;
  return next;
}
const isoOfPart = (p: DatePart): string | undefined => { const d = dateOfPart(p); if (!d || d.year === undefined) return undefined; try { return toGregorian(d); } catch { return undefined; } };

// --- who is whose ------------------------------------------------------------------------------------------------

/** The couple a new person descends from (father first). */
function parentsOfNew(base: Person[], relation: Relation, of?: string): { father?: Person; mother?: Person } {
  if (relation === 'child') {
    const adults = [selfOf(base), spouseOf(base)].filter((p): p is Person => !!p);
    return { father: adults.find(p => p.gender === 'm'), mother: adults.find(p => p.gender === 'f') };
  }
  if (relation === 'grandchild') {
    const child = find(base, of);
    const spouse = base.find(p => p.relation === 'childSpouse' && p.of === of);
    const pair = [child, spouse].filter((p): p is Person => !!p);
    return { father: pair.find(p => p.gender === 'm'), mother: pair.find(p => p.gender === 'f') };
  }
  return {};
}
/** Whose surname a new person takes: the father's (a child, a grandchild) or the husband's (a wife). */
function surnameFor(base: Person[], relation: Relation, of: string | undefined, gender: 'm' | 'f'): string {
  if (relation === 'child' || relation === 'grandchild') { const { father, mother } = parentsOfNew(base, relation, of); return clean(father?.surname) || clean(mother?.surname); }
  if (gender === 'f' && (relation === 'spouse' || relation === 'childSpouse')) {
    const husband = relation === 'spouse' ? selfOf(base) : find(base, of);
    return husband?.gender === 'm' ? clean(husband.surname) : '';
  }
  if (relation === 'father') return clean(find(base, of)?.gender === 'm' ? find(base, of)?.surname : '');
  return '';
}
/** A new son copies his father's tribe now (§17.5); it is stored on him and editable from then on. */
function tribeFor(base: Person[], relation: Relation, of: string | undefined, gender: 'm' | 'f'): Tribe | undefined {
  if (gender !== 'm' || relation !== 'child') return undefined;
  const father = parentsOfNew(base, relation, of).father;
  return father ? tribeOf(base, father.id) : undefined;
}

export function startSheet(base: Person[], target: Target, newId: string): SheetState {
  if ('id' in target) {
    const p = find(base, target.id);
    if (!p) throw new Error(`no such person: ${target.id}`);
    const draft: Draft = {
      id: p.id, relation: p.relation, of: p.of, gender: p.gender,
      hebrewFirst: clean(p.hebrewFirst), surname: clean(p.surname), fatherName: clean(p.fatherName), motherName: clean(p.motherName),
      tribe: p.tribe, birth: partOf(p.birth), deceased: !!p.deceased, ill: !!p.ill && !p.deceased, death: partOf(p.death), barMitzvah: p.barMitzvah, figure: p.figure,
    };
    return { base, draft, initial: draft, isNew: false, savedFirst: draft.hebrewFirst, takePrompt: false, ask: null };
  }
  const { relation, of, gender } = target.create;
  const draft: Draft = {
    id: newId, relation, of, gender, hebrewFirst: '', surname: surnameFor(base, relation, of, gender), fatherName: '', motherName: '',
    tribe: tribeFor(base, relation, of, gender), birth: {}, deceased: false, ill: false, death: {},
  };
  return { base, draft, initial: draft, isNew: true, savedFirst: '', takePrompt: false, ask: null };
}

// --- the bar mitzvah -----------------------------------------------------------------------------------------------

/** Boys on the tree as our children get a bar mitzvah Shabbat; nobody else (§17.4: grandchildren and others have no card). */
export const hasBarMitzvah = (d: Pick<Draft, 'relation' | 'gender'>) => d.relation === 'child' && d.gender === 'm';
export const hasBatMitzvah = (d: Pick<Draft, 'relation' | 'gender'>) => d.relation === 'child' && d.gender === 'f';

/** The suggested Shabbat for a draft's birth date; undefined while the birth is not a full valid date. */
export function suggestionOf(d: Draft): ShabbatInfo | undefined {
  const birth = dateOfPart(d.birth);
  if (!hasBarMitzvah(d) || !birth || birth.year === undefined) return undefined;
  try { return barMitzvahSuggestion(birth); } catch { return undefined; }
}
const stored = (info: ShabbatInfo, manual: boolean): BarMitzvah => ({ date: info.date, parasha: info.parasha, manual, ...(info.parasha ? {} : { label: info.label }) });
const barSuggested = (d: Draft): BarMitzvah | undefined => { const s = suggestionOf(d); return s ? stored(s, false) : undefined; };
/** The girl's bat mitzvah date (ISO), information only. */
export function batMitzvahOf(d: Draft): string | undefined {
  const birth = dateOfPart(d.birth);
  if (!hasBatMitzvah(d) || !birth || birth.year === undefined) return undefined;
  try { return batMitzvahDate(birth); } catch { return undefined; }
}

/** After a birth change: a suggestion follows the birth date; a hand-picked Shabbat is kept, and the user is asked. */
function syncBarMitzvah(prev: SheetState, draft: Draft): SheetState {
  if (!hasBarMitzvah(draft)) return { ...prev, draft: { ...draft, barMitzvah: undefined }, takePrompt: false };
  const suggestion = suggestionOf(draft);
  const bm = draft.barMitzvah;
  if (bm?.manual) return { ...prev, draft, takePrompt: !!suggestion && suggestion.date !== bm.date };
  return { ...prev, draft: { ...draft, barMitzvah: suggestion ? stored(suggestion, false) : undefined }, takePrompt: false };
}

export function sheetReducer(s: SheetState, a: SheetAction): SheetState {
  const d = s.draft;
  switch (a.type) {
    case 'text': return { ...s, draft: { ...d, [a.key]: a.value } };
    case 'gender': {
      if (a.gender === d.gender) return s;
      // The server rejects a tribe and a bar mitzvah on a woman: they go when the gender changes, and a son copies the father's tribe again.
      const next: Draft = { ...d, gender: a.gender, tribe: a.gender === 'f' ? undefined : tribeFor(s.base, d.relation, d.of, 'm'), barMitzvah: undefined };
      return syncBarMitzvah(s, next);
    }
    case 'tribe': return d.gender === 'm' ? { ...s, draft: { ...d, tribe: a.tribe } } : s;
    case 'birth': return syncBarMitzvah(s, { ...d, birth: patchPart(d.birth, a.part) });
    // Deceased clears ill (the heart is for the living); going back to living does not turn it on again.
    case 'alive': return { ...s, ask: null, draft: { ...d, deceased: a.deceased, ill: a.deceased ? false : d.ill, death: a.deceased ? d.death : {} } };
    case 'ill': return { ...s, ask: null, draft: { ...d, ill: a.ill && !d.deceased } };
    case 'toggleStatus': {
      if (a.what === 'ill' && d.deceased) return s;
      const on = a.what === 'ill' ? d.ill : d.deceased;
      if (!on) return { ...s, ask: a.what };
      return sheetReducer({ ...s, ask: null }, a.what === 'ill' ? { type: 'ill', ill: false } : { type: 'alive', deceased: false });
    }
    case 'confirmStatus':
      if (!s.ask) return s;
      return sheetReducer(s, s.ask === 'ill' ? { type: 'ill', ill: true } : { type: 'alive', deceased: true });
    case 'cancelStatus': return { ...s, ask: null };
    case 'death': return d.deceased ? { ...s, draft: { ...d, death: patchPart(d.death, a.part) } } : s;
    case 'shabbat': {
      if (!hasBarMitzvah(d)) return s;
      // Choosing the suggestion itself is not "by hand".
      const suggestion = suggestionOf(d);
      return { ...s, draft: { ...d, barMitzvah: stored(a.info, !(suggestion && suggestion.date === a.info.date)) }, takePrompt: false };
    }
    case 'takeSuggestion': {
      const suggestion = suggestionOf(d);
      return { ...s, draft: { ...d, barMitzvah: suggestion ? stored(suggestion, false) : undefined }, takePrompt: false };
    }
    case 'keepManual': return { ...s, takePrompt: false };
    case 'figure': return { ...s, draft: { ...d, figure: a.figure } };
    case 'rebase': return { ...s, base: a.base };
  }
}

/** What the family picked in the Shabbat picker: a Shabbat (set it), or a weekday (offer that week's Shabbat). */
export type PickResult = { kind: 'shabbat'; info: ShabbatInfo } | { kind: 'weekday'; day: number; hebrew: HebDate; shabbat: ShabbatInfo };
const SHABBAT_DAY = 6;
/** `iso`: the picked Gregorian day (a Hebrew pick is converted first). */
export function pickShabbat(iso: string): PickResult {
  const day = new Date(`${iso}T12:00:00`).getDay();
  const info = shabbatOfWeek(iso);
  if (day === SHABBAT_DAY) return { kind: 'shabbat', info };
  return { kind: 'weekday', day, hebrew: fromGregorian(iso), shabbat: info };
}
/** The Gregorian day of a Hebrew picker value; undefined while it is incomplete or invalid. */
export const isoOfHebrew = (p: DatePart): string | undefined => isoOfPart(p);

// --- parents ---------------------------------------------------------------------------------------------------------

function depthOf(tree: Person[], p: Person): number {
  let steps = 0;
  for (let cur: Person | undefined = p; cur && (cur.relation === 'father' || cur.relation === 'mother') && steps <= MAX_GENERATIONS_UP + 1; steps++) cur = find(tree, cur.of);
  return steps;
}
/** Whose father/mother this person's own sheet asks for: the two adults, their ancestors (figures, up to 6 generations; the
 *  last generation keeps typed text) and a child's spouse (typed, no figure drawn). Children and grandchildren take theirs from us. */
export function parentFields(d: Pick<Draft, 'relation'>): boolean { return d.relation !== 'child' && d.relation !== 'grandchild' && d.relation !== 'formerSpouse'; }
const parentFiguresAllowed = (tree: Person[], p: { id: string; relation: Relation }) =>
  (p.relation === 'self' || p.relation === 'spouse' || p.relation === 'father' || p.relation === 'mother') && depthOf(tree, p as Person) < MAX_GENERATIONS_UP;

export type ParentField =
  | { mode: 'tree'; name: string; figureId: string }       // the figure has a name: read-only, "מהעץ"
  | { mode: 'typed'; fillsFigure: boolean }                // editable; fillsFigure: also saved on the parent figure
  | { mode: 'none' };
export function parentField(state: SheetState, which: 'father' | 'mother'): ParentField {
  const { base, draft } = state;
  if (!parentFields(draft)) return { mode: 'none' };
  const figure = (which === 'father' ? fatherOf : motherOf)(base, draft.id);
  const fixed = state.isNew ? undefined : figure;
  // For a child or grandchild the parents are us (no fields); a figure of an existing person is found through `of`.
  if (fixed && clean(fixed.hebrewFirst)) return { mode: 'tree', name: clean(fixed.hebrewFirst), figureId: fixed.id };
  return { mode: 'typed', fillsFigure: parentFiguresAllowed(base, draft) };
}

// --- commit --------------------------------------------------------------------------------------------------------

const isParent = (p: Person) => p.relation === 'father' || p.relation === 'mother';
const strip = (p: Person): Person => {
  const out: Person = { ...p };
  for (const k of ['hebrewFirst', 'surname', 'fatherName', 'motherName'] as const) if (!clean(out[k])) delete out[k]; else out[k] = clean(out[k]);
  if (!out.tribe || out.gender !== 'm') delete out.tribe;
  if (!out.birth) delete out.birth;
  if (!out.deceased) { delete out.deceased; delete out.death; }
  if (!out.ill || out.deceased) delete out.ill;
  if (!out.barMitzvah || out.gender !== 'm') delete out.barMitzvah;
  if (!out.figure) delete out.figure;
  if (out.of === undefined) delete out.of;
  return out;
};

/** The whole tree with the draft written in. `mkId` makes the id of a parent figure created from a typed name. */
export function commit(state: SheetState, mkId: () => string): Person[] {
  const { base, draft: d } = state;
  const existing = find(base, d.id);
  const person: Person = {
    ...(existing ?? { id: d.id, relation: d.relation, gender: d.gender }), gender: d.gender,
    hebrewFirst: d.hebrewFirst, surname: d.surname, tribe: d.gender === 'm' ? d.tribe : undefined,
    birth: dateOfPart(d.birth), deceased: d.deceased, ill: d.ill && !d.deceased, death: d.deceased ? dateOfPart(d.death) : undefined,
    barMitzvah: hasBarMitzvah(d) ? (d.barMitzvah?.manual ? d.barMitzvah : barSuggested(d)) : undefined, figure: d.figure,
  };
  if (d.of !== undefined) person.of = d.of;
  const extra: Person[] = [];
  let people = base.filter(p => p.id !== d.id);
  if (parentFields(d)) {
    const allowed = parentFiguresAllowed(base, d);
    for (const which of ['father', 'mother'] as const) {
      const name = clean(which === 'father' ? d.fatherName : d.motherName);
      const key = which === 'father' ? 'fatherName' : 'motherName';
      const figure = existing && !state.isNew ? (which === 'father' ? fatherOf : motherOf)(base, d.id) : undefined;
      if (allowed) {
        // One source of truth: the name lives on the parent's figure, never on the child as well.
        delete person[key];
        if (figure && clean(figure.hebrewFirst)) continue; // read-only "מהעץ": the field was not editable
        if (name && figure) people = people.map(p => (p.id === figure.id ? { ...p, hebrewFirst: name } : p));
        else if (name) extra.push({ id: mkId(), relation: which, of: d.id, gender: which === 'father' ? 'm' : 'f', hebrewFirst: name, ...(which === 'father' && d.gender === 'm' && d.surname ? { surname: d.surname } : {}) });
      } else if (name) person[key] = name; else delete person[key];
    }
  }
  const at = base.findIndex(p => p.id === d.id);
  const result = at >= 0 ? [...people.slice(0, at), person, ...people.slice(at)] : [...people, person];
  return [...result, ...extra].map(strip);
}

/** How many children's computed names read this person's name (§17.4 "The feed, shown"). */
export const feedCount = (tree: Person[], id: string): number => childrenOf(tree, id).length;
/** The banner before saving: the first name changed and somebody else's name reads it. */
export function feedWarning(state: SheetState): number {
  if (state.isNew && !clean(state.draft.hebrewFirst)) return 0;
  if (clean(state.draft.hebrewFirst) === state.savedFirst) return 0;
  return feedCount(state.base, state.draft.id);
}

// --- remove and clear -------------------------------------------------------------------------------------------

/** Children and spouses can be removed; the two adults (and a spouse with an account) and parents cannot. */
export function canRemove(p: Person): boolean {
  if (p.userId) return false;
  return p.relation === 'child' || p.relation === 'childSpouse' || p.relation === 'grandchild' || p.relation === 'spouse' || p.relation === 'formerSpouse';
}
/** Parents keep their slot: "ניקוי הפרטים". */
export const canClear = (p: Person): boolean => isParent(p) && !p.userId;
/** Remove a figure and everything that hangs from it (`of`): a child's spouse and grandchildren, a spouse's ancestors. */
export function removePerson(tree: Person[], id: string): Person[] {
  const gone = new Set<string>([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of tree) if (!gone.has(p.id) && p.relation !== 'self' && p.of && gone.has(p.of)) { gone.add(p.id); grew = true; }
  }
  return tree.filter(p => !gone.has(p.id));
}
/** A parent's figure keeps its place, its parents' figures and its figure choice is dropped with the rest of its details. */
export function clearPerson(tree: Person[], id: string): Person[] {
  return tree.map(p => (p.id === id ? { id: p.id, relation: p.relation, gender: p.gender, ...(p.of !== undefined ? { of: p.of } : {}) } : p));
}

// --- checks ------------------------------------------------------------------------------------------------------

export type SheetError = 'yearRange' | 'partialBirth' | 'partialDeath' | 'birthFuture' | 'deathFuture' | 'deathBeforeBirth';
/** What would be rejected by the server (or is not a date yet); `today` is an ISO day. */
export function sheetErrors(d: Draft, today: string): SheetError[] {
  const out: SheetError[] = [];
  const partial = (p: DatePart) => (p.day !== undefined || p.month !== undefined || p.year !== undefined) && !dateOfPart(p);
  if (partial(d.birth)) out.push('partialBirth');
  if (d.deceased && partial(d.death)) out.push('partialDeath');
  const outside = (p: DatePart) => p.year !== undefined && (p.year < YEAR_RANGE[0] || p.year > YEAR_RANGE[1]);
  if (outside(d.birth) || (d.deceased && outside(d.death))) { out.push('yearRange'); return out; }
  const born = isoOfPart(d.birth);
  const died = d.deceased ? isoOfPart(d.death) : undefined;
  if (born && born > today) out.push('birthFuture');
  if (died && died > today) out.push('deathFuture');
  if (born && died && died < born) out.push('deathBeforeBirth');
  return out;
}

const canon = (v: unknown): string => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
/** True when the user changed something (a new figure always saves). */
const trimmed = (d: Draft): Draft => ({ ...d, hebrewFirst: clean(d.hebrewFirst), surname: clean(d.surname), fatherName: clean(d.fatherName), motherName: clean(d.motherName) });
export const isDirty = (state: SheetState): boolean => state.isNew || canon(trimmed(state.draft)) !== canon(trimmed(state.initial));
