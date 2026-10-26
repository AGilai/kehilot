import React from 'react';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { normEmail } from '../../auth/validate.ts';
import { Button, Card, Field, Txt } from '../../kit/components.tsx';
import { AuthFrame, useErrorText } from './Frame.tsx';

export function Verify({ email, onVerified, onBack }: { email: string; onVerified: (email: string) => void; onBack: () => void }) {
  const { t } = useI18n();
  const { confirm, resend } = useAuth();
  const errText = useErrorText();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  async function submit() {
    if (!code.trim() || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await confirm(email, code); onVerified(normEmail(email)); } catch (e) { setError(errText(e)); setBusy(false); }
  }
  async function again() {
    setBusy(true); setError(null); setNotice(null);
    try { await resend(email); setNotice(t('auth.verify.resent')); } catch (e) { setError(errText(e)); }
    setBusy(false);
  }
  return (
    <AuthFrame title={t('auth.verify.title')} error={error} notice={notice}>
      <Txt>{t('auth.verify.body', { email: normEmail(email) })}</Txt>
      <Card>
        <Field label={t('auth.codeLabel')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoCapitalize="none" autoCorrect={false} editable={!busy} onSubmitEditing={() => void submit()} />
        <Button title={t('auth.verify.submit')} onPress={() => void submit()} busy={busy} disabled={!code.trim()} />
      </Card>
      <Button kind="secondary" title={t('auth.verify.resend')} onPress={() => void again()} disabled={busy} />
      <Button kind="secondary" title={t('auth.back')} onPress={onBack} disabled={busy} />
    </AuthFrame>
  );
}
