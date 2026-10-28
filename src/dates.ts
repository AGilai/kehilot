import { HDate, gematriya } from '@hebcal/hdate';
import { MONTHS, TRIBES } from './types.ts';
import type { Lang } from './i18n/translate.ts';
import type { HebrewBirthDate, Profile } from './types.ts';

export const HEBREW_DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳', 'ט׳', 'י׳', 'י״א', 'י״ב', 'י״ג', 'י״ד', 'ט״ו', 'ט״ז', 'י״ז', 'י״ח', 'י״ט', 'כ׳', 'כ״א', 'כ״ב', 'כ״ג', 'כ״ד', 'כ״ה', 'כ״ו', 'כ״ז', 'כ״ח', 'כ״ט', 'ל׳'];
export const HEBREW_MONTH_NUMBERS: Record<string, number> = {
  nisan: 1, iyar: 2, sivan: 3, tamuz: 4, av: 5, elul: 6, tishrei: 7,
  cheshvan: 8, kislev: 9, tevet: 10, shevat: 11, adar: 12, adar_i: 12, adar_ii: 13,
};
export function currentHebrewYear(now = new Date()): number {
  return new HDate(new Date(`${israelDate(now)}T12:00:00`)).getFullYear();
}
export function birthYearOptions(now = new Date()) {
  return Array.from({ length: Math.max(0, currentHebrewYear(now) - 5700 + 1) }, (_, index) => {
    const year = 5700 + index;
    return { value: String(year), label: gematriya(year) };
  });
}
export function birthMonthOptions(year?: number | null) {
  if (!year) return MONTHS;
  const leap = HDate.isLeapYear(year);
  return MONTHS.filter(month => leap ? month.value !== 'adar' : !['adar_i', 'adar_ii'].includes(month.value));
}
export function birthDayOptions(month: HebrewBirthDate['month'], year?: number | null) {
  const option = birthMonthOptions(year).find(item => item.value === month);
  const max = option && year ? HDate.daysInMonth(HEBREW_MONTH_NUMBERS[month]!, year) : option?.max ?? 30;
  return HEBREW_DAY_LABELS.slice(0, max).map((label, index) => ({ value: String(index + 1), label }));
}
export function validHebrewBirthDate(value: unknown, now = new Date()): value is HebrewBirthDate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const date = value as Record<string, unknown>;
  if (Object.keys(date).length !== 3 || !Object.keys(date).every(key => ['day', 'month', 'year'].includes(key)) ||
      typeof date.year !== 'number' || !Number.isInteger(date.year) || date.year < 5700 || date.year > currentHebrewYear(now) ||
      typeof date.day !== 'number' || !Number.isInteger(date.day)) return false;
  const month = birthMonthOptions(date.year).find(item => item.value === date.month);
  if (!month || date.day < 1 || date.day > HDate.daysInMonth(HEBREW_MONTH_NUMBERS[month.value]!, date.year)) return false;
  const candidate = new HDate(date.day, HEBREW_MONTH_NUMBERS[month.value]!, date.year);
  return candidate.abs() <= new HDate(new Date(`${israelDate(now)}T12:00:00`)).abs();
}
export function updateHebrewBirthDate(value: HebrewBirthDate | null, patch: Partial<HebrewBirthDate>): HebrewBirthDate | null {
  const next = { day: 0, month: '' as HebrewBirthDate['month'], year: null as number | null, ...value, ...patch };
  if (next.month && !birthMonthOptions(next.year).some(item => item.value === next.month)) next.month = '';
  if (next.month && next.day > birthDayOptions(next.month, next.year).length) next.day = 0;
  return next.day === 0 && next.month === '' && !next.year ? null : next;
}

