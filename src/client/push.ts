// Push registration and routing (Task 14). No top-level native imports: the pure helpers run under node --test,
// and the native modules load only when a function needs them. Never log a token or a push payload.
import type { endpoints } from './endpoints.ts';
import type { Channel, NotifyPrefs } from './types.ts';
import { dayOfWeek } from '../dates.ts';
import { isAdult, isManagement } from './roles.ts';
import type { MemberSeats } from '../seats/wire.ts';

type Api = ReturnType<typeof endpoints>;

/** Secure-store key of the Expo push token. Sign-out reads it (to delete the device) and removes it. */
export const PUSH_TOKEN_KEY = 'kehilot.pushToken';
export const ANDROID_CHANNEL = 'community';
/** Updated messages: low importance, no sound, no vibration (UX §19.2a). The server asks for it by this id. */
export const QUIET_CHANNEL = 'quiet';
export const QUIET_CHANNEL_NAME = 'עדכונים שקטים';

export type PushStatus = 'registered' | 'denied' | 'unsupported';
export type PushRoute = { kehila: string; messageId?: string; screen?: string; /** The Friday of the Shabbat a seats push is about. */ week?: string };

/** Only `kehila`, `messageId` and `screen` are read, and only as non-empty strings; anything else is dropped. */
export function routeFromPush(data: unknown): PushRoute | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
  const kehila = str(d.kehila);
  if (!kehila) return null;
  const out: PushRoute = { kehila };
  const messageId = str(d.messageId);
  const screen = str(d.screen);
  if (messageId) out.messageId = messageId;
  if (screen) out.screen = screen;
  const week = str(d.week);
  if (week && /^\d{4}-\d\d-\d\d$/.test(week) && dayOfWeek(week) === 5) out.week = week;
  return out;
}

/** The server accepts at most this many `chatChannels`. */
export const MAX_CHAT_CHANNELS = 100;

export type MutedRow = { userId: string; name: string };

/**
 * Names for the muted-members list: directory first (members and gabbaim), then names seen in the feed, then
 * the fallback. One row per ID, in the order given. `directory` is null for listeners or when it failed.
 */
export function mutedMemberRows(mutedIds: string[], directory: { userId: string; displayName: string }[] | null, feedNames: Map<string, string>, fallback: string): MutedRow[] {
  const dir = new Map((directory ?? []).map(d => [d.userId, d.displayName]));
  const seen = new Set<string>();
  const out: MutedRow[] = [];
  for (const id of mutedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ userId: id, name: dir.get(id) || feedNames.get(id) || fallback });
  }
  return out;
}

/** Returns what the holder keeps and empties it, so a tap routes once (a remount never replays it). */
export function takePushTarget<T>(holder: { current: T | null }): T | null {
  const v = holder.current;
  holder.current = null;
  return v;
}

/** Where a tapped push goes. `requests` is the approvals queue (gabbai only); `group_requests` is the requests of a group the user administers (the screen finds which). */
export function pushDestination(t: { messageId?: string; screen?: string }, role: string | undefined): 'approvals' | 'group_requests' | 'message' | 'seats' | 'home' {
  if (t.screen === 'seats' && isAdult(role)) return 'seats';
  if (t.screen === 'requests' && isManagement(role)) return 'approvals';
  if (t.screen === 'group_requests' && isAdult(role)) return 'group_requests';
  if (t.screen) return 'home';
  return t.messageId ? 'message' : 'home';
}

export type ChatPrefRow = { channelId: string; name: string; on: boolean };

/** The "שיחות" group: one row per conversation channel in the caller's audience; off unless listed in `chatChannels`. */
export function chatPrefRows(channels: Channel[], notify: NotifyPrefs): ChatPrefRow[] {
  return channels.filter(c => c.conversation && c.inAudience)
    .map(c => ({ channelId: c.channelId, name: c.name, on: notify.chatChannels.includes(c.channelId) }));
}

/** The seat-form reminders switch in the preferences: only for someone the reminders go to, whose family has seats (or had them last week). */
export function seatReminderPrefShown(m: MemberSeats | null): boolean {
  return !!m && m.remindable && (m.seatCount > 0 || m.hadSeats);
}

/** `list` with `id` present (on) or absent (off), without duplicates. */
export function toggleId(list: string[], id: string, on: boolean): string[] {
  const rest = list.filter(x => x !== id);
  return on ? [...rest, id] : rest;
}

