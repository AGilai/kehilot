export type MessageCategory = 'weekly' | 'celebration' | 'condolence' | 'event';
export type Preferences = { weekly: boolean; community: boolean; replies: boolean; events: boolean };
export type HebrewMonth = 'tishrei' | 'cheshvan' | 'kislev' | 'tevet' | 'shevat' | 'adar' | 'adar_i' | 'adar_ii' | 'nisan' | 'iyar' | 'sivan' | 'tamuz' | 'av' | 'elul';
// Year is optional only for preserving older records; new dates require it.
export type HebrewBirthDate = { day: number; month: HebrewMonth | ''; year?: number | null };
export type Tribe = '' | 'kohen' | 'levi' | 'yisrael';
export const TRIBES: { value: Exclude<Tribe, ''>; label: string }[] = [
  { value: 'kohen', label: 'כהן' }, { value: 'levi', label: 'לוי' }, { value: 'yisrael', label: 'ישראל' },
];
export type Relationship = 'father' | 'mother' | 'son' | 'daughter' | 'brother' | 'sister';
export type Yahrzeit = { id: string; name: string; relationship: Relationship; day: number; month: HebrewMonth; year: string };
export type Child = {
  id: string;
  gender: 'son' | 'daughter';
  name: string;
  birthDate: string;
  hebrewBirthDate: HebrewBirthDate | null;
  torahName: string;
  barMitzvahParasha: string;
  barMitzvahDate: string;
  married: boolean;
  spouseName: string;
  spouseTribe: Tribe;
  spouseTorahName: string;
  spousePrayerName: string;
};
export type Profile = {
  name: string;
  firstName: string;
  lastName: string;
  tribe: Tribe;
  phone: string;
  wifePhone: string;
  torahName: string;
  wifePrayerName: string;
  barMitzvahParasha: string;
  birthDate: string;
  hebrewBirthDate: HebrewBirthDate | null;
  yahrzeits: Yahrzeit[];
  children: Child[];
};
export type Reply = { id: string; author: string; body: string; createdAt: string };
export type CommunityMessage = {
  id: string;
  category: MessageCategory;
  title: string;
  body: string;
  author: string;
  createdAt: string;
  pinned: boolean;
  replies: Reply[];
  attachment?: PdfAttachment | null;
};
export type HealingPrayer = { id: string; memberId: string; memberName: string; name: string; addedOn: string };
export type SeatingMode = 'unused' | 'needed';
export type SeatingEvent = { id: string; date: string; title: string; parasha: string | null; mode: SeatingMode; occasion: string; revision: number; reportingOpen: boolean; configuredOpen: boolean; closesAt: string | null; isCurrent: boolean; automatic: boolean };
export type PrayerSeats = { arvit: number; shacharit: number };
export type SeatingStatus = { event: SeatingEvent; eligible: boolean; allocatedSeats: number | null; allocationRevision: number | null; reported: boolean; value: PrayerSeats | null; neededSeats: PrayerSeats | null; releasedSeats: PrayerSeats | null; reportInvalidated: boolean; updatedAt: string | null };
export type SeatReport = { eventId: string; revision: number; mode: SeatingMode; allocatedSeats: number; allocationRevision: number; arvit: number; shacharit: number };
export type MemberState = { profile: Profile; preferences: Preferences; messages: CommunityMessage[]; readIds: string[]; healingPrayers: HealingPrayer[]; seating: SeatingStatus | null; classification?: string; role?: 'member' | 'gabbai'; verifiedPhone?: string | null; classifications?: ClassificationOption[] };
export type Session = { token: string; user: { id: string; email: string; phone?: string } };
export type Zmanim = { date: string; times: Record<string, string>; source: string };
export type Shabbat = { friday: string; parasha: string; petahTikva: string | null; telAviv: string | null };

