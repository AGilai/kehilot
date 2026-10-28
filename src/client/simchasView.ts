import he from '../i18n/he.json' with { type: 'json' };
import { translate } from '../i18n/translate.ts';
import { addDays } from '../schedule/week.ts';
import { fromGregorian } from '../tree/dates.ts';
import { gregText, hebrewText } from '../tree/format.ts';
import type { SimchaItem, SimchaWeek } from './types.ts';

export type SimchaFilter = 'all' | 'bar' | 'bat';
type T = (key: string, params?: Record<string, string | number>) => string;

/** The weeks that still have something after the filter (a quiet week drops out; see quietNames). */
export function filterWeeks(weeks: SimchaWeek[], filter: SimchaFilter): SimchaWeek[] {
  return weeks.map(w => ({ ...w, items: filter === 'all' ? w.items : w.items.filter(i => i.kind === filter) })).filter(w => w.items.length > 0);
}

export function counts(weeks: SimchaWeek[]): Record<SimchaFilter, number> {
  const all = weeks.flatMap(w => w.items);
  return { all: all.length, bar: all.filter(i => i.kind === 'bar').length, bat: all.filter(i => i.kind === 'bat').length };
}

/** "וירא" for a parasha Shabbat, the holiday name otherwise ("שבת חנוכה" -> "חנוכה"). */
export const weekName = (w: SimchaWeek): string => w.parasha || w.label.replace(/^שבת\s*/, '') || w.label;

/** The quiet weeks' names for the one muted line; '' when every week has something. */
export function quietNames(weeks: SimchaWeek[], filter: SimchaFilter): string {
  const busy = new Set(filterWeeks(weeks, filter).map(w => w.week));
  return weeks.filter(w => !busy.has(w.week)).map(weekName).join(', ');
}

const dayLetters = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const dayOf = (iso: string) => new Date(`${iso}T12:00:00`).getDay();
/** "ל׳ בחשוון" (no year). */
export function hebrewDay(iso: string): string {
  const h = fromGregorian(iso);
  return hebrewText({ day: h.day, month: h.month });
}
/** "9.11" */
export const dayMonth = (iso: string): string => gregText(iso).split('.').slice(0, 2).join('.');

/** The week header: the Shabbat's label and Hebrew date, and its Gregorian day on the other side. */
export function weekHeader(w: SimchaWeek): { title: string; greg: string } {
  return { title: `${w.label} · ${hebrewDay(w.shabbat)}`, greg: dayMonth(w.shabbat) };
}

export const simchaTitle = (i: SimchaItem, t: T): string => t(i.kind === 'bar' ? 'simchas.bar' : 'simchas.bat', { name: i.firstName });

/** The second line: the family, and "בשבת" for a bar mitzvah or the weekday and date for a bat mitzvah. */
export function simchaSub(i: SimchaItem, t: T): string {
  const family = i.surname ? t('simchas.family', { surname: i.surname }) : '';
  const when = i.kind === 'bar' ? t('simchas.onShabbat') : t('simchas.onDay', { day: dayLetters[dayOf(i.date)]!, hebrew: hebrewDay(i.date), date: dayMonth(i.date) });
  return family ? `${family} · ${when}` : when;
}

/** The state Tag of a bar mitzvah: undefined for a bat mitzvah. */
export function simchaTag(i: SimchaItem, t: T): { text: string; manual: boolean } | undefined {
  return i.kind === 'bar' ? { text: t(i.manual ? 'simchas.manual' : 'simchas.suggested'), manual: i.manual } : undefined;
}

/** Overview card: the nearest simcha, and how many more there are in the window. `thisWeek`: it is in the current week. */
export function nextSimcha(weeks: SimchaWeek[]): { item: SimchaItem; more: number; thisWeek: boolean } | undefined {
  const index = weeks.findIndex(w => w.items.length > 0);
  if (index < 0) return undefined;
  const total = weeks.reduce((n, w) => n + w.items.length, 0);
  return { item: weeks[index]!.items[0]!, more: total - 1, thisWeek: index === 0 };
}

/** A suggested (not family-set) bar mitzvah date: the draft and the row say to check it with the family. */
export const needsCheck = (i: SimchaItem): boolean => i.kind === 'bar' && !i.manual;

/** The mazal tov message for ONE simcha, for that child's family only (the weekly sheet lists the week's celebration messages). */
export function mazalDraft(i: SimchaItem, t: T): { title: string; body: string; familyId?: string; note?: string } {
  return { title: `${t('simchas.draftTitle')} · ${simchaTitle(i, t)}`, body: '', ...(i.familyId ? { familyId: i.familyId } : {}), ...(needsCheck(i) ? { note: t('simchas.suggestedNote') } : {}) };
}

/** The sheet week (named by its Friday) a Shabbat's simchas go to: the Friday before that Shabbat. */
export const sheetWeekOf = (w: SimchaWeek): string => addDays(w.shabbat, -1);

/** The weekly sheet's lines for a week's simchas (added by a gabbai, §19.8): always Hebrew, the surname bold; the second line is the template phrase. */
export function sheetItemsFor(week: SimchaWeek): Array<{ type: 'celebration'; text: string; bold: string; source: 'byGabbai' }> {
  return week.items.map(i => {
    const phrase = translate(he, he, `tpl.mazal.phrase.${i.kind === 'bar' ? 'barMitzvah' : 'batMitzvah'}.parents.name`).replace('{name}', () => i.firstName);
    return { type: 'celebration' as const, text: `מזל טוב למשפחת ${i.surname}\n${phrase}`, bold: i.surname, source: 'byGabbai' as const };
  });
}
