import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { loadShabbat, loadZmanim } from '../src/api.ts';
import { clockTime, israelDate, upcomingFriday, validateProfile } from '../src/dates.ts';
import { EMPTY_PROFILE } from '../src/types.ts';
import type { Profile } from '../src/types.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const member = (): Profile => ({ ...EMPTY_PROFILE, name: 'חבר לדוגמה', firstName: 'חבר', lastName: 'לדוגמה', tribe: 'yisrael', yahrzeits: [] });

test('the civil day follows Israel even across UTC midnight', () => {
  assert.equal(israelDate(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
  assert.equal(israelDate(new Date('2026-07-01T21:30:00Z')), '2026-07-02');
});

test('Friday stays today; Saturday chooses next Friday', () => {
  assert.equal(upcomingFriday('2026-10-23'), '2026-10-23');
  assert.equal(upcomingFriday('2026-10-24'), '2026-10-30');
  assert.equal(upcomingFriday('2026-12-31'), '2027-01-01');
});

test('clock formatting observes the Israeli daylight-saving transition', () => {
  assert.equal(clockTime('2026-10-24T12:00:00Z'), '15:00');
  assert.equal(clockTime('2026-10-25T12:00:00Z'), '14:00');
  assert.equal(clockTime(undefined), '—');
  assert.equal(clockTime('bad'), '—');
});

test('profile accepts leap-day birthdays but rejects normalized and future dates', () => {
  const profile = member();
  profile.birthDate = '2000-02-29';
  assert.equal(validateProfile(profile), null);
  for (const date of ['2001-02-29', '2000-04-31', '2100-01-01', '01/01/2000']) {
    profile.birthDate = date;
    assert.ok(validateProfile(profile), date);
  }
});

test('yahrzeits distinguish the permitted day ranges in Adar I and Adar II', () => {
  const profile = member();
  profile.yahrzeits.push({ id: 'one', name: 'שם לדוגמה', relationship: 'mother', day: 30, month: 'adar_i', year: '5784' });
  assert.equal(validateProfile(profile), null);
  profile.yahrzeits[0]!.month = 'adar_ii';
  assert.ok(validateProfile(profile));
  profile.yahrzeits[0]!.day = 29;
  assert.equal(validateProfile(profile), null);
});

test('a name is required and blank yahrzeit names cannot be saved', () => {
  assert.ok(validateProfile({ ...member(), firstName: ' ' }));
  const profile = member();
  profile.yahrzeits.push({ id: 'one', name: ' ', relationship: 'father', day: 1, month: 'nisan', year: '' });
  assert.ok(validateProfile(profile));
});

// This date has no supplied Yeshiva table, so it exercises the live calculation.
const date = '2026-10-26';
const times = {
  sunrise: `${date}T05:51:18+02:00`, sunset: `${date}T16:57:15+02:00`,
  chatzot: `${date}T11:24:16+02:00`, sofZmanShma: `${date}T08:37:47+02:00`,
  sofZmanTfilla: `${date}T09:33:17+02:00`, plagHaMincha: `${date}T15:47:52+02:00`,
};
function mockJson(data: unknown) {
  globalThis.fetch = async () => new Response(JSON.stringify(data), { status: 200 });
}

test('zmanim requires every requested time for exactly the requested date', async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('sec'), '1');
    assert.equal(url.searchParams.get('date'), date);
    assert.equal(url.searchParams.get('tzid'), 'Asia/Jerusalem');
    return new Response(JSON.stringify({ date, times }), { status: 200 });
  };
  const result = await loadZmanim(date);
  assert.equal(clockTime(result.times.nightfall), '17:16');
  assert.equal(clockTime(result.times.sofZmanShma), '08:37');
  mockJson({ date: '2026-10-24', times });
  await assert.rejects(loadZmanim(date));
  mockJson({ date, times: { ...times, sunrise: '2026-10-24T12:00:00+02:00' } });
  await assert.rejects(loadZmanim(date));
  mockJson({ date, times: { ...times, sunset: null } });
  await assert.rejects(loadZmanim(date));
  // The new rule needs exact sunset and solar noon, not a pre-rounded nightfall field.
  mockJson({ date, times: { ...times, chatzot: null, tzeit7083deg: `${date}T17:27:00+02:00` } });
  await assert.rejects(loadZmanim(date));
});

test('a provider outage rejects instead of substituting made-up times', async () => {
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(loadZmanim(date));
});

test('the supplied Yeshiva daily table is available without a provider request', async () => {
  globalThis.fetch = async () => { throw new Error('No request should be made for the supplied table'); };
  const result = await loadZmanim('2026-10-25');
  assert.deepEqual(Object.fromEntries(Object.entries(result.times).map(([key, value]) => [key, clockTime(value)])), {
    sunrise: '05:51', sofZmanShma: '08:37', sofZmanTfilla: '09:33',
    minchaGedola: '11:54', plagHaMincha: '15:49', sunset: '16:57', nightfall: '17:16',
  });
  assert.match(result.source, /אתר ישיבה/);
});

test('Shabbat uses distinct cities, second-precision sunsets and Yeshiva candle offsets', async () => {
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname === '/zmanim') {
      const sunset = url.searchParams.get('longitude') === '34.8878' ? '2026-10-30T16:52:40+02:00' : '2026-10-30T16:53:20+02:00';
      return new Response(JSON.stringify({ date: '2026-10-30', times: { sunset } }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: [
      { category: 'candles', date: '2026-10-29T16:00:00+02:00' },
      { category: 'candles', date: '2026-10-30T16:00:00+02:00' },
      { category: 'parashat', hebrew: 'פרשת וירא' },
    ] }), { status: 200 });
  };
  const result = await loadShabbat(date);
  assert.equal(result.friday, '2026-10-30');
  assert.equal(result.parasha, 'פרשת וירא');
  assert.equal(clockTime(result.petahTikva), '16:12');
  assert.equal(clockTime(result.telAviv), '16:32');
  const astronomy = urls.filter(url => url.pathname === '/zmanim');
  assert.equal(astronomy.length, 2);
  assert.notEqual(astronomy[0]!.searchParams.get('longitude'), astronomy[1]!.searchParams.get('longitude'));
  assert.ok(astronomy.every(url => url.searchParams.get('tzid') === 'Asia/Jerusalem' && url.searchParams.get('date') === '2026-10-30' && url.searchParams.get('sec') === '1'));
});

test('Shabbat never displays candles from another date', async () => {
  mockJson({ items: [{ category: 'candles', date: '2026-10-29T16:00:00+02:00' }] });
  await assert.rejects(loadShabbat(date));
});
