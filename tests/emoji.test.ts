import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMOJI, codePoints, insertAt } from '../src/kit/emoji.ts';

test('insert at caret', () => {
  assert.deepEqual(insertAt('שלום עולם', { start: 4, end: 4 }, '🕯️'), { text: 'שלום🕯️ עולם', cursor: 4 + '🕯️'.length });
});

test('replace selection', () => {
  assert.deepEqual(insertAt('abcdef', { start: 1, end: 4 }, '🍷'), { text: 'a🍷ef', cursor: 3 });
});

test('cursor after inserted surrogate pair', () => {
  const r = insertAt('ab', { start: 1, end: 1 }, '🎉');
  assert.equal(r.text, 'a🎉b');
  assert.equal(r.cursor, 3); // a + two UTF-16 units
});

test('selection is clamped to the text', () => {
  assert.deepEqual(insertAt('ab', { start: 9, end: 9 }, '❤️'), { text: 'ab❤️', cursor: 2 + '❤️'.length });
  assert.deepEqual(insertAt('ab', { start: 2, end: 1 }, 'x'), { text: 'abx', cursor: 3 });
});

test('codePoints counts ZWJ family as its code points', () => {
  assert.equal(codePoints('👨‍👩‍👧'), 5);
  assert.equal(codePoints('abc'), 3);
});

test('limit check uses code points', () => {
  const s = '😀'.repeat(1000);
  assert.equal(s.length, 2000);
  assert.equal(codePoints(s), 1000);
});

test('emoji set: 6 groups, about 120, no duplicates inside a group', () => {
  assert.equal(EMOJI.length, 6);
  const all = EMOJI.flatMap(g => g.items);
  assert.ok(all.length >= 110 && all.length <= 130, String(all.length));
  assert.ok(all.includes('🕯️') && all.includes('✡️') && all.includes('🕎') && all.includes('📜') && all.includes('🍷'));
  assert.equal(new Set(all).size, all.length);
});
