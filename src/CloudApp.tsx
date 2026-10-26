import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Banner } from './kit/components.tsx';
import { useErrorText } from './views/auth/Frame.tsx';
import { AuthProvider, useAuth } from './auth/AuthProvider.tsx';
import { config } from './config.ts';
import { fixtureParams } from './client/fixtures.ts';
import { rememberOnIntent } from './client/links.ts';
import { pendingInvite } from './client/pendingStore.ts';
import { SessionProvider, useSession } from './client/SessionProvider.tsx';
import { I18nProvider, useI18n } from './i18n/I18nProvider.tsx';
import { Button, Screen, Txt, useAppFonts, useTokens } from './kit/components.tsx';
import { ForgotPassword } from './views/auth/ForgotPassword.tsx';
import { AuthFrame } from './views/auth/Frame.tsx';
import { GuestHome } from './views/GuestHome.tsx';
import { Join } from './views/Join.tsx';
import { Main } from './views/Main.tsx';
import { useIncomingLink } from './views/useIncomingLink.ts';
import { KehilaSwitcher } from './views/KehilaSwitcher.tsx';
import { NoKehila } from './views/NoKehila.tsx';
import { ProfileSetup } from './views/ProfileSetup.tsx';
import { TopBar } from './views/TopBar.tsx';
import { Register } from './views/auth/Register.tsx';
import { SignIn } from './views/auth/SignIn.tsx';
import { Verify } from './views/auth/Verify.tsx';

type AuthScreen =
  | { name: 'signin'; email?: string; notice?: string }
  | { name: 'register' }
  | { name: 'verify'; email: string }
  | { name: 'forgot'; email?: string };

function initialScreen(start?: 'register' | 'signin'): AuthScreen {
  if (start === 'register') return { name: 'register' };
  if (start === 'signin') return { name: 'signin' };
  const s = config.fixtures ? fixtureParams().screen : null;
  if (s === 'register') return { name: 'register' };
  if (s === 'verify') return { name: 'verify', email: 'dana@example.invalid' };
  if (s === 'forgot') return { name: 'forgot' };
  return { name: 'signin' };
}

function SignedOutFlow({ start }: { start?: 'register' | 'signin' }) {
  const { t } = useI18n();
  const [screen, setScreen] = React.useState<AuthScreen>(() => initialScreen(start));
  switch (screen.name) {
    case 'register':
      return <Register onSignIn={() => setScreen({ name: 'signin' })} onForgot={email => setScreen({ name: 'forgot', email })} onRegistered={email => setScreen({ name: 'verify', email })} />;
    case 'verify':
      return <Verify email={screen.email} onBack={() => setScreen({ name: 'signin', email: screen.email })} onVerified={email => setScreen({ name: 'signin', email, notice: t('auth.verify.done') })} />;
    case 'forgot':
      return <ForgotPassword initialEmail={screen.email} onBack={() => setScreen({ name: 'signin', email: screen.email })} onDone={email => setScreen({ name: 'signin', email, notice: t('auth.forgot.done') })} />;
    default:
      return <SignIn initialEmail={screen.email} notice={screen.notice} onRegister={() => setScreen({ name: 'register' })} onForgot={email => setScreen({ name: 'forgot', email })} onUnconfirmed={email => setScreen({ name: 'verify', email })} />;
  }
}

/** Signed in: the session flow (profile, Kehila choice) and, once a Kehila is open, its screens. */
function SessionFlow({ link }: { link: ReturnType<typeof useIncomingLink> }) {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const { route, retry, state, acceptInvite, dismissJoinError } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  const [switcher, setSwitcher] = React.useState(false);
  const [typed, setTyped] = React.useState<string | null>(null);
  const code = link.code ?? typed;
  // A link that opens before the profile exists waits as a pending invite (accepted right after ProfileSetup).
  React.useEffect(() => {
    if (link.code && route === 'setup') { void pendingInvite.set(link.code).then(() => link.clear()); }
  }, [link, route]);
  if (route === 'loading') {
    return <Screen scroll={false}><View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={k.tekhelet} /></View></Screen>;
  }
  if (route === 'error') {
    return (
      <AuthFrame title={t('auth.offline.title')}>
        <Txt>{t('session.loadError')}</Txt>
        <Button title={t('common.retry')} onPress={retry} />
      </AuthFrame>
    );
  }
  if (route === 'setup') return <ProfileSetup />;
  if (code) {
    return <Join code={code} onAccept={() => acceptInvite(code).then(() => { setTyped(null); link.clear(); })} onClose={() => { setTyped(null); link.clear(); }} />;
  }
  if (route === 'none') return <NoKehila onCode={setTyped} error={state.joinError ? errText({ code: state.joinError }) : null} onDismissError={dismissJoinError} />;
  const banner = state.joinError ? <Banner tone="error" text={errText({ code: state.joinError })} action={{ title: t('common.close'), onPress: dismissJoinError }} /> : null;
  const sheet = <KehilaSwitcher visible={switcher || route === 'switcher'} onClose={() => { if (state.kehilaId) setSwitcher(false); }} />;
  if (route === 'ready' && state.kehila && state.kehila.role !== 'listener') {
    return <><Main onOpenSwitcher={() => setSwitcher(true)} banner={banner} />{sheet}</>;
  }
  return (
    <Screen>
      <TopBar onOpenSwitcher={() => setSwitcher(true)} />
      {banner}
      {route === 'ready' && state.kehila?.role === 'listener' ? <GuestHome /> : null}
      <Button kind="secondary" title={t('auth.profile.signOut')} onPress={() => void signOut()} />
      {sheet}
    </Screen>
  );
}

function Offline() {
  const { t } = useI18n();
  const { retry } = useAuth();
  return (
    <AuthFrame title={t('auth.offline.title')}>
      <Txt>{t('auth.offline.body')}</Txt>
      <Button title={t('common.retry')} onPress={() => void retry()} />
    </AuthFrame>
  );
}

function Shell() {
  const { status } = useAuth();
  const k = useTokens();
  const link = useIncomingLink();
  const [after, setAfter] = React.useState<'register' | 'signin' | null>(null);
  if (status === 'loading') {
    return <Screen scroll={false}><View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={k.tekhelet} /></View></Screen>;
  }
  if (status === 'offline') return <Offline />;
  if (status === 'signedIn') return <SessionProvider><SessionFlow link={link} /></SessionProvider>;
  if (link.code && !after) {
    return <Join code={link.code} onRegister={() => { void rememberOnIntent(pendingInvite, link.code!, 'register').then(a => { setAfter(a); link.clear(); }); }} onSignIn={() => { void rememberOnIntent(pendingInvite, link.code!, 'signin').then(a => { setAfter(a); link.clear(); }); }} onClose={() => { link.clear(); }} />;
  }
  return <SignedOutFlow start={after ?? undefined} />;
}

export function CloudApp() {
  const fontsReady = useAppFonts();
  const initialLang = config.fixtures ? fixtureParams().lang ?? undefined : undefined;
  if (!fontsReady) return null;
  return (
    <SafeAreaProvider>
      <I18nProvider initialLang={initialLang}>
        <AuthProvider>
          <StatusBar style="auto" />
          <Shell />
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
