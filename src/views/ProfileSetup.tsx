import React from 'react';
import { View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { NAME_MAX } from '../auth/validate.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Button, Card, Chip, Field, Txt } from '../kit/components.tsx';
import { AuthFrame, useErrorText } from './auth/Frame.tsx';

/** First sign-in: names (prefilled from sign-up) and the app language, then putProfile. */
export function ProfileSetup() {
  const { t, lang, setLang } = useI18n();
  const { pendingNames } = useAuth();
  const { saveProfile } = useSession();
  const errText = useErrorText();
  const [first, setFirst] = React.useState(pendingNames?.first ?? '');
  const [last, setLast] = React.useState(pendingNames?.last ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = !!first.trim() && [...first].length <= NAME_MAX && [...last].length <= NAME_MAX;
  async function submit() {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try { await saveProfile({ firstName: first.trim(), lastName: last.trim(), lang }); } catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <AuthFrame title={t('profileSetup.title')} error={error}>
      <Txt>{t('profileSetup.body')}</Txt>
      <Card>
        <Field label={t('auth.firstNameLabel')} value={first} onChangeText={setFirst} maxCodePoints={NAME_MAX} autoComplete="given-name" textContentType="givenName" editable={!busy} />
        <Field label={t('auth.lastNameLabel')} value={last} onChangeText={setLast} maxCodePoints={NAME_MAX} autoComplete="family-name" textContentType="familyName" editable={!busy} />
        <Txt size="small" bold>{t('profileSetup.langLabel')}</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label={t('lang.he')} selected={lang === 'he'} onPress={() => setLang('he')} />
          <Chip label={t('lang.en')} selected={lang === 'en'} onPress={() => setLang('en')} />
        </View>
        <Button title={t('profileSetup.submit')} onPress={() => void submit()} busy={busy} disabled={!ready} />
      </Card>
    </AuthFrame>
  );
}
