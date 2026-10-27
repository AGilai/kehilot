import type { AnchorId, Clock, Formula, Lang, ScheduleWeek, ZmanimFor } from './types.ts';

export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export function formatClock(minutes: number): Clock {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function roundMinutes(value: number, rounding: Formula['rounding']): number {
  if (rounding.mode === 'none') return value;
  const op = rounding.mode === 'down' ? Math.floor : rounding.mode === 'up' ? Math.ceil : Math.round;
  return op(value / rounding.step) * rounding.step;
}

export function anchorDates(formula: Formula, week: ScheduleWeek): string[] {
  return formula.day === 'friday' ? [week.friday] : formula.day === 'shabbat' ? [week.shabbat] : week.weekdays;
}

// Anchor value per date, in the order of anchorDates (null when a day has no such zman).
export function anchorTimes(formula: Formula, week: ScheduleWeek, zmanimFor: ZmanimFor): (number | null)[] {
  return anchorDates(formula, week).map(date => {
    const value = zmanimFor(date)?.[formula.anchor];
    return value === undefined ? null : parseClock(value);
  });
}

// Order: anchor of the chosen day(s) -> offset -> rounding -> notEarlierThan -> notLaterThan (it wins when the
// bounds cross). Whole minutes, wall clock: a DST switch inside the week never shifts a result.
export function evaluate(formula: Formula, week: ScheduleWeek, zmanimFor: ZmanimFor): Clock | null {
  const times = anchorTimes(formula, week, zmanimFor);
  if (!times.length || times.some(time => time === null)) return null;
  const values = times as number[];
  let minutes = formula.day === 'latest' ? Math.max(...values) : Math.min(...values);
  minutes += (formula.offset.direction === 'before' ? -1 : 1) * formula.offset.minutes;
  minutes = roundMinutes(minutes, formula.rounding);
  const earliest = formula.notEarlierThan ? parseClock(formula.notEarlierThan) : null;
  const latest = formula.notLaterThan ? parseClock(formula.notLaterThan) : null;
  if (earliest !== null) minutes = Math.max(minutes, earliest);
  if (latest !== null) minutes = Math.min(minutes, latest);
  return minutes >= 0 && minutes < 1440 ? formatClock(minutes) : null;
}

// he: the reference after "לפני/אחרי", the form after "ב", gender (for "המוקדמת / המוקדם").
const ANCHOR_NAMES: Record<AnchorId, { ref: string; at: string; feminine: boolean; en: string }> = {
  alotHaShachar: { ref: 'עלות השחר', at: 'בעלות השחר', feminine: true, en: 'dawn' },
  misheyakir: { ref: 'משיכיר', at: 'במשיכיר', feminine: false, en: 'misheyakir' },
  sunrise: { ref: 'הנץ החמה', at: 'בהנץ החמה', feminine: false, en: 'sunrise' },
  sofZmanShmaMGA: { ref: 'סוף זמן ק״ש מג״א', at: 'בסוף זמן ק״ש מג״א', feminine: false, en: 'latest Shema (MA)' },
  sofZmanShmaGRA: { ref: 'סוף זמן ק״ש גר״א', at: 'בסוף זמן ק״ש גר״א', feminine: false, en: 'latest Shema (GRA)' },
  sofZmanTfilaGRA: { ref: 'סוף זמן תפילה גר״א', at: 'בסוף זמן תפילה גר״א', feminine: false, en: 'latest Shacharit (GRA)' },
  chatzot: { ref: 'חצות היום', at: 'בחצות היום', feminine: true, en: 'midday' },
  minchaGedola: { ref: 'מנחה גדולה', at: 'במנחה גדולה', feminine: true, en: 'Mincha Gedola' },
  minchaKetana: { ref: 'מנחה קטנה', at: 'במנחה קטנה', feminine: true, en: 'Mincha Ketana' },
  plagHaMincha: { ref: 'פלג המנחה', at: 'בפלג המנחה', feminine: false, en: 'Plag HaMincha' },
  sunset: { ref: 'השקיעה', at: 'בשקיעה', feminine: true, en: 'sunset' },
  candleLighting: { ref: 'הדלקת נרות', at: 'בהדלקת נרות', feminine: true, en: 'candle lighting' },
  tzeit: { ref: 'צאת הכוכבים', at: 'בצאת הכוכבים', feminine: true, en: 'nightfall' },
  shabbatEnd: { ref: 'צאת השבת', at: 'בצאת השבת', feminine: true, en: 'Shabbat ending' },
};
export const anchorName = (anchor: AnchorId, lang: Lang) => lang === 'he' ? ANCHOR_NAMES[anchor].ref : ANCHOR_NAMES[anchor].en;

function minutesWord(n: number, lang: Lang): string {
  if (lang === 'en') return `${n} ${n === 1 ? 'minute' : 'minutes'}`;
  return n === 1 ? 'דקה אחת' : n === 2 ? 'שתי דקות' : `${n} דקות`;
}

// The plain-language summary (docs/UX-DESIGN.md §14.8 `editor.summary` / `editor.summaryExact`), e.g.
// "15 דקות לפני השקיעה המוקדמת בימים א׳–ה׳, מעוגל למטה ל־5, לא אחרי 18:30."
export function describe(formula: Formula, lang: Lang = 'he'): string {
  const name = ANCHOR_NAMES[formula.anchor];
  const he = lang === 'he';
  const dayPhrase = formula.day === 'friday' ? (he ? ' ביום שישי' : ' on Friday')
    : formula.day === 'shabbat' ? (he ? ' בשבת' : ' on Shabbat') : '';
  const span = formula.day === 'earliest' || formula.day === 'latest';
  const early = formula.day === 'earliest';
  const ref = he
    ? `${name.ref}${span ? ` ${early ? (name.feminine ? 'המוקדמת' : 'המוקדם') : (name.feminine ? 'המאוחרת' : 'המאוחר')} בימים א׳–ה׳` : dayPhrase}`
    : `${span ? `${early ? 'earliest' : 'latest'} ` : ''}${name.en}${span ? ' on Sun–Thu' : dayPhrase}`;
  const at = he ? `${name.at}${span ? ` ${early ? (name.feminine ? 'המוקדמת' : 'המוקדם') : (name.feminine ? 'המאוחרת' : 'המאוחר')} בימים א׳–ה׳` : dayPhrase}`
    : ref;
  const bounds = (formula.notEarlierThan ? `, ${he ? 'לא לפני' : 'not earlier than'} ${formula.notEarlierThan}` : '') +
    (formula.notLaterThan ? `, ${he ? 'לא אחרי' : 'not later than'} ${formula.notLaterThan}` : '');
  const { mode } = formula.rounding;
  const rounding = formula.rounding.mode === 'none' ? '' : he
    ? `, מעוגל ${mode === 'down' ? 'למטה' : mode === 'up' ? 'למעלה' : 'לקרוב'} ל־${formula.rounding.step}`
    : `, rounded ${mode === 'nearest' ? 'to the nearest' : `${mode} to`} ${formula.rounding.step}`;
  if (formula.offset.minutes === 0) {
    const lead = he ? (rounding ? at : `בדיוק ${at}`) : `${rounding ? 'At' : 'Exactly at'} ${ref}`;
    return `${lead}${rounding}${bounds}.`;
  }
  const direction = he ? (formula.offset.direction === 'before' ? 'לפני' : 'אחרי') : formula.offset.direction;
  return `${minutesWord(formula.offset.minutes, lang)} ${direction} ${ref}${rounding}${bounds}.`;
}
