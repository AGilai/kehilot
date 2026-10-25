import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type { NotificationResponse } from 'expo-notifications';
import { api } from './api';

export async function enablePush(token: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('התראות Push זמינות באפליקציה המותקנת בטלפון.');
  if (!Device.isDevice) throw new Error('יש להפעיל התראות ממכשיר פיזי.');
  if (Constants.appOwnership === 'expo') throw new Error('התראות Push דורשות גרסת פיתוח מותקנת. ב־Expo Go אפשר לצפות בהודעות בתוך האפליקציה.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('טרם הוגדר פרויקט Expo לקבלת התראות. ההודעות זמינות בלוח הקהילה.');
  const Notifications = await import('expo-notifications');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('community', { name: 'הודעות הקהילה', importance: Notifications.AndroidImportance.DEFAULT });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('לא ניתנה הרשאה להתראות. ניתן לאפשר אותן בהגדרות המכשיר.');
  const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.push(token, pushToken.data);
}

export async function listenForNotifications(onReceive: () => void, onOpen: (id: string) => void, onMembership: () => void): Promise<() => void> {
  if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return () => {};
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  const received = Notifications.addNotificationReceivedListener(onReceive);
  const open = (response: NotificationResponse) => {
    if (response.notification.request.content.data?.screen === 'membership') { onMembership(); return; }
    const id = response.notification.request.content.data?.messageId;
    if (typeof id === 'string') onOpen(id);
  };
  const tapped = Notifications.addNotificationResponseReceivedListener(open);
  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last) { open(last); await Notifications.clearLastNotificationResponseAsync(); }
  } catch { /* Keep live listeners even if the OS cannot provide the last tap. */ }
  return () => { received.remove(); tapped.remove(); };
}
