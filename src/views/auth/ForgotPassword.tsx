import React from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { looksLikeEmail, normEmail, passwordOk } from '../../auth/validate.ts';
import { Button, Card, Field, Txt } from '../../kit/components.tsx';
import { AuthFrame, useErrorText } from './Frame.tsx';

export function ForgotPassword({ initialEmail = '', onDone, onBack }: { initialEmail?: string; onDone: (email: string) => void; onBack: () => void }) {
  const { t } = useI18n();
  const { forgot, resetPassword } = useAuth();
  const errText = useErrorText();
  const [email, setEmail] = React.useState(initialEmail);
  const [sent, setSent] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function send() {
    if (!looksLikeEmail(email) || busy) return;
    setBusy(true); setError(null);
    try { await forgot(email); setSent(true); } catch (e) { setError(errText(e)); }
    setBusy(false);
  }
  async function submit() {
    if (!code.trim() || !passwordOk(password) || busy) return;
    setBusy(true); setError(null);
    try { await resetPassword(email, code, password); onDone(normEmail(email)); } catch (e) { setError(errText(e)); setBusy(false); }
  }
  const pwShort = password.length > 0 && !passwordOk(password);
  return (
    <AuthFrame title={t('auth.forgot.title')} error={error}>
      {sent ? (
        <>
          <Txt>{t('auth.forgot.codeBody', { email: normEmail(email) })}</Txt>
          <Card>
            <Field label={t('auth.codeLabel')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoCapitalize="none" autoCorrect={false} editable={!busy} />
            <Field label={t('auth.newPasswordLabel')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" editable={!busy}
              error={pwShort ? t('errors.password_short') : null} onSubmitEditing={() => void submit()} />
            <Button title={t('auth.forgot.submit')} onPress={() => void submit()} busy={busy} disabled={!code.trim() || !passwordOk(password)} />
          </Card>
        </>
      ) : (
        <Card>
          <Field label={t('auth.emailLabel')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" editable={!busy} onSubmitEditing={() => void send()} />
          <Button title={t('auth.forgot.send')} onPress={() => void send()} busy={busy} disabled={!looksLikeEmail(email)} />
        </Card>
      )}
      <Button kind="secondary" title={t('auth.back')} onPress={onBack} disabled={busy} />
    </AuthFrame>
  );
}
