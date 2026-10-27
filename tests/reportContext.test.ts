import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContext, osLabel, validateReportText, placeButton, REPORT_PAD, TEXT_MAX, errorKindOf } from '../src/client/reportContext.ts';
import { reportUi } from '../src/client/reportUi.ts';

const base = { appVersion: '0.1.0', build: 7, platform: 'android', os: '34', screen: 'home', lang: 'he' };

test('context has exactly the fixed keys, all non-empty strings of at most 64 chars', () => {
  const c = buildContext(base);
  assert.deepEqual(Object.keys(c).sort(), ['appVersion', 'build', 'lang', 'os', 'platform', 'screen']);
  for (const v of Object.values(c)) { assert.equal(typeof v, 'string'); assert.ok(v.length >= 1 && v.length <= 64); }
  assert.equal(c.build, '7');
});

test('kehilaId is omitted (key absent) outside a Kehila, never null or empty', () => {
  for (const id of [undefined, null, '', '   ']) {
    const c = buildContext({ ...base, kehilaId: id });
    assert.equal('kehilaId' in c, false);
  }
  assert.equal(buildContext({ ...base, kehilaId: '01ABC' }).kehilaId, '01ABC');
});

test('empty or over-long values are repaired, not sent as is', () => {
  const c = buildContext({ ...base, appVersion: '', os: 'x'.repeat(100), build: 0, screen: '  ' });
  assert.equal(c.appVersion, 'unknown');
  assert.equal(c.os.length, 64);
  assert.equal(c.build, '0');
  assert.equal(c.screen, 'unknown');
  assert.equal(buildContext({ ...base, kehilaId: 'k'.repeat(80) }).kehilaId!.length, 64);
});

