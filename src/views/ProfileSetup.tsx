import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { NAME_MAX } from '../auth/validate.ts';
import { config } from '../config.ts';
import { textStart } from '../i18n/direction.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Button, Card, Check, Chip, Field, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { AuthFrame, useErrorText } from './auth/Frame.tsx';

/** First sign-in: names (prefilled from sign-up) and the app language, then putProfile. */
export function ProfileSetup() {
  const { t, lang, setLang } = useI18n();
  const { pendingNames } = useAuth();
  const { saveProfile } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  const [age13, setAge13] = React.useState(false);
  const [first, setFirst] = React.useState(pendingNames?.first ?? '');
  const [last, setLast] = React.useState(pendingNames?.last ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = !!first.trim() && [...first].length <= NAME_MAX && [...last].length <= NAME_MAX && age13;
  async function submit() {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try { await saveProfile({ firstName: first.trim(), lastName: last.trim(), lang }, { age13: true }); } catch (e) { setError(errText(e)); setBusy(false); }
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
        <Check label={t('profileSetup.age13')} note={t('profileSetup.age13Note')} value={age13} onChange={setAge13} disabled={busy} />
        <Button title={t('profileSetup.submit')} onPress={() => void submit()} busy={busy} disabled={!ready} />
        <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(`${config.webUrl}/privacy/`).catch(() => {}); }} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
          <Txt size="small" bold color={k.tekhelet} style={{ textDecorationLine: 'underline', textAlign: textStart(lang) }}>{t('profileSetup.privacy')} ↗</Txt>
        </Pressable>
      </Card>
    </AuthFrame>
  );
}
