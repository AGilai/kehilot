import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkForUpdate, isNewer, parseBuildNumber, shouldCheck } from '../src/update/check.ts';

const release = (tag: string, assets: { name: string; browser_download_url: string }[]) => JSON.stringify({ tag_name: tag, assets });
const reply = (status: number, body: string) => (async () => ({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(body) })) as unknown as typeof fetch;
const APK = { name: 'kehilot-test-12.apk', browser_download_url: 'https://example.test/kehilot-test-12.apk' };

test('parseBuildNumber', () => {
  assert.equal(parseBuildNumber('android-test-12'), 12);
  assert.equal(parseBuildNumber('android-test-0'), 0);
  for (const bad of ['v12', 'ios-test-12', 'android-test-', 'android-test-1a', 'android-test-1.2', 'xandroid-test-3', '']) assert.equal(parseBuildNumber(bad), null, bad);
});

test('isNewer', () => {
  assert.equal(isNewer('android-test-13', 12), true);
  assert.equal(isNewer('android-test-12', 12), false);
  assert.equal(isNewer('android-test-11', 12), false);
  assert.equal(isNewer('nonsense', 12), false);
});

test('checkForUpdate: newer release returns build and url', async () => {
  let seen: { url: string; init?: RequestInit } | null = null;
  const f = (async (url: string, init?: RequestInit) => { seen = { url, init }; return { status: 200, ok: true, json: async () => JSON.parse(release('android-test-13', [{ name: 'notes.txt', browser_download_url: 'x' }, APK])) }; }) as unknown as typeof fetch;
  assert.deepEqual(await checkForUpdate(f, 'AGilai/kehilot', 12), { build: 13, url: APK.browser_download_url });
  assert.equal(seen!.url, 'https://api.github.com/repos/AGilai/kehilot/releases/latest');
  assert.deepEqual(seen!.init?.headers, { Accept: 'application/vnd.github+json' });
});

test('checkForUpdate: same, older, other tag, no apk, bad status, throw all give null', async () => {
  assert.equal(await checkForUpdate(reply(200, release('android-test-12', [APK])), 'o/r', 12), null);
  assert.equal(await checkForUpdate(reply(200, release('android-test-9', [APK])), 'o/r', 12), null);
  assert.equal(await checkForUpdate(reply(200, release('v2', [APK])), 'o/r', 12), null);
  assert.equal(await checkForUpdate(reply(200, release('android-test-13', [])), 'o/r', 12), null);
  assert.equal(await checkForUpdate(reply(200, '{}'), 'o/r', 12), null);
  assert.equal(await checkForUpdate(reply(404, '{}'), 'o/r', 12), null);
  assert.equal(await checkForUpdate((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'o/r', 12), null);
  assert.equal(await checkForUpdate((async () => ({ status: 200, ok: true, json: async () => { throw new Error('bad json'); } })) as unknown as typeof fetch, 'o/r', 12), null);
});

test('shouldCheck: at most once per 6 hours', () => {
  const H = 3600_000;
  assert.equal(shouldCheck(null, 1000), true);
  assert.equal(shouldCheck(0, 5 * H), false);
  assert.equal(shouldCheck(0, 6 * H), true);
});

test('checkLatest: replied is true only when GitHub answered 200 with JSON', async () => {
  const { checkLatest } = await import('../src/update/check.ts');
  assert.deepEqual(await checkLatest(reply(200, release('android-test-13', [APK])), 'o/r', 12), { replied: true, update: { build: 13, url: APK.browser_download_url } });
  assert.deepEqual(await checkLatest(reply(200, release('android-test-12', [APK])), 'o/r', 12), { replied: true, update: null });
  assert.deepEqual(await checkLatest(reply(404, '{}'), 'o/r', 12), { replied: false, update: null });
  assert.deepEqual(await checkLatest((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'o/r', 12), { replied: false, update: null });
});

test('visibleUpdate: hidden until dismissal is read, and once dismissed or installed', async () => {
  const { visibleUpdate } = await import('../src/update/check.ts');
  const f = { build: 13, url: 'u' };
  assert.equal(visibleUpdate(f, null, 12), null);
  assert.equal(visibleUpdate(null, 0, 12), null);
  assert.deepEqual(visibleUpdate(f, 0, 12), f);
  assert.equal(visibleUpdate(f, 13, 12), null);
  assert.deepEqual(visibleUpdate(f, 12, 12), f);
  assert.equal(visibleUpdate(f, 0, 13), null);
});
