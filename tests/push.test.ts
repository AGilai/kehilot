import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUSH_TOKEN_KEY, chatPrefRows, registerPush, routeFromPush, toggleId } from '../src/client/push.ts';
import { createStore } from '../src/client/store.ts';
import { localSignOut } from '../src/auth/signout.ts';
import type { Channel, Kehila, NotifyPrefs } from '../src/client/types.ts';

const notify = (over: Partial<NotifyPrefs> = {}): NotifyPrefs => ({ mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [], ...over });
const ch = (channelId: string, over: Partial<Channel> = {}): Channel => ({ channelId, name: `ערוץ ${channelId}`, listenersCanRead: true, postPolicy: 'management', canPost: false, inAudience: true, conversation: false, chatHourlyLimit: 0, isAdmin: false, ...over });

test('routeFromPush accepts only kehila, messageId, screen', () => {
  assert.deepEqual(routeFromPush({ kehila: 'k1', messageId: 'm1' }), { kehila: 'k1', messageId: 'm1' });
  assert.deepEqual(routeFromPush({ kehila: 'k1', screen: 'requests' }), { kehila: 'k1', screen: 'requests' });
  assert.deepEqual(routeFromPush({ kehila: 'k1', messageId: 'm1', url: 'x', extra: 'y' }), { kehila: 'k1', messageId: 'm1' });
  assert.equal(routeFromPush({ messageId: 'm1' }), null);
  assert.equal(routeFromPush(null), null);
  assert.equal(routeFromPush('k1'), null);
  assert.equal(routeFromPush({ kehila: '' }), null);
});

test('rejects non-string values', () => {
  assert.equal(routeFromPush({ kehila: 5 }), null);
  assert.equal(routeFromPush({ kehila: { a: 1 } }), null);
  assert.deepEqual(routeFromPush({ kehila: 'k1', messageId: 7, screen: ['requests'] }), { kehila: 'k1' });
});

test('unsupported on web', async () => {
  let called = 0;
  const api = { putDevice: async () => { called++; } } as any;
  assert.equal(await registerPush(api, { platform: 'web' }), 'unsupported');
  assert.equal(await registerPush(api, { platform: 'ios', isDevice: false, appOwnership: null, projectId: 'p' }), 'unsupported');
  assert.equal(await registerPush(api, { platform: 'ios', isDevice: true, appOwnership: 'expo', projectId: 'p' }), 'unsupported');
  assert.equal(await registerPush(api, { platform: 'ios', isDevice: true, appOwnership: null, projectId: undefined }), 'unsupported');
  assert.equal(called, 0);
});

test('registerPush stores the token and registers the device; denied stores nothing', async () => {
  const mem = new Map<string, string>();
  const calls: string[] = [];
  const api = { putDevice: async (t: string, p: string) => { calls.push(`device:${p}`); assert.equal(t, 'ExponentPushToken[x]'); } } as any;
  const base = {
    platform: 'android' as const, isDevice: true, appOwnership: null, projectId: 'p',
    storage: { set: async (k: string, v: string) => { mem.set(k, v); } },
    onToken: (t: string) => { calls.push('onToken'); void t; },
  };
  const notifs = (granted: boolean) => ({
    setAndroidChannel: async (id: string) => { calls.push(`channel:${id}`); },
    permission: async () => granted,
    token: async () => 'ExponentPushToken[x]',
  });
  assert.equal(await registerPush(api, { ...base, notifications: notifs(false) }), 'denied');
  assert.equal(mem.size, 0);
  assert.equal(await registerPush(api, { ...base, notifications: notifs(true) }), 'registered');
  assert.equal(mem.get(PUSH_TOKEN_KEY), 'ExponentPushToken[x]');
  assert.equal(PUSH_TOKEN_KEY, 'kehilot.pushToken');
  assert.ok(calls.includes('channel:community') && calls.includes('device:android'));
});

test('chat toggles default off and list only audience conversation channels', () => {
  const channels = [
    ch('a'), ch('c1', { conversation: true }), ch('c2', { conversation: true }), ch('c3', { conversation: true, inAudience: false }),
  ];
  assert.deepEqual(chatPrefRows(channels, notify()).map(r => [r.channelId, r.on]), [['c1', false], ['c2', false]]);
  assert.deepEqual(chatPrefRows(channels, notify({ chatChannels: ['c2', 'c3'] })).map(r => [r.channelId, r.on]), [['c1', false], ['c2', true]]);
});

test('toggleId adds and removes without duplicates', () => {
  assert.deepEqual(toggleId(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(toggleId(['a', 'b'], 'b', true), ['a', 'b']);
  assert.deepEqual(toggleId(['a', 'b'], 'a', false), ['b']);
});

test('sign-out clears the stored push token step', async () => {
  const log: string[] = [];
  await localSignOut({ clearTokens: async () => { log.push('tokens'); }, clearPush: async () => { log.push('push'); throw new Error('x'); }, wipeCaches: async () => { log.push('wipe'); }, resetStore: () => { log.push('reset'); } });
  assert.deepEqual(log, ['tokens', 'push', 'wipe', 'reset']);
});

test('setNotify is optimistic and reverts only the changed fields on error', async () => {
  const k0: Kehila = { kehilaId: 'k1', name: 'x', role: 'member', notify: notify(), settings: { pollSeconds: 60 } } as any;
  let fail = true;
  const sent: unknown[] = [];
  const api = {
    me: async () => ({ userId: 'u1', email: 'e', profile: { firstName: 'a', lastName: 'b', lang: 'he' }, kehilot: [{ kehilaId: 'k1', name: 'x', role: 'member', logoVersion: null }] }),
    kehila: async () => k0, channels: async () => [], changes: async () => ({ changes: [], cursor: '' }), messages: async () => [],
    putNotify: async (_k: string, p: unknown) => { sent.push(p); if (fail) throw new Error('boom'); return {}; },
  } as any;
  const mem = new Map<string, string>();
  const store = createStore(api, { get: async k => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); }, remove: async k => { mem.delete(k); } });
  await store.loadMe(); await store.selectKehila('k1');
  const p = store.setNotify({ mutedTypes: ['event'] });
  assert.deepEqual(store.getState().kehila!.notify.mutedTypes, ['event']);
  await assert.rejects(p);
  assert.deepEqual(store.getState().kehila!.notify.mutedTypes, []);
  fail = false;
  await store.setNotify({ membersBroadcasts: 'management_only' });
  assert.equal(store.getState().kehila!.notify.membersBroadcasts, 'management_only');
  assert.deepEqual(sent, [{ mutedTypes: ['event'] }, { membersBroadcasts: 'management_only' }]);
  store.reset();
});
