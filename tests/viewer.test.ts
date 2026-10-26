import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPan, clampScale, doubleTapScale, panUpdate, pinchUpdate, shouldDismiss } from '../src/media/viewerMath.ts';
import { imageFileName, printHtml, printImage, shareImage, saveToPhone, type NativeDeps, type TempFile } from '../src/media/saveShare.ts';

test('swipe down closes only at base zoom', () => {
  assert.equal(shouldDismiss({ dy: 121, vy: 0, scale: 1 }), true);
  assert.equal(shouldDismiss({ dy: 120, vy: 0, scale: 1 }), false);
  assert.equal(shouldDismiss({ dy: 300, vy: 0, scale: 1.5 }), false);
  assert.equal(shouldDismiss({ dy: 300, vy: 0, scale: 1.01 }), true);
});
test('fast flick closes', () => {
  assert.equal(shouldDismiss({ dy: 20, vy: 801, scale: 1 }), true);
  assert.equal(shouldDismiss({ dy: 20, vy: 800, scale: 1 }), false);
  assert.equal(shouldDismiss({ dy: 20, vy: 2000, scale: 2 }), false);
});
test('scale clamps between 1 and 4', () => {
  assert.equal(clampScale(0.3), 1);
  assert.equal(clampScale(2.2), 2.2);
  assert.equal(clampScale(9), 4);
});
test('double tap toggles', () => {
  assert.equal(doubleTapScale(1), 2.5);
  assert.equal(doubleTapScale(2.5), 1);
  assert.equal(doubleTapScale(4), 1);
});
test('pan is clamped to the image edge', () => {
  const box = { width: 400, height: 800 }; const image = { width: 400, height: 300 };
  // Scale 2: image 800 x 600 in a 400 x 800 box: x may move 200 either way, y not at all (600 < 800).
  assert.deepEqual(clampPan({ x: 500, y: 90 }, 2, box, image), { x: 200, y: 0 });
  assert.deepEqual(clampPan({ x: -500, y: -90 }, 2, box, image), { x: -200, y: 0 });
  assert.deepEqual(clampPan({ x: 50, y: 0 }, 2, box, image), { x: 50, y: 0 });
  // Scale 1: nothing to pan.
  assert.deepEqual(clampPan({ x: 30, y: 30 }, 1, box, image), { x: 0, y: 0 });
  // Scale 4: height 1200 in 800: y within 200.
  assert.deepEqual(clampPan({ x: 0, y: 999 }, 4, box, image), { x: 0, y: 200 });
});

const MESSAGE = '01JABCDEF';
const URL_SECRET = 'https://kehilot-dev-media.s3.il-central-1.amazonaws.com/k/m.jpg?X-Amz-Signature=SECRET';

function fakes(over: Partial<NativeDeps> = {}) {
  const log: string[] = [];
  const files = new Set<string>();
  const deps: NativeDeps = {
    async download(url, name) {
      log.push(`download ${name}`);
      files.add(name);
      const f: TempFile = { uri: `file:///cache/share/${name}`, base64: async () => 'QUJD', delete: () => { files.delete(name); log.push('delete'); } };
      return f;
    },
    share: async (uri, mime) => { log.push(`share ${uri} ${mime}`); },
    saveToLibrary: async uri => { log.push(`save ${uri}`); return true; },
    print: async html => { log.push(`print ${html.length}`); },
    ...over,
  };
  return { deps, log, files };
}

test('share file name has no personal data', async () => {
  assert.equal(imageFileName(MESSAGE, 'image/jpeg'), `kehilot-${MESSAGE}.jpg`);
  assert.equal(imageFileName(MESSAGE, 'image/png'), `kehilot-${MESSAGE}.png`);
  const { deps, log } = fakes();
  await shareImage(URL_SECRET, MESSAGE, deps);
  assert.ok(log.includes(`download kehilot-${MESSAGE}.jpg`));
  const shared = log.find(l => l.startsWith('share '))!;
  assert.equal(shared, `share file:///cache/share/kehilot-${MESSAGE}.jpg image/jpeg`);
  assert.ok(!shared.includes('SECRET'));
});
test('temp file removed after share even on error', async () => {
  const { deps, files } = fakes({ share: async () => { throw new Error('boom'); } });
  await assert.rejects(shareImage(URL_SECRET, MESSAGE, deps), /boom/);
  assert.equal(files.size, 0);
});
test('save to phone removes the temp file, also on denied permission or error', async () => {
  const ok = fakes();
  assert.equal(await saveToPhone(URL_SECRET, MESSAGE, ok.deps), true);
  assert.equal(ok.files.size, 0);
  const denied = fakes({ saveToLibrary: async () => false });
  assert.equal(await saveToPhone(URL_SECRET, MESSAGE, denied.deps), false);
  assert.equal(denied.files.size, 0);
  const bad = fakes({ saveToLibrary: async () => { throw new Error('x'); } });
  await assert.rejects(saveToPhone(URL_SECRET, MESSAGE, bad.deps));
  assert.equal(bad.files.size, 0);
});
test('print html holds only the image', async () => {
  const html = printHtml('data:image/jpeg;base64,QUJD');
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  const urls = html.match(/https?:\/\/[^"'\s)]+/g) ?? [];
  assert.deepEqual(urls, []);
  const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '').trim();
  assert.equal(text, '');
  assert.match(html, /max-width:100%/); assert.match(html, /max-height:100vh/); assert.match(html, /object-fit:contain/);
  const { deps, log } = fakes();
  await printImage(URL_SECRET, MESSAGE, deps);
  assert.ok(log.includes('delete'));
});
test('temp file removed after print even on error', async () => {
  const { deps, files } = fakes({ print: async () => { throw new Error('boom'); } });
  await assert.rejects(printImage(URL_SECRET, MESSAGE, deps), /boom/);
  assert.equal(files.size, 0);
});

import { closeViewerState, openViewerState } from '../src/views/viewerHostState.ts';
test('host: one viewer at a time, open and close', () => {
  const a = openViewerState(null, { k: 'k1', messageId: 'm1' });
  assert.deepEqual(a, { k: 'k1', messageId: 'm1' });
  assert.deepEqual(openViewerState(a, { k: 'k1', messageId: 'm2', contentType: 'image/png' }), { k: 'k1', messageId: 'm2', contentType: 'image/png' });
  assert.equal(closeViewerState(a), null);
});
test('pinch then pan mid-gesture does not compound the scale', () => {
  const box = { width: 400, height: 800 }; const image = { width: 400, height: 300 };
  const pinchStart = 1.5;
  const s1 = pinchUpdate(pinchStart, 1.2);
  assert.ok(Math.abs(s1 - 1.8) < 1e-9);
  // A pan starts now (its own start offset); the pinch keeps going from its own start, not from s1.
  const p = panUpdate({ x: 10, y: 0 }, { x: 20, y: 5 }, s1, box, image);
  assert.deepEqual(p, { x: 30, y: 0 });
  const s2 = pinchUpdate(pinchStart, 1.4);
  assert.ok(Math.abs(s2 - 2.1) < 1e-9);
  assert.equal(pinchUpdate(3, 2), 4);
  assert.equal(doubleTapScale(1.003), 2.5);
});
