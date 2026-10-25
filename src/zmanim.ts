import { israelDate } from './dates.ts';
import type { Zmanim } from './types.ts';

// Rules: https://www.yeshiva.org.il/calendar/timeprinciples
// Astronomy remains Hebcal's, so exact agreement with Yeshiva's own
// coordinates, elevation and astronomical engine needs separate verification.
export const ZMANIM_SOURCE = 'Hebcal · כללי אתר ישיבה';
export const YESHIVA_REFERENCE_SOURCE = 'אתר ישיבה · לוח יומי שנמסר';
export const ZMANIM_CACHE_PREFIX = 'shul.zmanim.yeshiva-rules.v2';
export const DAILY_TIME_KEYS = ['sunrise', 'sofZmanShma', 'sofZmanTfilla', 'minchaGedola', 'plagHaMincha', 'sunset', 'nightfall'] as const;
const MINUTE = 60000;

// Petah Tikva's complete daily table supplied by Noam from Yeshiva.
// This is dated source data, not an offset applied to Hebcal or other dates.
// Israel switched to UTC+02:00 on this date; never reuse its offset in summer.
export function yeshivaReference(date: string): Zmanim | null {
  if (date !== '2026-10-25') return null;
  const clocks = {
    sunrise: '05:51', sofZmanShma: '08:37', sofZmanTfilla: '09:33',
    minchaGedola: '11:54', plagHaMincha: '15:49', sunset: '16:57', nightfall: '17:16',
  };
  return { date, source: YESHIVA_REFERENCE_SOURCE, times: Object.fromEntries(
    DAILY_TIME_KEYS.map(key => [key, new Date(`${date}T${clocks[key]}:00+02:00`).toISOString()]),
  ) };
}

export function timeOnDate(value: unknown, date: string): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && israelDate(new Date(value)) === date;
}

function rounded(value: number, direction: 'up' | 'down'): string {
  return new Date((direction === 'up' ? Math.ceil : Math.floor)(value / MINUTE) * MINUTE).toISOString();
}

export function candleLighting(sunset: unknown, friday: string, minutesBefore: number): string {
  if (!timeOnDate(sunset, friday)) throw new Error('זמני כניסת השבת אינם זמינים כרגע.');
  return rounded(Date.parse(sunset) - minutesBefore * MINUTE, 'down');
}

export function applyYeshivaRules(date: string, data: unknown): Zmanim {
  const response = data as { date?: unknown; times?: Record<string, unknown> } | null;
  const times = response?.times;
  const required = ['sunrise', 'sunset', 'chatzot', 'sofZmanShma', 'sofZmanTfilla', 'plagHaMincha'];
  if (response?.date !== date || !times || required.some(key => !timeOnDate(times[key], date))) {
    throw new Error('התקבלו זמנים לא תקינים. נסו לרענן.');
  }
  const ms = (key: string) => Date.parse(times[key] as string);
  const sunrise = ms('sunrise');
  const sunset = ms('sunset');
  const noon = ms('chatzot');
  if (!(sunrise < noon && noon < sunset)) throw new Error('התקבלו זמנים לא תקינים. נסו לרענן.');
  const seasonalHour = (sunset - sunrise) / 12;
  return {
    date,
    source: ZMANIM_SOURCE,
    times: {
      sunrise: rounded(sunrise, 'up'),
      sofZmanShma: rounded(ms('sofZmanShma'), 'down'),
      sofZmanTfilla: rounded(ms('sofZmanTfilla'), 'down'),
      minchaGedola: rounded(noon + Math.max(30 * MINUTE, seasonalHour / 2), 'up'),
      plagHaMincha: rounded(ms('plagHaMincha'), 'up'),
      sunset: rounded(sunset, 'down'),
      nightfall: rounded(sunset + Math.max(18 * MINUTE, seasonalHour * 18 / 60), 'up'),
    },
  };
}

export function isCurrentZmanim(value: unknown, date: string): value is Zmanim {
  const saved = value as Partial<Zmanim> | null;
  const reference = yeshivaReference(date);
  return saved?.date === date && saved.source === (reference?.source ?? ZMANIM_SOURCE) && !!saved.times &&
    DAILY_TIME_KEYS.every(key => timeOnDate(saved.times?.[key], date) &&
      (!reference || saved.times?.[key] === reference.times[key]));
}
