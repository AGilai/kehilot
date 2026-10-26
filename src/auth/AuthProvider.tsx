import React from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { config } from '../config.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { createHttp } from '../client/http.ts';
import { endpoints } from '../client/endpoints.ts';
import { FIXTURE_APP_SCREENS, assertFixturesAllowed, createFixtureApi, fixtureParams } from '../client/fixtures.ts';
import * as cognito from './cognito.ts';
import { AuthError } from './cognito.ts';
import { signInSrp } from './srp.ts';
import { REFRESH_KEY, createTokenManager } from './tokens.ts';
import type { KeyValue } from './tokens.ts';
import { createSignOut, localSignOut, resolveStart } from './signout.ts';
import { wipeCaches } from '../search/platform.ts';
import { pendingInvite } from '../client/pendingStore.ts';
import { normEmail } from './validate.ts';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'offline';
export type Api = ReturnType<typeof endpoints>;
export type PendingNames = { first: string; last: string };

// Task 9 hook point: the session store registers its reset here; signOut() and forced sign-outs call it.
let resetSessionStore: () => void = () => {};
export function setSessionStoreReset(fn: () => void): void {
  resetSessionStore = fn;
}

// Task 12 hook point: the push registration code reports the current device token (kept in memory only).
let pushToken: string | null = null;
export function setPushToken(token: string | null): void {
  pushToken = token;
}

export type AuthApi = {
  status: AuthStatus;
  api: Api;
  pendingNames: PendingNames | null;
  /** True in fixture mode (no real auth). */
  fixtures: boolean;
  signIn(email: string, password: string): Promise<void>;
  register(email: string, password: string, first: string, last: string): Promise<void>;
  confirm(email: string, code: string): Promise<void>;
  resend(email: string): Promise<void>;
  forgot(email: string): Promise<void>;
  resetPassword(email: string, code: string, password: string): Promise<void>;
  signInFederated(provider: 'google' | 'apple'): Promise<void>;
  signOut(): Promise<void>;
  /** From 'offline': try restoring the stored session again. */
  retry(): Promise<void>;
};

const AuthContext = React.createContext<AuthApi | null>(null);

/** The refresh token is the only thing persisted: secure store on native, localStorage on web. */
function createStorage(): KeyValue {
  if (Platform.OS === 'web') {
    return {
      async get(k) { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
      async set(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch { /* storage blocked */ } },
      async remove(k) { try { globalThis.localStorage?.removeItem(k); } catch { /* storage blocked */ } },
    };
  }
  return {
    get: (k) => SecureStore.getItemAsync(k),
    set: (k, v) => SecureStore.setItemAsync(k, v),
    remove: (k) => SecureStore.deleteItemAsync(k),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { lang } = useI18n();
  const langRef = React.useRef(lang);
  langRef.current = lang;
  const [status, setStatus] = React.useState<AuthStatus>('loading');
  const [pendingNames, setPendingNames] = React.useState<PendingNames | null>(null);
  const forcedOut = React.useRef<() => void>(() => {});

  const core = React.useMemo(() => {
    if (config.fixtures) {
      assertFixturesAllowed();
      const p = fixtureParams();
      return { fixtures: true as const, api: createFixtureApi(p.role, p.screen, p.lang), startSignedIn: !p.screen || FIXTURE_APP_SCREENS.includes(p.screen) };
    }
    const storage = createStorage();
    const onOut = () => forcedOut.current();
    const tokens = createTokenManager({ storage, refresh: cognito.refresh, onSignedOut: onOut });
    const http = createHttp({ baseUrl: config.apiUrl, tokens, onAccountDeleted: onOut, onSignedOut: onOut });
    return { fixtures: false as const, storage, tokens, api: endpoints(http) };
  }, []);

  // One local clean-up for every sign-out path (user, forced, account deleted).
  const cleanup = React.useCallback(() => localSignOut({
    clearTokens: () => (core.fixtures ? Promise.resolve() : core.tokens.clear()),
    clearPending: () => pendingInvite.clear(),
    wipeCaches,
    resetStore: () => { setPendingNames(null); resetSessionStore(); },
    done: () => setStatus('signedOut'),
  }), [core]);
  forcedOut.current = () => { void cleanup(); };

  const start = React.useCallback(async () => {
    if (core.fixtures) { setStatus(core.startSignedIn ? 'signedIn' : 'signedOut'); return; }
    setStatus(await resolveStart(() => core.tokens.restore()));
  }, [core]);
  React.useEffect(() => { void start(); }, [start]);

  const value = React.useMemo<AuthApi>(() => {
    const fixtures = core.fixtures;
    return {
      status, api: core.api, pendingNames, fixtures,
      async signIn(email, password) {
        if (core.fixtures) { setStatus('signedIn'); return; }
        await core.tokens.setSession(await signInSrp(normEmail(email), password));
        setStatus('signedIn');
      },
      async register(email, password, first, last) {
        if (core.fixtures) return;
        await cognito.signUp(normEmail(email), password, langRef.current);
        setPendingNames({ first: first.trim(), last: last.trim() }); // in memory until the profile is saved (Task 9)
      },
      async confirm(email, code) {
        if (core.fixtures) return;
        await cognito.confirmSignUp(normEmail(email), code.trim());
      },
      async resend(email) {
        if (core.fixtures) return;
        await cognito.resendCode(normEmail(email), langRef.current);
      },
      async forgot(email) {
        if (core.fixtures) return;
        await cognito.forgotPassword(normEmail(email), langRef.current);
      },
      async resetPassword(email, code, password) {
        if (core.fixtures) return;
        await cognito.confirmForgotPassword(normEmail(email), code.trim(), password);
      },
      async signInFederated() {
        throw new AuthError('unsupported'); // Task 20
      },
      async signOut() {
        if (core.fixtures) { await cleanup(); return; }
        await createSignOut({
          deleteDevice: async () => { if (pushToken) await core.api.deleteDevice(pushToken); },
          revoke: async () => {
            const rt = await core.storage.get(REFRESH_KEY).catch(() => null);
            if (rt) await cognito.revoke(rt);
          },
          clearTokens: () => core.tokens.clear(), clearPending: () => pendingInvite.clear(), wipeCaches,
          resetStore: () => { setPendingNames(null); resetSessionStore(); }, done: () => setStatus('signedOut'),
        })();
      },
      async retry() { setStatus('loading'); await start(); },
    };
  }, [core, status, pendingNames, cleanup, start]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const c = React.useContext(AuthContext);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
