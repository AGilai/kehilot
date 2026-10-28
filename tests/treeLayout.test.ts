import assert from 'node:assert/strict';
import { test } from 'node:test';
import { familyStatus, levelDown, missingCount, treeLayout } from '../src/tree/layout.ts';
import type { Person } from '../src/tree/types.ts';

// Invented names only.
const me: Person = { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל', tribe: 'yisrael', fatherName: 'דוגמה', motherName: 'ניסיון' };
const wife: Person = { id: 'w', relation: 'spouse', of: 'me', gender: 'f', hebrewFirst: 'דוגמה', fatherName: 'אבא', motherName: 'אמא' };
const kid = (i: number, extra: Partial<Person> = {}): Person => ({ id: `c${i}`, relation: 'child', gender: i % 2 ? 'f' : 'm', hebrewFirst: `ילד${i}`, fatherName: 'ישראל', motherName: 'דוגמה', ...extra });

test('root: couple husband first, a parents card per adult, children in the grid', () => {
  const tree: Person[] = [wife, me, { id: 'f1', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף' }, kid(1), kid(2)];
  const l = treeLayout(tree, 'me');
  assert.equal(l.root, true);
  assert.deepEqual(l.couple.map(s => s.person?.id), ['me', 'w']);
  assert.deepEqual(l.parents.map(c => c.ofId), ['me', 'w']);
  assert.equal(l.parents[0]!.father.person?.id, 'f1');
  assert.equal(l.parents[0]!.mother.slot?.relation, 'mother');
  assert.equal(l.parents[0]!.upId, 'f1');
  assert.equal(l.parents[1]!.upId, null); // nobody drawn yet for the partner's parents
  assert.deepEqual(l.children.map(c => c.person.id), ['c1', 'c2']);
  assert.equal(l.canAddChild, true);
});

test('a woman signed in: the couple still shows the husband first', () => {
  const her: Person = { ...me, id: 'her', gender: 'f' };
  const him: Person = { ...wife, id: 'him', of: 'her', gender: 'm' };
  assert.deepEqual(treeLayout([her, him], 'her').couple.map(s => s.person?.id), ['him', 'her']);
  assert.deepEqual(treeLayout([her], 'her').couple.map(s => s.person?.id ?? s.slot?.relation), ['spouse', 'her'].map(x => (x === 'spouse' ? 'spouse' : x)));
});

test('no partner: one parents card and an empty partner slot', () => {
  const l = treeLayout([me], 'me');
  assert.equal(l.parents.length, 1);
  assert.equal(l.couple[1]!.slot?.relation, 'spouse');
  assert.equal(l.couple[1]!.slot?.gender, 'f');
});

test('a tree with no self: empty state, a self slot, no parents', () => {
  const l = treeLayout([], null);
  assert.equal(l.hasSelf, false);
  assert.equal(l.parents.length, 0);
  assert.equal(l.couple[0]!.slot?.relation, 'self');
  assert.equal(l.children.length, 0);
  // an older children-only tree still lists the children
  assert.equal(treeLayout([kid(1), kid(2)], null).children.length, 2);
});

test('seven children: seven tiles; a married child is one tile; grandchildren and a former spouse are not in the grid', () => {
  const tree: Person[] = [me, wife, ...[1, 2, 3, 4, 5, 6, 7].map(i => kid(i)),
    { id: 's1', relation: 'childSpouse', of: 'c1', gender: 'm', hebrewFirst: 'אליהו' },
    { id: 'g1', relation: 'grandchild', of: 'c1', gender: 'f', hebrewFirst: 'נכדה' },
    { id: 'g2', relation: 'grandchild', of: 'c1', gender: 'm', hebrewFirst: 'נכד' },
    { id: 'x', relation: 'formerSpouse', of: 'me', gender: 'f', hebrewFirst: 'ניסיון' }];
  const l = treeLayout(tree, 'me');
  assert.equal(l.children.length, 7);
  assert.equal(l.children[0]!.partner?.id, 's1');
  assert.equal(l.children[1]!.partner, undefined);
  assert.ok(!l.children.some(c => c.person.relation === 'grandchild' || c.person.relation === 'formerSpouse'));
  assert.ok(!JSON.stringify(l.parents).includes('"x"'));
});

test('20 children: no add tile', () => {
  const tree = [me, ...Array.from({ length: 20 }, (_, i) => kid(i + 1))];
  assert.equal(treeLayout(tree, 'me').canAddChild, false);
});

test('going up: the parents become the centre, the child we came from is the only tile', () => {
  const tree: Person[] = [me, wife,
    { id: 'f1', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף' }, { id: 'm1', relation: 'mother', of: 'me', gender: 'f', hebrewFirst: 'שרה' },
    { id: 'f2', relation: 'father', of: 'f1', gender: 'm', hebrewFirst: 'אבא' }, kid(1)];
  const l = treeLayout(tree, 'f1');
  assert.equal(l.root, false);
  assert.deepEqual(l.couple.map(s => s.person?.id), ['f1', 'm1']);
  assert.deepEqual(l.parents.map(c => c.ofId), ['f1', 'm1']);
  assert.equal(l.parents[0]!.father.person?.id, 'f2');
  assert.deepEqual(l.children.map(c => [c.person.id, c.partner?.id]), [['me', 'w']]);
  assert.equal(l.from?.person.id, 'me');
  assert.deepEqual(l.trail.map(p => p.id), ['me']);
  assert.equal(l.canAddChild, false);
  // the mother's id opens the same couple
  assert.deepEqual(treeLayout(tree, 'm1').couple.map(s => s.person?.id), ['f1', 'm1']);
  // one level further up: the child tile is the father and the mother of the level below, the trail has both persons
  const up2 = treeLayout(tree, 'f2');
  assert.deepEqual(up2.trail.map(p => p.id), ['me', 'f1']);
  assert.deepEqual(up2.children.map(c => [c.person.id, c.partner?.id]), [['f1', 'm1']]);
  assert.equal(up2.couple[1]!.slot?.relation, 'mother');
});

test('levelDown walks back one level, then to the root', () => {
  const tree: Person[] = [me, { id: 'f1', relation: 'father', of: 'me', gender: 'm' }, { id: 'f2', relation: 'father', of: 'f1', gender: 'm' }];
  assert.equal(levelDown(tree, 'f2'), 'f1');
  assert.equal(levelDown(tree, 'f1'), 'me');
  assert.equal(levelDown(tree, 'me'), 'me');
});

test('no going up past the 6th generation', () => {
  const tree: Person[] = [me];
  let of = 'me';
  for (let i = 1; i <= 6; i++) { tree.push({ id: `a${i}`, relation: 'father', of, gender: 'm', hebrewFirst: `א${i}` }); of = `a${i}`; }
  assert.equal(treeLayout(tree, 'me').parents[0]!.upId, 'a1');
  assert.equal(treeLayout(tree, 'a4').parents[0]!.upId, 'a5');
  assert.equal(treeLayout(tree, 'a5').parents[0]!.upId, null);
});

test('missingCount: complete figures, grandchildren and a former spouse do not count', () => {
  assert.equal(missingCount([me, wife, kid(1), kid(2)]), 0);
  const tree: Person[] = [me, wife, kid(1, { hebrewFirst: '' }), kid(2),
    { id: 'g', relation: 'grandchild', of: 'c1', gender: 'f' }, { id: 'x', relation: 'formerSpouse', of: 'me', gender: 'f' }];
  assert.equal(missingCount(tree), 1);
  assert.equal(missingCount([{ ...me, hebrewFirst: undefined }]), 1);
  assert.equal(missingCount([]), 0);
});

test('missingCount: a living ancestor needs a first name; a deceased one the whole memorial name', () => {
  const base: Person[] = [me, wife];
  assert.equal(missingCount([...base, { id: 'f1', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף' }]), 0);
  assert.equal(missingCount([...base, { id: 'f1', relation: 'father', of: 'me', gender: 'm' }]), 1);
  assert.equal(missingCount([...base, { id: 'f1', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף', deceased: true }]), 1);
  assert.equal(missingCount([...base, { id: 'f1', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף', deceased: true, fatherName: 'אברהם', motherName: 'שרה', tribe: 'levi' }]), 0);
});

test('familyStatus follows the §18 order', () => {
  const done: Person[] = [me, wife, kid(1)];
  const request = { name: 'דנה' };
  assert.deepEqual(familyStatus({ tree: [{ ...me, hebrewFirst: '' }], request }), { kind: 'request', name: 'דנה' });
  assert.deepEqual(familyStatus({ tree: [...done, kid(2, { hebrewFirst: '' })], sent: { name: 'יוסי' } }), { kind: 'missing', n: 1 });
  assert.deepEqual(familyStatus({ tree: [me] }), { kind: 'empty' });
  assert.deepEqual(familyStatus({ tree: [] }), { kind: 'empty' });
  assert.deepEqual(familyStatus({ tree: done, sent: { name: 'יוסי' } }), { kind: 'sent', name: 'יוסי' });
  assert.deepEqual(familyStatus({ tree: done, updated: '27.10' }), { kind: 'complete', date: '27.10' });
  assert.deepEqual(familyStatus({ tree: done }), { kind: 'complete', date: null });
});

test('missingParts says what is missing', async () => {
  const { missingParts } = await import('../src/tree/layout.ts');
  const boy: Person = { id: 'b', relation: 'child', gender: 'm', hebrewFirst: 'אורי' };
  const tree: Person[] = [{ ...me, tribe: undefined, hebrewFirst: 'ישראל' }, { ...wife, hebrewFirst: undefined }, boy];
  assert.deepEqual(missingParts(tree, boy), ['mother', 'tribe']);
  assert.deepEqual(missingParts([me, wife, boy], boy), []);
  assert.deepEqual(missingParts(tree, tree[1]!), ['first']);
});
