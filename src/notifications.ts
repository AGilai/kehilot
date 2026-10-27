import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type { NotificationResponse } from 'expo-notifications';
import { api } from './api';
import { opensMessages } from './notificationRouting';

async function messageChannel(Notifications: typeof import('expo-notifications')) {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('messages', { name: 'התראות על הודעות', importance: Notifications.AndroidImportance.HIGH });
}

async function register(token: string, current = () => true): Promise<void> {
  if (!Device.isDevice) throw new Error('יש להפעיל התראות ממכשיר פיזי.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('שירות ההתראות עדיין לא הוגדר לקהילה. ההודעות זמינות באפליקציה.');
  const Notifications = await import('expo-notifications');
  const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
  if (current()) await api.push(token, pushToken.data);
}

// Restore the device registration after login/token changes without asking for
// permission again. Permission is requested only by the explicit enable button.
async function syncRegistration(token: string, current: () => boolean): Promise<void> {
  if (!Device.isDevice || !Constants.expoConfig?.extra?.eas?.projectId) return;
  const Notifications = await import('expo-notifications');
  if ((await Notifications.getPermissionsAsync()).granted && current()) await register(token, current);
}

export async function enablePush(token: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('התראות Push זמינות באפליקציה המותקנת בטלפון.');
  if (Constants.appOwnership === 'expo') throw new Error('התראות Push דורשות גרסת פיתוח מותקנת. ב־Expo Go אפשר לצפות בהודעות בתוך האפליקציה.');
  const Notifications = await import('expo-notifications');
  await messageChannel(Notifications);
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('לא ניתנה הרשאה להתראות. ניתן לאפשר אותן בהגדרות המכשיר.');
  await register(token);
}

export async function listenForNotifications(onReceive: () => void, onOpenMessages: () => void, token: string): Promise<() => void> {
  if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return () => {};
  const Notifications = await import('expo-notifications');
  await messageChannel(Notifications);
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
  let disposed = false;
  let registering = false;
  const sync = () => {
    if (disposed || registering) return;
    registering = true;
    void syncRegistration(token, () => !disposed).catch(() => {}).finally(() => { registering = false; });
  };
  sync();
  const active = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
  const changedToken = Notifications.addPushTokenListener(sync);
  const received = Notifications.addNotificationReceivedListener(onReceive);
  const handled = new Set<string>();
  const open = (response: NotificationResponse) => {
    if (!opensMessages(response.notification.request.content.data)) return;
    const key = response.notification.request.identifier + ':' + response.actionIdentifier;
    if (handled.has(key)) return;
    handled.add(key);
    onOpenMessages(); onReceive();
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  };
  const tapped = Notifications.addNotificationResponseReceivedListener(open);
  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last) { open(last); await Notifications.clearLastNotificationResponseAsync(); }
  } catch { /* Keep live listeners even if the OS cannot provide the last tap. */ }
  return () => { disposed = true; received.remove(); tapped.remove(); active.remove(); changedToken.remove(); };
}
