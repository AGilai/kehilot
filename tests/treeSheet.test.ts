import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aliyahName, prayerName } from '../src/tree/names.ts';
import {
  canClear, canRemove, clearPerson, commit, feedCount, feedWarning, isDirty, parentField, pickShabbat, removePerson, sheetErrors,
  sheetReducer, startSheet, suggestionOf,
} from '../src/tree/sheet.ts';
import type { SheetAction, SheetState } from '../src/tree/sheet.ts';
import type { Person } from '../src/tree/types.ts';

// Invented names only.
const dad: Person = { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל', surname: 'דוגמה', tribe: 'levi', fatherName: 'אבנר', motherName: 'דליה' };
const mum: Person = { id: 'sp', relation: 'spouse', of: 'me', gender: 'f', hebrewFirst: 'שולמית', surname: 'דוגמה', fatherName: 'נחום', motherName: 'מיכל' };
const base: Person[] = [dad, mum];
const ids = () => { let n = 0; return () => `n${++n}`; };
const run = (s: SheetState, ...actions: SheetAction[]) => actions.reduce(sheetReducer, s);
const newChild = (people = base, gender: 'm' | 'f' = 'm') => startSheet(people, { create: { relation: 'child', gender } }, 'k1');

test('a new child takes the surname of the father and COPIES his tribe', () => {
  const s = newChild();
  assert.equal(s.draft.surname, 'דוגמה');
  assert.equal(s.draft.tribe, 'levi');
  const people = commit(run(s, { type: 'text', key: 'hebrewFirst', value: 'אורי' }), ids());
  const kid = people.find(p => p.id === 'k1')!;
  assert.equal(kid.tribe, 'levi'); // stored on him
  // later the father's tribe changes: the son keeps the copy
  const later = people.map(p => (p.id === 'me' ? { ...p, tribe: 'kohen' as const } : p));
  assert.equal(later.find(p => p.id === 'k1')!.tribe, 'levi');
});

test('a new daughter has no tribe; switching gender drops the tribe and the bar mitzvah, switching back copies the tribe again', () => {
  const girl = newChild(base, 'f');
  assert.equal(girl.draft.tribe, undefined);
  const boy = run(girl, { type: 'gender', gender: 'm' });
  assert.equal(boy.draft.tribe, 'levi');
  const born = run(boy, { type: 'birth', part: { day: 10, month: 'tishrei', year: 5780 } });
  assert.ok(born.draft.barMitzvah);
  const back = run(born, { type: 'gender', gender: 'f' });
  assert.equal(back.draft.tribe, undefined);
  assert.equal(back.draft.barMitzvah, undefined);
  const out = commit(back, ids()).find(p => p.id === 'k1')!;
  assert.equal(out.tribe, undefined);
  assert.equal(out.barMitzvah, undefined);
});

test('a single mother\'s child takes her surname, and a wife takes the husband\'s', () => {
  const alone: Person[] = [{ ...mum, id: 'solo', relation: 'self', of: undefined, surname: 'אלמונית' }];
  assert.equal(newChild(alone).draft.surname, 'אלמונית');
  assert.equal(newChild(alone).draft.tribe, undefined);
  const wife = startSheet([{ ...dad, surname: 'בדיוני' }], { create: { relation: 'spouse', of: 'me', gender: 'f' } }, 'w');
  assert.equal(wife.draft.surname, 'בדיוני');
});

test('editing the father\'s name updates every child\'s computed name (they read it)', () => {
  const kids: Person[] = [...base, { id: 'a', relation: 'child', gender: 'm', hebrewFirst: 'אורי' }, { id: 'b', relation: 'child', gender: 'f', hebrewFirst: 'נועה' }];
  const withFatherName = kids.map(p => (p.id === 'me' ? { ...p, hebrewFirst: 'יוסף' } : p));
  assert.equal(aliyahName(withFatherName, 'a').text, 'אורי בן יוסף הלוי');
  const s = run(startSheet(kids, { id: 'me' }, 'x'), { type: 'text', key: 'hebrewFirst', value: 'יוסף' });
  assert.equal(feedWarning(s), 2); // banner: also the father's name of 2 children
  const saved = commit(s, ids());
  assert.equal(aliyahName(saved, 'a').text, 'אורי בן יוסף הלוי');
  assert.equal(prayerName(saved, 'b').text, 'נועה בת שולמית'); // the mother's name is untouched
  assert.equal(saved.find(p => p.id === 'a')!.fatherName, undefined); // nothing copied onto the child
  assert.equal(feedCount(saved, 'me'), 2);
});

test('the feed banner shows only when the first name changed', () => {
  const kids: Person[] = [...base, { id: 'a', relation: 'child', gender: 'm', hebrewFirst: 'אורי' }];
  const s = startSheet(kids, { id: 'me' }, 'x');
  assert.equal(feedWarning(s), 0);
  assert.equal(feedWarning(run(s, { type: 'text', key: 'surname', value: 'אחר' })), 0);
  assert.equal(feedWarning(run(s, { type: 'text', key: 'hebrewFirst', value: 'ישראל ' })), 0); // trimmed: same name
});

test('typing a missing parent name creates the parent figure; the child keeps no copy', () => {
  const s = run(startSheet([{ ...dad, fatherName: undefined, motherName: undefined }, mum], { id: 'me' }, 'x'), { type: 'text', key: 'fatherName', value: 'אבנר' });
  assert.deepEqual(parentField(s, 'father'), { mode: 'typed', fillsFigure: true });
  const out = commit(s, ids());
  const figure = out.find(p => p.relation === 'father' && p.of === 'me')!;
  assert.equal(figure.hebrewFirst, 'אבנר');
  assert.equal(figure.gender, 'm');
  assert.equal(figure.surname, 'דוגמה');
  assert.equal(out.find(p => p.id === 'me')!.fatherName, undefined);
  assert.equal(aliyahName(out, 'me').text, 'ישראל בן אבנר הלוי');
});

test('typing a missing parent name fills an existing empty parent figure instead of adding a second', () => {
  const tree: Person[] = [dad, mum, { id: 'f', relation: 'father', of: 'sp', gender: 'm' }];
  const out = commit(run(startSheet(tree, { id: 'sp' }, 'x'), { type: 'text', key: 'fatherName', value: 'נחום' }), ids());
  assert.equal(out.filter(p => p.relation === 'father' && p.of === 'sp').length, 1);
  assert.equal(out.find(p => p.id === 'f')!.hebrewFirst, 'נחום');
});

test('a parent with a name is read-only (from the tree), and saving leaves it alone', () => {
  const tree: Person[] = [dad, mum, { id: 'f', relation: 'father', of: 'sp', gender: 'm', hebrewFirst: 'נחום' }];
  const s = startSheet(tree, { id: 'sp' }, 'x');
  assert.deepEqual(parentField(s, 'father'), { mode: 'tree', name: 'נחום', figureId: 'f' });
  const out = commit(run(s, { type: 'text', key: 'fatherName', value: 'אחר' }), ids());
  assert.equal(out.find(p => p.id === 'f')!.hebrewFirst, 'נחום');
});

test('children and grandchildren have no parent fields; a child\'s spouse keeps typed names (no figures drawn)', () => {
  const tree: Person[] = [...base, { id: 'c', relation: 'child', gender: 'f', hebrewFirst: 'נועה' }];
  assert.deepEqual(parentField(startSheet(tree, { id: 'c' }, 'x'), 'father'), { mode: 'none' });
  const spouse = run(startSheet(tree, { create: { relation: 'childSpouse', of: 'c', gender: 'm' } }, 'h'), { type: 'text', key: 'hebrewFirst', value: 'אליהו' }, { type: 'text', key: 'fatherName', value: 'משה' });
  assert.deepEqual(parentField(spouse, 'father'), { mode: 'typed', fillsFigure: false });
  const out = commit(spouse, ids());
  assert.equal(out.find(p => p.id === 'h')!.fatherName, 'משה');
  assert.equal(out.filter(p => p.relation === 'father').length, 0);
});

test('the sixth generation keeps a typed name instead of a figure', () => {
  let tree: Person[] = [dad];
  let of = 'me';
  for (let i = 1; i <= 6; i++) { tree = [...tree, { id: `g${i}`, relation: 'father', of, gender: 'm', hebrewFirst: `שם${i}` }]; of = `g${i}`; }
  const s = run(startSheet(tree, { id: 'g6' }, 'x'), { type: 'text', key: 'fatherName', value: 'קדמון' });
  assert.deepEqual(parentField(s, 'father'), { mode: 'typed', fillsFigure: false });
  const out = commit(s, ids());
  assert.equal(out.filter(p => p.relation === 'father').length, 6);
  assert.equal(out.find(p => p.id === 'g6')!.fatherName, 'קדמון');
});

test('bar mitzvah: a birth date makes a suggestion that follows later birth changes', () => {
  const s1 = run(newChild(), { type: 'birth', part: { day: 14, month: 'kislev', year: 5776 } });
  const bm = s1.draft.barMitzvah!;
  assert.equal(bm.manual, false);
  assert.equal(bm.date, suggestionOf(s1.draft)!.date);
  const s2 = run(s1, { type: 'birth', part: { year: 5777 } });
  assert.notEqual(s2.draft.barMitzvah!.date, bm.date);
  assert.equal(s2.draft.barMitzvah!.manual, false);
  assert.equal(s2.takePrompt, false);
});

test('bar mitzvah: a manual Shabbat is kept when the birth date changes, and the user is asked', () => {
  const s1 = run(newChild(), { type: 'birth', part: { day: 14, month: 'kislev', year: 5776 } });
  const pick = pickShabbat('2019-12-14'); // a Shabbat
  assert.equal(pick.kind, 'shabbat');
  const s2 = run(s1, { type: 'shabbat', info: pick.kind === 'shabbat' ? pick.info : (undefined as never) });
  assert.equal(s2.draft.barMitzvah!.manual, true);
  const kept = s2.draft.barMitzvah!;
  const s3 = run(s2, { type: 'birth', part: { year: 5777 } });
  assert.deepEqual(s3.draft.barMitzvah, kept);
  assert.equal(s3.takePrompt, true);
  // keep: no more asking, still manual
  const keep = run(s3, { type: 'keepManual' });
  assert.equal(keep.takePrompt, false);
  assert.deepEqual(keep.draft.barMitzvah, kept);
  // take: the new suggestion, not manual
  const take = run(s3, { type: 'takeSuggestion' });
  assert.equal(take.takePrompt, false);
  assert.equal(take.draft.barMitzvah!.manual, false);
  assert.equal(take.draft.barMitzvah!.date, suggestionOf(take.draft)!.date);
  // saving keeps the manual one
  assert.deepEqual(commit(s3, ids()).find(p => p.id === 'k1')!.barMitzvah, kept);
});

test('bar mitzvah: choosing the suggested Shabbat itself is not "by hand"', () => {
  const s1 = run(newChild(), { type: 'birth', part: { day: 14, month: 'kislev', year: 5776 } });
  const s2 = run(s1, { type: 'shabbat', info: suggestionOf(s1.draft)! });
  assert.equal(s2.draft.barMitzvah!.manual, false);
});

test('bar mitzvah: a weekday pick offers that week\'s Shabbat', () => {
  const wed = pickShabbat('2019-12-11'); // Wednesday
  assert.equal(wed.kind, 'weekday');
  if (wed.kind !== 'weekday') return;
  assert.equal(wed.day, 3);
  assert.equal(wed.shabbat.date, '2019-12-14');
  assert.equal(wed.hebrew.month, 'kislev');
  const sun = pickShabbat('2019-12-08');
  assert.equal(sun.kind === 'weekday' && sun.shabbat.date, '2019-12-14');
  const fri = pickShabbat('2019-12-13');
  assert.equal(fri.kind === 'weekday' && fri.shabbat.date, '2019-12-14');
  const sat = pickShabbat('2019-12-14');
  assert.equal(sat.kind, 'shabbat');
});

test('girls: no Shabbat, no bar mitzvah stored, bat mitzvah is information', () => {
  const g = run(newChild(base, 'f'), { type: 'birth', part: { day: 14, month: 'kislev', year: 5776 } });
  assert.equal(g.draft.barMitzvah, undefined);
  assert.equal(suggestionOf(g.draft), undefined);
  const out = commit(run(g, { type: 'shabbat', info: { date: '2019-12-14', parasha: 'וישלח', label: 'שבת פרשת וישלח' } }), ids()).find(p => p.id === 'k1')!;
  assert.equal(out.barMitzvah, undefined);
  assert.equal(out.tribe, undefined);
});

test('a holiday Shabbat is stored with its label and an empty parasha', () => {
  const s = run(newChild(), { type: 'birth', part: { day: 1, month: 'tishrei', year: 5776 } });
  const info = { date: '2019-09-28', parasha: '', label: 'שבת ראש השנה' };
  const out = commit(run(s, { type: 'shabbat', info }), ids()).find(p => p.id === 'k1')!;
  assert.deepEqual(out.barMitzvah, { date: '2019-09-28', parasha: '', manual: true, label: 'שבת ראש השנה' });
});

test('dates: an Adar that does not exist in the year is cleared, never moved; a day past the month end is cleared', () => {
  const s = run(newChild(), { type: 'birth', part: { day: 5, month: 'adar', year: 5775 } }); // 5775 is regular
  assert.equal(s.draft.birth.month, 'adar');
  const leap = run(s, { type: 'birth', part: { year: 5776 } }); // 5776 is a leap year
  assert.equal(leap.draft.birth.month, undefined);
  assert.equal(leap.draft.birth.year, 5776);
  const iyar = run(newChild(), { type: 'birth', part: { day: 30, month: 'sivan', year: 5777 } }, { type: 'birth', part: { month: 'iyar' } });
  assert.equal(iyar.draft.birth.day, undefined);
});

test('dates: half-filled dates are errors, only day + month are stored, the year is optional', () => {
  const half = run(newChild(), { type: 'birth', part: { day: 4 } });
  assert.deepEqual(sheetErrors(half.draft, '2026-10-28'), ['partialBirth']);
  const noYear = run(half, { type: 'birth', part: { month: 'sivan' } });
  assert.deepEqual(sheetErrors(noYear.draft, '2026-10-28'), []);
  assert.deepEqual(commit(noYear, ids()).find(p => p.id === 'k1')!.birth, { day: 4, month: 'sivan' });
  assert.equal(noYear.draft.barMitzvah, undefined);
});

test('checks mirror the server: death before birth, birth or death in the future, death only when deceased', () => {
  const kid = (extra: SheetAction[]) => run(newChild(), ...extra).draft;
  assert.deepEqual(sheetErrors(kid([{ type: 'birth', part: { day: 1, month: 'tishrei', year: 5790 } }]), '2026-10-28'), ['birthFuture']);
  const dead = kid([{ type: 'birth', part: { day: 10, month: 'sivan', year: 5750 } }, { type: 'alive', deceased: true }, { type: 'death', part: { day: 1, month: 'sivan', year: 5749 } }]);
  assert.deepEqual(sheetErrors(dead, '2026-10-28'), ['deathBeforeBirth']);
  const future = kid([{ type: 'alive', deceased: true }, { type: 'death', part: { day: 1, month: 'tishrei', year: 5790 } }]);
  assert.deepEqual(sheetErrors(future, '2026-10-28'), ['deathFuture']);
  // switching back to alive drops the death date (the server rejects a death date without deceased)
  const alive = run(newChild(), { type: 'alive', deceased: true }, { type: 'death', part: { day: 1, month: 'sivan', year: 5700 } }, { type: 'alive', deceased: false });
  const out = commit(alive, ids()).find(p => p.id === 'k1')!;
  assert.equal(out.death, undefined);
  assert.equal(out.deceased, undefined);
  assert.deepEqual(sheetErrors(alive.draft, '2026-10-28'), []);
});

test('the same Adar is kept in a leap year', () => {
  const s = run(newChild(), { type: 'birth', part: { day: 5, month: 'adar_ii', year: 5776 } });
  assert.deepEqual(commit(s, ids()).find(p => p.id === 'k1')!.birth, { day: 5, month: 'adar_ii', year: 5776 });
});

test('removing a child removes the spouse and grandchildren; removing a spouse removes the spouse\'s ancestors; the adults and parents are not removable', () => {
  const tree: Person[] = [...base,
    { id: 'c', relation: 'child', gender: 'f' }, { id: 'cs', relation: 'childSpouse', of: 'c', gender: 'm' }, { id: 'g', relation: 'grandchild', of: 'c', gender: 'f' },
    { id: 'c2', relation: 'child', gender: 'm' },
    { id: 'sf', relation: 'father', of: 'sp', gender: 'm', hebrewFirst: 'נחום' }, { id: 'mf', relation: 'father', of: 'me', gender: 'm' }];
  assert.deepEqual(removePerson(tree, 'c').map(p => p.id), ['me', 'sp', 'c2', 'sf', 'mf']);
  assert.deepEqual(removePerson(tree, 'sp').map(p => p.id), ['me', 'c', 'cs', 'g', 'c2', 'mf']);
  const by = (id: string) => tree.find(p => p.id === id)!;
  assert.deepEqual(['c', 'cs', 'g', 'sp'].map(id => canRemove(by(id))), [true, true, true, true]);
  assert.deepEqual(['me', 'mf'].map(id => canRemove(by(id))), [false, false]);
  assert.deepEqual(['mf', 'sf', 'c'].map(id => canClear(by(id))), [true, true, false]);
  assert.equal(canRemove({ ...mum, userId: 'u1' }), false); // a spouse with an account is removed by unlinking, not here
});

test('clearing a parent keeps the slot (id, relation, of, gender) and drops the details', () => {
  const tree: Person[] = [dad, { id: 'f', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'אבנר', tribe: 'levi', deceased: true, figure: { glasses: true } }];
  assert.deepEqual(clearPerson(tree, 'f')[1], { id: 'f', relation: 'father', of: 'me', gender: 'm' });
});

test('dirty: untouched is clean, any change is dirty, a new figure always saves', () => {
  const s = startSheet(base, { id: 'me' }, 'x');
  assert.equal(isDirty(s), false);
  assert.equal(isDirty(run(s, { type: 'text', key: 'hebrewFirst', value: 'אחר' })), true);
  assert.equal(isDirty(run(s, { type: 'text', key: 'hebrewFirst', value: ' ישראל ' })), false);
  assert.equal(isDirty(newChild()), true);
});

test('the figure choice is saved with the person', () => {
  const s = run(startSheet(base, { id: 'me' }, 'x'), { type: 'figure', figure: { glasses: true, skin: 2 } });
  assert.deepEqual(commit(s, ids()).find(p => p.id === 'me')!.figure, { glasses: true, skin: 2 });
  assert.equal(commit(run(s, { type: 'figure', figure: undefined }), ids()).find(p => p.id === 'me')!.figure, undefined);
});

test('a tribe is for men only', () => {
  const g = run(newChild(base, 'f'), { type: 'tribe', tribe: 'kohen' });
  assert.equal(g.draft.tribe, undefined);
});
