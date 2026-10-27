import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pushKeys, pushTextError, savedText } from '../src/client/pushTextsView.ts';

test('pushTextError: empty and 80 code points pass, 81 and newlines fail', () => {
  assert.equal(pushTextError(''), null);
  assert.equal(pushTextError('x'.repeat(80)), null);
  assert.equal(pushTextError('😀'.repeat(80)), null);
  assert.equal(pushTextError('x'.repeat(81)), 'tooLong');
  assert.equal(pushTextError('a\nb'), 'multiline');
  assert.equal(pushTextError('a\u2028b'), 'multiline');
});

test('savedText and pushKeys read the server shape', () => {
  const data = { defaults: { a: { he: 'א', en: 'a' }, b: { he: 'ב', en: 'b' } }, custom: { a: { en: 'x' } } };
  assert.deepEqual(pushKeys(data), ['a', 'b']);
  assert.equal(savedText(data, 'a', 'en'), 'x');
  assert.equal(savedText(data, 'a', 'he'), '');
  assert.equal(savedText(data, 'b', 'en'), '');
});
