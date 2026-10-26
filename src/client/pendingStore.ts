import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPendingInvite } from './links.ts';

/** The one pending-invite store of the app; it outlives the signed-out screens and the session. */
export const pendingInvite = createPendingInvite({
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
});
