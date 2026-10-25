import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { birthDayOptions, birthMonthOptions, birthYearOptions, currentHebrewYear, updateHebrewBirthDate, validHebrewBirthDate, validateProfile } from '../src/dates.ts';
import { EMPTY_PROFILE, MONTHS, newChild, normalizeProfile } from '../src/types.ts';

test('all Hebrew months have their correct day-30 birthday boundary', () => {
  const short = ['tevet', 'adar', 'adar_ii', 'iyar', 'tamuz', 'elul'];
  for (const month of MONTHS) {
    assert.equal(validHebrewBirthDate({ day: 29, month: month.value, year: month.value.startsWith('adar_') ? 5784 : 5783 }), true, month.value);
    assert.equal(validHebrewBirthDate({ day: 30, month: month.value, year: month.value.startsWith('adar_') ? 5784 : 5783 }), !short.includes(month.value), month.value);
    assert.equal(validHebrewBirthDate({ day: 31, month: month.value, year: month.value.startsWith('adar_') ? 5784 : 5783 }), false, month.value);
    assert.equal(birthDayOptions(month.value).some(option => option.value === '30'), !short.includes(month.value), month.value);
  }
});

test('birthday dropdowns have Hebrew day labels and all three Adar choices', () => {
  const days = birthDayOptions('tishrei');
  assert.equal(days[14]?.label, 'ט״ו');
  assert.equal(days[15]?.label, 'ט״ז');
  assert.equal(days[28]?.label, 'כ״ט');
  assert.equal(days[29]?.label, 'ל׳');
  assert.deepEqual(MONTHS.filter(month => month.value.startsWith('adar')).map(month => month.label), ['אדר', 'אדר א׳', 'אדר ב׳']);
});

test('switching day 30 to a short month requires choosing a valid day', () => {
  const changed = updateHebrewBirthDate({ day: 30, month: 'adar_i', year: 5784 }, { month: 'adar_ii' });
  assert.deepEqual(changed, { day: 0, month: 'adar_ii', year: 5784 });
  assert.equal(validHebrewBirthDate(changed), false);
  assert.deepEqual(updateHebrewBirthDate(changed, { day: 29 }), { day: 29, month: 'adar_ii', year: 5784 });
  assert.deepEqual(updateHebrewBirthDate({ day: 30, month: 'nisan', year: 5783 }, { month: 'sivan' }), { day: 30, month: 'sivan', year: 5783 });
});

test('incomplete, mistyped and out-of-range Hebrew birthdays are rejected', () => {
  for (const value of [null, '', 'כ״ט אדר', [], {}, { day: 1 }, { month: 'adar' }, { day: 0, month: 'nisan' }, { day: -1, month: 'nisan' }, { day: 1.5, month: 'nisan' }, { day: '29', month: 'adar' }, { day: true, month: 'adar' }, { day: 1, month: 'unknown' }, { day: 1, month: 'adar', year: 5784 }]) {
    assert.equal(validHebrewBirthDate(value), false, JSON.stringify(value));
  }
});

test('members and children save Hebrew birthdays without a Gregorian date', () => {
  const profile = { ...structuredClone(EMPTY_PROFILE), name: 'חבר', firstName: 'חבר', lastName: 'דוגמה', tribe: 'yisrael' as const, hebrewBirthDate: { day: 30, month: 'cheshvan' as const, year: 5783 } };
  profile.children = [{ ...newChild('son'), name: 'בן', hebrewBirthDate: { day: 30, month: 'adar_i', year: 5784 }, barMitzvahDate: '2030-10-12' }];
  assert.equal(validateProfile(profile), null);
  profile.children[0]!.hebrewBirthDate = { day: 30, month: 'adar_ii', year: 5784 };
  assert.ok(validateProfile(profile));
  profile.children[0]!.hebrewBirthDate = null;
  assert.ok(validateProfile(profile));
});

test('legacy birthdays and permanent child identities survive local normalization', () => {
  const child = { ...newChild('daughter'), id: 'permanent-child', name: 'בת', birthDate: '2005-10-10' };
  const { hebrewBirthDate: ignored, ...legacyChild } = child;
  const profile = normalizeProfile({ name: 'חבר', firstName: 'חבר', lastName: 'דוגמה', tribe: 'yisrael', birthDate: '1980-05-23', children: [legacyChild as typeof child] });
  assert.equal(profile.birthDate, '1980-05-23');
  assert.equal(profile.hebrewBirthDate, null);
  assert.equal(profile.children[0]?.id, 'permanent-child');
  assert.equal(profile.children[0]?.birthDate, '2005-10-10');
  assert.equal(profile.children[0]?.hebrewBirthDate, null);
  assert.equal(validateProfile(profile), null);
});


test('birth year options start at 5700 and advance with Rosh Hashanah', () => {
  const before = new Date('2026-09-11T09:00:00Z');
  const after = new Date('2026-09-12T09:00:00Z');
  assert.equal(currentHebrewYear(before), 5786);
  assert.equal(currentHebrewYear(after), 5787);
  assert.deepEqual(birthYearOptions(after)[0], { value: '5700', label: 'ת״ש' });
  assert.equal(birthYearOptions(before).at(-1)?.value, '5786');
  assert.equal(birthYearOptions(after).at(-1)?.value, '5787');
});

test('changing years clears impossible Adar selections and variable day 30', () => {
  assert.deepEqual(birthMonthOptions(5783).filter(m => m.value.startsWith('adar')).map(m => m.value), ['adar']);
  assert.deepEqual(birthMonthOptions(5784).filter(m => m.value.startsWith('adar')).map(m => m.value), ['adar_i', 'adar_ii']);
  assert.deepEqual(updateHebrewBirthDate({ day: 29, month: 'adar', year: 5783 }, { year: 5784 }), { day: 29, month: '', year: 5784 });
  for (const month of ['cheshvan', 'kislev'] as const) {
    assert.equal(birthDayOptions(month, 5783).length, 30);
    assert.equal(birthDayOptions(month, 5784).length, 29);
    assert.deepEqual(updateHebrewBirthDate({ day: 30, month, year: 5783 }, { year: 5784 }), { day: 0, month, year: 5784 });
  }
});

test('future birthdays, missing years and years outside the dropdown are rejected', () => {
  const now = new Date('2026-10-25T10:00:00Z');
  for (const value of [
    { day: 1, month: 'tishrei' }, { day: 1, month: 'tishrei', year: null },
    { day: 1, month: 'tishrei', year: 5699 }, { day: 1, month: 'tishrei', year: 5788 },
    { day: 15, month: 'cheshvan', year: 5787 }, { day: 1, month: 'nisan', year: '5783' },
  ]) assert.equal(validHebrewBirthDate(value, now), false, JSON.stringify(value));
  assert.equal(validHebrewBirthDate({ day: 14, month: 'cheshvan', year: 5787 }, now), true);
});

test('client agrees with independent Python calendar fixtures for 101 Hebrew years', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/hebrew-years.json', import.meta.url), 'utf8'));
  for (const fixture of fixtures) {
    assert.deepEqual(birthMonthOptions(fixture.year).map(month => month.value).sort(), Object.keys(fixture.months).sort());
    for (const [month, length] of Object.entries(fixture.months)) {
      assert.equal(birthDayOptions(month as 'tishrei', fixture.year).length, length, `${fixture.year} ${month}`);
    }
  }
});
