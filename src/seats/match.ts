/**
 * Suggest which Kehila household a pasted family might be (pure). Nothing is ever linked here: every result is a
 * suggestion for a gabbai to confirm (spec, Global Constraints; UX-DESIGN §16.3).
 */

const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/**
 * For COMPARISON only: final letters folded (ך→כ …), niqqud/cantillation dropped, geresh/gershayim/quotes removed,
 * maqaf and dashes become spaces, other punctuation stripped, spaces collapsed.
 */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[֑-ֽֿ-ׇ]/g, '')
    .replace(/[‎‏‪-‮⁦-⁩﻿​]/g, '')
    .replace(/[׳״'"‘’“”`´]/g, '')
    .replace(/[־\-‐-―−]/g, ' ')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c)
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const PREFIX = /^(משפחת|משפחה|משפ|בית)\s+/;
/**
 * The surname as written, plus (only when the name has more than one word) the form without a "משפחת"/"בית" prefix.
 * The stripped form is a candidate for comparison only: "בית הלל" never turns into "הלל" unless a household called
 * "הלל" is actually being compared.
 */
function surnameVariants(name: string): string[] {
  const n = normalizeName(name);
  const stripped = n.replace(PREFIX, '');
  return stripped !== n && stripped ? [n, stripped] : [n];
}
const sameName = (a: string[], b: string[]) => a.some((x) => x !== '' && b.includes(x));
const letters = (k: string) => k.replace(/\s/g, '').length;
/** Spelling-variant key: full/defective spelling (ו, י dropped), final א/ה dropped, doubled letters merged. */
export function spellingKey(name: string): string {
  return normalizeName(name)
    .split(' ')
    .map((w) => w.replace(/[\u05D5\u05D9]/g, '').replace(/[\u05D0\u05D4]$/, '').replace(/(.)\1+/g, '$1'))
    .join(' ');
}
/** Spelling keys that are long enough (>= 3 letters) to mean something. */
const spellingKeys = (name: string) => surnameVariants(name).map(spellingKey).filter((k) => letters(k) >= 3);
/** "בדיוני ש." / "משפחת בדיוני" → surname variants + optional initial. */
function splitHolderName(name: string): { surnames: string[]; initial?: string } {
  const n = normalizeName(name);
  const t = n.split(' ');
  const last = t[t.length - 1] ?? '';
  if (t.length >= 2 && /^[\u05D0-\u05EA]$/.test(last)) return { surnames: surnameVariants(t.slice(0, -1).join(' ')), initial: last };
  return { surnames: surnameVariants(n) };
}
const firstLetter = (s?: string) => (s ? normalizeName(s).charAt(0) : '');
const digits = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-9);

export type PastedFamily = { familyKey: string; family: string; initial?: string; phone?: string };
export type KehilaFamily = {
  id: string;
  lastName: string;
  /** The head's and the spouse's first names: an initial matches either. */
  firstName?: string;
  spouseFirstName?: string;
  phone?: string;
  /** Already holds seats on the map: ranks lower among equals. */
  holdsSeats?: boolean;
};
/** A seat holder without an account. */
export type Holder = { id: string; name: string; phone?: string };

export type MatchWhy = 'surname-initial' | 'phone' | 'phone-surname' | 'spelling' | 'surname-only' | 'surname-other-initial' | 'same-holder';
export type MatchLevel = 'exact' | 'likely' | 'none';
export type MatchCandidate = {
  kind: 'family' | 'holder';
  id: string;
  /** Display name of the candidate. */
  name: string;
  level: 'exact' | 'likely';
  why: MatchWhy;
  /** Short Hebrew reason for the gabbai. */
  whyText: string;
  holdsSeats: boolean;
};
export type MatchResult = {
  familyKey: string;
  level: MatchLevel;
  /** Several exact candidates for one family: nothing is preselectable. */
  ambiguous: boolean;
  candidates: MatchCandidate[];
};

