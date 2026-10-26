import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BYTES, MAX_EDGE, QUALITY_STEPS, TARGET_BYTES, prepareImage, resizePlan } from '../src/media/prepare.ts';
import type { Manipulate } from '../src/media/prepare.ts';
import { attachAndPost, putToS3 } from '../src/media/upload.ts';
import { ApiCodeError } from '../src/client/errors.ts';
import type { UploadGrant } from '../src/client/types.ts';

test('constants match the spec', () => {
  assert.equal(MAX_EDGE, 2000); assert.equal(TARGET_BYTES, 512000); assert.equal(MAX_BYTES, 1048576);
  assert.deepEqual(QUALITY_STEPS, [0.8, 0.65, 0.5, 0.4]);
});

test('resize keeps aspect and caps long edge at 2000', () => {
  assert.deepEqual(resizePlan(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(resizePlan(3000, 6000), { width: 1000, height: 2000 });
});

test('small image not resized', () => {
  assert.equal(resizePlan(2000, 1500), null);
  assert.equal(resizePlan(800, 600), null);
});

type Call = { actions: unknown[]; compress: number; format: string };
/** A fake manipulator: every result is `size(call)` bytes; the source is 3000x2000 unless said otherwise. */
function fake(size: (c: Call, n: number) => number, dims = { width: 3000, height: 2000 }) {
  const calls: Call[] = [];
  const sizes = new Map<string, number>();
  const manipulate: Manipulate = async (_uri, actions, o) => {
    const c = { actions, compress: o.compress, format: o.format };
    calls.push(c);
    const uri = `out${calls.length}.jpg`;
    sizes.set(uri, size(c, calls.length));
    const r = (actions[0] as { resize?: { width?: number; height?: number } } | undefined)?.resize;
    return { uri, width: r?.width ?? dims.width, height: r?.height ?? (r?.width ? Math.round(dims.height * r.width / dims.width) : dims.height) };
  };
  return { calls, manipulate, sizeOf: async (u: string) => sizes.get(u)! };
}

test('always re-encodes to JPEG', async () => {
  const f = fake(() => 100_000, { width: 800, height: 600 });
  const r = await prepareImage('in.png', f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.format, 'jpeg');
  assert.deepEqual(f.calls[0]!.actions, []); // small: no resize, still re-encoded (drops EXIF)
  assert.equal(r.contentType, 'image/jpeg');
  assert.equal(r.bytes, 100_000);
  assert.equal(r.uri, 'out1.jpg');
});

test('large image is resized to the 2000 cap in the same encode', async () => {
  const f = fake(() => 100_000, { width: 4000, height: 3000 });
  await prepareImage('in.jpg', f);
  assert.deepEqual(f.calls.at(-1)!.actions, [{ resize: { width: 2000, height: 1500 } }]);
});

test('quality steps until under 0.5 MB', async () => {
  const sizeByQuality: Record<number, number> = { 0.8: 900_000, 0.65: 700_000, 0.5: 500_000, 0.4: 300_000 };
  const f = fake(c => sizeByQuality[c.compress]!, { width: 1000, height: 800 });
  const r = await prepareImage('in.jpg', f);
  assert.deepEqual(f.calls.map(c => c.compress), [0.8, 0.65, 0.5]);
  assert.equal(r.bytes, 500_000);
});

test('still over at 0.4 resizes to 1600 and encodes at 0.6', async () => {
  const f = fake(c => (c.compress === 0.6 ? 400_000 : 800_000), { width: 3000, height: 2000 });
  const r = await prepareImage('in.jpg', f);
  const last = f.calls.at(-1)!;
  assert.equal(last.compress, 0.6);
  assert.deepEqual(last.actions, [{ resize: { width: 1600, height: 1067 } }]);
  assert.equal(r.bytes, 400_000);
});

test('over 1 MiB after all steps is image_too_large', async () => {
  const f = fake(() => MAX_BYTES + 1);
  await assert.rejects(prepareImage('in.jpg', f), (e: unknown) => e instanceof ApiCodeError && e.code === 'image_too_large');
});

test('between 0.5 MB and 1 MiB after all steps is accepted', async () => {
  const f = fake(() => 900_000);
  const r = await prepareImage('in.jpg', f);
  assert.equal(r.bytes, 900_000);
});

const grant: UploadGrant = { uploadId: 'U1', url: 'https://s3.example.invalid/x?sig=1', method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, expiresAt: '2026-10-26T10:00:00Z' };

test('upload sends only grant headers, no Authorization', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const blob = new Blob(['x']);
  await putToS3(grant, blob, (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(null, { status: 200 }); }) as typeof fetch);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, grant.url);
  assert.equal(seen[0]!.init.method, 'PUT');
  assert.deepEqual(seen[0]!.init.headers, { 'Content-Type': 'image/jpeg' });
  assert.equal(seen[0]!.init.body, blob);
  assert.ok(!Object.keys(seen[0]!.init.headers as object).some(h => h.toLowerCase() === 'authorization'));
});

test('a failing PUT never leaks the URL in its error', async () => {
  await assert.rejects(putToS3(grant, new Blob(['x']), (async () => new Response(null, { status: 500 })) as typeof fetch),
    (e: unknown) => e instanceof ApiCodeError && e.code === 'upload_failed' && !String(e.message).includes('s3.example'));
});

test('403 from S3 asks for a new grant once', async () => {
  let grants = 0; let puts = 0;
  const r = await attachAndPost({
    requestUpload: async () => { grants++; return { ...grant, uploadId: `U${grants}` }; },
    put: async () => { puts++; if (puts === 1) throw new ApiCodeError(403, 'upload_expired'); },
    post: async (id: string) => id,
  });
  assert.equal(r, 'U2'); assert.equal(grants, 2); assert.equal(puts, 2);
});

test('a second 403 gives up: one retry only', async () => {
  let grants = 0;
  await assert.rejects(attachAndPost({
    requestUpload: async () => { grants++; return grant; },
    put: async () => { throw new ApiCodeError(403, 'upload_expired'); },
    post: async (id: string) => id,
  }), (e: unknown) => e instanceof ApiCodeError && e.code === 'upload_expired');
  assert.equal(grants, 2);
});

test('image_not_found on publish runs the whole upload again once', async () => {
  let grants = 0; let posts = 0;
  const r = await attachAndPost({
    requestUpload: async () => { grants++; return grant; },
    put: async () => {},
    post: async () => { posts++; if (posts === 1) throw new ApiCodeError(400, 'image_not_found'); return 'ok'; },
  });
  assert.equal(r, 'ok'); assert.equal(grants, 2);
});

test('other errors (rate_limited) are not retried', async () => {
  let grants = 0;
  await assert.rejects(attachAndPost({
    requestUpload: async () => { grants++; throw new ApiCodeError(429, 'rate_limited'); },
    put: async () => {}, post: async (id: string) => id,
  }), (e: unknown) => e instanceof ApiCodeError && e.code === 'rate_limited');
  assert.equal(grants, 1);
});
