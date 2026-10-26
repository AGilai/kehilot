import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './auth/AuthProvider.tsx';
import { config } from './config.ts';
import { fixtureParams } from './client/fixtures.ts';
import { I18nProvider, useI18n } from './i18n/I18nProvider.tsx';
import { Button, Screen, Txt, useAppFonts, useTokens } from './kit/components.tsx';
import { ForgotPassword } from './views/auth/ForgotPassword.tsx';
import { AuthFrame } from './views/auth/Frame.tsx';
import { Register } from './views/auth/Register.tsx';
import { SignIn } from './views/auth/SignIn.tsx';
import { Verify } from './views/auth/Verify.tsx';

type AuthScreen =
  | { name: 'signin'; email?: string; notice?: string }
  | { name: 'register' }
  | { name: 'verify'; email: string }
  | { name: 'forgot'; email?: string };

function initialScreen(): AuthScreen {
  const s = config.fixtures ? fixtureParams().screen : null;
  if (s === 'register') return { name: 'register' };
  if (s === 'verify') return { name: 'verify', email: 'dana@example.invalid' };
  if (s === 'forgot') return { name: 'forgot' };
  return { name: 'signin' };
}

function SignedOutFlow() {
  const { t } = useI18n();
  const [screen, setScreen] = React.useState<AuthScreen>(initialScreen);
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

/** Placeholder until Task 9 (profile and session store). */
function ProfilePlaceholder() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  return (
    <AuthFrame title={t('auth.profile.title')}>
      <Txt>{t('auth.profile.body')}</Txt>
      <Button kind="secondary" title={t('auth.profile.signOut')} onPress={() => void signOut()} />
    </AuthFrame>
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
  if (status === 'loading') {
    return <Screen scroll={false}><View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={k.tekhelet} /></View></Screen>;
  }
  if (status === 'offline') return <Offline />;
  return status === 'signedIn' ? <ProfilePlaceholder /> : <SignedOutFlow />;
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
