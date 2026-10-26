import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttp } from '../src/client/http.ts';
import { ApiCodeError } from '../src/client/errors.ts';
import { errorKey } from '../src/client/errors.ts';
import { endpoints } from '../src/client/endpoints.ts';

type Call = { url: string; init: RequestInit };
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

function setup(responses: Array<Response | (() => Promise<Response>)>, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const log = { refreshes: 0, signedOut: 0, deleted: 0, sleeps: [] as number[] };
  const queue = [...responses];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    assert.ok(next, 'unexpected extra request');
    return typeof next === 'function' ? next() : next;
  };
  const tokens = {
    idToken: async () => 'id-1',
    forceRefresh: async () => { log.refreshes++; return 'id-2'; },
  };
  const http = createHttp({
    baseUrl: 'https://api.example.invalid',
    tokens: tokens as any,
    fetch: fetch as any,
    sleep: async (ms: number) => { log.sleeps.push(ms); },
    onAccountDeleted: () => { log.deleted++; },
    onSignedOut: () => { log.signedOut++; },
    ...extra,
  });
  return { http, calls, log };
}
const headers = (c: Call) => new Headers(c.init.headers);

test('sends bearer id token', async () => {
  const { http, calls } = setup([json(200, { ok: true })]);
  assert.deepEqual(await http.request('GET', '/v1/me'), { ok: true });
  assert.equal(calls[0]!.url, 'https://api.example.invalid/v1/me');
  assert.equal(headers(calls[0]!).get('authorization'), 'Bearer id-1');
});

test('try_again is retried then succeeds', async () => {
  const { http, calls, log } = setup([json(409, { error: 'try_again' }), json(503, { error: 'try_again' }), json(200, { n: 1 })]);
  assert.deepEqual(await http.request('POST', '/v1/x', { a: 1 }), { n: 1 });
  assert.equal(calls.length, 3);
  assert.deepEqual(log.sleeps, [500, 500]);
  assert.equal(calls[0]!.init.body, '{"a":1}');
});

test('try_again gives up after 4 attempts', async () => {
  const { http, calls } = setup(Array.from({ length: 4 }, () => json(409, { error: 'try_again' })));
  await assert.rejects(http.request('POST', '/v1/x'), (e: any) => e instanceof ApiCodeError && e.code === 'try_again' && e.status === 409);
  assert.equal(calls.length, 4);
});

test('401 refreshes once then retries', async () => {
  const { http, calls, log } = setup([json(401, { message: 'Unauthorized' }), json(200, { ok: 1 })]);
  assert.deepEqual(await http.request('GET', '/v1/me'), { ok: 1 });
  assert.equal(log.refreshes, 1);
  assert.equal(headers(calls[1]!).get('authorization'), 'Bearer id-2');
  assert.equal(log.signedOut, 0);
});

test('second 401 signs out', async () => {
  const { http, calls, log } = setup([json(401, { message: 'Unauthorized' }), json(401, { message: 'Unauthorized' })]);
  await assert.rejects(http.request('GET', '/v1/me'), (e: any) => e.code === 'unauthorized' && e.status === 401);
  assert.equal(calls.length, 2);
  assert.equal(log.refreshes, 1);
  assert.equal(log.signedOut, 1);
});

test('account_deleted signs out without retry', async () => {
  const { http, calls, log } = setup([json(401, { error: 'account_deleted' })]);
  await assert.rejects(http.request('GET', '/v1/me'), (e: any) => e.code === 'account_deleted');
  assert.equal(calls.length, 1);
  assert.equal(log.deleted, 1);
  assert.equal(log.refreshes, 0);
});

test('public route sends no Authorization', async () => {
  const { http, calls } = setup([json(200, { kehilaName: 'x' })]);
  await http.request('GET', '/v1/invites/ABC', undefined, { auth: false });
  assert.equal(headers(calls[0]!).get('authorization'), null);
});

test('204 resolves undefined', async () => {
  const { http } = setup([json(204)]);
  assert.equal(await http.request('DELETE', '/v1/me'), undefined);
});

