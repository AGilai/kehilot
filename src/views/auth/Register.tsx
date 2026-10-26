import React from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { NAME_MAX, looksLikeEmail, passwordOk } from '../../auth/validate.ts';
import { Banner, Button, Card, Field } from '../../kit/components.tsx';
import { AuthFrame, useErrorText } from './Frame.tsx';

export function Register({ onSignIn, onForgot, onRegistered }: {
  onSignIn: () => void; onForgot: (email: string) => void; onRegistered: (email: string) => void;
}) {
  const { t } = useI18n();
  const { register } = useAuth();
  const errText = useErrorText();
  const [first, setFirst] = React.useState('');
  const [last, setLast] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exists, setExists] = React.useState(false);
  const pwShort = password.length > 0 && !passwordOk(password);
  const ready = !!first.trim() && looksLikeEmail(email) && passwordOk(password) && [...first].length <= NAME_MAX && [...last].length <= NAME_MAX;
  async function submit() {
    if (!ready || busy) return;
    setBusy(true); setError(null); setExists(false);
    try {
      await register(email, password, first, last);
      onRegistered(email);
    } catch (e) {
      if ((e as { code?: string })?.code === 'UsernameExistsException') setExists(true);
      else setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <AuthFrame title={t('auth.register.title')} error={error}>
      {exists ? <Banner tone="error" text={t('errors.UsernameExistsException')} action={{ title: t('auth.exists.cta'), onPress: () => onForgot(email) }} /> : null}
      <Card>
        <Field label={t('auth.firstNameLabel')} value={first} onChangeText={setFirst} maxCodePoints={NAME_MAX} autoComplete="given-name" textContentType="givenName" editable={!busy} />
        <Field label={t('auth.lastNameLabel')} value={last} onChangeText={setLast} maxCodePoints={NAME_MAX} autoComplete="family-name" textContentType="familyName" editable={!busy} />
        <Field label={t('auth.emailLabel')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" editable={!busy} />
        <Field label={t('auth.passwordLabel')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" editable={!busy}
          error={pwShort ? t('errors.password_short') : null} onSubmitEditing={() => void submit()} />
        <Button title={t('auth.register.submit')} onPress={() => void submit()} busy={busy} disabled={!ready} />
      </Card>
      <Button kind="secondary" title={t('auth.register.haveAccount')} onPress={onSignIn} disabled={busy} />
    </AuthFrame>
  );
}
