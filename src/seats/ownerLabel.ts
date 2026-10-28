/**
 * The name shown on an allocated seat (pure): the household's surname; when another household in the Kehila has the same surname, the first
 * letter of the first name too ("כהן י."). Gabbai views only. Holders without an account are parsed like the paste matcher parses a pasted name
 * (match.ts): surname, then an optional single-letter initial.
 */
import { normalizeName } from './match.ts';

export type SeatOwner = { surname: string; first?: string };

const PREFIX = /^(משפחת|משפחה|משפ)\s+/;
const clean = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const key = (s: string): string => normalizeName(s).replace(PREFIX, '');
const initialOf = (first: string | undefined): string => {
  const f = clean(first).replace(/^[\s.'"׳״]+/, '');
  return f ? [...f][0]! : '';
};

/** A holder's name as one owner: "בדיוני ש." / "בדיוני ש" → surname + initial; "משפחת מדומה" → "מדומה"; "בית הלל" stays whole. */
export function holderOwner(name: string): SeatOwner {
  const t = clean(name).replace(PREFIX, '').split(' ').filter(Boolean);
  const last = t[t.length - 1]?.replace(/\.$/, '') ?? '';
  if (t.length >= 2 && /^[א-ת]$/.test(last)) return { surname: t.slice(0, -1).join(' '), first: last };
  return { surname: t.join(' ') };
}

/** `allOwners` holds every household's owner (the owner itself included). */
export function seatOwnerLabel(owner: SeatOwner, allOwners: readonly SeatOwner[]): string {
  const surname = clean(owner.surname);
  if (!surname) return '';
  const k = key(surname);
  const initial = initialOf(owner.first);
  const shared = allOwners.filter((x) => key(clean(x.surname)) === k).length > 1;
  return shared && initial ? `${surname} ${initial}.` : surname;
}

/** Labels for a whole Kehila at once (counts the surnames once). */
export function ownerLabels(owners: ReadonlyMap<string, SeatOwner>): Map<string, string> {
  const counts = new Map<string, number>();
  for (const o of owners.values()) { const k = key(clean(o.surname)); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const out = new Map<string, string>();
  for (const [ref, o] of owners) {
    const surname = clean(o.surname);
    const initial = initialOf(o.first);
    out.set(ref, !surname ? '' : (counts.get(key(surname)) ?? 0) > 1 && initial ? `${surname} ${initial}.` : surname);
  }
  return out;
}

/** Font size that lets `text` fit `width` on one line: the largest size down to `min` (about 0.58 em per character); below that the cell ellipsises. */
export function fitFontSize(text: string, width: number, max = 12, min = 9): number {
  const n = [...text].length;
  if (n === 0 || width <= 0) return max;
  return Math.max(min, Math.min(max, Math.floor((width / (n * 0.58)) * 2) / 2));
}
