import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockTime } from '../src/dates.ts';
import { applyYeshivaRules, candleLighting, isCurrentZmanim, yeshivaReference } from '../src/zmanim.ts';

// Hebcal's live second-precision response for the configured Petah Tikva
// coordinates on 2026-10-25. These assertions exercise the calculated fallback;
// it differs from the supplied Yeshiva table for sunrise, Mincha and Plag.
const date = '2026-10-25';
const astronomy = { date, times: {
  sunrise: `${date}T05:51:18+02:00`, sunset: `${date}T16:57:15+02:00`,
  chatzot: `${date}T11:24:16+02:00`, sofZmanShma: `${date}T08:37:47+02:00`,
  sofZmanTfilla: `${date}T09:33:17+02:00`, plagHaMincha: `${date}T15:47:52+02:00`,
} };

test('winter nightfall matches the reported Yeshiva 17:16 after rounding upward', () => {
  const result = applyYeshivaRules(date, astronomy);
  assert.equal(clockTime(result.times.nightfall), '17:16');
  assert.equal(clockTime(result.times.minchaGedola), '11:55');
  assert.equal(clockTime(result.times.sofZmanShma), '08:37');
  assert.equal(clockTime(result.times.sofZmanTfilla), '09:33');
});

test('long summer days use seasonal minutes for nightfall and earliest Mincha', () => {
  const summer = '2026-06-19';
  const result = applyYeshivaRules(summer, { date: summer, times: {
    sunrise: `${summer}T05:00:00+03:00`, sunset: `${summer}T19:00:00+03:00`,
    chatzot: `${summer}T12:00:00+03:00`, sofZmanShma: `${summer}T08:30:00+03:00`,
    sofZmanTfilla: `${summer}T09:40:00+03:00`, plagHaMincha: `${summer}T17:32:30+03:00`,
  } });
  assert.equal(clockTime(result.times.nightfall), '19:21');
  assert.equal(clockTime(result.times.minchaGedola), '12:35');
  assert.equal(clockTime(result.times.plagHaMincha), '17:33');
});

test('short days retain ordinary-minute minimums and exact minutes are not shifted', () => {
  const result = applyYeshivaRules(date, { date, times: {
    sunrise: `${date}T06:00:00+02:00`, sunset: `${date}T16:00:00+02:00`,
    chatzot: `${date}T11:00:00+02:00`, sofZmanShma: `${date}T08:30:00+02:00`,
    sofZmanTfilla: `${date}T09:20:00+02:00`, plagHaMincha: `${date}T14:57:30+02:00`,
  } });
  assert.equal(clockTime(result.times.sunrise), '06:00');
  assert.equal(clockTime(result.times.sunset), '16:00');
  assert.equal(clockTime(result.times.minchaGedola), '11:30');
  assert.equal(clockTime(result.times.nightfall), '16:18');
});

test('cache accepts only the current method, complete times and the requested Israel date', () => {
  const result = yeshivaReference(date)!;
  assert.ok(isCurrentZmanim(result, date));
  assert.equal(isCurrentZmanim(result, '2026-10-26'), false);
  assert.equal(isCurrentZmanim({ ...result, source: 'Hebcal' }, date), false);
  assert.equal(isCurrentZmanim({ ...result, times: { ...result.times, nightfall: undefined } }, date), false);
  assert.equal(isCurrentZmanim({ ...result, times: { ...result.times, nightfall: '2026-10-26T17:16:00+02:00' } }, date), false);
  assert.equal(isCurrentZmanim(applyYeshivaRules(date, astronomy), date), false);
  assert.equal(isCurrentZmanim({ ...result, times: { ...result.times, sunrise: `${date}T05:52:00+02:00` } }, date), false);
  const nextDate = '2026-10-26';
  const next = applyYeshivaRules(nextDate, JSON.parse(JSON.stringify(astronomy).replaceAll(date, nextDate)));
  assert.ok(isCurrentZmanim(next, nextDate));
  assert.equal(isCurrentZmanim({ ...next, source: result.source }, nextDate), false);
});

test('the supplied table never carries over to adjacent days or a later year', () => {
  for (const other of ['2026-10-24', '2026-10-26', '2027-10-25']) {
    assert.equal(yeshivaReference(other), null);
  }
  const first = yeshivaReference(date)!;
  first.times.sunrise = 'bad';
  assert.equal(clockTime(yeshivaReference(date)!.times.sunrise), '05:51');
});

test('invalid astronomy is rejected without substituting fixed offsets', () => {
  assert.throws(() => applyYeshivaRules(date, { ...astronomy, date: '2026-10-24' }));
  assert.throws(() => applyYeshivaRules(date, { date, times: { ...astronomy.times, sunrise: astronomy.times.sunset } }));
  assert.throws(() => applyYeshivaRules(date, { date, times: { ...astronomy.times, chatzot: 'bad' } }));
  assert.throws(() => candleLighting('2026-10-24T17:00:00+03:00', date, 40));
});
