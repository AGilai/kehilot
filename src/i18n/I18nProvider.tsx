import React from 'react';
import { Platform, View } from 'react-native';
import { getLocales } from 'expo-localization';
import en from './en.json';
import he from './he.json';
import { deviceLang, dirOf } from './direction.ts';
import { translate } from './translate.ts';
import type { Lang } from './translate.ts';

type Ctx = { lang: Lang; dir: 'rtl' | 'ltr'; t: (key: string, params?: Record<string, string | number>) => string; setLang: (l: Lang) => void };
const dicts = { he, en } as const;
const I18nContext = React.createContext<Ctx | null>(null);

export function I18nProvider({ initialLang, children }: { initialLang?: Lang; children: React.ReactNode }) {
  const [lang, setLang] = React.useState<Lang>(() => initialLang ?? deviceLang(getLocales().map(l => l.languageTag)));
  const dir = dirOf(lang);
  React.useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.dir = dir;
      document.documentElement.lang = lang;
    }
  }, [lang, dir]);
  const value = React.useMemo<Ctx>(
    () => ({ lang, dir, setLang, t: (key, params) => translate(dicts[lang], he, key, params) }),
    [lang, dir],
  );
  // `direction` on the root view flips layout at runtime; I18nManager.forceRTL would need a restart.
  return (
    <I18nContext.Provider value={value}>
      <View style={Platform.OS === 'web' ? { flex: 1 } : { flex: 1, direction: dir }}>{children}</View>
    </I18nContext.Provider>
  );
}

export function useI18n(): Ctx {
  const c = React.useContext(I18nContext);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
}
