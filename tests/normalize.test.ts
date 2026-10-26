import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, normalizeWithMap, queryWords, snippet } from '../src/search/normalize.ts';

test('strips niqqud and cantillation', () => {
  assert.equal(normalize('בְּרֵאשִׁ֖ית'), 'בראשית');
});

test('folds final letters', () => {
  assert.equal(normalize('שלום'), normalize('שלומ'));
  assert.equal(normalize('ךםןףץ'), 'כמנפצ');
});

test('removes geresh, gershayim and quotes', () => {
  assert.equal(normalize('צה"ל'), 'צהל');
  assert.equal(normalize('צה״ל'), 'צהל');
  assert.equal(normalize('ג׳'), 'ג');
  assert.equal(normalize("ג'"), 'ג');
  assert.equal(normalize('א‏ב‪ג⁦ד'), 'אבגד');
});

test('maqaf splits words', () => {
  assert.equal(normalize('בית־הכנסת'), 'בית הכנסת');
  assert.equal(normalize('א׀ב׃ג׆ד'), 'א ב ג ד');
});

test('lower-cases Latin, turns other characters into single spaces, trims', () => {
  assert.equal(normalize('  Hello, WORLD!!  2026 '), 'hello world 2026');
  assert.equal(normalize('a - - b'), 'a b');
});

test('map points back to original indices', () => {
  const s = 'בְּרֵאשִׁית־ם';
  const { text, map } = normalizeWithMap(s);
  assert.equal(text, 'בראשית מ');
  assert.equal(map.length, text.length);
  assert.equal(s[map[0]!], 'ב');
  assert.equal(s[map[1]!], 'ר');
  assert.equal(s[map[text.length - 1]!], 'ם');
  for (let i = 0; i < text.length; i++) assert.ok(map[i]! >= 0 && map[i]! < s.length);
  assert.ok(map.every((v, i) => i === 0 || v >= map[i - 1]!));
});

test('query with niqqud matches plain text and the reverse', () => {
  const plain = normalize('שבת שלום לכולם');
  for (const w of queryWords('שַׁבָּת שָׁלוֹם')) assert.ok(plain.includes(w), w);
  const pointed = normalize('שַׁבָּת שָׁלוֹם');
  for (const w of queryWords('שבת שלומ')) assert.ok(pointed.includes(w), w);
  assert.deepEqual(queryWords('  '), []);
});

test('snippet is cut from the original around the first match', () => {
  const text = 'א'.repeat(100) + ' בְּרֵאשִׁית ' + 'ב'.repeat(100);
  const s = snippet(text, queryWords('בראשית'), 40);
  assert.ok(s.includes('בְּרֵאשִׁית'));
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok([...s].length <= 45);
  assert.equal(snippet('short text', ['zzz']), 'short text');
});
