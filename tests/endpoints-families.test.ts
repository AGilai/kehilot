import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endpoints } from '../src/client/endpoints.ts';
import { FIXTURE_APP_SCREENS, createFixtureApi, parseFixtureParams } from '../src/client/fixtures.ts';
import type { Http } from '../src/client/http.ts';

function recorder() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const http: Http = { async request(method, path, body) { calls.push({ method, path, body }); return undefined as any; } };
  return { api: endpoints(http), calls };
}

const cases: Array<[string, (a: ReturnType<typeof endpoints>) => Promise<unknown>, string, string, unknown?]> = [
  ['putPhone', a => a.putPhone('+972501234567'), 'PUT', '/v1/me/phone', { phone: '+972501234567' }],
  ['putPhone null', a => a.putPhone(null), 'PUT', '/v1/me/phone', { phone: null }],
  ['age13Consent', a => a.age13Consent(), 'POST', '/v1/me/consents/age13'],
  ['exportStatus', a => a.exportStatus(), 'GET', '/v1/me/export'],
  ['startExport', a => a.startExport(), 'POST', '/v1/me/export'],
  ['deleteMe', a => a.deleteMe(), 'DELETE', '/v1/me'],
  ['deleteMe posts', a => a.deleteMe({ deletePosts: true }), 'DELETE', '/v1/me?deletePosts=1'],
  ['deleteMe keep posts', a => a.deleteMe({ deletePosts: false }), 'DELETE', '/v1/me'],
  ['dismissCard', a => a.dismissCard('K', 'gabbai_link'), 'POST', '/v1/kehilot/K/me/cards/gabbai_link/dismiss'],
  ['putPhoneList', a => a.putPhoneList('K', true), 'PUT', '/v1/kehilot/K/me/phone-list', { show: true }],
  ['phoneList', a => a.phoneList('K'), 'GET', '/v1/kehilot/K/phone-list'],
  ['family', a => a.family('K'), 'GET', '/v1/kehilot/K/family'],
  ['addChild', a => a.addChild('K', { firstName: 'נועם', gender: 'm' }), 'POST', '/v1/kehilot/K/family/children', { firstName: 'נועם', gender: 'm' }],
  ['editChild', a => a.editChild('K', 'C', { firstName: 'נועם', gender: 'm', birthDate: '2015-03-02' }), 'PUT', '/v1/kehilot/K/family/children/C', { firstName: 'נועם', gender: 'm', birthDate: '2015-03-02' }],
  ['removeChild', a => a.removeChild('K', 'C'), 'DELETE', '/v1/kehilot/K/family/children/C'],
  ['familyCandidates', a => a.familyCandidates('K'), 'GET', '/v1/kehilot/K/family/candidates'],
  ['requestPartner', a => a.requestPartner('K', 'U'), 'POST', '/v1/kehilot/K/family/requests', { toUserId: 'U' }],
  ['withdrawPartnerRequest', a => a.withdrawPartnerRequest('K'), 'DELETE', '/v1/kehilot/K/family/requests/mine'],
  ['confirmPartner', a => a.confirmPartner('K', 'U'), 'POST', '/v1/kehilot/K/family/requests/U/confirm'],
  ['declinePartner', a => a.declinePartner('K', 'U'), 'POST', '/v1/kehilot/K/family/requests/U/decline'],
  ['unlink', a => a.unlink('K'), 'POST', '/v1/kehilot/K/family/unlink'],
  ['targetFamilies', a => a.targetFamilies('K', 'CH'), 'GET', '/v1/kehilot/K/families?channelId=CH'],
  ['adminFamilies', a => a.adminFamilies('K'), 'GET', '/v1/kehilot/K/admin/families'],
  ['adminLink', a => a.adminLink('K', 'A', 'B'), 'POST', '/v1/kehilot/K/admin/families/link', { userIds: ['A', 'B'] }],
  ['acceptTerms', a => a.acceptTerms('K'), 'POST', '/v1/kehilot/K/admin/terms'],
  ['putSettings contact', a => a.putSettings('K', { privacyContact: 'x' }), 'PUT', '/v1/kehilot/K/admin/settings', { privacyContact: 'x' }],
  ['putSettings max', a => a.putSettings('K', { maxListeners: 9 }), 'PUT', '/v1/kehilot/K/admin/settings', { maxListeners: 9 }],
];

for (const [name, run, method, path, body] of cases) {
  test(`endpoint ${name}: ${method} ${path}`, async () => {
    const { api, calls } = recorder();
    await run(api);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, method);
    assert.equal(calls[0]!.path, path);
    assert.deepEqual(calls[0]!.body, body);
  });
}

const CHILD_KEYS = ['children', 'child', 'firstName', 'gender', 'birthDate', 'birthYear'];