// birthDate retains legacy Gregorian data; new birthdays use hebrewBirthDate.
export const EMPTY_PROFILE: Profile = { name: '', firstName: '', lastName: '', tribe: '', phone: '', wifePhone: '', torahName: '', wifePrayerName: '', barMitzvahParasha: '', birthDate: '', hebrewBirthDate: null, yahrzeits: [], children: [] };
export function normalizeProfile(profile: Partial<Profile>): Profile {
  const firstName = profile.firstName?.trim() ?? '';
  const lastName = profile.lastName?.trim() ?? '';
  return { ...EMPTY_PROFILE, ...profile, firstName, lastName, name: firstName && lastName ? `${firstName} ${lastName}` : profile.name ?? '', tribe: profile.tribe ?? '', phone: profile.phone ?? '', wifePhone: profile.wifePhone ?? '', hebrewBirthDate: profile.hebrewBirthDate ?? null, children: (profile.children ?? []).map(child => ({ ...child, spouseTribe: child.spouseTribe ?? '', hebrewBirthDate: child.hebrewBirthDate ?? null })) };
}
export function normalizeMemberState(value: Omit<MemberState, 'healingPrayers' | 'seating'> & { healingPrayers?: HealingPrayer[]; seating?: SeatingStatus | null }): MemberState {
  return { ...value, profile: normalizeProfile(value.profile), healingPrayers: Array.isArray(value.healingPrayers) ? value.healingPrayers : [], seating: value.seating && (value.seating.value === null || typeof value.seating.value === 'object') && (value.seating.neededSeats === null || typeof value.seating.neededSeats === 'object') ? value.seating : null };
}
export function newChild(gender: Child['gender']): Child {
  return { id: `child-${Date.now()}-${Math.random().toString(36).slice(2)}`, gender, name: '', birthDate: '', hebrewBirthDate: null, torahName: '', barMitzvahParasha: '', barMitzvahDate: '', married: false, spouseName: '', spouseTribe: '', spouseTorahName: '', spousePrayerName: '' };
}
export const DEFAULT_PREFERENCES: Preferences = { weekly: true, community: true, replies: true, events: true };
export const MONTHS: { value: HebrewMonth; label: string; max: number }[] = [
  { value: 'tishrei', label: 'תשרי', max: 30 }, { value: 'cheshvan', label: 'חשוון', max: 30 },
  { value: 'kislev', label: 'כסלו', max: 30 }, { value: 'tevet', label: 'טבת', max: 29 },
  { value: 'shevat', label: 'שבט', max: 30 }, { value: 'adar', label: 'אדר', max: 29 },
  { value: 'adar_i', label: 'אדר א׳', max: 30 }, { value: 'adar_ii', label: 'אדר ב׳', max: 29 },
  { value: 'nisan', label: 'ניסן', max: 30 }, { value: 'iyar', label: 'אייר', max: 29 },
  { value: 'sivan', label: 'סיוון', max: 30 }, { value: 'tamuz', label: 'תמוז', max: 29 },
  { value: 'av', label: 'אב', max: 30 }, { value: 'elul', label: 'אלול', max: 29 },
];
export const RELATIONSHIPS: { value: Relationship; label: string }[] = [
  { value: 'father', label: 'אב' }, { value: 'mother', label: 'אם' }, { value: 'son', label: 'בן' },
  { value: 'daughter', label: 'בת' }, { value: 'brother', label: 'אח' }, { value: 'sister', label: 'אחות' },
];
export const CATEGORY: Record<MessageCategory, { label: string; color: string; background: string; symbol: string }> = {
  weekly: { label: 'לו״ז שבועי', color: '#245E4F', background: '#EAF1ED', symbol: '▦' },
  celebration: { label: 'מזל טוב', color: '#966F20', background: '#FBF1DA', symbol: '✧' },
  condolence: { label: 'תנחומים', color: '#596477', background: '#EDF0F5', symbol: '◈' },
  event: { label: 'אירוע בקהילה', color: '#815D7A', background: '#F3EBF1', symbol: '◇' },
};
export const PARASHOT = ['בראשית', 'נח', 'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי', 'שמות', 'וארא', 'בא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא', 'ויקהל', 'פקודי', 'ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'קדושים', 'אמור', 'בהר', 'בחוקותי', 'במדבר', 'נשא', 'בהעלותך', 'שלח', 'קרח', 'חקת', 'בלק', 'פינחס', 'מטות', 'מסעי', 'דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים', 'כי תצא', 'כי תבוא', 'נצבים', 'וילך', 'האזינו', 'וזאת הברכה'];
const COMBINED_PARASHOT: Record<string, string> = {
  'פקודי': 'ויקהל־פקודי', 'מצורע': 'תזריע־מצורע', 'קדושים': 'אחרי מות־קדושים',
  'בחוקותי': 'בהר־בחוקותי', 'בלק': 'חקת־בלק', 'מסעי': 'מטות־מסעי', 'וילך': 'נצבים־וילך',
};
export const PARASHA_OPTIONS = [{ value: '', label: 'לא הוגדרה' }, ...PARASHOT.flatMap(value =>
  [value, ...(COMBINED_PARASHOT[value] ? [COMBINED_PARASHOT[value]] : [])]
).map(value => ({ value, label: value }))];

export type Classification = string;
export type ClassificationOption = { value: Classification; label: string };
export const CLASSIFICATION_OPTIONS: { value: Classification; label: string }[] = ['א', 'דור ב', 'חתן', 'דור ב-נשוי', 'קבוע'].map(value => ({ value: value as Classification, label: value === 'א' ? 'א — חבר עמותה' : value }));
export type PdfAttachment = { id: string; name: string; size: number; mimeType: 'application/pdf' };
export type RosterPerson = { id: string; sourcePersonId: string | null; familyChildId: string | null; name: string; firstName: string; lastName: string; tribe: Tribe; classification: Classification | ''; torahName: string; wifePrayerName: string; barMitzvahDate: string; barMitzvahParasha: string; hebrewBirthDate: HebrewBirthDate | null; yahrzeits: Yahrzeit[]; allocatedSeats: number | null; aliyahCount: number | null; windowMonths: number | null; lastAliyah: string };
export type PersonDetails = { person: RosterPerson; profile: Profile; kind: 'self' | 'son' | 'son_in_law' | 'independent'; ownerId: string | null; verifiedPhone?: string | null; account: { email: string; role: 'member' | 'gabbai' } | null };
export type PersonUpdate = { profile: Profile; classification: Classification; allocatedSeats: number | null; barMitzvahDate: string };
export type AliyahSlot = { position: string; tribe: Tribe | null };
export type AliyahTemplate = { date: string; reading: string; regularCount: number; allowExtra: boolean; slots: AliyahSlot[] };
export type AliyahCall = { position: string; personId?: string | null; guest?: boolean; nameAtRecording?: string };
export type AliyahRecord = { id: string; date: string; hebrewDate: string; service: 'shacharit' | 'mincha'; reading: string; cancelled: boolean; calls: AliyahCall[] };
export type AliyahInput = { date: string; reading: string; calls: AliyahCall[]; cancelled?: boolean };

export type PhoneChallenge = { challengeId: string; expiresIn: number; retryAfter: number };
export type AssociationMember = { phone: string; name: string; firstName: string; lastName: string; registered: boolean };
