import { HDate } from '@hebcal/hdate';
import { getSedra, parshiot } from '@hebcal/core/dist/esm/sedra';
import type { Lang } from './types.ts';

// Hebrew names in the order of Hebcal's `parshiot` (the Torah order).
const HEBREW = ['בראשית', 'נח', 'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי', 'שמות', 'וארא', 'בא', 'בשלח',
  'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא', 'ויקהל', 'פקודי', 'ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'קדושים', 'אמור', 'בהר',
  'בחוקותי', 'במדבר', 'נשא', 'בהעלותך', 'שלח', 'קורח', 'חוקת', 'בלק', 'פינחס', 'מטות', 'מסעי', 'דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים', 'כי תצא',
  'כי תבוא', 'נצבים', 'וילך', 'האזינו', 'וזאת הברכה'];

// The parasha read in Israel on a Shabbat date ("YYYY-MM-DD"), by name in `lang` ("תזריע-מצורע" when doubled);
// null when that Shabbat has no regular reading (a holiday).
export function parashaOf(shabbat: string, lang: Lang): string | null {
  const hd = new HDate(new Date(`${shabbat}T12:00:00`));
  const found = getSedra(hd.getFullYear(), true).lookup(hd);
  if (found.chag) return null;
  const names = found.parsha.map(name => (lang === 'he' ? HEBREW[parshiot.indexOf(name)] : name) ?? name);
  return names.join('-');
}
