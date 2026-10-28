// Ported from origin/main 6d74d0e src/types.ts (aliyah and recommendation types only).
import type { HebrewBirthDate, HebrewMonth, Relationship, Tribe, Yahrzeit } from '../types.ts';

export type YahrzeitCustom = 'ashkenaz' | 'sephardi';
export const YAHRZEIT_CUSTOM_OPTIONS: { value: YahrzeitCustom; label: string }[] = [{ value: 'ashkenaz', label: 'אשכנז' }, { value: 'sephardi', label: 'עדות המזרח' }];
export type Classification = string;
// The engine also reports these relationships, which our profile Relationship type does not list yet.
export type YahrzeitRelationship = Relationship | 'father_in_law' | 'mother_in_law' | 'uncle' | 'aunt' | 'unknown';
export type RosterPerson = { id: string; sourcePersonId: string | null; familyChildId: string | null; name: string; firstName: string; lastName: string; tribe: Tribe; classification: Classification | ''; torahName: string; wifePrayerName: string; barMitzvahDate: string; barMitzvahParasha: string; hebrewBirthDate: HebrewBirthDate | null; yahrzeits: Yahrzeit[]; allocatedSeats: number | null; aliyahCount: number | null; windowMonths: number | null; lastAliyah: string };
export type AliyahSlot = { position: string; tribe: Tribe | null };
export type AliyahService = 'shacharit' | 'mincha';
export type AliyahTemplate = { date: string; service?: AliyahService; reading: string; regularCount: number; allowExtra: boolean; slots: AliyahSlot[] };
export type AliyahCall = { position: string; personId?: string | null; guest?: boolean; nameAtRecording?: string };
export type AliyahRecord = { id: string; date: string; hebrewDate: string; service: AliyahService; minyan?: number; reading: string; cancelled: boolean; calls: AliyahCall[] };
export type AliyahInput = { date: string; service?: AliyahService; minyan?: number; reading: string; calls: AliyahCall[]; cancelled?: boolean };
export type RecommendationService = { date: string; key?: string; service?: AliyahService; reading: string; parashot: string[]; hebrewDate: string; year: number; yearLabel: string; title: string };
export type RecommendationCalendar = { year: number; yearLabel: string; defaultDate: string; years: { value: string; label: string }[]; services: RecommendationService[] };
export type RecommendationEvent = { kind: 'bar_mitzvah' | 'yahrzeit'; date: string; hebrewDate: string; description: string; needsReview: boolean; relationship?: YahrzeitRelationship; relativeName?: string; recordedDay?: number; recordedMonth?: HebrewMonth; recordedHebrewDate?: string };
export type RecommendationPerson = { id: string; name: string; firstName: string; lastName: string; tribe: Tribe; torahName: string; wifePrayerName: string; classification: string; aliyahCount: number | null; windowMonths: number | null; lastAliyahDate: string | null; lastAliyah: string; events: RecommendationEvent[] };
export type AliyahRecommendations = { service: RecommendationService; yahrzeitCustom?: YahrzeitCustom | null; eventWindowEnd: string; sections: { id: string; title: string; limit: number | null; people: RecommendationPerson[] }[]; notes: string[] };