const WHY_TEXT: Record<MatchWhy, string> = {
  'surname-initial': 'אותו שם משפחה ואות ראשונה של השם הפרטי',
  phone: 'אותו מספר טלפון',
  'phone-surname': 'אותו טלפון ואותו שם משפחה',
  spelling: 'שם משפחה באיות אחר',
  'surname-only': 'אותו שם משפחה (אין אות להשוואה)',
  'surname-other-initial': 'אותו שם משפחה, אות שונה: אולי בן משפחה אחר',
  'same-holder': 'מחזיק מקום שכבר קיים באותו שם',
};
const RANK: Record<MatchWhy, number> = { 'phone-surname': 6, 'surname-initial': 5, 'same-holder': 5, phone: 4, spelling: 3, 'surname-only': 2, 'surname-other-initial': 1 };

export function suggestMatches(familiesInPaste: PastedFamily[], kehilaFamilies: KehilaFamily[], holders: Holder[] = []): MatchResult[] {
  return familiesInPaste.map((p) => {
    const sur = surnameVariants(p.family);
    const spell = spellingKeys(p.family);
    const ini = firstLetter(p.initial);
    const phone = digits(p.phone);
    const found: (MatchCandidate & { rank: number })[] = [];
    const add = (c: Omit<MatchCandidate, 'whyText' | 'level'> & { level: 'exact' | 'likely' }) =>
      found.push({ ...c, whyText: WHY_TEXT[c.why], rank: RANK[c.why] });

    for (const f of kehilaFamilies) {
      const sameSurname = sameName(surnameVariants(f.lastName), sur);
      const sameSpelling = !sameSurname && sameName(spellingKeys(f.lastName), spell);
      const samePhone = phone.length >= 7 && digits(f.phone) === phone;
      const name = `${f.lastName}${f.firstName ? ' ' + f.firstName : ''}`;
      const base = { kind: 'family' as const, id: f.id, name, holdsSeats: !!f.holdsSeats };
      const initials = [firstLetter(f.firstName), firstLetter(f.spouseFirstName)].filter(Boolean);
      if (samePhone && (sameSurname || sameSpelling)) add({ ...base, level: 'exact', why: 'phone-surname' });
      else if (samePhone) add({ ...base, level: 'likely', why: 'phone' });
      else if (sameSurname && ini && initials.includes(ini)) add({ ...base, level: 'exact', why: 'surname-initial' });
      else if (sameSurname && ini && initials.length) add({ ...base, level: 'likely', why: 'surname-other-initial' });
      else if (sameSurname) add({ ...base, level: 'likely', why: 'surname-only' });
      else if (sameSpelling) add({ ...base, level: 'likely', why: 'spelling' });
    }
    for (const h of holders) {
      const hn = splitHolderName(h.name);
      const sameSurname = sameName(hn.surnames, sur);
      const sameSpelling = !sameSurname && sameName(hn.surnames.map(spellingKey).filter((k) => letters(k) >= 3), spell);
      const samePhone = phone.length >= 7 && digits(h.phone) === phone;
      const base = { kind: 'holder' as const, id: h.id, name: h.name, holdsSeats: true };
      const iniEq = (hn.initial ?? '') === ini;
      if (samePhone && (sameSurname || sameSpelling)) add({ ...base, level: 'exact', why: 'phone-surname' });
      else if (samePhone) add({ ...base, level: 'likely', why: 'phone' });
      else if (sameSurname && iniEq) add({ ...base, level: 'exact', why: 'same-holder' });
      else if (sameSurname) add({ ...base, level: 'likely', why: 'surname-other-initial' });
      else if (sameSpelling) add({ ...base, level: 'likely', why: 'spelling' });
    }
    // higher rank first; among equals, households not yet holding seats first; then registered before holders; stable by id
    found.sort((a, b) => b.rank - a.rank || Number(a.holdsSeats) - Number(b.holdsSeats) || (a.kind === b.kind ? 0 : a.kind === 'family' ? -1 : 1) || a.id.localeCompare(b.id));
    const exact = found.filter((c) => c.level === 'exact');
    const ambiguous = exact.length > 1;
    const candidates: MatchCandidate[] = found.map(({ rank: _r, ...c }) => (ambiguous && c.level === 'exact' ? { ...c, level: 'likely' as const } : c));
    const level: MatchLevel = !candidates.length ? 'none' : exact.length === 1 ? 'exact' : 'likely';
    return { familyKey: p.familyKey, level, ambiguous, candidates };
  });
}
