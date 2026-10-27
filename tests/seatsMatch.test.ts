import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeName, spellingKey, suggestMatches } from '../src/seats/match.ts';
import type { KehilaFamily } from '../src/seats/match.ts';

test('normalizeName folds final letters, geresh/gershayim, maqaf, punctuation and spaces (comparison only)', () => {
  assert.equal(normalizeName('דוגמך'), normalizeName('דוגמכ'));
  assert.equal(normalizeName('שלום'), normalizeName('שלומ'));
  assert.equal(normalizeName("ג'ורג׳"), normalizeName('גורג'));
  assert.equal(normalizeName('צה"ל'), 'צהל');
  assert.equal(normalizeName('בן־דוגמה'), 'בנ דוגמה');
  assert.equal(normalizeName('בן-דוגמה'), 'בנ דוגמה');
  assert.equal(normalizeName('  בדיוני,   ש. '), 'בדיוני ש');
  assert.equal(normalizeName('בְּדִיּוֹנִי'), 'בדיוני');
  assert.equal(normalizeName('‏בדיוני‏'), 'בדיוני');
});

test('spelling keys equate full and defective spelling', () => {
  assert.equal(spellingKey('בדיוני'), spellingKey('בדיונ'));
  assert.equal(spellingKey('דוגמה'), spellingKey('דוגמא'));
  assert.notEqual(spellingKey('דוגמה'), spellingKey('ניסיון'));
});

const FAMS: KehilaFamily[] = [
  { id: 'f1', lastName: 'בדיוני', firstName: 'שמעון', spouseFirstName: 'רות', phone: '050-1234567' },
  { id: 'f2', lastName: 'בדיוני', firstName: 'אבי', phone: '052-7654321' },
  { id: 'f3', lastName: 'דוגמה', firstName: 'גד' },
  { id: 'f4', lastName: 'ניסיון', firstName: 'נתן', holdsSeats: true },
  { id: 'f5', lastName: 'ניסיון', firstName: 'נועם' },
  { id: 'f6', lastName: 'דמיוני', firstName: 'דן' },
];
const p = (family: string, initial?: string, phone?: string) => ({ familyKey: initial ? `${family} ${initial}` : family, family, initial, phone });

test('exact: same surname and the head\'s initial; the "why" says so; never auto-linked (suggestions only)', () => {
  const [r] = suggestMatches([p('בדיוני', 'ש')], FAMS, []);
  assert.equal(r!.level, 'exact');
  assert.equal(r!.candidates[0]!.id, 'f1');
  assert.equal(r!.candidates[0]!.why, 'surname-initial');
  assert.ok(r!.candidates[0]!.whyText.length > 0);
  // the other same-surname family is offered as a lower, different-initial suggestion
  assert.deepEqual(r!.candidates.map((c) => [c.id, c.level, c.why]), [['f1', 'exact', 'surname-initial'], ['f2', 'likely', 'surname-other-initial']]);
});

test('an initial matches the spouse\'s first name too', () => {
  const [r] = suggestMatches([p('בדיוני', 'ר')], FAMS, []);
  assert.equal(r!.candidates[0]!.id, 'f1');
  assert.equal(r!.level, 'exact');
});

test('final letters and prefixes do not break an initial match', () => {
  const [r] = suggestMatches([p('משפחת דוגמה', 'ג')], FAMS, []);
  assert.equal(r!.candidates[0]!.id, 'f3');
  assert.equal(r!.level, 'exact');
});

test('likely: spelling variant, with its why', () => {
  const [r] = suggestMatches([p('דוגמא', 'ג')], FAMS, []);
  assert.equal(r!.level, 'likely');
  assert.equal(r!.candidates[0]!.id, 'f3');
  assert.equal(r!.candidates[0]!.why, 'spelling');
});

test('likely: surname without an initial in the paste (no auto-exact)', () => {
  const [r] = suggestMatches([p('דוגמה')], FAMS, []);
  assert.equal(r!.level, 'likely');
  assert.equal(r!.candidates[0]!.why, 'surname-only');
});

