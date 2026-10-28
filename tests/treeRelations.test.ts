import assert from 'node:assert/strict';
import { test } from 'node:test';
import { childrenOf, fatherNameOf, fatherOf, motherNameOf, generationUp, isComplete, motherOf } from '../src/tree/relations.ts';
import type { Person } from '../src/tree/types.ts';

const self: Person = { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל', tribe: 'yisrael' };
const wife: Person = { id: 'w', relation: 'spouse', of: 'me', gender: 'f', hebrewFirst: 'דוגמה' };

test('fatherOf / motherOf for figures, children and grandchildren', () => {
  const tree: Person[] = [
    self, wife,
    { id: 'f', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף' },
    { id: 'c', relation: 'child', gender: 'f', hebrewFirst: 'ניסיון' },
    { id: 'cs', relation: 'childSpouse', of: 'c', gender: 'm', hebrewFirst: 'אליהו' },
    { id: 'g', relation: 'grandchild', of: 'c', gender: 'm', hebrewFirst: 'נכד' },
  ];
  assert.equal(fatherOf(tree, 'me')?.id, 'f');
  assert.equal(motherOf(tree, 'me'), undefined);
  assert.equal(fatherOf(tree, 'c')?.id, 'me');
  assert.equal(motherOf(tree, 'c')?.id, 'w');
  assert.equal(fatherOf(tree, 'g')?.id, 'cs');
  assert.equal(motherOf(tree, 'g')?.id, 'c');
});

test('childrenOf', () => {
  const tree: Person[] = [
    self, wife,
    { id: 'c1', relation: 'child', gender: 'f' }, { id: 'c2', relation: 'child', gender: 'm' },
    { id: 'cs', relation: 'childSpouse', of: 'c1', gender: 'm' },
    { id: 'g1', relation: 'grandchild', of: 'c1', gender: 'm' }, { id: 'g2', relation: 'grandchild', of: 'c2', gender: 'm' },
  ];
  assert.deepEqual(childrenOf(tree, 'me').map(p => p.id), ['c1', 'c2']);
  assert.deepEqual(childrenOf(tree, 'w').map(p => p.id), ['c1', 'c2']);
  assert.deepEqual(childrenOf(tree, 'c1').map(p => p.id), ['g1']);
  assert.deepEqual(childrenOf(tree, 'cs').map(p => p.id), ['g1']);
  assert.deepEqual(childrenOf(tree, 'g1'), []);
});

test('isComplete needs first name, both parents names, tribe for men', () => {
  const tree: Person[] = [
    self,
    { id: 'f', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף' },
    { id: 'm', relation: 'mother', of: 'me', gender: 'f', hebrewFirst: 'דוגמה' },
  ];
  assert.equal(isComplete(tree, 'me'), true);
  assert.equal(isComplete(tree.slice(0, 2), 'me'), false);
  assert.equal(isComplete([{ ...self, tribe: undefined }, ...tree.slice(1)], 'me'), false);
  assert.equal(isComplete([{ ...self, hebrewFirst: '' }, ...tree.slice(1)], 'me'), false);
  const woman: Person[] = [{ id: 'x', relation: 'spouse', gender: 'f', hebrewFirst: 'דוגמה', fatherName: 'א', motherName: 'ב' }];
  assert.equal(isComplete(woman, 'x'), true);
});

test('generationUp returns the parent figures and stops at 6', () => {
  const tree: Person[] = [self];
  let child = 'me';
  for (let g = 1; g <= 7; g++) {
    tree.push({ id: `f${g}`, relation: 'father', of: child, gender: 'm', hebrewFirst: `א${g}` });
    tree.push({ id: `m${g}`, relation: 'mother', of: child, gender: 'f', hebrewFirst: `ב${g}` });
    child = `f${g}`;
  }
  assert.deepEqual(generationUp(tree, 'me').map(p => p.id), ['f1', 'm1']);
  assert.deepEqual(generationUp(tree, 'f5').map(p => p.id), ['f6', 'm6']);
  assert.deepEqual(generationUp(tree, 'f6'), []);
});

test('an empty parent figure name falls back to the typed name, like a missing figure', () => {
  const tree: Person[] = [
    { ...self, fatherName: 'ניסיון', motherName: 'דוגמה' },
    { id: 'f', relation: 'father', of: 'me', gender: 'm', hebrewFirst: '  ' },
    { id: 'm', relation: 'mother', of: 'me', gender: 'f', hebrewFirst: '' },
  ];
  assert.equal(fatherNameOf(tree, 'me'), 'ניסיון');
  assert.equal(motherNameOf(tree, 'me'), 'דוגמה');
  assert.equal(isComplete(tree, 'me'), true);
});
