import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateProfile } from '../src/dates.ts';
import { EMPTY_PROFILE, newChild, normalizeProfile, TRIBES } from '../src/types.ts';
import type { Profile, Tribe } from '../src/types.ts';

const member = (): Profile => ({ ...structuredClone(EMPTY_PROFILE), name: 'חבר', firstName: 'חבר', lastName: 'דוגמה', tribe: 'kohen' });

test('member status requires one of the three dropdown choices', () => {
  const profile = member();
  assert.deepEqual(TRIBES.map(option => option.label), ['כהן', 'לוי', 'ישראל']);
  for (const option of TRIBES) {
    profile.tribe = option.value;
    assert.equal(validateProfile(profile), null);
  }
  for (const invalid of ['', 'כהן', 'other', null, 1]) {
    profile.tribe = invalid as Tribe;
    assert.match(validateProfile(profile)!, /כהן, לוי או ישראל/);
  }
});

test('a married daughter requires an independent son-in-law choice; sons do not', () => {
  const profile = member();
  const son = { ...newChild('son'), name: 'בן', birthDate: '2005-10-10' };
  const daughter = { ...newChild('daughter'), name: 'בת', birthDate: '2000-10-10', married: true };
  profile.children = [son, daughter];
  assert.match(validateProfile(profile)!, /בן הזוג/);
  for (const option of TRIBES) {
    daughter.spouseTribe = option.value;
    assert.equal(validateProfile(profile), null);
  }
  daughter.spouseTribe = 'other' as Tribe;
  assert.ok(validateProfile(profile));
  daughter.spouseTribe = 'levi';
  son.spouseTribe = 'kohen';
  assert.ok(validateProfile(profile));
  son.spouseTribe = '';
  daughter.married = false;
  assert.ok(validateProfile(profile));
  daughter.spouseTribe = '';
  assert.equal(validateProfile(profile), null);
});

test('legacy profiles keep unknown status and permanent child identities', () => {
  const son = { ...newChild('son'), id: 'permanent-son', name: 'בן', birthDate: '2005-10-10' };
  const daughter = { ...newChild('daughter'), id: 'permanent-daughter', name: 'בת', birthDate: '2000-10-10', married: true };
  const { spouseTribe: ignored, ...legacyDaughter } = daughter;
  const profile = normalizeProfile({ name: 'שם שמור', firstName: 'שם', lastName: 'שמור', children: [son, legacyDaughter as typeof daughter] });
  assert.equal(profile.tribe, '');
  assert.equal(profile.children[1]!.spouseTribe, '');
  assert.deepEqual(profile.children.map(child => child.id), ['permanent-son', 'permanent-daughter']);
  assert.ok(validateProfile(profile));
  profile.tribe = 'kohen';
  profile.children[1]!.spouseTribe = 'levi';
  assert.equal(validateProfile(profile), null);
  assert.deepEqual(normalizeProfile(profile), profile);
  assert.equal('tribe' in profile.children[0]!, false);
});