export type NotificationsPort = {
  setAndroidChannel(id: string): Promise<void>;
  /** Asks when allowed; true when notifications are granted. */
  permission(): Promise<boolean>;
  token(projectId: string): Promise<string>;
};

export type PushDeps = {
  platform?: 'ios' | 'android' | 'web';
  isDevice?: boolean;
  appOwnership?: string | null;
  projectId?: string;
  storage?: { set(k: string, v: string): Promise<void> };
  notifications?: NotificationsPort;
  /** Told the new token (kept in memory for sign-out). */
  onToken?: (token: string) => void;
};

async function defaultPort(): Promise<NotificationsPort> {
  const N = await import('expo-notifications');
  return {
    setAndroidChannel: async id => {
      await N.setNotificationChannelAsync(id, id === QUIET_CHANNEL
        ? { name: QUIET_CHANNEL_NAME, importance: N.AndroidImportance.LOW, sound: null, enableVibrate: false, vibrationPattern: null }
        : { name: 'הודעות הקהילה', importance: N.AndroidImportance.DEFAULT });
    },
    permission: async () => {
      let p = await N.getPermissionsAsync();
      if (!p.granted && p.canAskAgain) p = await N.requestPermissionsAsync();
      return p.granted;
    },
    token: async projectId => (await N.getExpoPushTokenAsync({ projectId })).data,
  };
}

/**
 * Registers this device for push in the signed-in account. `unsupported` on web, a simulator, Expo Go and
 * without an EAS project ID; `denied` when the user refuses permission (nothing is stored then).
 */
export async function registerPush(api: Api, o: PushDeps = {}): Promise<PushStatus> {
  const platform = o.platform ?? (await import('react-native')).Platform.OS as 'ios' | 'android' | 'web';
  if (platform === 'web') return 'unsupported';
  const isDevice = 'isDevice' in o ? o.isDevice : (await import('expo-device')).isDevice;
  if (!isDevice) return 'unsupported';
  const C = 'appOwnership' in o && 'projectId' in o ? null : (await import('expo-constants')).default;
  const appOwnership = 'appOwnership' in o ? o.appOwnership : C?.appOwnership;
  if (appOwnership === 'expo') return 'unsupported';
  const projectId = 'projectId' in o ? o.projectId : (C?.expoConfig?.extra?.eas?.projectId as string | undefined);
  if (!projectId) return 'unsupported';
  const port = o.notifications ?? await defaultPort();
  if (platform === 'android') { await port.setAndroidChannel(ANDROID_CHANNEL); await port.setAndroidChannel(QUIET_CHANNEL); }
  if (!(await port.permission())) return 'denied';
  const token = await port.token(projectId);
  const storage = o.storage ?? await secureStorage();
  await storage.set(PUSH_TOKEN_KEY, token);
  o.onToken?.(token);
  await api.putDevice(token, platform);
  return 'registered';
}

async function secureStorage(): Promise<{ set(k: string, v: string): Promise<void> }> {
  const S = await import('expo-secure-store');
  return { set: (k, v) => S.setItemAsync(k, v) };
}

/** Whether the OS currently allows notifications (the M5 banner). `unsupported` where push cannot work. */
export async function pushPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  const { Platform } = await import('react-native');
  if (Platform.OS === 'web') return 'unsupported';
  const N = await import('expo-notifications');
  return (await N.getPermissionsAsync()).granted ? 'granted' : 'denied';
}

const handled = new Set<string>();

/**
 * Foreground receive -> `onReceive` (poll now). A tap, or the tap that launched the app, -> `onOpen` with the
 * route (null when the payload is not ours). Returns the unsubscribe function.
 */
export async function listenForPush(h: { onReceive: () => void; onOpen: (r: PushRoute | null) => void }): Promise<() => void> {
  const { Platform } = await import('react-native');
  const Constants = (await import('expo-constants')).default;
  if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return () => {};
  const N = await import('expo-notifications');
  N.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  const open = (r: import('expo-notifications').NotificationResponse) => {
    const id = r.notification.request.identifier;
    if (handled.has(id)) return;
    handled.add(id);
    h.onOpen(routeFromPush(r.notification.request.content.data));
  };
  const a = N.addNotificationReceivedListener(() => h.onReceive());
  const b = N.addNotificationResponseReceivedListener(open);
  void N.getLastNotificationResponseAsync().then(r => { if (r) open(r); }).catch(() => {});
  return () => { a.remove(); b.remove(); };
}
