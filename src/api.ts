import type { PhoneChallenge, AssociationMember } from './types';
import type { Classification, ClassificationOption, AliyahInput, AliyahRecord, AliyahTemplate, PersonDetails, PersonUpdate, RosterPerson, CommunityMessage, HealingPrayer, MemberState, Preferences, Profile, Reply, SeatReport, SeatingStatus, Session, Shabbat, Zmanim } from './types.ts';
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
  roster: (token: string) => request<RosterPerson[]>('/api/admin/roster', token),
  person: (token: string, id: string) => request<PersonDetails>(`/api/admin/people/${encodeURIComponent(id)}`, token),
  savePerson: (token: string, id: string, value: PersonUpdate) => request<PersonDetails>(`/api/admin/people/${encodeURIComponent(id)}`, token, value, 'PUT'),
  publish: (token: string, value: { category: string; title: string; body: string; pinned: boolean }) => request<CommunityMessage>('/api/admin/messages', token, value),
  publishPdf: (token: string, value: { name: string; base64: string; title: string; body: string }) => request<CommunityMessage>('/api/admin/weekly-documents', token, value),
  aliyahTemplate: (token: string, date: string) => request<AliyahTemplate>(`/api/admin/aliyah-template?date=${encodeURIComponent(date)}`, token),
  aliyahRecords: (token: string) => request<AliyahRecord[]>('/api/admin/aliyah-services', token),
  saveAliyot: (token: string, value: AliyahInput, id?: string) => request<AliyahRecord>(id ? `/api/admin/aliyah-records/${encodeURIComponent(id)}` : '/api/admin/aliyah-records', token, value, id ? 'PUT' : 'POST'),
  requestPhoneCode: (phone: string) => request<PhoneChallenge>('/api/auth/phone/request', undefined, { phone }),
  verifyPhoneCode: (challengeId: string, code: string) => request<Session>('/api/auth/phone/verify', undefined, { challengeId, code }),
  associationMembers: (token: string) => request<AssociationMember[]>('/api/admin/association-members', token),
  importMembers: (token: string, file: { name: string; base64: string }) => request<{ added: number; updated: number; total: number }>('/api/admin/association-members/import', token, { name: file.name, base64: file.base64 }),
  classifications: (token: string) => request<ClassificationOption[]>('/api/admin/classifications', token),
  addClassification: (token: string, name: string) => request<ClassificationOption>('/api/admin/classifications', token, { name }),
  classifyMember: (token: string, id: string, classification: Classification) => request(`/api/admin/roster/${encodeURIComponent(id)}`, token, { classification }, 'PUT'),
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
