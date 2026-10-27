import React from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useSession } from '../client/SessionProvider.tsx';
import { config } from '../config.ts';
import { textStart } from '../i18n/direction.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { useErrorText } from './auth/Frame.tsx';

/** P8 (terms part): stands in for every management screen of the Kehila until one gabbai accepts the terms. */
export function TermsGate({ onToast }: { onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state, refreshKehila } = useSession();
  const errText = useErrorText();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const kehila = state.kehila;
  if (!kehila) return null;
  // A version bump: someone accepted an older version, so the title says the terms changed.
  const updated = !!kehila.termsAccepted;
  async function accept() {
    if (busy || !kehila) return;
    setBusy(true); setError(null);
    try { await api.acceptTerms(kehila.kehilaId); onToast(t('terms.accepted')); await refreshKehila(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const bullet = (text: string) => (
    <View key={text} style={{ flexDirection: 'row', gap: 8 }}>
      <Txt>•</Txt>
      <Txt style={{ flex: 1 }}>{text}</Txt>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <Txt serif size="heading" accessibilityRole="header">{updated ? t('terms.updatedTitle') : t('terms.title')}</Txt>
      <Card edgeColor={k.gold}>
        <Txt>{t('terms.intro', { kehila: kehila.name })}</Txt>
        {[t('terms.p1'), t('terms.p2'), t('terms.p3'), t('terms.p4')].map(bullet)}
        <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(`${config.webUrl}/terms/`).catch(() => {}); }} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
          <Txt size="small" bold color={k.tekhelet} style={{ textDecorationLine: 'underline', textAlign: textStart(lang) }}>{t('terms.read')} ↗</Txt>
        </Pressable>
        {error ? <Banner tone="error" text={error} /> : null}
        <Button title={t('terms.accept')} onPress={() => void accept()} busy={busy} />
        <Txt size="small" color={k.muted}>{t('terms.others')}</Txt>
      </Card>
    </ScrollView>
  );
}
