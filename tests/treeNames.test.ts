import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aliyahName, memorialName, prayerName } from '../src/tree/names.ts';
import type { Person } from '../src/tree/types.ts';

const base = (): Person[] => [
  { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל', surname: 'ישראלי' },
  { id: 'f', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף חיים' },
  { id: 'm', relation: 'mother', of: 'me', gender: 'f', hebrewFirst: 'דוגמה' },
];

test('aliyah, mi sheberach and memorial names follow the formula', () => {
  const tree = base();
  assert.deepEqual(aliyahName(tree, 'me'), { text: 'ישראל בן יוסף חיים', missing: [] });
  assert.deepEqual(prayerName(tree, 'me'), { text: 'ישראל בן דוגמה', missing: [] });
  assert.deepEqual(memorialName(tree, 'me'), { text: 'ישראל בן יוסף חיים ז״ל', missing: [] });
});

test('kohen and levi suffixes, men only', () => {
  const tree = base();
  tree[0]!.tribe = 'levi';
  assert.equal(aliyahName(tree, 'me').text, 'ישראל בן יוסף חיים הלוי');
  tree[0]!.tribe = 'kohen';
  assert.equal(aliyahName(tree, 'me').text, 'ישראל בן יוסף חיים הכהן');
  assert.equal(memorialName(tree, 'me').text, 'ישראל בן יוסף חיים הכהן ז״ל');
  tree[0]!.tribe = 'yisrael';
  assert.equal(aliyahName(tree, 'me').text, 'ישראל בן יוסף חיים');
  const woman: Person[] = [{ id: 'w', relation: 'spouse', of: 'me', gender: 'f', hebrewFirst: 'דוגמה', tribe: 'kohen', fatherName: 'ניסיון' }];
  assert.equal(aliyahName(woman, 'w').text, 'דוגמה בת ניסיון');
});

test('missing father is reported, text keeps what exists', () => {
  const tree = base().filter(p => p.id !== 'f');
  assert.deepEqual(aliyahName(tree, 'me'), { text: 'ישראל', missing: ['father'] });
  assert.deepEqual(prayerName(tree, 'me').missing, []);
  const noMother = base().filter(p => p.id !== 'm');
  assert.deepEqual(prayerName(noMother, 'me'), { text: 'ישראל', missing: ['mother'] });
  assert.deepEqual(aliyahName([{ id: 'x', relation: 'self', gender: 'm' }], 'x').missing, ['first', 'father']);
});

test('typed parent names are used when there is no parent figure', () => {
  const tree: Person[] = [{ id: 's', relation: 'spouse', gender: 'f', hebrewFirst: 'דוגמה', fatherName: 'ניסיון', motherName: 'דוגמה שנייה' }];
  assert.equal(aliyahName(tree, 's').text, 'דוגמה בת ניסיון');
  assert.equal(prayerName(tree, 's').text, 'דוגמה בת דוגמה שנייה');
});

test('children read their parents names from the tree, never a copy', () => {
  const tree: Person[] = [
    { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל', tribe: 'levi' },
    { id: 'w', relation: 'spouse', of: 'me', gender: 'f', hebrewFirst: 'דוגמה' },
    ...Array.from({ length: 7 }, (_, i): Person => ({ id: `c${i}`, relation: 'child', gender: i % 2 ? 'f' : 'm', hebrewFirst: `ילד${i}` })),
  ];
  assert.equal(aliyahName(tree, 'c0').text, 'ילד0 בן ישראל הלוי');
  assert.equal(aliyahName(tree, 'c1').text, 'ילד1 בת ישראל');
  assert.equal(prayerName(tree, 'c0').text, 'ילד0 בן דוגמה');
  tree[0]!.hebrewFirst = 'יעקב';
  for (let i = 0; i < 7; i++) assert.match(aliyahName(tree, `c${i}`).text, / יעקב( הלוי)?$/);
  assert.equal('fatherName' in tree[2]!, false);
});

test('child tribe is inherited from the father figure', () => {
  const tree: Person[] = [
    { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל', tribe: 'kohen' },
    { id: 'w', relation: 'spouse', of: 'me', gender: 'f', hebrewFirst: 'דוגמה' },
    { id: 'c', relation: 'child', gender: 'm', hebrewFirst: 'ניסיון' },
  ];
  assert.equal(aliyahName(tree, 'c').text, 'ניסיון בן ישראל הכהן');
});

test('grandchildren take parents from their child and the child spouse', () => {
  const tree: Person[] = [
    { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל' },
    { id: 'c', relation: 'child', gender: 'f', hebrewFirst: 'דוגמה' },
    { id: 'cs', relation: 'childSpouse', of: 'c', gender: 'm', hebrewFirst: 'ניסיון' },
    { id: 'g', relation: 'grandchild', of: 'c', gender: 'f', hebrewFirst: 'נכדה' },
  ];
  assert.deepEqual(aliyahName(tree, 'g'), { text: 'נכדה בת ניסיון', missing: [] });
  assert.deepEqual(prayerName(tree, 'g'), { text: 'נכדה בת דוגמה', missing: [] });
});
