// New test (not ported): the date helpers upstream kept in src/dates.ts, now in src/aliyot/dates.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCivilDate, isYomKippur } from '../src/aliyot/dates.ts';
import { serviceForDate } from '../src/aliyot/aliyot.ts';

test('Yom Kippur is detected by Hebrew date and only it keeps a mincha service', () => {
  assert.equal(isYomKippur('2026-09-21'), true);
  assert.equal(isYomKippur('2026-09-12'), false);
  assert.equal(isYomKippur('2026-02-30'), false);
  assert.equal(serviceForDate('2026-09-21', 'mincha'), 'mincha');
  assert.equal(serviceForDate('2026-10-24', 'mincha'), 'shacharit');
});
test('civil dates format day-month-year and reject invalid values', () => {
  assert.equal(formatCivilDate('2026-10-31'), '31-10-2026');
  assert.equal(formatCivilDate(''), '');
  assert.equal(formatCivilDate('bad'), '—');
});
