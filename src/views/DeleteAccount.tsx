import React from 'react';
import { ScrollView, View } from 'react-native';
import { config } from '../config.ts';
import { fixtureParams } from '../client/fixtures.ts';
import { useAuth } from '../auth/AuthProvider.tsx';
import { deleteAccount } from '../client/account.ts';
import { singleFlight } from '../client/singleFlight.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Check, Field, Txt, useTokens } from '../kit/components.tsx';
import { BackLink } from './Me.tsx';
import { LinkRow } from './me/KehilaInfo.tsx';
import { useErrorText } from './auth/Frame.tsx';

const ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;

/** Confirm screen for account deletion (spec §4.5b): lists what is deleted; the word must be typed. */
export function DeleteAccount({ onBack, onExport }: { onBack: () => void; /** Opens Me's privacy card ("download my data"); absent on the age gate, which has no Me. */ onExport?: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const { api, signOut } = useAuth();
  const errText = useErrorText();
  const [typed, setTyped] = React.useState('');
  const [deletePosts, setDeletePosts] = React.useState(config.fixtures && fixtureParams().screen === 'delete-ticked'); // unticked by default (user decision)
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: 'error'; text: string } | null>(null);
  const word = t('deleteAccount.word');
  const ok = typed.trim().toLowerCase() === word.toLowerCase();

  const runRef = React.useRef<() => Promise<void>>(async () => {});
  runRef.current = async () => {
    if (!ok) return;
    setBusy(true); setMessage(null);
    try {
      // 'deleted' ends in the full sign-out (tokens, pending invite, caches, store); this screen unmounts with it.
      const r = await deleteAccount(api, signOut, undefined, { deletePosts });
      if (r === 'last_gabbai') { setMessage({ tone: 'error', text: t('deleteAccount.lastGabbai') }); setBusy(false); }
    } catch (e) {
      setMessage({ tone: 'error', text: `${t('deleteAccount.failed')} (${errText(e)})` });
      setBusy(false);
    }
  };
  // The guard is a synchronous flag: a second tap in the same tick is ignored.
  const run = React.useRef(singleFlight(() => runRef.current())).current;

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
      </Card>
      <Card>
        <Check label={t('deleteAccount.posts')} value={deletePosts} onChange={setDeletePosts} disabled={busy} />
        <Txt size="small" color={deletePosts ? k.ink : k.muted}>{t(deletePosts ? 'deleteAccount.postsOn' : 'deleteAccount.postsOff')}</Txt>
        <Txt size="small" color={k.muted}>{t('deleteAccount.always')}</Txt>
        <Txt size="small" color={k.muted}>{t('deleteAccount.backups')}</Txt>
      </Card>
      {onExport ? <LinkRow label={t('deleteAccount.exportFirst')} onPress={onExport} /> : null}
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
