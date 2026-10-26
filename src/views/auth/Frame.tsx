import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import en from '../../i18n/en.json';
import he from '../../i18n/he.json';
import { errorKey } from '../../client/errors.ts';
import { Banner, Screen, Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH } from '../../kit/theme.ts';

/** Turns a thrown error (AuthError / ApiCodeError, both carry `code`) into text in the current language. */
export function useErrorText(): (e: unknown) => string {
  const { lang, t } = useI18n();
  return (e) => {
    const code = (e as { code?: unknown } | null)?.code;
    return t(errorKey(typeof code === 'string' ? code : '', (lang === 'he' ? he : en).errors));
  };
}

export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  const k = useTokens();
  const other = lang === 'he' ? 'en' : 'he';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('auth.switchLang')} onPress={() => setLang(other)}
      style={{ minHeight: TOUCH, minWidth: TOUCH, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: k.line }}>
      <Txt size="small" bold color={k.tekhelet}>{t(`lang.${other}`)}</Txt>
    </Pressable>
  );
}

/** Header (title + language toggle) and the form column shared by the auth screens. */
export function AuthFrame({ title, children, error, notice }: { title: string; children: React.ReactNode; error?: string | null; notice?: string | null }) {
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Txt serif size="display" accessibilityRole="header" style={{ flex: 1 }}>{title}</Txt>
        <LangToggle />
      </View>
      {notice ? <Banner tone="success" text={notice} /> : null}
      {error ? <Banner tone="error" text={error} /> : null}
      {children}
    </Screen>
  );
}
