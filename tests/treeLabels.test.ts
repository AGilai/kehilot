import assert from 'node:assert/strict';
import { test } from 'node:test';
import { israelDayMonth, statusLine, coupleLabel, figureLabel, pairName, relationLabel, stateWords, isMe } from '../src/tree/labels.ts';
import type { Person } from '../src/tree/types.ts';

// A tiny t: "key" or "key|a=1|b=2", so the tests do not depend on the wording.
const t = (key: string, p: Record<string, string | number> = {}) => [key, ...Object.entries(p).map(([k, v]) => `${k}=${v}`)].join('|');
const me: Person = { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל', surname: 'ישראלי', tribe: 'yisrael', fatherName: 'יוסף', motherName: 'שרה' };
const wife: Person = { id: 'w', relation: 'spouse', of: 'me', gender: 'f', hebrewFirst: 'דוגמה', surname: 'ישראלי', fatherName: 'אבא', motherName: 'אמא' };

test('coupleLabel: two names, one name, none', () => {
  assert.equal(coupleLabel([me, wife], t), 'tree.coupleName|a=ישראל|b=דוגמה|surname=ישראלי');
  assert.equal(coupleLabel([me], t), 'ישראל ישראלי');
  assert.equal(coupleLabel([{ ...me, hebrewFirst: '' }], t), 'ישראלי');
  assert.equal(coupleLabel([{ ...me, hebrewFirst: '', surname: '' }], t), 'me.family.title');
});

test('pairName uses the role word for a blank name', () => {
  const kid: Person = { id: 'c', relation: 'child', gender: 'f', hebrewFirst: 'נועה' };
  const sp: Person = { id: 's', relation: 'childSpouse', of: 'c', gender: 'm' };
  assert.equal(pairName(kid, sp, t), 'tree.pair|a=נועה|b=tree.role.spouseM');
});

test('relationLabel', () => {
  const f: Person = { id: 'f', relation: 'father', of: 'me', gender: 'm' };
  const tree = [me, wife, f, { id: 'x', relation: 'mother', of: 'w', gender: 'f' } as Person, { ...me, id: 'nameless', relation: 'father', of: 'f', gender: 'm', hebrewFirst: '' } as Person];
  assert.equal(relationLabel(tree, f, t), 'tree.rel.father|name=ישראל');
  assert.equal(relationLabel(tree, tree[3]!, t), 'tree.rel.mother|name=דוגמה');
  assert.equal(relationLabel(tree, wife, t), 'tree.rel.wife|name=ישראל');
  assert.equal(relationLabel(tree, { id: 'c', relation: 'child', gender: 'f' }, t), 'tree.rel.daughter');
  assert.equal(relationLabel([{ ...me, hebrewFirst: '' }, f], f, t), 'tree.rel.ofMe|kind=tree.role.father');
});

test('stateWords: deceased, unfilled, what is missing', () => {
  const f: Person = { id: 'f', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף', deceased: true, tribe: 'levi', fatherName: 'אברהם' };
  assert.deepEqual(stateWords([me, f], f, t), ['tree.state.deceased', 'tree.state.missMother']);
  const two: Person = { id: 'g', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'יוסף', deceased: true };
  assert.deepEqual(stateWords([me, two], two, t), ['tree.state.deceased', 'tree.state.missMany|list=tree.part.father, tree.part.mother, tree.part.tribe']);
  const empty: Person = { id: 'e', relation: 'father', of: 'me', gender: 'm' };
  assert.deepEqual(stateWords([me, empty], empty, t), ['tree.state.unfilled']);
  assert.deepEqual(stateWords([me, wife], wife, t), []);
});

test('figureLabel', () => {
  assert.equal(figureLabel({ relation: 'R', name: 'N', deceased: true, states: ['S'] }, t), 'R: N tree.zl, S. tree.open');
  assert.equal(figureLabel({ relation: 'R', name: 'N', states: [] }, t), 'R: N. tree.open');
});

test('statusLine: text and tone per state', () => {
  assert.deepEqual(statusLine({ kind: 'request', name: 'דנה' }, t), { text: 'me.family.request|name=דנה', tone: 'request' });
  assert.deepEqual(statusLine({ kind: 'missing', n: 2 }, t), { text: 'me.family.missing|n=2', tone: 'missing' });
  assert.deepEqual(statusLine({ kind: 'empty' }, t), { text: 'me.family.empty', tone: 'muted' });
  assert.deepEqual(statusLine({ kind: 'sent', name: 'יוסי' }, t), { text: 'me.family.sent|name=יוסי', tone: 'muted' });
  assert.deepEqual(statusLine({ kind: 'complete', date: '27.10' }, t), { text: 'me.family.updated|date=27.10', tone: 'muted' });
  assert.deepEqual(statusLine({ kind: 'complete', date: null }, t), { text: 'me.family.complete', tone: 'muted' });
});

test('israelDayMonth uses the Israel calendar day', () => {
  assert.equal(israelDayMonth(Date.parse('2026-10-27T22:30:00Z') / 1000), 'י״ז בחשוון (28.10)'); // 00:30 on the 28th in Israel (UTC+2)
  assert.equal(israelDayMonth(Date.parse('2026-10-27T12:00:00Z') / 1000), 'ט״ז בחשוון (27.10)');
  assert.equal(israelDayMonth(Date.parse('2026-03-05T10:00:00Z') / 1000), 'ט״ז באדר (5.3)');
});

test('ill: a state word and the label says so; deceased wins', () => {
  const g: Person = { id: 'i', relation: 'mother', of: 'me', gender: 'f', hebrewFirst: 'שרה', ill: true, motherName: 'לאה', fatherName: 'דוד' };
  assert.deepEqual(stateWords([me, g], g, t), ['tree.ill.a11y']);
  assert.deepEqual(stateWords([me, { ...g, deceased: true }], { ...g, deceased: true }, t), ['tree.state.deceased']);
});

test('"me" is the figure whose userId is mine; the partner stored as self is not me', () => {
  const a: Person = { ...me, userId: 'UA' };
  const b: Person = { ...wife, userId: 'UB' };
  const dad: Person = { id: 'f', relation: 'father', of: 'w', gender: 'm' };
  const tree = [a, b, dad];
  // B opens the tree: B's own figure is "me", A (stored as self) is "the husband of B", B's father is "mine"
  assert.equal(isMe(tree, b, { myId: 'UB' }), true);
  assert.equal(isMe(tree, a, { myId: 'UB' }), false);
  assert.equal(relationLabel(tree, b, t, { myId: 'UB' }), 'tree.rel.self');
  assert.equal(relationLabel(tree, a, t, { myId: 'UB' }), 'tree.rel.husband|name=דוגמה');
  assert.equal(relationLabel([a, { ...b, hebrewFirst: '' }, dad], dad, t, { myId: 'UB' }), 'tree.rel.ofMe|kind=tree.role.father');
  assert.equal(relationLabel([a, { ...b, hebrewFirst: '' }, dad], dad, t, { myId: 'UA' }), 'tree.role.father');
  // A without any userId in the tree: self is me (a family not linked yet)
  assert.equal(isMe([me, wife], me, {}), true);
  assert.equal(isMe([me, wife], wife, {}), false);
});

test('a gabbai\'s read-only view never says "me"', () => {
  const tree = [{ ...me, userId: 'UA' }, wife];
  assert.equal(isMe(tree, tree[0]!, { myId: 'UA', neutral: true }), false);
  assert.equal(relationLabel(tree, tree[0]!, t, { myId: 'UA', neutral: true }), 'tree.role.spouseM');
  const dad: Person = { id: 'f', relation: 'father', of: 'me', gender: 'm' };
  assert.equal(relationLabel([{ ...me, hebrewFirst: '' }, dad], dad, t, { neutral: true }), 'tree.role.father');
});
