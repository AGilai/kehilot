import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validPhone, validateProfile } from '../src/dates.ts';
import { EMPTY_PROFILE, newChild, normalizeProfile } from '../src/types.ts';
import type { Child, Profile } from '../src/types.ts';

const member = (): Profile => ({ ...structuredClone(EMPTY_PROFILE), name: 'חבר לדוגמה', firstName: 'חבר', lastName: 'לדוגמה', tribe: 'yisrael' });
const child = (gender: Child['gender'] = 'son'): Child => ({ ...newChild(gender), name: 'שם לדוגמה', birthDate: '2005-10-10' });

test('old saved profiles gain empty family and phone fields without losing data', () => {
  const old = { name: 'שם שמור', torahName: 'שם לתורה', wifePrayerName: '', birthDate: '', barMitzvahParasha: 'נח', yahrzeits: [] };
  const upgraded = normalizeProfile(old);
  assert.equal(upgraded.phone, '');
  assert.equal(upgraded.wifePhone, '');
  assert.deepEqual(upgraded.children, []);
  assert.equal(upgraded.torahName, old.torahName);
  assert.equal(upgraded.barMitzvahParasha, 'נח');
});

test('local and international phones are accepted while malformed numbers are rejected', () => {
  for (const phone of ['', '050-1234567', '+972 (50) 123-4567', '+1 212 555 0100']) assert.ok(validPhone(phone), phone);
  for (const phone of ['abc0501234567', '050', '++972501234567', '1'.repeat(16)]) assert.equal(validPhone(phone), false, phone);
  const profile = member();
  profile.phone = '050-1234567';
  profile.wifePhone = '+972501234568';
  assert.equal(validateProfile(profile), null);
  profile.wifePhone = 'not a phone';
  assert.ok(validateProfile(profile));
});

test('both sons and daughters can be saved with names and birth dates', () => {
  const profile = member();
  profile.children = [child('son'), child('daughter')];
  assert.equal(validateProfile(profile), null);
  profile.children[0]!.birthDate = '';
  assert.ok(validateProfile(profile));
});

test('spouse prayer fields follow the spouse gender', () => {
  const profile = member();
  profile.children = [
    { ...child('son'), married: true, spouseName: 'שרה', spousePrayerName: 'שרה בת רבקה' },
    { ...child('daughter'), married: true, spouseName: 'יצחק', spouseTribe: 'levi', spouseTorahName: 'יצחק בן אברהם' },
  ];
  assert.equal(validateProfile(profile), null);
  profile.children[0]!.spouseTorahName = 'wrong field';
  assert.ok(validateProfile(profile));
  profile.children[0]!.spouseTorahName = '';
  profile.children[1]!.spousePrayerName = 'wrong field';
  assert.ok(validateProfile(profile));
});

test('bar mitzvah Saturday is independent of birth date and may be scheduled ahead', () => {
  const profile = member();
  profile.children = [{ ...child(), barMitzvahParasha: 'נח', barMitzvahDate: '2018-10-13' }];
  assert.equal(validateProfile(profile), null);
  profile.children[0]!.barMitzvahDate = '2018-10-14';
  assert.ok(validateProfile(profile));
  profile.children[0]!.barMitzvahDate = '2000-01-01';
  assert.ok(validateProfile(profile));
  profile.children[0]!.barMitzvahDate = '2030-10-12';
  assert.equal(validateProfile(profile), null);
});

test('invalid child dates, duplicate identities and unmarked spouse data are rejected', () => {
  const profile = member();
  const boy = child();
  profile.children = [boy, { ...boy }];
  assert.ok(validateProfile(profile));
  profile.children = [{ ...boy, birthDate: '2025-02-29' }];
  assert.ok(validateProfile(profile));
  profile.children = [{ ...boy, birthDate: '2100-01-01' }];
  assert.ok(validateProfile(profile));
  profile.children = [{ ...boy, spouseName: 'שם בת זוג' }];
  assert.ok(validateProfile(profile));
  profile.children = [{ ...child('daughter'), barMitzvahParasha: 'נח' }];
  assert.ok(validateProfile(profile));
});
