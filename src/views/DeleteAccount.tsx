import React from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { deleteAccount } from '../client/account.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, Txt } from '../kit/components.tsx';
import { BackLink } from './Me.tsx';
import { useErrorText } from './auth/Frame.tsx';

const ITEMS = ['i1', 'i2', 'i3', 'i4'] as const;

/** Confirm screen for account deletion (spec §4.5b): lists what is deleted; the word must be typed. */
export function DeleteAccount({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const { api, signOut } = useAuth();
  const errText = useErrorText();
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: 'error'; text: string } | null>(null);
  const word = t('deleteAccount.word');
  const ok = typed.trim().toLowerCase() === word.toLowerCase();

  async function run() {
    if (!ok || busy) return;
    setBusy(true); setMessage(null);
    try {
      // 'deleted' ends in the full sign-out (tokens, pending invite, caches, store); this screen unmounts with it.
      const r = await deleteAccount(api, signOut);
      if (r === 'last_gabbai') { setMessage({ tone: 'error', text: t('deleteAccount.lastGabbai') }); setBusy(false); }
    } catch (e) {
      setMessage({ tone: 'error', text: `${t('deleteAccount.failed')} (${errText(e)})` });
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{t('deleteAccount.title')}</Txt>
      <Card>
        <Txt>{t('deleteAccount.intro')}</Txt>
        {ITEMS.map(i => (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            <Txt>•</Txt>
            <Txt style={{ flex: 1 }}>{t(`deleteAccount.deleted.${i}`)}</Txt>
          </View>
        ))}
        <Txt size="small" bold>{t('deleteAccount.kept')}</Txt>
      </Card>
      <Card>
        <Field label={t('deleteAccount.typePrompt', { word })} value={typed} onChangeText={setTyped} editable={!busy}
          autoCapitalize="none" autoCorrect={false} accessibilityHint={t('deleteAccount.field')} />
        {message ? <Banner tone={message.tone} text={message.text} /> : null}
        {busy ? <Txt size="small">{t('deleteAccount.working')}</Txt> : null}
        <Button kind="danger" title={t('deleteAccount.confirm')} onPress={() => void run()} busy={busy} disabled={!ok} />
        <Button kind="secondary" title={t('deleteAccount.cancel')} onPress={onBack} disabled={busy} />
      </Card>
    </ScrollView>
  );
}