test('phone: a phone match is found even when the surname differs; with the surname it is exact', () => {
  const [a, b] = suggestMatches([p('מומצא', undefined, '+972 50-123-4567'), p('בדיוני', 'ש', '0501234567')], FAMS, []);
  assert.equal(a!.level, 'likely');
  assert.equal(a!.candidates[0]!.id, 'f1');
  assert.equal(a!.candidates[0]!.why, 'phone');
  assert.equal(b!.level, 'exact');
  assert.equal(b!.candidates[0]!.why, 'phone-surname');
});

test('ties produce several candidates and nothing is exact; households without seats rank first', () => {
  const [r] = suggestMatches([p('ניסיון', 'נ')], FAMS, []);
  assert.equal(r!.ambiguous, true);
  assert.equal(r!.level, 'likely');
  assert.deepEqual(r!.candidates.map((c) => c.id), ['f5', 'f4']); // f4 already holds seats: ranks lower
  assert.ok(r!.candidates.every((c) => c.level === 'likely'));
});

test('none: no candidate at all', () => {
  const [r] = suggestMatches([p('אפשרי', 'ש')], FAMS, []);
  assert.equal(r!.level, 'none');
  assert.deepEqual(r!.candidates, []);
  assert.equal(r!.ambiguous, false);
});

test('seat holders without an account are candidates too, by name and by phone', () => {
  const holders = [{ id: 'h1', name: 'משפחת מומצא ש.', phone: '053-1112222' }, { id: 'h2', name: 'חלומי' }];
  const [a, b, c] = suggestMatches([p('מומצא', 'ש'), p('חלומי'), p('אחר', undefined, '0531112222')], FAMS, holders);
  assert.equal(a!.level, 'exact');
  assert.deepEqual([a!.candidates[0]!.kind, a!.candidates[0]!.id], ['holder', 'h1']);
  assert.equal(b!.candidates[0]!.id, 'h2');
  assert.equal(c!.candidates[0]!.id, 'h1');
  assert.equal(c!.candidates[0]!.why, 'phone');
});

test('registered family and holder with the same name: both offered, registered first', () => {
  const [r] = suggestMatches([p('דמיוני', 'ד')], FAMS, [{ id: 'h9', name: 'דמיוני ד.' }]);
  assert.equal(r!.ambiguous, true);
  assert.deepEqual(r!.candidates.map((c) => [c.kind, c.id]), [['family', 'f6'], ['holder', 'h9']]);
});

test('results keep the paste order, one per family', () => {
  const rs = suggestMatches([p('אפשרי'), p('דוגמה', 'ג'), p('בדיוני', 'א')], FAMS, []);
  assert.deepEqual(rs.map((r) => r.familyKey), ['אפשרי', 'דוגמה ג', 'בדיוני א']);
  assert.deepEqual(rs.map((r) => r.level), ['none', 'exact', 'exact']);
});

test('spelling variants need a key of at least 3 letters', () => {
  const fams: KehilaFamily[] = [{ id: 'a', lastName: 'בו', firstName: 'א' }, { id: 'b', lastName: 'לוי', firstName: 'א' }];
  const [short, shortOther] = suggestMatches([p('בי'), p('לי')], fams, []); // both reduce to <3 letters
  assert.equal(short!.level, 'none');
  assert.equal(shortOther!.level, 'none');
});

test('a "בית" prefix is stripped only to meet a candidate, never from a surname like "בית הלל"', () => {
  const fams: KehilaFamily[] = [{ id: 'h', lastName: 'הלל', firstName: 'א' }, { id: 'bh', lastName: 'בית הלל', firstName: 'ב' }, { id: 'd', lastName: 'דוגמה', firstName: 'ג' }];
  const [a, b, c] = suggestMatches([p('בית הלל'), p('משפחת דוגמה'), p('בית דוגמה')], fams, []);
  assert.equal(a!.candidates[0]!.id, 'bh'); // the full name ranks and matches first
  assert.ok(a!.candidates.some((x) => x.id === 'h')); // stripped form is only a lower candidate for a gabbai to judge
  assert.equal(b!.candidates[0]!.id, 'd');
  assert.equal(c!.candidates[0]!.id, 'd');
  // with no household "הלל", "בית הלל" is not reduced to anything
  const [d] = suggestMatches([p('בית הלל')], [{ id: 'x', lastName: 'ניסיון' }], []);
  assert.equal(d!.level, 'none');
});
