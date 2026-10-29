import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUSH_TOKEN_KEY, chatPrefRows, mutedMemberRows, pushDestination, registerPush, seatReminderPrefShown, routeFromPush, takePushTarget, toggleId } from '../src/client/push.ts';
import { createStore } from '../src/client/store.ts';
import { localSignOut } from '../src/auth/signout.ts';
import type { MemberSeats } from '../src/seats/wire.ts';
import type { Channel, Kehila, NotifyPrefs } from '../src/client/types.ts';

const notify = (over: Partial<NotifyPrefs> = {}): NotifyPrefs => ({ mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [], seatReminders: true, ...over });
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
  assert.ok(calls.includes('channel:community') && calls.includes('channel:quiet') && calls.includes('device:android'));
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

test('mutedMemberRows: directory, then feed names, then fallback; no duplicates', () => {
  const feed = new Map([['u2', 'שם מההודעות'], ['u3', 'שם אחר']]);
  const dir = [{ userId: 'u1', displayName: 'משפחת בדיוני' }, { userId: 'u2', displayName: 'משפחת לדוגמה' }];
  assert.deepEqual(mutedMemberRows(['u1', 'u2', 'u3', 'u4', 'u1'], dir, feed, 'חבר'), [
    { userId: 'u1', name: 'משפחת בדיוני' }, { userId: 'u2', name: 'משפחת לדוגמה' }, { userId: 'u3', name: 'שם אחר' }, { userId: 'u4', name: 'חבר' },
  ]);
  // Listener or failed directory: feed names only.
  assert.deepEqual(mutedMemberRows(['u2', 'u9'], null, feed, 'חבר'), [{ userId: 'u2', name: 'שם מההודעות' }, { userId: 'u9', name: 'חבר' }]);
});

test('takePushTarget returns the tap once', () => {
  const h = { current: { messageId: 'm1' } as { messageId: string } | null };
  assert.deepEqual(takePushTarget(h), { messageId: 'm1' });
  assert.equal(takePushTarget(h), null);
});

test('a failed change does not restore over a newer change to the same field', async () => {
  const k0: Kehila = { kehilaId: 'k1', name: 'x', role: 'member', notify: notify(), settings: { pollSeconds: 60 } } as any;
  let n = 0;
  const api = {
    me: async () => ({ userId: 'u1', email: 'e', profile: { firstName: 'a', lastName: 'b', lang: 'he' }, kehilot: [{ kehilaId: 'k1', name: 'x', role: 'member', logoVersion: null }] }),
    kehila: async () => k0, channels: async () => [], changes: async () => ({ changes: [], cursor: '' }), messages: async () => [],
    putNotify: async () => { if (n++ === 0) { await new Promise(r => setTimeout(r, 20)); throw new Error('boom'); } return {}; },
  } as any;
  const mem = new Map<string, string>();
  const store = createStore(api, { get: async k => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); }, remove: async k => { mem.delete(k); } });
  await store.loadMe(); await store.selectKehila('k1');
  const a = store.setNotify({ mutedChannels: ['a'] });
  const b = store.setNotify({ mutedChannels: ['a', 'b'] });
  await assert.rejects(a);
  await b;
  assert.deepEqual(store.getState().kehila!.notify.mutedChannels, ['a', 'b']);
  store.reset();
});

test('pushDestination: requests opens approvals for a gabbai only; group_requests opens the group requests (any role)', async () => {
  const { pushDestination } = await import('../src/client/push.ts');
  assert.equal(pushDestination({ screen: 'requests' }, 'gabbai'), 'approvals');
  assert.equal(pushDestination({ screen: 'requests' }, 'member'), 'home');
  assert.equal(pushDestination({ screen: 'group_requests' }, 'gabbai'), 'group_requests');
  assert.equal(pushDestination({ screen: 'group_requests' }, 'member'), 'group_requests');
  assert.equal(pushDestination({ screen: 'group_requests' }, 'listener'), 'home');
  assert.equal(pushDestination({ messageId: 'm1' }, 'listener'), 'message'); // a listener's tap opens the message in Main
  assert.equal(pushDestination({ screen: 'other' }, 'gabbai'), 'home');
  assert.equal(pushDestination({ messageId: 'm1' }, 'gabbai'), 'message');
  assert.equal(pushDestination({}, 'member'), 'home');
});

test('family screen opens home', () => {
  assert.equal(pushDestination({ screen: 'family' }, 'member'), 'home');
  assert.deepEqual(routeFromPush({ kehila: 'k1', screen: 'family', name: 'x' }), { kehila: 'k1', screen: 'family' });
});

test('routeFromPush keeps a valid week (a Friday date) and drops anything else', () => {
  assert.deepEqual(routeFromPush({ kehila: 'k', screen: 'seats', week: '2026-10-30' }), { kehila: 'k', screen: 'seats', week: '2026-10-30' });
  assert.equal(routeFromPush({ kehila: 'k', screen: 'seats', week: 'x' })!.week, undefined);
  assert.equal(routeFromPush({ kehila: 'k', screen: 'seats', week: '2026-10-29' })!.week, undefined, 'Thursday is not a Friday');
  assert.equal(routeFromPush({ kehila: 'k', week: 5 })!.week, undefined);
});

test('pushDestination: seats opens for every adult (no preview flag needed); a listener gets home', () => {
  for (const role of ['member', 'gabbai', 'tech']) {
    assert.equal(pushDestination({ screen: 'seats' }, role), 'seats');
  }
  assert.equal(pushDestination({ screen: 'seats' }, 'listener'), 'home');
});

test('seatReminderPrefShown: only for a remindable family that has or had seats', () => {
  const m = (over: Partial<MemberSeats> = {}) => ({ remindable: true, seatCount: 0, hadSeats: false, ...over }) as MemberSeats;
  assert.equal(seatReminderPrefShown(null), false);
  assert.equal(seatReminderPrefShown(m({ remindable: false, seatCount: 3, hadSeats: true })), false);
  assert.equal(seatReminderPrefShown(m()), false);
  assert.equal(seatReminderPrefShown(m({ seatCount: 2 })), true);
  assert.equal(seatReminderPrefShown(m({ hadSeats: true })), true);
});
