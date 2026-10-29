import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LogoEncodeError, MAX_INPUT_BYTES, cropRect, encodeLogo, logoErrorKey, targetSides } from '../src/media/logo.ts';
import type { LogoDeps } from '../src/media/logo.ts';
import { ApiCodeError } from '../src/client/errors.ts';

const still = { scale: 1, x: 0, y: 0, rotation: 0 } as const;

test('cropRect: no zoom is the centred square of the short side', () => {
  assert.deepEqual(cropRect(still, { width: 1000, height: 500 }, 300), { originX: 250, originY: 0, width: 500, height: 500 });
});

test('cropRect: zoom 2 with an offset', () => {
  // display scale 300/500*2 = 1.2; pan 60 px left moves the centre 50 source px right
  assert.deepEqual(cropRect({ scale: 2, x: -60, y: 0, rotation: 0 }, { width: 1000, height: 500 }, 300), { originX: 425, originY: 125, width: 250, height: 250 });
});

test('cropRect: 90 degrees swaps the axes', () => {
  assert.deepEqual(cropRect({ ...still, rotation: 90 }, { width: 1000, height: 500 }, 300), { originX: 0, originY: 250, width: 500, height: 500 });
  assert.deepEqual(cropRect({ ...still, rotation: 270 }, { width: 500, height: 1000 }, 300), { originX: 250, originY: 0, width: 1000 / 2, height: 500 });
});

test('cropRect: clamped inside the image', () => {
  const r = cropRect({ scale: 2, x: 9999, y: -9999, rotation: 0 }, { width: 1000, height: 500 }, 300);
  assert.deepEqual(r, { originX: 0, originY: 250, width: 250, height: 250 });
  const r2 = cropRect({ scale: 1, x: -9999, y: 0, rotation: 180 }, { width: 1000, height: 500 }, 300);
  assert.deepEqual(r2, { originX: 500, originY: 0, width: 500, height: 500 });
  const z = cropRect({ scale: 0.2, x: 0, y: 0, rotation: 0 }, { width: 400, height: 400 }, 300);
  assert.equal(z.width, 400);
});

test('targetSides never up-scales', () => {
  assert.deepEqual(targetSides(1000), [512, 384, 256]);
  assert.deepEqual(targetSides(512), [512, 384, 256]);
  assert.deepEqual(targetSides(300), [256]);
  assert.deepEqual(targetSides(200), [200]);
  assert.equal(MAX_INPUT_BYTES, 10 * 1024 * 1024);
});

const img = { width: 1000, height: 1000 };
function deps(sizes: Record<number, number>, post?: number): { d: LogoDeps; calls: number[]; posted: string[] } {
  const calls: number[] = []; const posted: string[] = [];
  const d: LogoDeps = {
    render: async (_u, _r, _rect, side) => { calls.push(side); return { base64: `s${side}`, bytes: sizes[side] ?? 1 }; },
  };
  if (post !== undefined) d.posterize = async b => { posted.push(b); return { base64: `p${b}`, bytes: post }; };
  return { d, calls, posted };
}

test('encodeLogo returns the first side under the limit', async () => {
  const { d, calls } = deps({ 512: 70000, 384: 60000 });
  const r = await encodeLogo('u', still, img, 300, d);
  assert.deepEqual(r, { base64: 's384', side: 384, bytes: 60000 });
  assert.deepEqual(calls, [512, 384]);
});

test('encodeLogo accepts exactly 65536 bytes', async () => {
  const { d } = deps({ 512: 65536 });
  assert.equal((await encodeLogo('u', still, img, 300, d)).side, 512);
});

test('encodeLogo posterizes only after 256, then succeeds', async () => {
  const { d, calls, posted } = deps({ 512: 99999, 384: 99999, 256: 99999 }, 40000);
  const r = await encodeLogo('u', still, img, 300, d);
  assert.deepEqual(calls, [512, 384, 256]);
  assert.deepEqual(posted, ['s256']);
  assert.deepEqual(r, { base64: 'ps256', side: 256, bytes: 40000 });
});

test('encodeLogo throws big without posterize or when posterize is still too large', async () => {
  const sizes = { 512: 99999, 384: 99999, 256: 99999 };
  await assert.rejects(encodeLogo('u', still, img, 300, deps(sizes).d), (e: unknown) => e instanceof LogoEncodeError && e.kind === 'big');
  await assert.rejects(encodeLogo('u', still, img, 300, deps(sizes, 70000).d), (e: unknown) => e instanceof LogoEncodeError && e.kind === 'big');
});

test('encodeLogo throws small for a 50 px crop and renders nothing', async () => {
  const { d, calls } = deps({});
  await assert.rejects(encodeLogo('u', still, { width: 50, height: 50 }, 300, d), (e: unknown) => e instanceof LogoEncodeError && e.kind === 'small');
  assert.deepEqual(calls, []);
});

test('encodeLogo: a 200 px crop is saved at 200', async () => {
  const { d, calls } = deps({ 200: 5000 });
  const r = await encodeLogo('u', still, { width: 200, height: 300 }, 300, d);
  assert.equal(r.side, 200);
  assert.deepEqual(calls, [200]);
});

test('logoErrorKey', () => {
  assert.equal(logoErrorKey(new ApiCodeError(400, 'invalid_logo_format')), 'logo.err.format');
  assert.equal(logoErrorKey(new ApiCodeError(400, 'logo_too_small')), 'logo.err.small');
  assert.equal(logoErrorKey(new ApiCodeError(400, 'logo_too_large')), 'logo.err.big');
  assert.equal(logoErrorKey(new ApiCodeError(400, 'logo_not_square')), 'logo.err.save');
  assert.equal(logoErrorKey(new LogoEncodeError('small')), 'logo.err.small');
  assert.equal(logoErrorKey(new LogoEncodeError('big')), 'logo.err.big');
  assert.equal(logoErrorKey(new Error('x')), 'logo.err.save');
  assert.equal(logoErrorKey(undefined), 'logo.err.save');
});
