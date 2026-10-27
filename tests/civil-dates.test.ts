import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCivilDate, isYomKippur, pickerDate, pickerDateISO } from '../src/dates.ts';
import { serviceForDate } from '../src/aliyot.ts';

test('Gregorian display is unambiguous DD-MM-YYYY while stored values remain ISO', () => {
  assert.equal(formatCivilDate('2026-10-04'), '04-10-2026');
  assert.equal(formatCivilDate('2024-02-29'), '29-02-2024');
  assert.equal(formatCivilDate('1940-01-02'), '02-01-1940');
  assert.equal(formatCivilDate(''), '');
  for (const value of ['2025-02-29', '2026-04-31', '04-10-2026', 'bad']) {
    assert.equal(formatCivilDate(value), '—'); assert.throws(() => pickerDate(value));
  }
  assert.throws(() => pickerDateISO(new Date('bad')));
});

test('native calendar conversion preserves the chosen day across time zones and DST boundaries', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['Asia/Jerusalem', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      process.env.TZ = zone;
      for (const value of ['2026-03-27', '2026-10-25', '2024-02-29', '1940-01-01', '2030-12-31']) {
        assert.equal(pickerDateISO(pickerDate(value)), value, `${zone}: ${value}`);
        assert.equal(pickerDate(value).getHours(), 12);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('only the actual civil date of Yom Kippur exposes both services and leaving it resets Mincha', () => {
  for (const value of ['2024-10-12', '2025-10-02', '2026-09-21']) {
    assert.equal(isYomKippur(value), true);
    assert.equal(serviceForDate(value, 'mincha'), 'mincha');
  }
  for (const value of ['2026-09-20', '2026-09-22', '2026-10-24', '2026-05-22', '', '21-09-2026', '2026-02-30']) {
    assert.equal(isYomKippur(value), false);
    assert.equal(serviceForDate(value, 'mincha'), 'shacharit');
  }
  assert.equal(serviceForDate('2026-09-21', 'shacharit'), 'shacharit');
});
