import type { CommunityMessage, HealingPrayer, MembershipRequest, MemberState, Preferences, Profile, Reply, SeatReport, SeatingStatus, Session, Shabbat, Zmanim } from './types.ts';
import { upcomingFriday } from './dates.ts';
import { applyYeshivaRules, candleLighting, timeOnDate, yeshivaReference } from './zmanim.ts';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function request<T>(path: string, token?: string, body?: unknown, method?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: method || (body === undefined ? 'GET' : 'POST'), signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error || 'הבקשה נכשלה. נסו שוב.', res.status);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error('לא ניתן להתחבר לשרת. בדקו את החיבור ונסו שוב.');
  } finally { clearTimeout(timeout); }
}
export const api = {
  register: (email: string, password: string, firstName: string, lastName: string) => request<Session>('/api/register', undefined, { email, password, firstName, lastName }),
  membershipRequests: (token: string) => request<MembershipRequest[]>('/api/admin/membership-requests', token),
  classifyMember: (token: string, id: string, classification: 'א' | 'קבוע') => request(`/api/admin/roster/${encodeURIComponent(id)}`, token, { classification }, 'PUT'),
  login: (email: string, password: string) => request<Session>('/api/login', undefined, { email, password }),
  state: (token: string) => request<MemberState>('/api/me', token),
  profile: (token: string, profile: Profile) => request<Profile>('/api/profile', token, profile, 'PUT'),
  preferences: (token: string, preferences: Preferences) => request<Preferences>('/api/preferences', token, preferences, 'PUT'),
  messages: (token: string) => request<CommunityMessage[]>('/api/messages', token),
  reply: (token: string, id: string, body: string) => request<Reply>(`/api/messages/${encodeURIComponent(id)}/replies`, token, { body }),
  read: (token: string, id: string) => request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}/read`, token, {}),
  push: (token: string, pushToken: string) => request<{ ok: boolean }>('/api/push-token', token, { token: pushToken }, 'PUT'),
  logout: (token: string) => request<{ ok: boolean }>('/api/logout', token, {}),
  healingPrayers: (token: string) => request<HealingPrayer[]>('/api/healing-prayers', token),
  addHealingPrayer: (token: string, name: string) => request<HealingPrayer>('/api/healing-prayers', token, { name }),
  deleteHealingPrayer: (token: string, id: string) => request<{ ok: boolean }>(`/api/healing-prayers/${encodeURIComponent(id)}`, token, undefined, 'DELETE'),
  seating: (token: string) => request<SeatingStatus>('/api/seating', token),
  saveSeating: (token: string, report: SeatReport) => request<SeatingStatus>('/api/seating', token, report, 'PUT'),
};

async function publicJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('זמני היום אינם זמינים כרגע.');
    return await response.json();
  } finally { clearTimeout(timer); }
}
const location = (latitude: string, longitude: string) => `latitude=${latitude}&longitude=${longitude}&tzid=Asia%2FJerusalem&i=on`;
export async function loadZmanim(date: string): Promise<Zmanim> {
  const reference = yeshivaReference(date);
  if (reference) return reference;
  const data = await publicJson(`https://www.hebcal.com/zmanim?cfg=json&${location('32.0878', '34.8878')}&date=${date}&sec=1`);
  return applyYeshivaRules(date, data);
}
export async function loadShabbat(date: string): Promise<Shabbat> {
  const friday = upcomingFriday(date);
  const [year, month, day] = friday.split('-');
  const astronomy = (latitude: string, longitude: string) => publicJson(`https://www.hebcal.com/zmanim?cfg=json&${location(latitude, longitude)}&date=${friday}&sec=1`);
  const [pt, ta, shabbat] = await Promise.all([
    astronomy('32.0878', '34.8878'), astronomy('32.0809', '34.7806'),
    publicJson(`https://www.hebcal.com/shabbat?cfg=json&${location('32.0878', '34.8878')}&gy=${year}&gm=${month}&gd=${day}&b=40&M=on&lg=he&leyning=off`),
  ]);
  const calendarFriday = shabbat?.items?.some((item: any) => item.category === 'candles' && timeOnDate(item.date, friday));
  if (pt.date !== friday || ta.date !== friday || !calendarFriday) throw new Error('זמני כניסת השבת אינם זמינים כרגע.');
  return {
    friday, parasha: shabbat.items?.find((item: any) => item.category === 'parashat')?.hebrew || 'שבת קודש',
    petahTikva: candleLighting(pt.times?.sunset, friday, 40),
    telAviv: candleLighting(ta.times?.sunset, friday, 21),
  };
}
