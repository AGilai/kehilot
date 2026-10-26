import type { Lang } from './translate.ts';

export function deviceLang(locales: string[]): Lang {
  const first = (locales[0] ?? '').toLowerCase();
  return first === 'he' || first.startsWith('he-') || first === 'iw' || first.startsWith('iw-') ? 'he' : 'en';
}
export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'he' ? 'rtl' : 'ltr');
export const textStart = (lang: Lang): 'right' | 'left' => (lang === 'he' ? 'right' : 'left');