test('timeout maps to network', async () => {
  const hang = (_u: string, init: RequestInit) =>
    new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))));
  const { http } = setup([], { fetch: hang, timeoutMs: 10 });
  await assert.rejects(http.request('GET', '/v1/me'), (e: any) => e.code === 'network' && e.status === 0);
});

test('fetch failure maps to network, other errors keep code', async () => {
  const a = setup([async () => { throw new TypeError('fail'); }]);
  await assert.rejects(a.http.request('GET', '/v1/me'), (e: any) => e.code === 'network');
  const b = setup([json(403, { error: 'forbidden' })]);
  await assert.rejects(b.http.request('GET', '/v1/me'), (e: any) => e.code === 'forbidden' && e.status === 403);
  const c = setup([json(500)]);
  await assert.rejects(c.http.request('GET', '/v1/me'), (e: any) => e.code === 'internal');
});

test('path segments are encoded', async () => {
  const { http, calls } = setup([json(204), json(200, []), json(200, { changes: [] })]);
  const api = endpoints(http);
  await api.deleteDevice('ExponentPushToken[abc]');
  assert.equal(calls[0]!.url, 'https://api.example.invalid/v1/me/devices/ExponentPushToken%5Babc%5D');
  await api.messages('K1', { before: 'M/1', limit: 5 });
  assert.equal(calls[1]!.url, 'https://api.example.invalid/v1/kehilot/K1/messages?limit=5&before=M%2F1');
  await api.changes('K1', 'a b');
  assert.equal(calls[2]!.url, 'https://api.example.invalid/v1/kehilot/K1/changes?since=a%20b');
});

test('endpoints use the documented methods and paths', async () => {
  const seen: string[] = [];
  const http = { request: async (m: string, p: string, b?: unknown, o?: { auth?: boolean }) => { seen.push(`${m} ${p} ${b === undefined ? '' : JSON.stringify(b)}${o?.auth === false ? ' public' : ''}`.replace(/ +/g, ' ').trim()); return undefined; } };
  const a = endpoints(http as any);
  await a.previewInvite('C1');
  await a.requestGroup('K', 'G');
  await a.withdrawGroupRequest('K', 'G');
  await a.approveGroupRequest('K', 'G', 'U');
  await a.rejectGroupRequest('K', 'G', 'U');
  await a.removeGroupMember('K', 'G', 'U');
  await a.leaveGroup('K', 'G');
  await a.appointGroupAdmin('K', 'G', 'U');
  await a.unappointGroupAdmin('K', 'G', 'U');
  await a.setChatLimit('K', 'C', 7);
  await a.putSettings('K', { maxListeners: 9 });
  await a.directory('K', 'C');
  await a.revokeInvite('K', 'AB');
  await a.requestUpload('K', { channelId: 'C', contentType: 'image/png', bytes: 3 });
  assert.deepEqual(seen, [
    'GET /v1/invites/C1 public',
    'POST /v1/kehilot/K/groups/G/requests',
    'DELETE /v1/kehilot/K/groups/G/requests/me',
    'POST /v1/kehilot/K/groups/G/requests/U/approve',
    'DELETE /v1/kehilot/K/groups/G/requests/U',
    'DELETE /v1/kehilot/K/groups/G/members/U',
    'DELETE /v1/kehilot/K/groups/G/members/me',
    'PUT /v1/kehilot/K/admin/groups/G/admins/U',
    'DELETE /v1/kehilot/K/admin/groups/G/admins/U',
    'PUT /v1/kehilot/K/channels/C/chat-settings {"chatHourlyLimit":7}',
    'PUT /v1/kehilot/K/admin/settings {"maxListeners":9}',
    'GET /v1/kehilot/K/members?channelId=C',
    'DELETE /v1/kehilot/K/invites/AB',
    'POST /v1/kehilot/K/uploads {"channelId":"C","contentType":"image/png","bytes":3}',
  ]);
});

test('errorKey falls back to generic', () => {
  assert.equal(errorKey('UsernameExistsException'), 'errors.UsernameExistsException');
  assert.equal(errorKey('forbidden'), 'errors.forbidden');
  assert.equal(errorKey('something_new'), 'errors.generic');
});
