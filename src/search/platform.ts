import { Platform } from 'react-native';
import { Image } from 'expo-image';
import type { CacheStore } from './cache.ts';
import { wipeAllCaches } from './cache.ts';

let store: CacheStore | null = null;
/** The one cache store of this device: IndexedDB on the web, files on a phone. */
export function cacheStore(): CacheStore {
  if (!store) {
    store = Platform.OS === 'web'
      ? (require('./store-web.ts') as typeof import('./store-web.ts')).createWebStore()
      : (require('./store-native.ts') as typeof import('./store-native.ts')).createNativeStore();
  }
  return store;
}

/**
 * Sign-out: the message cache, expo-image's disk and memory caches, and the share files (Task 13b).
 * Each step runs even if an earlier one fails; the first error is rethrown afterwards.
 */
export async function wipeCaches(): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (fn: () => Promise<unknown> | unknown) => { try { await fn(); } catch (e) { errors.push(e); } };
  await attempt(() => wipeAllCaches(cacheStore()));
  await attempt(() => Image.clearDiskCache());
  await attempt(() => Image.clearMemoryCache());
  if (Platform.OS !== 'web') {
    await attempt(() => {
      const { Directory, Paths } = require('expo-file-system') as typeof import('expo-file-system');
      const share = new Directory(Paths.cache, 'share');
      if (share.exists) share.delete();
    });
  }
  if (errors.length > 0) throw errors[0];
}
