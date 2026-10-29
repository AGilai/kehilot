import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LogoEncodeError, MAX_INPUT_BYTES, clampView, cropRect, encodeLogo, logoErrorKey, nudgeView, rotateView, sourceError, targetSides, zoomView } from '../src/media/logo.ts';
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

test('sourceError: PNG and JPEG up to 10 MB pass, anything else is a format error', () => {
  assert.equal(sourceError('image/png', 1000), null);
  assert.equal(sourceError('image/jpeg', MAX_INPUT_BYTES), null);
  assert.equal(sourceError('image/gif', 1000), 'logo.err.format');
  assert.equal(sourceError('image/png', MAX_INPUT_BYTES + 1), 'logo.err.format');
  assert.equal(sourceError('', 1000), 'logo.err.format');
  assert.equal(sourceError('', 1000, true), null);
});

test('clampView: scale 1..4 and the pan keeps the image over the frame', () => {
  const img = { width: 1000, height: 500 };
  assert.deepEqual(clampView({ scale: 0.5, x: 999, y: 999, rotation: 0 }, img, 300), { scale: 1, x: 150, y: 0, rotation: 0 });
  assert.equal(clampView({ scale: 9, x: 0, y: 0, rotation: 0 }, img, 300).scale, 4);
  // scale 2: displayed 1200x600, so the pan may reach 450 across and 150 down
  assert.deepEqual(clampView({ scale: 2, x: -999, y: 999, rotation: 0 }, img, 300), { scale: 2, x: -450, y: 150, rotation: 0 });
  // rotated 90: the short side is the width of the original
  assert.deepEqual(clampView({ scale: 1, x: 99, y: 999, rotation: 90 }, img, 300), { scale: 1, x: 0, y: 150, rotation: 90 });
});

test('zoomView and nudgeView clamp; rotateView turns 90 degrees and recentres', () => {
  const img = { width: 500, height: 500 };
  assert.equal(zoomView(still, 0.5, img, 300).scale, 1.5);
  assert.equal(zoomView({ ...still, scale: 3.8 }, 0.5, img, 300).scale, 4);
  assert.equal(zoomView(still, -1, img, 300).scale, 1);
  const z = { scale: 2, x: 0, y: 0, rotation: 0 } as const;
  assert.deepEqual(nudgeView(z, 1, 0, img, 300), { ...z, x: 1 });
  assert.deepEqual(nudgeView(z, 10, -10, img, 300), { ...z, x: 10, y: -10 });
  assert.equal(nudgeView(still, 10, 0, img, 300).x, 0);
  assert.deepEqual(rotateView({ scale: 2, x: 5, y: 7, rotation: 270 }), { scale: 2, x: 0, y: 0, rotation: 0 });
  assert.equal(rotateView(still).rotation, 90);
});
