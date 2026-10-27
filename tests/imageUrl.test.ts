import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createImageUrls } from '../src/media/imageUrl.ts';
import { ApiCodeError } from '../src/client/errors.ts';

const T0 = Date.parse('2026-10-26T10:00:00Z');
const grant = (n: number, secs = 300) => ({ url: `https://s3.invalid/img-${n}`, expiresAt: Math.floor(T0 / 1000) + secs });

test('url reused until 30 s before expiry', async () => {
  let now = T0; let n = 0;
  const urls = createImageUrls({ messageImage: async () => grant(++n) }, () => now);
  assert.equal(await urls.get('k', 'm'), 'https://s3.invalid/img-1');
  now = T0 + 269_000;
  assert.equal(await urls.get('k', 'm'), 'https://s3.invalid/img-1');
  now = T0 + 270_000;
  assert.equal(await urls.get('k', 'm'), 'https://s3.invalid/img-2');
  assert.equal(n, 2);
});

test('concurrent gets share one request', async () => {
  let n = 0;
  const urls = createImageUrls({ messageImage: async () => { n++; await new Promise(r => setTimeout(r, 5)); return grant(n); } }, () => T0);
  const [a, b, c] = await Promise.all([urls.get('k', 'm'), urls.get('k', 'm'), urls.get('k', 'm')]);
  assert.equal(n, 1);
  assert.equal(a, b); assert.equal(b, c);
});

test('not_found gives null', async () => {
  const urls = createImageUrls({ messageImage: async () => { throw new ApiCodeError(404, 'not_found'); } }, () => T0);
  assert.equal(await urls.get('k', 'm'), null);
});

test('other errors surface and are not cached', async () => {
  let n = 0;
  const urls = createImageUrls({ messageImage: async () => { n++; if (n === 1) throw new ApiCodeError(503, 'try_again'); return grant(n); } }, () => T0);
  await assert.rejects(urls.get('k', 'm'));
  assert.equal(await urls.get('k', 'm'), 'https://s3.invalid/img-2');
});

test('fresh: true drops the cached url', async () => {
  let n = 0;
  const urls = createImageUrls({ messageImage: async () => grant(++n) }, () => T0);
  assert.equal(await urls.get('k', 'm'), 'https://s3.invalid/img-1');
  assert.equal(await urls.get('k', 'm', { fresh: true }), 'https://s3.invalid/img-2');
});
