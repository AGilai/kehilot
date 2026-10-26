import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValue } from '../auth/tokens.ts';
import { setSessionStoreReset, useAuth } from '../auth/AuthProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { createLogoCache } from './logoCache.ts';
import { pendingInvite } from './pendingStore.ts';
import { createStore } from './store.ts';
import type { Route, StoreState } from './store.ts';
import type { Lang } from './types.ts';

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
  saveProfile(p: { firstName: string; lastName: string; lang: Lang }): Promise<void>;
  /** Join screen: accepts the invite and opens the new Kehila. */
  acceptInvite(code: string): Promise<void>;
  /** Listener home: sends a membership request (already sent counts as sent). */
  requestMembership(): Promise<void>;
  /** Hides the dropped-invite notice. */
  dismissJoinError(): void;
  /** Re-run the start sequence after an error. */
  retry(): void;
};

const SessionContext = React.createContext<SessionApi | null>(null);

/** Mounted only while signed in. Every async result is checked against the store generation. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { api } = useAuth();
  const { setLang } = useI18n();
  const store = React.useMemo(() => createStore(api, storage, { pending: pendingInvite }), [api]);
  const logos = React.useMemo(() => createLogoCache(storage), []);
  const logo = React.useCallback((k: string, v: string | null) => logos.get(api, k, v), [logos, api]);
  const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [route, setRoute] = React.useState<SessionApi['route']>('loading');
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    setSessionStoreReset(() => store.reset());
    return () => { setSessionStoreReset(() => {}); store.reset(); };
  }, [store]);

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
    async saveProfile(p) {
      const gen = store.getState().generation;
      const r = await store.saveProfile(p);
      if (store.guard(gen)) setRoute(r);
    },
    async acceptInvite(code) {
      const gen = store.getState().generation;
      if (await store.acceptInvite(code) && store.guard(gen)) setRoute('ready');
    },
    requestMembership: () => store.requestMembership(),
    dismissJoinError: () => store.clearJoinError(),
    retry: () => setAttempt(a => a + 1),
  }), [state, route, logo, store]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const c = React.useContext(SessionContext);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
