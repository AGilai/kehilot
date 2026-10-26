import React from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { looksLikeEmail } from '../../auth/validate.ts';
import { Button, Card, Field } from '../../kit/components.tsx';
import { AuthFrame, useErrorText } from './Frame.tsx';

export function SignIn({ initialEmail = '', notice, onRegister, onForgot, onUnconfirmed }: {
  initialEmail?: string; notice?: string | null;
  onRegister: () => void; onForgot: (email: string) => void; onUnconfirmed: (email: string) => void;
}) {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const errText = useErrorText();
  const [email, setEmail] = React.useState(initialEmail);
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = looksLikeEmail(email) && password.length > 0;
  async function submit() {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      if ((e as { code?: string })?.code === 'UserNotConfirmedException') { onUnconfirmed(email); return; }
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <AuthFrame title={t('auth.signin.title')} error={error} notice={notice}>
      <Card>
        <Field label={t('auth.emailLabel')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" editable={!busy} />
        <Field label={t('auth.passwordLabel')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" editable={!busy} onSubmitEditing={() => void submit()} />
        <Button title={t('auth.signin.submit')} onPress={() => void submit()} busy={busy} disabled={!ready} />
      </Card>
      <Button kind="secondary" title={t('auth.signin.forgot')} onPress={() => onForgot(email)} disabled={busy} />
      <Button kind="secondary" title={t('auth.signin.register')} onPress={onRegister} disabled={busy} />
    </AuthFrame>
  );
}
