/**
 * React key of the signed-in app: a different Kehila gives a new key, so `Main` remounts on Home with its
 * navigation, management mode, filters and drafts reset (no stale chat, detail or group screen of the old
 * Kehila, and no "left management" toast just because the role differs in the new one).
 */
export const mainKey = (kehilaId: string | null): string => `main:${kehilaId ?? 'none'}`;