test('fixture api returns a phone list with no children fields', async () => {
  const api = createFixtureApi('member', 'phone-list');
  const list = await api.phoneList('01FIXTUREKEHILA0000000001');
  assert.ok(list.length >= 3);
  for (const fam of list) {
    assert.deepEqual(Object.keys(fam).sort(), ['familyId', 'name', 'people']);
    for (const p of fam.people) assert.deepEqual(Object.keys(p).sort(), ['name', 'phone', 'tags', 'userId']);
  }
  assert.ok(!CHILD_KEYS.some(k => JSON.stringify(list).includes(`"${k}"`)));
  const empty = await createFixtureApi('member', 'phone-list-empty').phoneList('01FIXTUREKEHILA0000000001');
  assert.deepEqual(empty, []);
});

test('fixture api answers every new endpoint', async () => {
  const api = createFixtureApi('gabbai', 'me-family');
  const k = '01FIXTUREKEHILA0000000001';
  const fam = await api.family(k);
  assert.ok(fam.adults.some(a => a.me));
  assert.ok(Array.isArray(fam.children) && Array.isArray(fam.received));
  await api.addChild(k, { firstName: 'נועם', gender: 'm' });
  await api.editChild(k, 'c1', { firstName: 'נועם', gender: 'm' });
  await api.removeChild(k, 'c1');
  assert.ok((await api.familyCandidates(k)).length > 0);
  await api.requestPartner(k, 'u');
  await api.withdrawPartnerRequest(k);
  await api.confirmPartner(k, 'u');
  await api.declinePartner(k, 'u');
  await api.unlink(k);
  assert.ok((await api.targetFamilies(k, 'ch')).length > 0);
  assert.ok((await api.adminFamilies(k)).length > 0);
  await api.adminLink(k, 'a', 'b');
  await api.acceptTerms(k);
  await api.putSettings(k, { privacyContact: 'x' });
  await api.putPhone('+972501234567');
  await api.age13Consent();
  await api.dismissCard(k, 'phone');
  await api.putPhoneList(k, true);
  assert.ok((await api.startExport()).expiresAt > 0);
});

test('fixture screens are listed and cards follow ?card=', async () => {
  for (const s of ['phone-list', 'phone-list-empty', 'me-family', 'me-request', 'me-linked', 'partner-picker', 'child-sheet', 'privacy', 'privacy-ready', 'kehila-info', 'leave-listener', 'home-card', 'age13', 'age13-under', 'terms', 'profile-age', 'delete', 'delete-ticked', 'admin-families', 'admin-link', 'overview-privacy', 'compose-family']) {
    assert.ok(FIXTURE_APP_SCREENS.includes(s), s);
  }
  assert.equal(parseFixtureParams('?screen=home-card&card=gabbai').card, 'gabbai');
  const k = '01FIXTUREKEHILA0000000001';
  const cards = async (card: string) => (await createFixtureApi('member', 'home-card', null, card).kehila(k)).cards;
  assert.ok((await cards('gabbai')).gabbaiLink);
  assert.ok((await cards('request')).request);
  assert.equal((await cards('imported')).imported, true);
  assert.equal((await cards('phone')).phoneAsk, true);
  assert.equal((await cards('phone-nonumber')).phoneAsk, true);
  assert.equal((await createFixtureApi('member', 'home-card', null, 'phone-nonumber').me()).profile!.phone, null);
  assert.ok((await createFixtureApi('member', 'home-card', null, 'phone').me()).profile!.phone);
  assert.equal((await createFixtureApi('gabbai', 'home-card', null, 'terms').kehila(k)).cards.terms, true);
  assert.equal((await createFixtureApi('member', 'home').kehila(k)).cards.phoneAsk, false);
  assert.equal((await createFixtureApi('member', 'age13').me()).age13Required, true);
  assert.equal((await createFixtureApi('member', 'home').me()).age13Required, false);
});

test('fixture P5 export: idle is 404, ready has a link', async () => {
  await assert.rejects(createFixtureApi('member', 'privacy').exportStatus(), { code: 'export_not_found' });
  const ready = await createFixtureApi('member', 'privacy-ready').exportStatus();
  assert.ok(ready.url && ready.expiresAt > 0);
  const k = '01FIXTUREKEHILA0000000001';
  for (const sc of ['privacy', 'privacy-ready']) {
    assert.equal((await createFixtureApi('member', sc).kehila(k)).privacyContact, 'עמית דוגמה, גבאי · pratiyut@example.org');
  }
});

test('fixture me-linked is P2 main state', async () => {
  const api = createFixtureApi('member', 'me-linked');
  const f = await api.family('01FIXTUREKEHILA0000000001');
  assert.deepEqual(f.adults.map(a => [a.displayName, a.me]), [['דנה בדיוני', true], ['יוסי בדיוני', false]]);
  assert.deepEqual(f.children.map(c => [c.firstName, c.gender, c.birthDate]), [['נועה', 'f', '2015-03-12'], ['איתי', 'm', '2018-09-04'], ['אורי', 'm', undefined]]);
});
