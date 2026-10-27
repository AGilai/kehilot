import { GeoLocation } from '@hebcal/noaa';
import { Zmanim as HebcalZmanim } from '@hebcal/core/dist/esm/zmanim';
import { clockTime, TZ } from '../dates.ts';
import { applyYeshivaRules } from '../zmanim.ts';
import type { DayZmanim, ZmanimFor } from './types.ts';

// Offline zmanim for the Kehila, with the same rules as Home (src/zmanim.ts "כללי אתר ישיבה"):
// the astronomy is Hebcal's (the same engine the Hebcal API runs), and the rounding / mincha gedola / nightfall
// formulas are `applyYeshivaRules` itself, so Home and the schedule cannot drift. Candle lighting is
// src/zmanim.ts `candleLighting` (sunset minus N, rounded down). Only the zmanim Home does not show are new here
// (rounding chosen by direction of caution; not Yeshiva-verified): alot and misheyakir up, latest-shema (MGA) down,
// mincha ketana up, chatzot nearest, tzeit/Shabbat end by degrees or minutes up.
//
// The Kehila location is the one src/api.ts passes to Hebcal (Petah Tikva); sea level (no elevation), like Home.
export const KEHILA_LOCATION = { latitude: 32.0878, longitude: 34.8878, tzid: TZ };

export type TzeitRule = { kind: 'yeshiva' } | { kind: 'minutes'; minutes: number } | { kind: 'degrees'; degrees: number };
export type ZmanimSettings = { candleMinutes: number; tzeit: TzeitRule; shabbatEnd: TzeitRule };
// 40 = the Petah Tikva candle-lighting minutes src/api.ts uses today.
export const DEFAULT_ZMANIM_SETTINGS: ZmanimSettings = { candleMinutes: 40, tzeit: { kind: 'yeshiva' }, shabbatEnd: { kind: 'yeshiva' } };

const MINUTE = 60000;
const geo = new GeoLocation(null, KEHILA_LOCATION.latitude, KEHILA_LOCATION.longitude, 0, KEHILA_LOCATION.tzid);

const roundMs = (ms: number, direction: 'up' | 'down' | 'nearest') =>
  new Date((direction === 'up' ? Math.ceil : direction === 'down' ? Math.floor : Math.round)(ms / MINUTE) * MINUTE);
const clock = (value: Date | string) => clockTime(typeof value === 'string' ? value : value.toISOString());

export function offlineDayZmanim(date: string, settings: ZmanimSettings = DEFAULT_ZMANIM_SETTINGS): DayZmanim | null {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const z = new HebcalZmanim(geo, new Date(year, month - 1, day), false);
  const astronomy = { sunrise: z.sunrise(), sunset: z.sunset(), chatzot: z.chatzot(), sofZmanShma: z.sofZmanShma(),
    sofZmanTfilla: z.sofZmanTfilla(), plagHaMincha: z.plagHaMincha() };
  if (Object.values(astronomy).some(value => !value || Number.isNaN(value.getTime()))) return null;
  const iso = Object.fromEntries(Object.entries(astronomy).map(([key, value]) => [key, value!.toISOString()]));
  const rules = applyYeshivaRules(date, { date, times: iso }).times;
  const sunset = astronomy.sunset!.getTime();
  const rule = (value: TzeitRule): string | null => {
    if (value.kind === 'yeshiva') return rules.nightfall!;
    if (value.kind === 'minutes') return roundMs(sunset + value.minutes * MINUTE, 'up').toISOString();
    const at = z.tzeit(value.degrees);
    return at ? roundMs(at.getTime(), 'up').toISOString() : null;
  };
  const extra: Record<string, Date | string | null | undefined> = {
    alotHaShachar: dateOrNull(z.alotHaShachar(), 'up'), misheyakir: dateOrNull(z.misheyakir(), 'up'),
    sofZmanShmaMGA: dateOrNull(z.sofZmanShmaMGA(), 'down'), minchaKetana: dateOrNull(z.minchaKetana(), 'up'),
    chatzot: roundMs(astronomy.chatzot!.getTime(), 'nearest'),
    candleLighting: roundMs(sunset - settings.candleMinutes * MINUTE, 'down'),
    tzeit: rule(settings.tzeit), shabbatEnd: rule(settings.shabbatEnd),
  };
  const out: DayZmanim = {
    sunrise: clock(rules.sunrise!), sofZmanShmaGRA: clock(rules.sofZmanShma!), sofZmanTfilaGRA: clock(rules.sofZmanTfilla!),
    minchaGedola: clock(rules.minchaGedola!), plagHaMincha: clock(rules.plagHaMincha!), sunset: clock(rules.sunset!),
  };
  for (const [key, value] of Object.entries(extra)) if (value) out[key as keyof DayZmanim] = clock(value);
  return out;
}

function dateOrNull(value: Date | null | undefined, direction: 'up' | 'down'): Date | null {
  return value && !Number.isNaN(value.getTime()) ? roundMs(value.getTime(), direction) : null;
}

export function offlineZmanimFor(settings: ZmanimSettings = DEFAULT_ZMANIM_SETTINGS): ZmanimFor {
  const cache = new Map<string, DayZmanim | null>();
  return date => {
    if (!cache.has(date)) cache.set(date, offlineDayZmanim(date, settings));
    return cache.get(date)!;
  };
}
