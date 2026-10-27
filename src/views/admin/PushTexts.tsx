import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { keyedFlight } from '../../client/singleFlight.ts';
import { PUSH_LANGS, PUSH_TEXT_MAX, pushKeys, pushTextError, savedText } from '../../client/pushTextsView.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Lang, PushTexts as PushTextsData } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, Txt, useTokens } from '../../kit/components.tsx';
import { BackLink } from '../Me.tsx';
import { useAdminErrText } from './shared.tsx';

/** Gabbai: the text of each notification, per language. The default is the placeholder; empty restores it. */
export function PushTexts({ onBack, onToast }: { onBack: () => void; onToast: (text: string) => void }) {
  const { t, lang: uiLang } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [data, setData] = React.useState<PushTextsData | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const flight = React.useRef(keyedFlight()).current;

  React.useEffect(() => {
    let alive = true;
    api.pushTexts(kehilaId).then(d => { if (alive) setData(d); }, e => { if (alive) setLoadError(errText(e)); });
    return () => { alive = false; };
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const id = (key: string, lang: Lang) => `${key}:${lang}`;
  const value = (d: PushTextsData, key: string, lang: Lang) => drafts[id(key, lang)] ?? savedText(d, key, lang);

  function save(d: PushTextsData, key: string, lang: Lang) {
    const rowId = id(key, lang);
    const text = value(d, key, lang).trim();
    if (pushTextError(text)) return;
    void flight(rowId, async () => {
      setBusy(b => ({ ...b, [rowId]: true })); setErrors(e => ({ ...e, [rowId]: '' }));
      try {
        await api.putPushText(kehilaId, key, lang, text);
        setData(prev => {
          if (!prev) return prev;
          const langs = { ...prev.custom[key] };
          if (text) langs[lang] = text; else delete langs[lang];
          return { ...prev, custom: { ...prev.custom, [key]: langs } };
        });
        setDrafts(x => { const { [rowId]: _gone, ...rest } = x; return rest; });
        onToast(t('admin.pushTexts.saved'));
      } catch (e) { setErrors(x => ({ ...x, [rowId]: errText(e) })); }
      finally { setBusy(b => ({ ...b, [rowId]: false })); }
    });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{t('admin.pushTexts.title')}</Txt>
      <Banner tone="info" text={t('admin.pushTexts.warning')} />
      <Txt size="small" color={k.muted}>{t('admin.pushTexts.intro')}</Txt>
      {loadError ? <Banner tone="error" text={loadError} /> : null}
      {!data && !loadError ? <ActivityIndicator color={k.tekhelet} /> : null}
      {data ? pushKeys(data).map(key => (
        <Card key={key}>
          <Txt bold accessibilityRole="header">{t(`admin.pushTexts.key.${key}`)}</Txt>
          {((uiLang === 'he' ? ['he', 'en'] : ['en', 'he']) as Lang[]).map(lang => {
            const rowId = id(key, lang);
            const text = value(data, key, lang);
            const problem = pushTextError(text);
            const dirty = text.trim() !== savedText(data, key, lang);
            return (
              <View key={lang} style={{ gap: 8 }}>
                <Field label={t(`admin.pushTexts.lang.${lang}`)} value={text} placeholder={data.defaults[key]?.[lang]}
                  onChangeText={v => setDrafts(x => ({ ...x, [rowId]: v }))} maxCodePoints={PUSH_TEXT_MAX}
                  editable={!busy[rowId]} error={problem ? t('errors.invalid_text') : null} />
                {errors[rowId] ? <Banner tone="error" text={errors[rowId]!} /> : null}
                <Button kind="secondary" title={text.trim() === '' && savedText(data, key, lang) ? t('admin.pushTexts.reset') : t('admin.pushTexts.save')}
                  onPress={() => save(data, key, lang)} busy={!!busy[rowId]} disabled={!dirty || !!problem} />
              </View>
            );
          })}
        </Card>
      )) : null}
    </ScrollView>
  );
}

