import test from 'node:test';
import assert from 'node:assert/strict';
import { copyToFree, previewOf, sheetCaption } from '../src/client/composeState.ts';

const built = { title: 'T', body: 'B' };
test('copyToFree copies into empty free fields', () => {
  const r = copyToFree({ title: '', body: '', lastCopied: null }, built);
  assert.deepEqual(r, { title: 'T', body: 'B', lastCopied: built, copied: true });
});
test('copyToFree keeps what the person edited', () => {
  const r = copyToFree({ title: 'mine', body: '', lastCopied: null }, built);
  assert.equal(r.copied, false);
  assert.equal(r.title, 'mine');
  assert.equal(r.lastCopied, null);
});
test('copyToFree re-copies when both still equal the last copy', () => {
  const r = copyToFree({ title: 'old', body: 'older', lastCopied: { title: 'old', body: 'older' } }, built);
  assert.deepEqual(r, { title: 'T', body: 'B', lastCopied: built, copied: true });
});
test('copyToFree keeps when only one equals the last copy', () => {
  const r = copyToFree({ title: 'old', body: 'edited', lastCopied: { title: 'old', body: 'older' } }, built);
  assert.equal(r.copied, false);
});
test('sheetCaption', () => {
  assert.equal(sheetCaption('gabbai', 'approve', 'celebration'), 'sheetAuto');
  assert.equal(sheetCaption('tech', 'approve', 'condolence'), 'sheetAuto');
  assert.equal(sheetCaption('member', 'approve', 'celebration'), 'sheetPending');
  assert.equal(sheetCaption('member', undefined, 'event'), 'sheetPending');
  assert.equal(sheetCaption('member', 'auto', 'celebration'), 'sheetAuto');
  assert.equal(sheetCaption('gabbai', 'approve', 'general'), null);
  assert.equal(sheetCaption('member', 'auto', 'weekly'), null);
});

test('previewOf names the missing fields instead of breaking', () => {
  const label = (k: string) => ({ date: 'יום ותאריך', time: 'שעה', place: 'מקום', name: 'שם האירוע' }[k] ?? k);
  const p = previewOf('event', { name: 'ערב לימוד', for: 'all' }, 'he', label);
  assert.deepEqual(p.missing, ['date', 'time', 'place']);
  assert.equal(p.title, 'ערב לימוד');
  assert.match(p.body, /‹יום ותאריך›, בשעה ‹שעה› · ‹מקום›/);
  assert.ok(!p.body.includes('2000'));
});
test('previewOf with nothing filled does not throw for any template', () => {
  for (const id of ['event', 'mazal', 'condolence'] as const) {
    const p = previewOf(id, {}, 'he', k => k);
    assert.ok(p.missing.length > 0);
    assert.ok(!p.body.includes('tpl.'));
  }
});
test('previewOf of a complete form has no missing fields', () => {
  const p = previewOf('event', { name: 'א', date: '2026-11-03', time: '20:30', place: 'בית הכנסת', for: 'women' }, 'he', k => k);
  assert.deepEqual(p.missing, []);
  assert.match(p.body, /20:30/);
});
