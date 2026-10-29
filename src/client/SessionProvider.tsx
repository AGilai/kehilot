import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValue } from '../auth/tokens.ts';
import { setSessionKeysClear, setSessionStoreReset, useAuth } from '../auth/AuthProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { createLogoCache } from './logoCache.ts';
import { clearSessionKeys } from './sessionKeys.ts';
import { pendingInvite } from './pendingStore.ts';
import { createImageUrls } from '../media/imageUrl.ts';
import { createStore } from './store.ts';
import { cacheStore } from '../search/platform.ts';
import type { CachedMessage } from '../search/cache.ts';
import type { Hit } from '../search/hit.ts';
import type { Route, StoreState } from './store.ts';
import type { DirectoryEntry, Lang, Message, NotifyPrefs, PostMessageBody, UpdateMessageBody, Reply, TargetFamily, UploadGrant } from './types.ts';

const storage: KeyValue = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
};

export type SessionApi = {
  state: StoreState;
  /** 'loading' and 'error' while the start sequence runs or failed; then where it ended. */
  route: Route | 'loading' | 'error';
  logo(kehilaId: string, logoVersion: string | null): Promise<string | null>;
  select(kehilaId: string): Promise<void>;
  saveProfile(p: { firstName: string; lastName: string; lang: Lang }, opts?: { age13?: boolean }): Promise<void>;
  /** Age gate: records the age 13 consent and reloads me. */
  acceptAge13(): Promise<void>;
  /** Join screen: accepts the invite and opens the new Kehila. */
  acceptInvite(code: string): Promise<void>;
  /** Listener home: sends a membership request (already sent counts as sent). */
  requestMembership(): Promise<void>;
  /** Hides the dropped-invite notice. */
  dismissJoinError(): void;
  /** Re-run the start sequence after an error. */
  retry(): void;
  /** Reload the channel list now (after a channel or chat-limit change). */
  refreshChannels(): Promise<void>;
  /** Reload the open Kehila's record (after admin rights ended). */
  refreshKehila(): Promise<void>;
  /** Poll the change feed now (a push arrived). */
  pollNow(): Promise<void>;
  /** M5: optimistic notification-preference change; rejects (after reverting) when the server refuses. */
  setNotify(partial: Partial<NotifyPrefs>): Promise<void>;
  /** Me: names and language (the server's answer becomes me.profile). */
  editProfile(p: { firstName: string; lastName: string; lang: Lang }): Promise<void>;
  /** Me: my phone number (E.164) or null to remove it. */
  setPhone(phone: string | null): Promise<void>;
  /** Me: my phone-list switch for the open Kehila. */
  setShowPhone(show: boolean): Promise<void>;
  /** Me: leaves a Kehila; the app then moves to another Kehila or the join screen. Throws on a refusal (last_gabbai). */
  leaveKehila(kehilaId: string): Promise<void>;
  /** Message actions in the open Kehila (see the store). */
  markRead(messageId: string): Promise<void>;
  loadReplies(messageId: string): Promise<void>;
  /** `to` is omitted for the route's default, `family`, or one adult's userId. */
  sendReply(messageId: string, body: string, to?: string): Promise<Reply | null>;
  /** The text only; the recipient is fixed once sent. */
  editReply(messageId: string, replyId: string, body: string): Promise<Reply | null>;
  deleteReply(messageId: string, replyId: string): Promise<void>;
  /** Marks the replies up to `upTo` seen (recipients only) and refreshes the mailbox. */
  markRepliesSeen(messageId: string, upTo: string): Promise<void>;
  /** Loads the mailbox into `state.inbox` (memory only; adults only). */
  loadInbox(): Promise<void>;
  join(messageId: string): Promise<void>;
  removeMessage(messageId: string): Promise<void>;
  /** A fresh-enough presigned URL for a message image, or null when it has none. Memory only. */
  imageUrl(messageId: string, fresh?: boolean): Promise<string | null>;
  /** Publishes or chats; the returned message is already in the feed (and the search cache). */
  postMessage(body: PostMessageBody): Promise<Message>;
  /** Update an event or condolence in place (author, management, bereaved family adult). `notified` is false when saved quietly. */
  updateMessage(messageId: string, body: UpdateMessageBody): Promise<{ message: Message; notified: boolean }>;
  /** An S3 upload grant for the open Kehila. Never log or store it. */
  requestUpload(o: { channelId: string; contentType: 'image/jpeg' | 'image/png'; bytes: number }): Promise<UploadGrant>;
  /** The families (members) a message to this channel may be about. */
  directory(channelId?: string): Promise<DirectoryEntry[]>;
  /** The families a blessing in this channel may be about (adults who can read it; no children). */
  targetFamilies(channelId: string): Promise<TargetFamily[]>;
  /** Offline search over the on-phone cache of the open Kehila. */
  search(q: string, o?: { channelId?: string }): Promise<CachedMessage[]>;
  /** The whole on-phone archive of the open Kehila (the Messages filter counts over it). */
  archive(): Promise<CachedMessage[]>;
  cacheStatus(): Promise<{ complete: boolean; count: number }>;
  /** An older message (a search hit): full online, the read-only offline copy without a connection. */
  loadHit(messageId: string): Promise<Hit>;
};

