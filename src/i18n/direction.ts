import type { Lang } from './translate.ts';

export function deviceLang(locales: string[]): Lang {
  const first = (locales[0] ?? '').toLowerCase();
  return first === 'he' || first.startsWith('he-') || first === 'iw' || first.startsWith('iw-') ? 'he' : 'en';
}
export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'he' ? 'rtl' : 'ltr');
export const textStart = (lang: Lang): 'right' | 'left' => (lang === 'he' ? 'right' : 'left');

/** Direction of user text: the first strong letter decides (Hebrew/Arabic rtl, Latin ltr), else the UI direction. */
export function contentDir(s: string, ui: 'rtl' | 'ltr'): 'rtl' | 'ltr' {
  const m = s.match(/[\u0590-\u05FF\u0600-\u06FFA-Za-z\u00C0-\u024F]/);
  if (!m) return ui;
  return /[\u0590-\u06FF]/.test(m[0]) ? 'rtl' : 'ltr';
}
