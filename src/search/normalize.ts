/**
 * Hebrew-aware text normalisation for the on-phone search (spec §3c). Both the cached text and the query
 * go through it, so niqqud, final letters, quotes and case never decide whether something is found.
 */

const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

type Kind = 'drop' | 'space' | 'keep';

function kindOf(cp: number, ch: string): Kind {
  if (cp >= 0x591 && cp <= 0x5C7) {
    return cp === 0x5BE || cp === 0x5C0 || cp === 0x5C3 || cp === 0x5C6 ? 'space' : 'drop'; // maqaf, paseq, sof pasuq, nun hafukha
  }
  if (cp === 0x5F3 || cp === 0x5F4 || ch === "'" || ch === '"') return 'drop';
  if ((cp >= 0x200B && cp <= 0x200F) || (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069)) return 'drop';
  return LETTER_OR_DIGIT.test(ch) ? 'keep' : 'space';
}

/** `map[i]` is the UTF-16 index in `s` of normalised character `i`. */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = -1; // index of the first character of a pending run of spaces
  let i = 0;
  for (const ch of s) {
    const at = i;
    i += ch.length;
    const kind = kindOf(ch.codePointAt(0)!, ch);
    if (kind === 'drop') continue;
    if (kind === 'space') { if (out.length > 0 && pendingSpace < 0) pendingSpace = at; continue; }
    if (pendingSpace >= 0) { out.push(' '); map.push(pendingSpace); pendingSpace = -1; }
    const folded = FINALS[ch] ?? ch.toLowerCase();
    for (const unit of folded) { out.push(unit); map.push(at); }
  }
  return { text: out.join(''), map };
}

export const normalize = (s: string): string => normalizeWithMap(s).text;

/** The words of a query, normalised. Empty for a blank query. */
export function queryWords(q: string): string[] {
  return normalize(q).split(' ').filter(Boolean);
}

/**
 * About `width` characters of the original text around the first place a query word matches, with … at a
 * cut end. Line breaks become spaces. Without a match: the start of the text.
 */
export function snippet(original: string, words: string[], width = 80): string {
  const { text, map } = normalizeWithMap(original);
  let hit = -1;
  for (const w of words) {
    const at = text.indexOf(w);
    if (at >= 0 && (hit < 0 || at < hit)) hit = at;
  }
  const pos = hit >= 0 ? map[hit]! : 0;
  let start = Math.max(0, pos - Math.floor(width / 4));
  let end = Math.min(original.length, start + width);
  if (start > 0 && isLow(original.charCodeAt(start))) start--;
  if (end < original.length && isLow(original.charCodeAt(end))) end++;
  const cut = original.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${cut}${end < original.length ? '…' : ''}`;
}
const isLow = (c: number) => c >= 0xDC00 && c <= 0xDFFF;

/** What a message is searched by: title, body, author and target names, normalised. */
export const searchNorm = (m: { title: string; body: string; authorName: string; targetName?: string }): string =>
  normalize([m.title, m.body, m.authorName, m.targetName].filter(Boolean).join(' '));

/** Every query word occurs in the normalised text. */
export const matchesWords = (norm: string, words: string[]): boolean => words.every(w => norm.includes(w));