const SessionContext = React.createContext<SessionApi | null>(null);

/** Mounted only while signed in. Every async result is checked against the store generation. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { api } = useAuth();
  const { setLang } = useI18n();
  const store = React.useMemo(() => createStore(api, storage, { pending: pendingInvite, cacheStore: cacheStore(), isActive: () => AppState.currentState === 'active' }), [api]);
  const images = React.useMemo(() => createImageUrls(api), [api]);
  const logos = React.useMemo(() => createLogoCache(storage), []);
  const logo = React.useCallback((k: string, v: string | null) => logos.get(api, k, v), [logos, api]);
  const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [route, setRoute] = React.useState<SessionApi['route']>('loading');
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    setSessionStoreReset(() => store.reset());
    setSessionKeysClear(() => clearSessionKeys(storage, store.getState().me?.userId ?? null, () => AsyncStorage.getAllKeys()));
    return () => { setSessionStoreReset(() => {}); setSessionKeysClear(async () => {}); store.reset(); images.clear(); };
  }, [store, images]);

  React.useEffect(() => {
    const gen = store.getState().generation;
    setRoute('loading');
    store.start().then(r => { if (store.guard(gen)) setRoute(r); }, () => { if (store.guard(gen)) setRoute('error'); });
  }, [store, attempt]);

  // profile.lang sets the UI language.
  const profileLang = state.me?.profile?.lang;
  React.useEffect(() => { if (profileLang) setLang(profileLang); }, [profileLang, setLang]);

  // me() runs again when the app comes to the foreground.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active') return;
      void store.refreshChannels().catch(() => {}); // a changed readable channel set wipes the search cache
      void store.pollNow(); // catch up at once; the poll is paused while the app is in the background
      void store.loadInbox().catch(() => {}); // the Me badge
      const gen = store.getState().generation;
      try {
        if (!(await store.loadMe())) return;
        if (store.dropMissingSelection()) { const r = await store.chooseKehila(); if (store.guard(gen)) setRoute(r); }
        else if (await store.syncRole()) void store.pollNow(); // approved (or changed) while away: the tabs follow the new role
      } catch { /* offline: keep what we have */ }
    });
    return () => sub.remove();
  }, [store]);

  const value = React.useMemo<SessionApi>(() => ({
    state, route,
    logo,
    async select(k) {
      const gen = store.getState().generation;
      await store.selectKehila(k);
      if (store.guard(gen)) setRoute('ready');
    },
    async saveProfile(p, o) {
      const gen = store.getState().generation;
      const r = await store.saveProfile(p, o);
      if (store.guard(gen)) setRoute(r);
    },
    async acceptAge13() {
      const gen = store.getState().generation;
      const r = await store.acceptAge13();
      if (store.guard(gen)) setRoute(r);
    },
    async acceptInvite(code) {
      const gen = store.getState().generation;
      if (await store.acceptInvite(code) && store.guard(gen)) setRoute('ready');
    },
    requestMembership: () => store.requestMembership(),
    dismissJoinError: () => store.clearJoinError(),
    retry: () => setAttempt(a => a + 1),
    refreshChannels: () => store.refreshChannels(),
    refreshKehila: () => store.refreshKehila(),
    pollNow: () => store.pollNow(),
    setNotify: p => store.setNotify(p),
    editProfile: p => store.editProfile(p),
    setPhone: p => store.setPhone(p),
    setShowPhone: s => store.setShowPhone(s),
    async leaveKehila(k) {
      const gen = store.getState().generation;
      const r = await store.leaveKehila(k);
      if (store.guard(gen)) setRoute(r);
    },
    markRead: m => store.markRead(m),
    loadReplies: m => store.loadReplies(m),
    sendReply: (m, body, to) => store.sendReply(m, body, to),
    editReply: (m, r, body) => store.editReply(m, r, body),
    deleteReply: (m, r) => store.deleteReply(m, r),
    markRepliesSeen: (m, upTo) => store.markRepliesSeen(m, upTo),
    loadInbox: () => store.loadInbox(),
    join: m => store.join(m),
    removeMessage: m => store.removeMessage(m),
    postMessage: b => store.postMessage(b),
    updateMessage: (m, b) => store.updateMessage(m, b),
    requestUpload: o => store.requestUpload(o),
    targetFamilies: async c => { const k = store.getState().kehilaId; return k ? api.targetFamilies(k, c) : []; },
    directory: async c => { const k = store.getState().kehilaId; return k ? api.directory(k, c) : []; },
    search: (q, o) => store.search(q, o),
    archive: store.archive,
    cacheStatus: store.cacheStatus,
    loadHit: m => store.loadHit(m),
    imageUrl: async (m, fresh) => { const k = store.getState().kehilaId; return k ? images.get(k, m, { fresh }) : null; },
  }), [state, route, logo, store, images, api]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const c = React.useContext(SessionContext);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
