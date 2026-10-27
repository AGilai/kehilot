import type { Lang, PushTexts } from './types.ts';

export const PUSH_TEXT_MAX = 80;
export const PUSH_LANGS: Lang[] = ['he', 'en'];
const NEWLINE = /[\n\r\v\f\u0085\u2028\u2029]/;

/** Same rule as the server: one line, at most 80 code points (empty means "use the default"). */
export function pushTextError(text: string): 'multiline' | 'tooLong' | null {
  if (NEWLINE.test(text)) return 'multiline';
  return [...text].length > PUSH_TEXT_MAX ? 'tooLong' : null;
}

/** The saved custom text of a key and language, or ''. */
export function savedText(data: PushTexts, key: string, lang: Lang): string {
  return data.custom[key]?.[lang] ?? '';
}

/** Keys in the order the server lists them in the defaults. */
export function pushKeys(data: PushTexts): string[] {
  return Object.keys(data.defaults);
}
