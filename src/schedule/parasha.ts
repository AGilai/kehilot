import { HDate, Locale } from '@hebcal/hdate';
import { getSedra } from '@hebcal/core/dist/esm/sedra';
import type { Lang } from './types.ts';

// Hebcal's Hebrew rendering of a parasha name: maqaf becomes a space, niqqud and cantillation are removed.
const hebrew = (name: string) => Locale.gettext(name, 'he').replace(/\u05BE/g, ' ').normalize('NFD').replace(/[\u0591-\u05C7]/g, '').normalize('NFC');

// The parasha read in Israel on a Shabbat date ("YYYY-MM-DD"), by name in `lang` ("תזריע-מצורע" when doubled);
// null when that Shabbat has no regular reading (a holiday).
export function parashaOf(shabbat: string, lang: Lang): string | null {
  const hd = new HDate(new Date(`${shabbat}T12:00:00`));
  const found = getSedra(hd.getFullYear(), true).lookup(hd);
  if (found.chag) return null;
  const names = found.parsha.map(name => lang === 'he' ? hebrew(name) : name);
  return names.join('-');
}
