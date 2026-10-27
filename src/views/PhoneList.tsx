import React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { formatPhone, telUrl, whatsappUrl } from '../client/phone.ts';
import { filterFamilies, sortFamilies } from '../client/phoneListView.ts';
import { useSession } from '../client/SessionProvider.tsx';
import type { PhoneListFamily } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { textStart } from '../i18n/direction.ts';
import { Banner, Button, Card, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH, fonts, type } from '../kit/theme.ts';
import { TagChips } from './TagChips.tsx';
import { BackLink } from './Me.tsx';
import { useErrorText } from './auth/Frame.tsx';

/**
 * P1: the phone list of the open Kehila. Fetched when the screen opens and kept only in this component's state:
 * never in the store, the message cache or AsyncStorage, and gone when the screen closes. No copy-all, share
 * or export. Numbers are never logged.
 */
export function PhoneList({ onBack, onMine }: { onBack: () => void; /** Opens Me (my settings). */ onMine: () => void }) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state, setShowPhone } = useSession();
  const errText = useErrorText();
  const kehila = state.kehila;
  const kehilaId = state.kehilaId;
  const [rows, setRows] = React.useState<PhoneListFamily[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [revision, setRevision] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [mineError, setMineError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!kehilaId) return;
    let live = true;
    setRows(null); setFailed(false);
    api.phoneList(kehilaId).then(r => { if (live) setRows(sortFamilies(r)); }, () => { if (live) setFailed(true); });
    return () => { live = false; setRows(null); };
  }, [api, kehilaId, revision]);

  if (!kehila) return null;
  const name = kehila.name;
  const hasNumber = !!state.me?.profile?.phone;
  const shown = rows ? filterFamilies(rows, q) : [];

  async function showMine() {
    if (!hasNumber) { onMine(); return; }
    setBusy(true); setMineError(null);
    try { await setShowPhone(true); setRevision(n => n + 1); } catch (e) { setMineError(errText(e)); } finally { setBusy(false); }
  }
  const open = (url: string) => { void Linking.openURL(url).catch(() => {}); };

  const search = (
    <TextInput accessibilityLabel={t('phoneList.search')} placeholder={t('phoneList.search')} placeholderTextColor={k.muted} value={q} onChangeText={setQ}
      style={{ minHeight: TOUCH, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) }} />
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{t('phoneList.title')}</Txt>
      {rows && rows.length > 0 && !q.trim() ? <Txt size="small" color={k.muted}>{t('phoneList.intro', { kehila: name })}</Txt> : null}

      {failed ? (
        <Banner tone="error" text={t('phoneList.loadError')} action={{ title: t('common.retry'), onPress: () => setRevision(n => n + 1) }} />
      ) : rows === null ? (
        <View style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator accessibilityLabel={t('common.loading')} color={k.tekhelet} /></View>
      ) : (
        <>
          {search}
          {rows.length === 0 ? (
            <Card>
              <Txt>{t('phoneList.empty')}</Txt>
              {!kehila.showPhone ? (
                <>
                  <Txt size="small" color={k.muted}>{t('phoneList.emptyJoin')}</Txt>
                  {mineError ? <Banner tone="error" text={mineError} /> : null}
                  <Button title={t('phoneList.showMine')} onPress={() => void showMine()} busy={busy} />
                </>
              ) : null}
            </Card>
          ) : shown.length === 0 ? (
            <Card>
              <Txt>{t('phoneList.noResults', { q: q.trim() })}</Txt>
              <Txt size="small" color={k.muted}>{t('phoneList.noResultsHint')}</Txt>
            </Card>
          ) : (
            <>
              <Txt size="small" color={k.muted}>{t('phoneList.count', { n: shown.length })}</Txt>
              {shown.map(f => (
                <Card key={f.familyId} style={{ gap: 4 }}>
                  <Txt serif content size="heading" accessibilityRole="header">{f.name}</Txt>
                  {f.people.map(p => (
                    <View key={p.userId} style={{ borderTopWidth: 1, borderTopColor: k.line, paddingTop: 8, marginTop: 4, gap: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                        <View style={{ flexShrink: 1, gap: 4 }}>
                          <Txt bold content>{p.name}</Txt>
                          <TagChips tags={p.tags} />
                        </View>
                        <Txt color={k.muted} style={{ writingDirection: 'ltr', textAlign: 'left', fontVariant: ['tabular-nums'] }}>{formatPhone(p.phone)}</Txt>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}><Button kind="secondary" icon="phone" title={t('phoneList.call')} accessibilityLabel={t('phoneList.callA11y', { name: p.name })} onPress={() => open(telUrl(p.phone))} /></View>
                        <View style={{ flex: 1 }}><Button kind="secondary" title={t('phoneList.whatsapp')} accessibilityLabel={t('phoneList.whatsappA11y', { name: p.name })} onPress={() => open(whatsappUrl(p.phone))} /></View>
                      </View>
                    </View>
                  ))}
                </Card>
              ))}
              <Txt size="small" color={k.muted}>{t('phoneList.privacyNote')}</Txt>
              <Pressable accessibilityRole="link" onPress={onMine} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
                <Txt size="small" bold color={k.tekhelet}>{t('phoneList.mySetting')}</Txt>
              </Pressable>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
