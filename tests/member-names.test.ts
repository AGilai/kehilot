import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateProfile } from '../src/dates.ts';
import { EMPTY_PROFILE, normalizeProfile } from '../src/types.ts';

test('legacy full names stay intact without guessing which part is the surname', () => {
  for (const name of ['כהן משה דוד', 'משה דוד בן עמי']) {
    const profile = normalizeProfile({ name, tribe: 'yisrael' });
    assert.equal(profile.name, name);
    assert.equal(profile.firstName, '');
    assert.equal(profile.lastName, '');
    assert.match(validateProfile(profile)!, /שם פרטי/);
  }
});

test('multiword first names and surnames are stored separately and compose the display name', () => {
  const profile = normalizeProfile({ ...EMPTY_PROFILE, tribe: 'yisrael', name: 'ישן', firstName: '  משה דוד  ', lastName: '  בן עמי  ' });
  assert.equal(profile.firstName, 'משה דוד');
  assert.equal(profile.lastName, 'בן עמי');
  assert.equal(profile.name, 'משה דוד בן עמי');
  assert.equal(validateProfile(profile), null);
  assert.deepEqual(normalizeProfile(profile), profile);
});

test('both name fields are required and their combined length is bounded', () => {
  const profile = normalizeProfile({ ...EMPTY_PROFILE, tribe: 'yisrael', firstName: 'משה', lastName: 'כהן' });
  assert.match(validateProfile({ ...profile, firstName: ' ' })!, /שם פרטי/);
  assert.match(validateProfile({ ...profile, lastName: ' ' })!, /שם משפחה/);
  assert.ok(validateProfile({ ...profile, firstName: 'א'.repeat(100), lastName: 'ב'.repeat(100) }));
  assert.equal(validateProfile({ ...profile, firstName: 'א'.repeat(99), lastName: 'ב'.repeat(100) }), null);
});