export const TZ = 'Asia/Jerusalem';
export function israelDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function civilDate(date: string): Date { return new Date(`${date}T12:00:00+02:00`); }
export function dayOfWeek(date: string): number { return civilDate(date).getUTCDay(); }
export function upcomingFriday(date: string): string {
  const d = civilDate(date);
  d.setUTCDate(d.getUTCDate() + (5 - d.getUTCDay() + 7) % 7);
  return d.toISOString().slice(0, 10);
}
// The Hebrew calendar is computed with @hebcal/hdate (pure JS), never with Intl `-u-ca-hebrew`: Hermes (the Android
// runtime) has no dependable non-Gregorian calendar support in Intl. Month 12 is Adar (Adar I in a leap year), 13 is Adar II.
const HE_MONTHS = ['', 'ניסן', 'אייר', 'סיוון', 'תמוז', 'אב', 'אלול', 'תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר ב׳'];
const EN_MONTHS = ['', 'Nisan', 'Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul', 'Tishrei', 'Cheshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar', 'Adar II'];
const HE_WEEKDAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];
const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LRI = '\u2066', PDI = '\u2069';
function hdateOf(date: string): HDate {
  const [y, m, d] = date.split('-').map(Number);
  return new HDate(new Date(y!, m! - 1, d!, 12));
}
function monthName(h: HDate, lang: Lang): string {
  const month = h.getMonth(), leapAdarI = month === 12 && HDate.isLeapYear(h.getFullYear());
  if (lang === 'en') return leapAdarI ? 'Adar I' : EN_MONTHS[month]!;
  return leapAdarI ? 'אדר א׳' : HE_MONTHS[month]!;
}
const dayLabel = (h: HDate, lang: Lang): string => lang === 'en' ? String(h.getDate()) : HEBREW_DAY_LABELS[h.getDate() - 1]!;
const heMonth = (h: HDate): string => `ב${monthName(h, 'he')}`;
const hebrewYear = (h: HDate, lang: Lang): string => lang === 'en' ? String(h.getFullYear()) : gematriya(h.getFullYear());
/** "d.m" without leading zeros; with `year`, "d.m.yyyy". */
function civilShort(date: string, year = false): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d}.${m}${year ? `.${y}` : ''}`;
}
export function hebrewDate(date: string, lang: Lang = 'he'): string {
  const h = hdateOf(date);
  return lang === 'en' ? `${h.getDate()} ${monthName(h, 'en')} ${h.getFullYear()}` : `${dayLabel(h, 'he')} ${heMonth(h)} ${hebrewYear(h, 'he')}`;
}
/** Owner rule: a Gregorian date is never shown alone. "י״ב בחשוון (23.10)", with `weekday` "יום ו׳, י״ב בחשוון (23.10)", with `year` "י״ב בחשוון תשפ״ז (23.10.2026)". */
export function dualDate(date: string, lang: Lang = 'he', opts: { weekday?: boolean; year?: boolean } = {}): string {
  const h = hdateOf(date);
  const day = dayOfWeek(date);
  const core = lang === 'en' ? `${h.getDate()} ${monthName(h, 'en')}` : `${dayLabel(h, 'he')} ${heMonth(h)}`;
  const weekday = opts.weekday ? `${(lang === 'en' ? EN_WEEKDAYS : HE_WEEKDAYS)[day]}, ` : '';
  const year = opts.year ? ` ${hebrewYear(h, lang)}` : '';
  return `${weekday}${core}${year} (${civilShort(date, opts.year)})`;
}
/** "י״ב–י״ח בחשוון (23.10–29.10)"; across Hebrew months "כ״ח בתשרי–ד׳ בחשוון (9.10–15.10)". The numbers are isolated left-to-right in Hebrew. */
export function dualRange(from: string, to: string, lang: Lang = 'he'): string {
  if (from === to) return dualDate(from, lang);
  const a = hdateOf(from), b = hdateOf(to);
  const same = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const heb = same
    ? lang === 'en' ? `${a.getDate()}–${b.getDate()} ${monthName(a, 'en')}` : `${dayLabel(a, 'he')}–${dayLabel(b, 'he')} ${heMonth(a)}`
    : lang === 'en' ? `${a.getDate()} ${monthName(a, 'en')}–${b.getDate()} ${monthName(b, 'en')}` : `${dayLabel(a, 'he')} ${heMonth(a)}–${dayLabel(b, 'he')} ${heMonth(b)}`;
  const greg = `${civilShort(from)}–${civilShort(to)}`;
  return `${heb} (${lang === 'he' ? `${LRI}${greg}${PDI}` : greg})`;
}
/** A day with its weekday: "יום ו׳, י״ב בחשוון (23.10)". */
export function displayDate(date: string, lang: Lang = 'he'): string { return dualDate(date, lang, { weekday: true }); }
/** The Israel calendar day of an instant (epoch milliseconds), as a dual date. */
export function dualDateAt(ms: number, lang: Lang = 'he', opts: { weekday?: boolean; year?: boolean } = {}): string {
  return dualDate(israelDate(new Date(ms)), lang, opts);
}
export function clockTime(iso?: string | null): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '—';
  return new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function relativeDate(iso: string): string {
  const date = israelDate(new Date(iso));
  return date === israelDate() ? `היום, ${clockTime(iso)}` : displayDate(date);
}
export function validCivilDate(value: string, allowFuture = false): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && (allowFuture || value <= israelDate());
}
export function validPhone(value: string): boolean {
  return value === '' || /^\+?[0-9]{7,15}$/.test(value.replace(/[\s().-]/g, ''));
}
export function validateProfile(p: Profile): string | null {
  if (!p.firstName?.trim()) return 'יש להזין שם פרטי.';
  if (!p.lastName?.trim()) return 'יש להזין שם משפחה.';
  if (`${p.firstName.trim()} ${p.lastName.trim()}`.length > 200) return 'השם הפרטי ושם המשפחה יחד יכולים להכיל עד 200 תווים.';
  if (!TRIBES.some(option => option.value === p.tribe)) return 'יש לבחור כהן, לוי או ישראל.';
  if ([p.torahName, p.wifePrayerName, p.barMitzvahParasha].some(s => s.length > 200)) return 'כל שדה יכול להכיל עד 200 תווים.';
  if ([p.phone, p.wifePhone].some(value => value.length > 40 || !validPhone(value.trim()))) return 'מספר הטלפון אינו תקין. אפשר להזין מספר מקומי או מספר בינלאומי עם +.';
  if (p.birthDate && !validCivilDate(p.birthDate)) return 'יש להזין תאריך לידה תקין בפורמט שנה-חודש-יום, שאינו בעתיד.';
  if (p.hebrewBirthDate != null && !validHebrewBirthDate(p.hebrewBirthDate)) return 'יש לבחור יום, חודש ושנה תקינים לתאריך הלידה העברי.';
  if (p.children.length > 30) return 'ניתן לשמור עד 30 ילדים בפרופיל.';
  const childIds = new Set<string>();
  for (const child of p.children) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(child.id) || childIds.has(child.id)) return 'מזהי הילדים צריכים להיות תקינים ושונים זה מזה.';
    childIds.add(child.id);
    if (!child.name.trim()) return 'יש להזין שם לכל בן או בת.';
    if ([child.name, child.torahName, child.barMitzvahParasha, child.spouseName, child.spouseTorahName, child.spousePrayerName].some(value => value.length > 200)) return 'פרטי הילד או בן/בת הזוג יכולים להכיל עד 200 תווים בכל שדה.';
    if ((child.birthDate && !validCivilDate(child.birthDate)) || (child.hebrewBirthDate != null && !validHebrewBirthDate(child.hebrewBirthDate)) || (!child.birthDate && !validHebrewBirthDate(child.hebrewBirthDate))) return `יש לבחור יום, חודש ושנה תקינים לתאריך הלידה העברי עבור ${child.name}.`;
    if (!['son', 'daughter'].includes(child.gender) || typeof child.married !== 'boolean') return 'פרטי הבן או הבת אינם תקינים.';
    if (child.gender === 'daughter' && child.married) {
      if (!TRIBES.some(option => option.value === child.spouseTribe)) return `יש לבחור כהן, לוי או ישראל עבור בן הזוג של ${child.name}.`;
    } else if (child.spouseTribe !== '') return 'מעמד החתן נשמר רק עבור בן זוג של בת נשואה.';
    if (child.barMitzvahDate && (!validCivilDate(child.barMitzvahDate, true) || dayOfWeek(child.barMitzvahDate) !== 6 || (child.birthDate && child.barMitzvahDate < child.birthDate))) return 'תאריך שבת בר המצווה צריך להיות תאריך של שבת, לאחר הלידה.';
    if (child.gender === 'daughter' && (child.torahName || child.barMitzvahParasha || child.barMitzvahDate)) return 'פרטי עלייה לתורה ובר מצווה נשמרים עבור בנים.';
    if (!child.married && (child.spouseName || child.spouseTorahName || child.spousePrayerName)) return 'יש לסמן נשוי/אה כדי לשמור פרטי בן או בת זוג.';
    if ((child.gender === 'son' && child.spouseTorahName) || (child.gender === 'daughter' && child.spousePrayerName)) return 'שמות בן או בת הזוג לתפילה אינם תואמים לבחירה.';
  }
  for (const y of p.yahrzeits) {
    if (!y.name.trim()) return 'יש להזין את שם הנפטר/ת בכל יארצייט.';
    const month = MONTHS.find(m => m.value === y.month);
    if (!month || !Number.isInteger(y.day) || y.day < 1 || y.day > month.max) return 'תאריך היארצייט אינו תקין לחודש שנבחר.';
    if (y.year && (!/^\d{4}$/.test(y.year) || Number(y.year) < 5000 || Number(y.year) > Number(new Intl.DateTimeFormat('en-u-ca-hebrew', { year: 'numeric', timeZone: TZ }).format(new Date())))) return 'שנת הפטירה צריכה להיות שנה עברית תקינה, למשל 5784.';
  }
  return null;
}
