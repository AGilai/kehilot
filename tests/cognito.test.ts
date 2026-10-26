import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AuthError, signUp, confirmSignUp } from '../src/auth/cognito.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

type Call = { url: string; init: RequestInit };
function mockFetch(status: number, body: unknown, calls: Call[] = []) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

test('signUp sends ClientMetadata lang and the right target', async () => {
  const calls = mockFetch(200, {});
  await signUp('dana@example.invalid', 'a-long-password-1', 'he');
  const call = calls[0]!;
  const headers = call.init.headers as Record<string, string>;
  assert.match(call.url, /^https:\/\/cognito-idp\..*\.amazonaws\.com\/$/);
  assert.equal(headers['X-Amz-Target'], 'AWSCognitoIdentityProviderService.SignUp');
  assert.equal(headers['Content-Type'], 'application/x-amz-json-1.1');
  const body = JSON.parse(String(call.init.body));
  assert.deepEqual(body.ClientMetadata, { lang: 'he' });
  assert.equal(body.Username, 'dana@example.invalid');
});

test('maps __type to AuthError code', async () => {
  mockFetch(400, { __type: 'com.amazonaws.cognito#CodeMismatchException', message: 'x' });
  await assert.rejects(confirmSignUp('dana@example.invalid', '123456'), (e: unknown) => e instanceof AuthError && e.code === 'CodeMismatchException');
});

test('UsernameExistsException surfaces as its own code', async () => {
  mockFetch(400, { __type: 'UsernameExistsException' });
  await assert.rejects(signUp('dana@example.invalid', 'a-long-password-1', 'en'), (e: unknown) => e instanceof AuthError && e.code === 'UsernameExistsException');
});

test('network failure is AuthError network', async () => {
  globalThis.fetch = (async () => { throw new TypeError('fetch failed dana@example.invalid'); }) as typeof fetch;
  await assert.rejects(signUp('dana@example.invalid', 'a-long-password-1', 'en'), (e: unknown) => e instanceof AuthError && e.code === 'network' && !e.message.includes('example.invalid'));
});
