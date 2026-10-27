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

test('pushTextError rejects control and bidi characters, allows ZWJ and Hebrew', () => {
  for (const c of [0x09, 0x00, 0x1f, 0x7f, 0x85, 0x9f, 0x2028, 0x2029, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069]) {
    assert.notEqual(pushTextError('a' + String.fromCodePoint(c) + 'b'), null, c.toString(16));
  }
  assert.equal(pushTextError('a\u200db\u05d0'), null);
  assert.equal(pushTextError('  ' + 'x'.repeat(80) + '  '), null); // trimmed first, like the server
  assert.equal(pushTextError('\t'), 'multiline');
});
