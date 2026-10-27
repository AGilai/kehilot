import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TAGS, TAG_NAME_MAX, assignmentBody, canAddTag, sortTags, starterToOffer, tagListLabel, toggleId, validateTagName } from '../src/client/tagsView.ts';

// All names are invented.
const tags = [{ tagId: 't1', name: 'רב' }, { tagId: 't2', name: 'Tech' }, { tagId: 't3', name: 'גזבר' }];

test('name validation mirrors the server: trim, 1-24 code points, no duplicate ignoring case', () => {
  assert.deepEqual(validateTagName('  חזן  ', tags), { ok: true, name: 'חזן' });
  assert.deepEqual(validateTagName('   ', tags), { ok: false, error: 'required' });
  assert.deepEqual(validateTagName('א'.repeat(TAG_NAME_MAX), tags), { ok: true, name: 'א'.repeat(24) });
  assert.deepEqual(validateTagName('א'.repeat(25), tags), { ok: false, error: 'tooLong' });
  assert.deepEqual(validateTagName('😀'.repeat(24), tags).ok, true); // code points, not UTF-16 units
  assert.deepEqual(validateTagName(' tech ', tags), { ok: false, error: 'duplicate' });
  assert.deepEqual(validateTagName('a\nb', tags), { ok: false, error: 'invalid' });
});

test('renaming may keep the same tag (case change) but not take another one\'s name', () => {
  assert.deepEqual(validateTagName('TECH', tags, 't2'), { ok: true, name: 'TECH' });
  assert.deepEqual(validateTagName('רב', tags, 't2'), { ok: false, error: 'duplicate' });
});

test('limit of 20', () => {
  const many = Array.from({ length: MAX_TAGS }, (_, i) => ({ tagId: `t${i}`, name: `n${i}` }));
  assert.equal(canAddTag(many), false);
  assert.equal(canAddTag(many.slice(1)), true);
});

test('starter set: shown only when the sheet opened on an empty list; added ones drop out', () => {
  const sug = ['גבאי', 'רב', 'חזן'];
  assert.deepEqual(starterToOffer(sug, [], true), sug);
  assert.deepEqual(starterToOffer(sug, [{ name: ' רב ' }], true), ['גבאי', 'חזן']);
  assert.deepEqual(starterToOffer(sug, [{ name: 'רב' }, { name: 'גבאי' }, { name: 'חזן' }], true), []);
  assert.deepEqual(starterToOffer(sug, tags, false), []);
  assert.deepEqual(starterToOffer(sug, [], false), []);
});

test('chip order is by name, Hebrew and Latin each in their own order, stable, without mutating', () => {
  const before = [...tags];
  assert.deepEqual(sortTags(tags).map(x => x.name), ['גזבר', 'רב', 'Tech'].sort((a, b) => a.localeCompare(b, 'he')));
  assert.deepEqual(sortTags([{ name: 'ב' }, { name: 'א' }]).map(x => x.name), ['א', 'ב']);
  assert.deepEqual(tags, before);
});

test('assignment body keeps existing, distinct IDs only', () => {
  assert.deepEqual(assignmentBody(['t1', 't1', 'zz', 't3'], tags), { tagIds: ['t1', 't3'] });
  assert.deepEqual(assignmentBody([], tags), { tagIds: [] });
});

test('toggleId adds or removes', () => {
  assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
});

test('label of a row of tags for screen readers', () => {
  assert.equal(tagListLabel([{ tagId: 't3', name: 'גזבר' }, { tagId: 't1', name: 'רב' }]), 'גזבר, רב');
});
