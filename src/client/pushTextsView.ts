import type { Lang, PushTexts } from './types.ts';

export const PUSH_TEXT_MAX = 80;
export const PUSH_LANGS: Lang[] = ['he', 'en'];
const UNSAFE = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** Same rule as the server: no control or bidi characters, at most 80 code points after the trim (empty means "use the default"). */
export function pushTextError(text: string): 'multiline' | 'tooLong' | null {
  if (UNSAFE.test(text)) return 'multiline'; // control or bidi character, checked before the trim like the server
  return [...text.trim()].length > PUSH_TEXT_MAX ? 'tooLong' : null;
}

/** The saved custom text of a key and language, or ''. */
export function savedText(data: PushTexts, key: string, lang: Lang): string {
  return data.custom[key]?.[lang] ?? '';
}

/** Keys in the order the server lists them in the defaults. */
export function pushKeys(data: PushTexts): string[] {
  return Object.keys(data.defaults);
}