test('osLabel: native version, coarse family on web', () => {
  assert.equal(osLabel('ios', '17.4', ''), '17.4');
  assert.equal(osLabel('android', 34, ''), '34');
  assert.equal(osLabel('web', undefined, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iOS');
  assert.equal(osLabel('web', undefined, 'Mozilla/5.0 (Linux; Android 14; Pixel)'), 'Android');
  assert.equal(osLabel('web', undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'macOS');
  assert.equal(osLabel('web', undefined, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows');
  assert.equal(osLabel('web', undefined, 'Mozilla/5.0 (X11; Linux x86_64)'), 'Linux');
  assert.equal(osLabel('web', undefined, ''), 'web');
});

test('text validation counts trimmed code points', () => {
  assert.equal(validateReportText('').ok, false);
  assert.equal(validateReportText('  \n ').ok, false);
  assert.deepEqual(validateReportText(' שלום '), { ok: true, count: 4 });
  assert.equal(validateReportText('😀'.repeat(TEXT_MAX)).ok, true);
  const over = validateReportText('😀'.repeat(TEXT_MAX + 1));
  assert.equal(over.ok, false);
  assert.equal(over.count, TEXT_MAX + 1);
});

const place = { width: 390, hasTabs: true, keyboard: false, modalOpen: false, viewerOpen: false, screen: 'home', enabled: true, insetBottom: 0 };

test('phone: bottom-start, 16 above the tab bar; without tabs 16 from the bottom', () => {
  const a = placeButton(place);
  assert.deepEqual(a, { show: true, corner: 'start', bottom: 16 + 65 });
  const b = placeButton({ ...place, hasTabs: false, screen: 'signin' });
  assert.deepEqual(b, { show: true, corner: 'start', bottom: 16 });
  assert.equal((placeButton({ ...place, hasTabs: false, insetBottom: 20 }) as { bottom: number }).bottom, 36);
});

test('desktop >= 1024: bottom-end, 16 inset, not lifted by tabs; 1023 is still phone layout', () => {
  assert.deepEqual(placeButton({ ...place, width: 1280 }), { show: true, corner: 'end', bottom: 16 });
  assert.deepEqual(placeButton({ ...place, width: 1024 }), { show: true, corner: 'end', bottom: 16 });
  assert.equal((placeButton({ ...place, width: 1023 }) as { corner: string }).corner, 'start');
});

test('hidden with keyboard, any sheet, the viewer, on chat, or when the flag is off', () => {
  for (const o of [{ keyboard: true }, { modalOpen: true }, { viewerOpen: true }, { screen: 'chat' }, { enabled: false }]) {
    assert.deepEqual(placeButton({ ...place, ...o }), { show: false });
  }
});

test('the scroll padding is 56', () => { assert.equal(REPORT_PAD, 56); });

test('server errors map to the section 13 states', () => {
  assert.equal(errorKindOf({ status: 429, code: 'rate_limited' }, true), 'limitUser');
  assert.equal(errorKindOf({ status: 429, code: 'rate_limited' }, false), 'limitAnon');
  assert.equal(errorKindOf({ status: 400, code: 'invalid_upload' }, true), 'tooBig');
  assert.equal(errorKindOf({ status: 400, code: 'image_too_large' }, true), 'tooBig');
  assert.equal(errorKindOf({ status: 0, code: 'network' }, true), 'generic');
  assert.equal(errorKindOf({ status: 503, code: 'try_again' }, false), 'generic');
  assert.equal(errorKindOf(new Error('x'), false), 'generic');
});

test('report ui store: modals are counted, collapse lasts for the session, screen resets on cleanup', () => {
  reportUi.reset();
  assert.equal(reportUi.get().modals, 0);
  const off1 = reportUi.modal(); const off2 = reportUi.modal();
  assert.equal(reportUi.get().modals, 2);
  off1(); off1(); // a double release does not go negative
  assert.equal(reportUi.get().modals, 1);
  off2();
  assert.equal(reportUi.get().modals, 0);
  reportUi.setCollapsed(true);
  assert.equal(reportUi.get().collapsed, true);
  let n = 0; const un = reportUi.subscribe(() => { n++; });
  reportUi.setScreen({ screen: 'home', hasTabs: true });
  reportUi.setScreen({ screen: 'home', hasTabs: true }); // unchanged: no notification
  assert.equal(n, 1);
  un();
  reportUi.reset();
});

import { sendReport } from '../src/client/sendReport.ts';
import { ApiCodeError } from '../src/client/errors.ts';

function fakeApi() {
  const calls: string[] = [];
  const api = {
    requestReportUpload: async (o: { bytes: number }) => { calls.push(`grant:${o.bytes}`); return { uploadId: 'u1', url: 'x', method: 'PUT' as const, headers: {}, expiresAt: 1 }; },
    postReport: async (o: { imageUploadId?: string; text: string }) => { calls.push(`post:${o.text}:${o.imageUploadId ?? '-'}`); return { reportId: 'r' }; },
    postAnonymousReport: async (o: { text: string }) => { calls.push(`anon:${o.text}`); return { reportId: 'r' }; },
  };
  return { api, calls };
}
const ctx = buildContext(base);

test('signed out: the public route, text only (a picture is never sent)', async () => {
  const { api, calls } = fakeApi();
  await sendReport({ signedIn: false, text: ' hi ', context: ctx, api, image: { prepare: async () => new Blob(['x']), put: async () => {} } });
  assert.deepEqual(calls, ['anon:hi']);
});

test('signed in without a picture: one post; with a picture: grant, put, post with the upload id', async () => {
  const a = fakeApi();
  await sendReport({ signedIn: true, text: 'a', context: ctx, api: a.api, image: null });
  assert.deepEqual(a.calls, ['post:a:-']);
  const b = fakeApi(); const put: string[] = [];
  await sendReport({ signedIn: true, text: 'b', context: ctx, api: b.api, image: { prepare: async () => new Blob(['abc']), put: async g => { put.push(g.uploadId); } } });
  assert.deepEqual(b.calls, ['grant:3', 'post:b:u1']);
  assert.deepEqual(put, ['u1']);
});

test('a picture that cannot be prepared fails before anything is sent', async () => {
  const { api, calls } = fakeApi();
  await assert.rejects(sendReport({ signedIn: true, text: 'a', context: ctx, api, image: { prepare: async () => { throw new ApiCodeError(0, 'image_too_large'); }, put: async () => {} } }), { code: 'image_too_large' });
  assert.deepEqual(calls, []);
});
