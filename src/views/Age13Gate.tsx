import React from 'react';
import { Linking, Pressable } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useSession } from '../client/SessionProvider.tsx';
import { config } from '../config.ts';
import { textStart } from '../i18n/direction.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Check, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { DeleteAccount } from './DeleteAccount.tsx';
import { AuthFrame, useErrorText } from './auth/Frame.tsx';

/** P8 (age part): replaces the whole app until the account confirms it is 13 or older. */
export function Age13Gate() {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { signOut } = useAuth();
  const { acceptAge13 } = useSession();
  const errText = useErrorText();
  const [ticked, setTicked] = React.useState(false);
  const [under, setUnder] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit() {
    if (!ticked || busy) return;
    setBusy(true); setError(null);
    try { await acceptAge13(); } catch (e) { setError(errText(e)); setBusy(false); }
  }
  if (deleting) return <DeleteAccount onBack={() => setDeleting(false)} />;
  const link = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="link" onPress={onPress} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
      <Txt size="small" bold color={k.tekhelet} style={{ textDecorationLine: 'underline', textAlign: textStart(lang) }}>{label}</Txt>
    </Pressable>
  );
  return (
    <AuthFrame title={t('age13.title')} error={error}>
      {under ? (
        <>
          <Banner text={t('age13.underBody')} />
          <Button kind="danger" title={t('me.deleteAction')} onPress={() => setDeleting(true)} />
          <Button kind="secondary" title={t('auth.profile.signOut')} onPress={() => void signOut()} />
        </>
      ) : (
        <>
          <Txt>{t('age13.body')}</Txt>
          <Card>
            <Check label={t('age13.check')} value={ticked} onChange={setTicked} disabled={busy} />
            <Button title={t('age13.continue')} onPress={() => void submit()} busy={busy} disabled={!ticked} />
          </Card>
          {link(t('age13.under'), () => setUnder(true))}
          {link(`${t('common.policyLink')} ↗`, () => { void Linking.openURL(`${config.webUrl}/privacy/`).catch(() => {}); })}
        </>
      )}
    </AuthFrame>
  );
}
