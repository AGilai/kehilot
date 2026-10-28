import { config } from '../config.ts';
import { ApiCodeError } from './errors.ts';
import { endpoints } from './endpoints.ts';
import type { Http } from './http.ts';
import type { Shabbat, Zmanim } from '../types.ts';
import { fixtureTreeFor } from '../tree/fixtureTree.ts';
import { createSeatsFixture, seatVariantOf } from '../seats/fixtureSeats.ts';
export { fixtureMemberSeats, fixtureSeatHall, seatVariantOf } from '../seats/fixtureSeats.ts';
export type { FixtureMemberSeats, SeatVariant } from '../seats/fixtureSeats.ts';
import { dayOfWeek, israelDate, upcomingFriday } from '../dates.ts';
import { addDays } from '../schedule/week.ts';
import { israelInstant, shabbatFriday } from '../seats/window.ts';
import type { Formula, Row, ScheduleDoc } from '../schedule/types.ts';
import { fixtureMap, fixtureMapFamilies, fixtureSeatFamilies } from '../seats/fixturePaste.ts';
import { createUploadFixture, fixtureHolderFamilies, fixtureHolderLayout, fixtureHolders, fixtureLinkSuggestions } from '../seats/fixtureUpload.ts';
import type { Channel, Child, SimchaWeek, FamilyView, Kehila, Lang, Message, MessageType, Reply, Role, RoleTag } from './types.ts';
import { ROLES, isManagement } from './roles.ts';

export type FixtureParams = { role: Role; lang: Lang | null; screen: string | null; card: string | null };

/** Fixture mode is for screenshots and demos only: it must never run beside a real API. */
export function assertFixturesAllowed(apiUrl: string = config.apiUrl): void {
  if (apiUrl) throw new Error('EXPO_PUBLIC_FIXTURES and EXPO_PUBLIC_API_URL are both set');
}

/** Screens that open the signed-in app at once (the others are for the sign-in screens). */
/** Screens for the P-frames. `me-linked` is P2's main state and P6's member-with-a-partner check;
 *  `leave-listener` is P6's guest listener; `home-card` takes `&card=` (P7). */
export const FRAME_SCREENS = ['phone-list', 'phone-list-empty', 'me', 'me-family', 'me-request', 'me-linked', 'me-man', 'partner-picker', 'child-sheet', 'privacy', 'privacy-ready', 'kehila-info', 'leave-listener', 'home-card', 'age13', 'age13-under', 'terms', 'delete', 'delete-ticked', 'admin-families', 'admin-link', 'overview-privacy', 'area-seats', 'area-people', 'area-settings', 'compose-family', 'tree', 'tree-married', 'tree-solo', 'tree-empty', 'tree-admin', 'tree-link', 'tree-link-sent', 'tree-link-received', 'tree-link-declined', 'tree-link-expired', 'simchas', 'simchas-empty', 'simchas-card', 'simchas-card-empty'];

export const FIXTURE_APP_SCREENS = ['profile', 'switcher', 'home', 'me', 'messages', 'messages-all', 'm3', 'm3b', 'm3target', 'chat', 'search-loading', 'compose', 'compose-target', 'compose-image', 'm5', 'overview', 'approvals', 'members', 'invite-member', 'groups', 'channels', 'channel-sheet', 'group-admin', 'import',
  'phone-list', 'phone-list-empty', 'me-family', 'me-request', 'me-linked', 'me-man', 'partner-picker', 'child-sheet', 'privacy', 'privacy-ready', 'kehila-info', 'leave-listener', 'home-card', 'age13', 'age13-under', 'terms', 'profile-age', 'delete', 'delete-ticked', 'admin-families', 'admin-link', 'overview-privacy', 'area-seats', 'area-people', 'area-settings', 'compose-family', 'tags-manage', 'tags-assign', 'tags-empty', 'schedule', 'schedule-none', 'schedule-editor', 'schedule-editor-none', 'seats', 'seats-split', 'seats-none', 'seats-closed', 'seats-gabbai', 'seat-print', 'seat-editor', 'seat-editor-check', 'seat-editor-match', 'seat-editor-save', 'seat-map', 'seat-upload', 'seat-upload-preview', 'seat-holders', 'seat-link', 'seat-approval', 'tree', 'tree-married', 'tree-solo', 'tree-empty', 'tree-admin', 'tree-link', 'tree-link-sent', 'tree-link-received', 'tree-link-declined', 'tree-link-expired', 'simchas', 'simchas-empty', 'simchas-card', 'simchas-card-empty'];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A valid-looking ULID for a time, so fixtures group by day like real messages. */
function fixtureUlid(ms: number, n: number): string {
  let t = ''; let v = ms;
  for (let i = 0; i < 10; i++) { t = CROCKFORD[v % 32] + t; v = Math.floor(v / 32); }
  return t + '0000000000000000'.slice(0, 15) + CROCKFORD[n % 32];
}

export const FIXTURE_PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#C9D3F5"/><circle cx="480" cy="110" r="52" fill="#F2D27A"/><path d="M0 400 L200 170 L340 320 L450 230 L640 400 Z" fill="#2A3F94"/></svg>')}`;

export function fixtureZmanim(date: string): Zmanim {
  const at = (hm: string) => new Date(`${date}T${hm}:00+02:00`).toISOString();
  return { date, source: 'fixture', times: { sunrise: at('05:51'), sofZmanShma: at('08:37'), sofZmanTfilla: at('09:33'), minchaGedola: at('11:54'), plagHaMincha: at('15:49'), sunset: at('16:57'), nightfall: at('17:16') } };
}
export function fixtureShabbat(friday: string): Shabbat {
  return { friday, parasha: 'פרשת נח', petahTikva: new Date(`${friday}T16:17:00+02:00`).toISOString(), telAviv: new Date(`${friday}T16:36:00+02:00`).toISOString() };
}


/** Fixture mode only: `?now=2026-10-30T15:40` (Israel time) fixes the clock Home and the schedule use. */
export function fixtureNow(search: string = typeof window !== 'undefined' && window.location ? window.location.search : ''): Date | null {
  if (!config.fixtures) return null;
  const raw = new URLSearchParams(search).get('now');
  const local = raw ? /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)$/.exec(raw) : null;
  const at = local ? israelInstant(local[1]!, local[2]!) : raw ? new Date(raw) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

// The Shabbat the fixture override belongs to: the one in progress on Saturday, else the coming one.
const overrideFriday = (date: string) => (dayOfWeek(date) === 6 ? addDays(date, -1) : upcomingFriday(date));

const fx = (id: string, label: string, time: Row['time'], more: Partial<Row> = {}): Row => ({ id, label: { he: label }, time, ...more });
const fixedAt = (at: string): Row['time'] => ({ kind: 'fixed', at });
const formula = (anchor: 'candleLighting' | 'sunset' | 'shabbatEnd', day: 'friday' | 'shabbat' | 'earliest', minutes: number, direction: 'before' | 'after', rounding: Formula['rounding'] = { mode: 'none' }): Row['time'] => ({ kind: 'formula', formula: { anchor, day, offset: { minutes, direction }, rounding } });

/** A realistic weekly sheet (invented content): candle lighting, Kabbalat Shabbat as candles + 10, two Daf Yomi slots, a text-only
 *  line, the earliest-sunset Mincha, two Maariv minyanim; one "this week only" override for the week of `friday`. */
export function fixtureScheduleDoc(friday: string): ScheduleDoc {
  return {
    version: 1,
    sections: [
      { id: 'shabbat', kind: 'shabbat', title: { he: 'שבת קודש', en: 'Shabbat' }, rows: [
        fx('candles', 'הדלקת נרות', formula('candleLighting', 'friday', 0, 'before'), { role: 'candles', day: 'friday', label: { he: 'הדלקת נרות', en: 'Candle lighting' } }),
        fx('kabbalat', 'מנחה וקבלת שבת', formula('candleLighting', 'friday', 10, 'after', { mode: 'nearest', step: 5 }), { label: { he: 'מנחה וקבלת שבת', en: 'Mincha and Kabbalat Shabbat' } }),
        fx('s-daf', 'דף יומי', fixedAt('07:45'), { label: { he: 'דף יומי', en: 'Daf Yomi' } }),
        fx('s-shacharit', 'שחרית', fixedAt('08:30'), { label: { he: 'שחרית', en: 'Shacharit' }, note: 'בבית הכנסת הגדול' }),
        fx('s-shiur', 'שיעורים לגברים, נשים וילדים לאחר התפילה', { kind: 'none' }, { label: { he: 'שיעורים לגברים, נשים וילדים לאחר התפילה', en: 'Classes for men, women and children after the service' } }),
        fx('s-gedola', 'מנחה גדולה', fixedAt('13:15'), { label: { he: 'מנחה גדולה', en: 'Mincha Gedola' } }),
        fx('s-third', 'מנחה וסעודה שלישית', formula('sunset', 'shabbat', 40, 'before', { mode: 'down', step: 5 }), { label: { he: 'מנחה וסעודה שלישית', en: 'Mincha and third meal' } }),
        fx('s-end', 'צאת השבת', formula('shabbatEnd', 'shabbat', 0, 'before'), { label: { he: 'צאת השבת', en: 'Shabbat ends' } }),
        fx('s-daf2', 'דף יומי', fixedAt('19:30'), { label: { he: 'דף יומי', en: 'Daf Yomi' } }),
      ] },
      { id: 'weekday', kind: 'weekday', title: { he: 'תפילות ימי החול', en: 'Weekday prayers' }, rows: [
        fx('w-sh1', 'שחרית מניין א׳', fixedAt('06:15'), { label: { he: 'שחרית מניין א׳', en: 'Shacharit, first minyan' } }),
        fx('w-daf', 'שיעור דף יומי', fixedAt('07:00'), { label: { he: 'שיעור דף יומי', en: 'Daf Yomi class' } }),
        fx('w-sh2', 'שחרית מניין ב׳', fixedAt('08:00'), { label: { he: 'שחרית מניין ב׳', en: 'Shacharit, second minyan' } }),
        fx('w-gedola', 'מנחה גדולה', fixedAt('13:15'), { label: { he: 'מנחה גדולה', en: 'Mincha Gedola' } }),
        fx('w-mincha', 'מנחה', { kind: 'formula', formula: { anchor: 'sunset', day: 'earliest', offset: { minutes: 20, direction: 'before' }, rounding: { mode: 'down', step: 5 } } }, { label: { he: 'מנחה', en: 'Mincha' } }),
        fx('w-arvit', 'ערבית', fixedAt('17:15'), { label: { he: 'ערבית', en: 'Maariv' } }),
        fx('w-arvit2', 'מניין ערבית ב׳', fixedAt('20:15'), { label: { he: 'מניין ערבית ב׳', en: 'Maariv, second minyan' } }),
      ] },
    ],
    weekOverrides: { [friday]: { rows: { 's-gedola': { kind: 'time', at: '12:45', note: 'בגלל הקידוש' } } } },
    sheet: { candleCities: [
      { name: { he: 'ירושלים', en: 'Jerusalem' }, latitude: 31.7683, longitude: 35.2137, candleMinutes: 40 },
      { name: { he: 'ת״א', en: 'Tel Aviv' }, latitude: 32.0853, longitude: 34.7818, candleMinutes: 20 },
    ] },
    location: { latitude: 32.0878, longitude: 34.8878, elevation: 'sea', candleMinutes: 40 },
    updatedAt: Date.parse('2026-10-27T09:02:00+02:00'),
  };
}

/** Fixture mode only: `?long=1` adds long labels and extra rows, to see the sheet's fitting rules work (UX-DESIGN §14.5). */
function fixtureLongRows(doc: ScheduleDoc): ScheduleDoc {
  const search = typeof window !== 'undefined' && window.location ? window.location.search : '';
  if (new URLSearchParams(search).get('long') !== '1') return doc;
  const more = (prefix: string, at: string[]): Row[] => at.map((time, i) => fx(`${prefix}${i}`, `שיעור מיוחד בנושא הלכות שבת ומועד מפי הרב לדוגמה מספר ${i + 1}`, fixedAt(time)));
  return { ...doc, sections: doc.sections.map(s => ({ ...s, rows: [...s.rows, ...more(s.id, s.kind === 'shabbat' ? ['09:30', '10:15', '11:00', '14:30', '15:15'] : ['06:45', '09:00', '10:00', '12:00', '14:00', '15:00', '18:30', '19:00'])] })) };
}

export function parseFixtureParams(search: string): FixtureParams {
  const q = new URLSearchParams(search);
  const role = q.get('role');
  const lang = q.get('lang');
  return {
    role: (ROLES as readonly (string | null)[]).includes(role) ? (role as Role) : 'member',
    lang: lang === 'he' || lang === 'en' ? lang : null,
    screen: q.get('screen'),
    card: q.get('card'),
  };
}

export function fixtureParams(): FixtureParams {
  const search = typeof window !== 'undefined' && window.location ? window.location.search : '';
  return parseFixtureParams(search);
}

/** Fixture mode only: `?hide=celebration` leaves those message types out of the feed (a guest whose type rules hide mazal tov). */
function hiddenTypes(): string[] {
  const search = typeof window !== 'undefined' && window.location ? window.location.search : '';
  return (new URLSearchParams(search).get('hide') ?? '').split(',').filter(Boolean);
}

// All names below are invented.
export function createFixtureApi(roleIn: Role, screen: string | null = null, lang: Lang | null = null, card: string | null = null) {
  assertFixturesAllowed();
  // P6 (leave the Kehila) is a guest-listener frame whatever ?role says.
  const role: Role = screen === 'leave-listener' ? 'listener' : roleIn;
  // Screens for the P1-P14 frames use the frames' Kehila and people (design/mockups/frames).
  const frame = !!screen && FRAME_SCREENS.includes(screen);
  const meFirst = screen === 'me-man' ? 'דוד' : card === 'request' || screen === 'me-request' ? 'יוסי' : screen === 'leave-listener' ? 'רון' : 'דנה';
  const meLast = screen === 'leave-listener' ? 'אורח' : 'בדיוני';
  const meName = `${meFirst} ${meLast}`;
  const PRIVACY_CONTACT = 'עמית דוגמה, גבאי · pratiyut@example.org';
  const TERMS_AT = Math.floor(Date.parse('2026-10-27T10:00:00+02:00') / 1000);
  // P4 main state: a number on file and the switch on. P1 empty: a number, switch off.
  const phoneOn = !!screen && ['me', 'me-family', 'me-request', 'me-linked', 'me-man', 'child-sheet', 'partner-picker', 'phone-list', 'tree', 'tree-married', 'tree-solo', 'tree-link', 'tree-link-sent', 'tree-link-received', 'tree-link-declined', 'tree-link-expired'].includes(screen);
  const hasPhone = phoneOn || screen === 'phone-list-empty' || card === 'phone';
  const kehila: Kehila = {
    kehilaId: '01FIXTUREKEHILA0000000001', name: screen === 'leave-listener' ? 'מניין נווה דמיון' : frame ? 'קהילת אור הדוגמה' : 'קהילת בדיוני', role, classification: '', logoVersion: null,
    canBroadcast: isManagement(role), pendingRequest: false,
    // ?screen=m5 shows M5 with some choices already made (one muted channel, type and member).
    notify: screen === 'm5'
      ? { mutedChannels: ['01FIXTURECHANNEL00000002'], mutedTypes: ['event'], membersBroadcasts: 'management_only', mutedMembers: ['m1'], chatChannels: [], seatReminders: true }
      : { mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [], seatReminders: true },
    // A listener admitted to the youth group reads its channel and posts in its chat (spec §3c).
    groups: role === 'listener' ? ['01FIXTUREGROUP00000000001'] : [], adminGroups: [], tags: [] as RoleTag[], settings: { pollSeconds: 60 },
    privacyContact: screen === 'kehila-info' || screen === 'overview-privacy' || screen === 'privacy' || screen === 'privacy-ready' ? PRIVACY_CONTACT : '',
    showPhone: phoneOn,
    cards: {
      gabbaiLink: card === 'gabbai' ? { gabbaiName: 'עמית דוגמה', gabbaiRole: 'gabbai' as const, partnerName: 'דנה בדיוני' } : card === 'tech' ? { gabbaiName: 'אורן מערכת', gabbaiRole: 'tech' as const, partnerName: 'דנה בדיוני' } : null,
      request: card === 'request' ? { fromUserId: '01FIXTUREUSER00000000005', fromName: 'דנה בדיוני' } : null,
      imported: card === 'imported',
      phoneAsk: card === 'phone' || card === 'phone-nonumber',
      terms: isManagement(role) && (screen === 'terms' || card === 'terms'),
      seatLink: card === 'seat-link' ? { seats: 2, at: 1_790_000_000 } : null,
    },
    ...(isManagement(role) ? { typeRules: { celebration: { post: 'broadcasters' as const, listeners: false }, condolence: { post: 'management' as const, listeners: true } } } : {}),
    ...(isManagement(role) ? { termsAccepted: screen === 'terms' || card === 'terms' ? null : { name: 'עמית דוגמה', at: TERMS_AT } } : {}),
  };
  const me = {
    userId: '01FIXTUREUSER00000000001', email: 'dana@example.invalid',
    // ?screen=profile shows the profile form; ?screen=switcher gives three Kehilot and no remembered choice.
    profile: screen === 'profile' || screen === 'profile-age' ? null : {
      firstName: lang === 'en' ? (meFirst === 'יוסי' ? 'Yossi' : 'Dana') : frame ? meFirst : 'דנה', lastName: lang === 'en' ? 'Example' : frame ? meLast : 'בדויה', lang: lang ?? ('he' as Lang),
      // A number is on file where the frame shows one (P4, P1, P7 phone card); the rest have none.
      phone: hasPhone ? '+972500000001' : null,
    },
    age13Required: screen === 'age13' || screen === 'age13-under' || screen === 'profile-age',
    kehilot: [
      { kehilaId: kehila.kehilaId, name: kehila.name, role, logoVersion: null },
      ...(screen === 'switcher' || screen === 'me-linked' || screen === 'me-man' ? [
        { kehilaId: '01FIXTUREKEHILA0000000002', name: 'בית כנסת הדוגמה', role: 'gabbai' as Role, logoVersion: null },
        { kehilaId: '01FIXTUREKEHILA0000000003', name: 'קהילת הנחל המצויר', role: 'listener' as Role, logoVersion: null },
      ] : []),
    ],
  };
  // The Compose screens show a member who may broadcast (a plain member has no Compose at all).
  const broadcaster = isManagement(role) || (role === 'member' && !!screen && screen.startsWith('compose'));
  // What the server computes per channel: all five for a gabbai, general + the two configurable types for a broadcaster.
  const postable = (): MessageType[] => (isManagement(role) ? ['general', 'weekly', 'event', 'celebration', 'condolence'] : broadcaster ? ['general', 'celebration', 'condolence'] : []);
  const ch = (channelId: string, name: string, over: Partial<Channel> = {}) => ({
    channelId, name, listenersCanRead: true, postPolicy: 'management' as const, canPost: isManagement(role), inAudience: true,
    conversation: false, chatHourlyLimit: 0, isAdmin: isManagement(role), postableTypes: [] as MessageType[], ...over,
  });
  const allChannels = [
    // The one main channel (stored name `announcements`, shown through channelLabel()); members with broadcast permission post here.
    ch('01FIXTURECHANNEL00000001', 'announcements', { postPolicy: 'broadcasters', canPost: broadcaster, postableTypes: postable() }),
    // A group's channel: listeners do not read it.
    ch('01FIXTURECHANNEL00000002', 'שיעור הדף', { listenersCanRead: false, inAudience: role !== 'listener', ...(isManagement(role) ? { groups: ['01FIXTUREGROUP00000000002'], postableTypes: postable() } : {}) }),
    // The server never returns the whole-Kehila chat to a listener; the one it returns is the admitted group's chat.
    ch('01FIXTURECHANNEL00000003', role === 'listener' ? 'שיחת קבוצת הנוער' : 'שיחת הקהילה', { conversation: true, listenersCanRead: role === 'listener' ? false : true, canPost: true, chatHourlyLimit: 30, ...(isManagement(role) ? { groups: ['01FIXTUREGROUP00000000001'] } : {}) }),
    ...(isManagement(role) ? [ch('01FIXTURECHANNEL00000004', 'קבוצת הנוער', { inAudience: false, postableTypes: postable() })] : []),
  ];
  const [cAnn, cGroup, cChat, cYouth] = [allChannels[0]!.channelId, allChannels[1]!.channelId, allChannels[2]!.channelId, allChannels[3]?.channelId ?? allChannels[0]!.channelId];
  // The server never returns a group's channel to a listener who is not in the group.
  const channels = role === 'listener' ? allChannels.filter(c => c.channelId !== cGroup) : allChannels;
  // ?screen=m3target makes the signed-in user the family a blessing is aimed at.
  const targetId = screen === 'm3target' ? me.userId : '01FIXTUREUSER00000000002';
  const now = Date.now();
  const H = 3600_000;
  /** The server sends times as Unix seconds. */
  const secs = (ms: number) => Math.floor(ms / 1000);
  const mk = (ago: number, n: number, over: Partial<Message>): Message => ({
    messageId: fixtureUlid(now - ago, n), channelId: cAnn, type: 'weekly', title: '', body: '', authorId: 'm1', authorName: 'יוסי לדוגמה',
    authorKind: 'management', joinCount: 0, ...over,
  });
  const messages: Message[] = [
    mk(1 * H, 1, { type: 'weekly', title: 'שבת שלום מהקהילה הבדיונית', body: 'הודעת דוגמה בלבד. קבלת שבת תתקיים בשעה הרגילה.' }),
    mk(2 * H, 2, { type: 'celebration', title: 'מזל טוב לבר המצווה בבית בדיוני', body: 'משפחת בדיוני מזמינה את כולם לשמחה בשבת הקרובה.', joinCount: 12, targetMemberId: targetId, targetName: 'בדיוני', replierCount: 3 }),
    mk(5 * H, 3, { type: 'condolence', title: 'השתתפות בצער משפחת לדוגמה', body: 'בצער רב אנו מודיעים על פטירתו של אבי המשפחה. יהי זכרו ברוך.', targetMemberId: targetId, targetName: 'לדוגמה', replierCount: 2 }),
    mk(26 * H, 4, { type: 'event', title: 'שיעור ערב שבת', body: 'שיעור קצר לפני מנחה, בהשתתפות כולם.' }),
    mk(3 * H, 5, { channelId: cChat, type: 'chat', authorKind: 'member', authorId: 'u7', authorName: 'רון לדוגמה', body: 'מי מביא כיסאות לשבת?' }),
    mk(2.5 * H, 6, { channelId: cChat, type: 'chat', authorKind: 'member', authorId: 'u8', authorName: 'מיכל בדויה', body: 'צילמתי את הסוכה, הנה:', image: { contentType: 'image/jpeg', bytes: 40000 } }),
    mk(1.5 * H, 7, { channelId: cChat, type: 'chat', authorKind: 'member', authorId: me.userId, authorName: 'דנה בדויה', body: 'אני אביא, תודה!' }),
    mk(6 * H, 9, { type: 'general', authorKind: 'member', authorId: 'u7', authorName: 'רון לדוגמה', title: 'מי יכול להביא כיסאות?', body: 'חסרים כמה כיסאות באולם לשבת.' }),
    mk(27 * H, 10, { type: 'celebration', title: 'מזל טוב להולדת הבת', body: 'משפחת דוגמה מודיעה בשמחה על הולדת בת.', targetMemberId: '01FIXTUREUSER00000000003', targetName: 'דוגמה', joinCount: 4 }),
    ...(role === 'listener' ? [] : [mk(30 * H, 11, { channelId: cGroup, type: 'weekly', title: 'שיעור הדף השבועי', body: 'הדף היומי ימשיך כרגיל, ללא שינוי.' })]),
    ...(isManagement(role) ? [mk(4 * H, 8, { channelId: cYouth, type: 'weekly', title: 'מפגש נוער בשבת', body: 'הודעה בקבוצה שאינה בקהל שלי.' })] : []),
  ];
  // ?screen=search-loading: a full first page and then a failing second page, so the archive stays "still loading".
  if (screen === 'search-loading') {
    for (let i = 0; i < 42; i++) messages.push(mk((30 + i) * H, 100 + i, { title: `עדכון שבועי מספר ${i + 1}`, body: 'הודעת דוגמה בלבד, ללא תוכן אמיתי.' }));
  }
  const celebration = messages[1]!;
  // The server returns replies only to the target and to their own author; a gabbai gets none.
  const someReply = (n: number, authorId: string, authorName: string, body: string): Reply =>
    ({ replyId: fixtureUlid(now - n * H, n), authorId, authorName, body, createdAt: secs(now - n * H) });
  const repliesFor = (m: Message): Reply[] => {
    if (isManagement(role) && m.targetMemberId !== me.userId) return [];
    if (m.targetMemberId === me.userId) return [someReply(1, 'u7', 'רון לדוגמה', 'מזל טוב ושמחה גדולה!'), someReply(2, 'u8', 'מיכל בדויה', 'מברכים מכל הלב, שתזכו לנחת.')];
    return m.messageId === celebration.messageId ? [someReply(1, me.userId, 'דנה בדויה', 'מזל טוב! נשמח לחגוג איתכם.')] : [];
  };
  const routes: Record<string, unknown> = {
    'GET /v1/me': me,
    'PUT /v1/me/profile': { firstName: 'דנה', lastName: 'בדויה', lang: 'he' },
    [`GET /v1/kehilot/${kehila.kehilaId}`]: kehila,
    [`GET /v1/kehilot/${kehila.kehilaId}/channels`]: channels,
    [`GET /v1/kehilot/${kehila.kehilaId}/messages`]: messages.filter(m => !hiddenTypes().includes(m.type)),
    [`GET /v1/kehilot/${kehila.kehilaId}/changes`]: { cursor: 'fixture', more: false, changes: [] },
  };
  for (const m of messages) {
    const base = `/v1/kehilot/${kehila.kehilaId}/messages/${m.messageId}`;
    routes[`GET ${base}`] = m;
    routes[`GET ${base}/replies`] = repliesFor(m);
    routes[`POST ${base}/read`] = undefined;
    routes[`POST ${base}/join`] = { joinCount: m.joinCount + 1, joined: true };
    routes[`DELETE ${base}`] = undefined;
    if (m.image) routes[`GET ${base}/image`] = { url: FIXTURE_PICTURE, expiresAt: secs(now + 300_000) };
  }
  for (const x of me.kehilot.slice(1)) {
    routes[`GET /v1/kehilot/${x.kehilaId}`] = { ...kehila, kehilaId: x.kehilaId, name: x.name, role: x.role };
    routes[`GET /v1/kehilot/${x.kehilaId}/channels`] = channels;
  }
  // Invite previews (public): 7K3M9Q2XPA is valid, 4D8F2H6NRT has expired. Same codes as views/useIncomingLink.ts.
  routes['GET /v1/invites/7K3M9Q2XPA'] = { kehilaName: kehila.name, role: 'member', expiresAt: secs(now + 24 * 24 * H) };
  routes[`POST /v1/kehilot/${kehila.kehilaId}/membership-request`] = {};
  routes[`PUT /v1/kehilot/${kehila.kehilaId}/me/notify`] = {};
  routes[`GET /v1/kehilot/${kehila.kehilaId}/invites`] = [
    { code: '7K3M9Q2XPA', role: 'listener', usesLeft: 8, expiresAt: secs(now + 5 * 24 * H), mine: true },
    { code: '4D8F2H6NRT', role: 'listener', usesLeft: 10, expiresAt: secs(now + 2 * 24 * H), mine: true },
  ];
  routes[`POST /v1/kehilot/${kehila.kehilaId}/invites`] = { code: '9P2R5T8WXZ', expiresAt: secs(now + 7 * 24 * H) };
  // Management (gabbai). Invented names only.
  const A = `/v1/kehilot/${kehila.kehilaId}/admin`;
  const requests = [
    { userId: '01FIXTUREUSER00000000011', displayName: 'נועה בדויה', createdAt: secs(now - 30 * H), previouslyRejected: false },
    { userId: '01FIXTUREUSER00000000012', displayName: 'אורי לדוגמה', createdAt: secs(now - 5 * H), previouslyRejected: true },
  ];
  if (screen === 'seat-approval') (requests[0] as Record<string, unknown>).seatSuggestions = { count: 1, items: [{ holderId: '01FIXTUREHOLDER00000000001', holderName: 'משפחת מדומה', why: 'phone', level: 'likely' }] };
  const adminFam = screen === 'admin-families' || screen === 'admin-link';
  const U = (n: number) => `01FIXTUREUSER000000000${n}`;
  const memberRows = adminFam ? [
    { userId: U(21), displayName: 'דנה בדיוני', role: 'member', classification: 'א', canBroadcast: true, groups: [], tags: [], phone: '+972500000011', showPhone: true },
    { userId: U(22), displayName: 'יוסי בדיוני', role: 'member', classification: '', canBroadcast: false, groups: [], tags: [] as RoleTag[], phone: '+972500000012', showPhone: false },
    { userId: U(23), displayName: 'מיכל דוגמה', role: 'member', classification: 'קבוע', canBroadcast: true, groups: [], tags: [] as RoleTag[], phone: '+972500000013', showPhone: true },
    { userId: U(24), displayName: 'אבי ניסיון', role: 'member', classification: '', canBroadcast: false, groups: [], tags: [] as RoleTag[], phone: '+972500000014', showPhone: false },
    { userId: U(25), displayName: 'אברהם אלמוני', role: 'member', classification: '', canBroadcast: false, groups: [], tags: [] as RoleTag[], phone: null, showPhone: false },
  ] : [
    { userId: me.userId, displayName: 'דנה בדויה', role: role === 'tech' ? 'tech' : 'gabbai', classification: 'קבוע', canBroadcast: true, groups: ['01FIXTUREGROUP00000000001'], tags: [] as RoleTag[] },
    { userId: 'm1', displayName: 'יוסי לדוגמה', role: 'gabbai', classification: 'א', canBroadcast: true, groups: [], tags: [] as RoleTag[] },
    { userId: 'm2', displayName: 'אורן מערכת', role: 'tech', classification: '', canBroadcast: true, groups: [], tags: [] as RoleTag[] },
    { userId: 'u7', displayName: 'רון לדוגמה', role: 'member', classification: 'קבוע', canBroadcast: true, groups: ['01FIXTUREGROUP00000000001', '01FIXTUREGROUP00000000002'], tags: [] as RoleTag[] },
    { userId: 'u8', displayName: 'מיכל בדויה', role: 'member', classification: 'א', canBroadcast: false, groups: ['01FIXTUREGROUP00000000002'], tags: [] as RoleTag[] },
    { userId: '01FIXTUREUSER00000000002', displayName: 'משפחת בדיוני', role: 'member', classification: '', canBroadcast: false, groups: [], tags: [] as RoleTag[] },
    { userId: '01FIXTUREUSER00000000013', displayName: 'תמר הנחל', role: 'listener', classification: '', canBroadcast: false, groups: [], tags: [] as RoleTag[] },
  ];
  // Role tags (invented): six names, some assigned. `tags-empty` starts with none, to show the starter set.
  let tagList: RoleTag[] = screen === 'tags-empty' ? [] : ['גבאי', 'רב', 'חזן', 'גזבר', 'ועד שמחות', 'טכני'].map((name, i) => ({ tagId: `01FIXTURETAG00000000000${i + 1}`, name }));
  const tagNamed = (n: string) => tagList.filter(x => x.name === n);
  const assignTags = (id: string, ...names: string[]) => { const r = memberRows.find(x => x.userId === id); if (r) r.tags = names.flatMap(tagNamed); };
  assignTags(me.userId, 'טכני'); assignTags('m1', 'גבאי', 'ועד שמחות'); assignTags('u7', 'גזבר', 'ועד שמחות'); assignTags('u8', 'רב'); assignTags(U(23), 'חזן');
  if (screen === 'me' || screen === 'me-family' || screen === 'me-linked' || screen === 'me-man') kehila.tags = ['גזבר', 'ועד שמחות'].flatMap(tagNamed);
  const tagRows = () => tagList.map(x => ({ ...x, memberCount: memberRows.filter(r => r.tags.some(y => y.tagId === x.tagId)).length })).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  routes[`GET ${A}/requests`] = requests;
  routes[`GET ${A}/members`] = memberRows;
  routes[`GET ${A}/tags`] = tagRows();
  routes[`GET ${A}/groups`] = [
    { groupId: '01FIXTUREGROUP00000000001', name: 'נוער', memberCount: 3, channelCount: 1, adminCount: 1, pendingCount: 2 },
    { groupId: '01FIXTUREGROUP00000000002', name: 'שיעור הדף', memberCount: 2, channelCount: 0, adminCount: 0, pendingCount: 0 },
    { groupId: '01FIXTUREGROUP00000000003', name: 'נשים', memberCount: 0, channelCount: 0, adminCount: 0, pendingCount: 0 },
  ];
  // Groups: member-facing, and one group's screen (invented names).
  const K = `/v1/kehilot/${kehila.kehilaId}`;
  routes[`GET ${K}/groups`] = [
    { groupId: '01FIXTUREGROUP00000000001', name: 'נוער', isMember: true, isAdmin: false, requested: false },
    { groupId: '01FIXTUREGROUP00000000002', name: 'שיעור הדף', isMember: true, isAdmin: true, requested: false },
    { groupId: '01FIXTUREGROUP00000000003', name: 'נשים', isMember: false, isAdmin: false, requested: true },
    { groupId: '01FIXTUREGROUP00000000004', name: 'גברים', isMember: false, isAdmin: false, requested: false },
  ];
  routes[`GET ${K}/groups/01FIXTUREGROUP00000000001/members`] = [
    { userId: 'u7', displayName: 'רון לדוגמה', role: 'member', isAdmin: true },
    { userId: 'u8', displayName: 'מיכל בדויה', role: 'member', isAdmin: false },
    { userId: me.userId, displayName: 'דנה בדויה', role: 'gabbai', isAdmin: true },
  ];
  routes[`GET ${K}/groups/01FIXTUREGROUP00000000001/requests`] = [
    { userId: '01FIXTUREUSER00000000013', displayName: 'תמר הנחל', role: 'listener', createdAt: secs(now - 30 * H) },
    { userId: '01FIXTUREUSER00000000011', displayName: 'נועה בדויה', role: 'member', createdAt: secs(now - 5 * H) },
  ];
  routes[`GET ${K}/groups/01FIXTUREGROUP00000000002/requests`] = [];
  routes[`GET ${K}/groups/01FIXTUREGROUP00000000002/members`] = [{ userId: 'u8', displayName: 'מיכל בדויה', role: 'member', isAdmin: true }];
  routes[`PUT ${A}/settings`] = {};
  routes[`PUT ${A}/broadcast`] = {};
  routes[`PUT ${A}/push-texts`] = {};
  routes[`GET ${A}/push-texts`] = {
    defaults: {
      celebration: { he: 'מזל טוב חדש בקהילה', en: 'New mazal tov in your community' },
      reply: { he: 'ברכה חדשה', en: 'New blessing' },
    },
    custom: { celebration: { en: 'Mazal tov!' } },
  };
  routes[`GET /v1/kehilot/${kehila.kehilaId}`] = { ...kehila, settings: { pollSeconds: 60, maxListeners: screen === 'overview-privacy' ? 100 : 500 }, listenerCount: screen === 'overview-privacy' ? 42 : 37 };
  routes[`GET /v1/kehilot/${kehila.kehilaId}/invites`] = [
    ...(routes[`GET /v1/kehilot/${kehila.kehilaId}/invites`] as unknown[]),
    { code: '3B6D9F2HKM', role: 'member', usesLeft: 3, expiresAt: secs(now + 3 * 24 * H), mine: false },
  ];
  // Families, phone list and privacy (invented names; times are Unix seconds).
  const partner = { userId: '01FIXTUREUSER00000000005', displayName: 'יוסי בדיוני', me: false };
  const meAdult = { userId: me.userId, displayName: meName, me: true };
  // P2/P3 main state: three children, one without a birth date.
  const kids: Child[] = [
    { id: '01FIXTURECHILD00000000001', firstName: 'נועה', gender: 'f', birthDate: '2015-03-12' },
    { id: '01FIXTURECHILD00000000002', firstName: 'איתי', gender: 'm', birthDate: '2018-09-04' },
    { id: '01FIXTURECHILD00000000003', firstName: 'אורי', gender: 'm' },
  ];
  // `me-linked` is P2's main state and also P6's member-with-a-partner check; `child-sheet` has the same family.
  const linked = screen === 'me-linked' || screen === 'me-man' || screen === 'child-sheet' || screen === 'tree' || screen === 'tree-married';
  const ended = (state: 'declined' | 'expired') => ({ toUserId: partner.userId, toName: 'אבי מדומה', expiresAt: secs(now + 24 * H), state });
  const familyView: FamilyView = {
    familyId: '01FIXTUREFAMILY0000000001', name: 'בדיוני',
    adults: linked ? [meAdult, partner] : [meAdult],
    children: linked ? kids : [],
    sent: screen === 'tree-link-sent' ? { toUserId: partner.userId, toName: 'אבי מדומה', expiresAt: secs(now + 6 * 24 * H), state: 'pending' as const }
      : screen === 'tree-link-declined' ? ended('declined') : screen === 'tree-link-expired' ? ended('expired') : null,
    received: screen === 'me-request' ? [{ fromUserId: partner.userId, fromName: 'דנה בדיוני', expiresAt: secs(now + 6 * 24 * H) }]
      : screen === 'tree-link-received' ? [{ fromUserId: partner.userId, fromName: 'אבי מדומה', expiresAt: secs(now + 6 * 24 * H) }] : [],
    notice: null,
  };
  routes[`GET ${K}/family`] = familyView;
  // The family tree (UX-DESIGN §17): `?screen=tree | tree-married | tree-solo | tree-empty` (tree-admin is the gabbai's read-only view).
  routes[`GET ${K}/family/tree`] = { people: fixtureTreeFor(screen), version: 1 };
  routes[`PUT ${K}/family/tree`] = { version: 2 };
  for (const f of ['3', '4', '5', '6']) routes[`GET ${A}/families/01FIXTUREFAMILY000000000${f}/tree`] = { people: fixtureTreeFor(screen?.startsWith('tree') && screen !== 'tree-admin' ? screen : 'tree'), version: 1 };
  // Upcoming simchas (UX §17.14): `?screen=simchas | simchas-empty` (the Overview card: `?screen=simchas-card`). Dates are from server/cloud/simchas.py for 2026-10-28.
  const simchaWeeks: SimchaWeek[] = [
    { week: '2026-10-25', shabbat: '2026-10-31', parasha: 'וירא', label: 'שבת פרשת וירא', items: [{ kind: 'bar', firstName: 'הלל', surname: 'דוגמה', date: '2026-10-31', manual: false }] },
    { week: '2026-11-01', shabbat: '2026-11-07', parasha: 'חיי שרה', label: 'שבת פרשת חיי שרה', items: [] },
    { week: '2026-11-08', shabbat: '2026-11-14', parasha: 'תולדות', label: 'שבת פרשת תולדות', items: [{ kind: 'bat', firstName: 'נגה', surname: 'ניסיון', date: '2026-11-09', manual: false }] },
    { week: '2026-11-15', shabbat: '2026-11-21', parasha: 'ויצא', label: 'שבת פרשת ויצא', items: [{ kind: 'bar', firstName: 'עמית', surname: 'בדיוני', date: '2026-11-21', manual: true }] },
    { week: '2026-11-22', shabbat: '2026-11-28', parasha: 'וישלח', label: 'שבת פרשת וישלח', items: [{ kind: 'bat', firstName: 'אילה', surname: 'אלמוגי', date: '2026-11-25', manual: false }] },
    { week: '2026-11-29', shabbat: '2026-12-05', parasha: 'וישב', label: 'שבת פרשת וישב', items: [{ kind: 'bar', firstName: 'יונתן', surname: 'דמיון', date: '2026-12-05', manual: false }] },
    { week: '2026-12-06', shabbat: '2026-12-12', parasha: 'מקץ', label: 'שבת פרשת מקץ', items: [] },
    { week: '2026-12-13', shabbat: '2026-12-19', parasha: 'ויגש', label: 'שבת פרשת ויגש', items: [] },
  ];
  const withFamily = simchaWeeks.map(w => ({ ...w, items: w.items.map(i => ({ ...i, familyId: '01FIXTUREFAMILY0000000003' })) }));
  routes[`GET ${A}/simchas`] = { weeks: screen === 'simchas-empty' || screen === 'simchas-card-empty' ? simchaWeeks.map(w => ({ ...w, items: [] })) : withFamily };
  routes[`GET ${K}/family/candidates`] = [
    { userId: partner.userId, displayName: 'יוסי בדיוני' },
    { userId: '01FIXTUREUSER00000000006', displayName: 'יונתן דוגמה' },
    { userId: '01FIXTUREUSER00000000007', displayName: 'יואב ניסיון' },
    { userId: '01FIXTUREUSER00000000008', displayName: 'רותי דמיון' },
    { userId: '01FIXTUREUSER00000000009', displayName: 'מיכל דוגמה' },
  ];
  const phoneFamilies = screen === 'phone-list-empty' ? [] : [
    { familyId: '01FIXTUREFAMILY0000000002', name: 'אלמוני', people: [{ userId: 'u21', name: 'שרה אלמוני', phone: '+972500000005', tags: [] }] },
    { familyId: '01FIXTUREFAMILY0000000003', name: 'בדיוני', people: [{ userId: 'u22', name: 'דנה בדיוני', phone: '+972500000001', tags: ['ועד שמחות', 'גזבר'].flatMap(tagNamed) }, { userId: 'u23', name: 'יוסי בדיוני', phone: '+972500000002', tags: [] }] },
    { familyId: '01FIXTUREFAMILY0000000004', name: 'דוגמה', people: [{ userId: 'u24', name: 'מיכל דוגמה', phone: '+972500000003', tags: tagNamed('טכני') }] },
    { familyId: '01FIXTUREFAMILY0000000005', name: 'ניסיון · דמיון', people: [{ userId: 'u25', name: 'אבי ניסיון', phone: '+972500000004', tags: [] }, { userId: 'u26', name: 'רותי דמיון', phone: '+972500000006', tags: tagNamed('רב') }] },
  ];
  if (screen !== 'schedule-none' && screen !== 'schedule-editor-none') routes[`GET ${K}/schedule`] = fixtureLongRows(fixtureScheduleDoc(overrideFriday(israelDate(fixtureNow() ?? new Date()))));
  else routes[`GET ${K}/schedule`] = { version: 1, sections: [], weekOverrides: {}, sheet: { candleCities: [] }, location: { latitude: 32.0878, longitude: 34.8878, elevation: 'sea', candleMinutes: 40 }, updatedAt: null };
  routes[`GET ${K}/phone-list`] = phoneFamilies;
  routes[`PUT ${K}/me/phone-list`] = { show: true };
  routes[`GET ${K}/families`] = [
    { familyId: '01FIXTUREFAMILY0000000003', name: 'בדיוני', firstNames: ['דנה', 'יוסי'], targetMemberId: U(21) },
    { familyId: '01FIXTUREFAMILY0000000004', name: 'בן דמיון', firstNames: ['רון'], targetMemberId: 'u24' },
    { familyId: '01FIXTUREFAMILY0000000005', name: 'ניסיון · דמיון', firstNames: ['אבי', 'רותי'], targetMemberId: 'u25' },
  ];
  // P11: דנה and יוסי with three children, מיכל alone with one, and two members free to link.
  routes[`GET ${A}/families`] = [
    { familyId: '01FIXTUREFAMILY0000000003', name: 'בדיוני', adults: [{ userId: U(21), displayName: 'דנה בדיוני' }, { userId: U(22), displayName: 'יוסי בדיוני' }], children: [{ firstName: 'נועה', gender: 'f', birthYear: 2015 }, { firstName: 'איתי', gender: 'm', birthYear: 2018 }, { firstName: 'אורי', gender: 'm' }] },
    { familyId: '01FIXTUREFAMILY0000000004', name: 'דוגמה', adults: [{ userId: U(23), displayName: 'מיכל דוגמה' }], children: [{ firstName: 'תמר', gender: 'f', birthYear: 2019 }] },
    { familyId: '01FIXTUREFAMILY0000000005', name: 'ניסיון', adults: [{ userId: U(24), displayName: 'אבי ניסיון' }], children: [] },
    { familyId: '01FIXTUREFAMILY0000000006', name: 'אלמוני', adults: [{ userId: U(25), displayName: 'אברהם אלמוני' }], children: [] },
  ];
  routes[`POST ${A}/families/link`] = { familyId: familyView.familyId };
  routes[`POST ${A}/terms`] = { at: secs(now) };
  routes['PUT /v1/me/phone'] = { phone: '+972500000001' };
  routes['POST /v1/me/consents/age13'] = undefined;
  // P5: `privacy` is idle (no file yet), `privacy-ready` has a link.
  if (screen === 'privacy-ready') routes['GET /v1/me/export'] = { url: FIXTURE_PICTURE, expiresAt: secs(now + 600_000) };
  routes['POST /v1/reports'] = { reportId: '01FIXTUREREPORT0000000001' };
  routes['POST /v1/reports/anonymous'] = { reportId: '01FIXTUREREPORT0000000002' };
  routes['POST /v1/reports/upload'] = { uploadId: '01FIXTUREUPLOAD0000000001', url: 'https://upload.invalid/x', method: 'PUT', headers: {}, expiresAt: secs(now + 300_000) };
  routes['POST /v1/me/export'] = { url: FIXTURE_PICTURE, expiresAt: secs(now + 600_000) };
  routes[`POST ${K}/family/unlink`] = { ...familyView, adults: [meAdult] };
  routes[`POST ${K}/family/requests`] = { toUserId: partner.userId, expiresAt: secs(now + 7 * 24 * H) };
  routes[`DELETE ${K}/family/requests/mine`] = undefined;
  routes[`POST ${K}/family/requests/${partner.userId}/confirm`] = { ...familyView, adults: [meAdult, partner], received: [] };
  routes[`POST ${K}/family/requests/${partner.userId}/decline`] = undefined;
  routes[`POST ${K}/family/children`] = kids[0];
  routes[`PUT ${K}/family/children/${kids[0]!.id}`] = kids[0];
  routes[`PUT ${K}/family/children/${kids[1]!.id}`] = kids[1];
  routes[`DELETE ${K}/family/children/${kids[0]!.id}`] = undefined;
  routes[`DELETE ${K}/family/children/${kids[1]!.id}`] = undefined;
  for (const c of ['gabbai_link', 'imported', 'phone', 'seat_link']) routes[`POST ${K}/me/cards/${c}/dismiss`] = undefined;
  // The schedule is kept in memory so the editor's saves show up on the next read; `?conflict=1` makes the first save answer 409
  // (somebody else saved: their copy has another Maariv time).
  let scheduleDoc = structuredClone(routes[`GET ${K}/schedule`]) as ScheduleDoc;
  let conflictPending = typeof window !== 'undefined' && !!window.location && new URLSearchParams(window.location.search).get('conflict') === '1';
  // Seating editor (fixture builds): holders and layouts are kept in memory, so a save shows up on the next read.
  const holdersFx = !!screen && (screen.startsWith('seat-upload') || screen === 'seat-holders' || screen === 'seat-link' || screen === 'seat-approval');
  let seatHolders: Array<{ holderId: string; name: string; phone: string | null; createdAt: number; updatedAt: number }> = holdersFx ? fixtureHolders() : [{ holderId: '01FIXTUREHOLDER00000000001', name: 'משפחת מדומה', phone: null, createdAt: 1_780_000_000_000, updatedAt: 1_780_000_000_000 }];
  const uploadFx = screen?.startsWith('seat-upload') ? createUploadFixture(shabbatFriday(fixtureNow() ?? new Date())) : null;
  let linkSuggestions = fixtureLinkSuggestions().suggestions;
  type SeatVersion = { body: Record<string, unknown>; seats: Array<{ id: string; row: number; col: number }>; updatedAt: number; asg: Record<string, string>; asgAt: number | null };
  const seatLayouts = new Map<string, SeatVersion>();
  const seatId = (row: number, col: number) => `s${String(row).padStart(3, '0')}${String(col).padStart(3, '0')}`;
  const seatsOfBody = (cells: string[][]) => { const out: Array<{ id: string; row: number; col: number }> = []; cells.forEach((r, row) => r.forEach((kind, col) => { if (kind === 'seat') out.push({ id: seatId(row, col), row, col }); })); return out; };
  // `?screen=seat-map`: three saved versions of an invented hall (one past, one in effect, one scheduled); `&conflict=1` makes the first layout save answer 409
  // after "another gabbai" saved (a few seats moved), so the conflict dialog can be shot.
  // Seat release (weekly): the preview flag serves the fixture hall in the server's wire shapes; without it there is no layout.
  // `&nolayout=1` serves no layout (the print screen's empty state).
  const noLayout = typeof window !== 'undefined' && !!window.location && new URLSearchParams(window.location.search).get('nolayout') === '1';
  const seatsFx = config.seatsPreview && !noLayout ? createSeatsFixture(seatVariantOf(screen), card, shabbatFriday(fixtureNow() ?? new Date())) : null;
  const seatsWeekFixture = (method: string, path: string, body: unknown): unknown => {
    const p = path.split('?')[0]!;
    const week = /\/seats\/week\//.test(p);
    if (p === `${K}/seats/me`) {
      if (method === 'PUT') { if (!seatsFx) throw new ApiCodeError(404, 'no_seats'); return seatsFx.putMine(body as never); }
      return seatsFx ? seatsFx.memberWire() : { week: shabbatFriday(new Date()), deadline: new Date().toISOString(), open: true, remindable: true, hadSeats: false, seats: 0 };
    }
    if (week) {
      if (!seatsFx) throw new ApiCodeError(404, 'layout_not_found');
      return method === 'PUT' ? seatsFx.putWeek(body as never) : seatsFx.adminWeek();
    }
    return undefined;
  };
  const mineFx = typeof window !== 'undefined' && !!window.location && new URLSearchParams(window.location.search).get('mine') === '1';
  let seatConflictPending = typeof window !== 'undefined' && !!window.location && new URLSearchParams(window.location.search).get('conflict') === '1';
  if (screen === 'seat-holders' || screen === 'seat-link') {
    const hl = fixtureHolderLayout();
    seatLayouts.set('2026-01-02', { body: hl.body as unknown as Record<string, unknown>, seats: hl.seats, updatedAt: 1_780_000_000_000, asg: hl.asg, asgAt: 1_780_000_000_000 });
  }
  if (screen === 'seat-map') {
    const m = fixtureMap();
    const seats = seatsOfBody(m.layout.cells);
    const asgOf = (assign: Record<string, string>) => Object.fromEntries(Object.entries(assign).map(([p, ref]) => { const [r, c] = p.split(':').map(Number); return [seatId(r!, c!), ref]; }));
    const base = asgOf(m.assign);
    const ids = seats.map((x) => x.id);
    const later = { ...base };
    for (const id of ids.slice(0, 6)) delete later[id];
    seatLayouts.set('2026-09-04', { body: m.layout as unknown as Record<string, unknown>, seats, updatedAt: 1_788_000_000_000, asg: later, asgAt: 1_788_000_000_000 });
    seatLayouts.set('2026-10-09', { body: m.layout as unknown as Record<string, unknown>, seats, updatedAt: 1_791_000_000_000, asg: base, asgAt: 1_791_000_000_000 });
    seatLayouts.set('2026-11-13', { body: m.layout as unknown as Record<string, unknown>, seats, updatedAt: 1_792_000_000_000, asg: base, asgAt: 1_792_000_000_000 });
  }
  const seatingFixture = (method: string, path: string, body: unknown): unknown => {
    const p = path.split('?')[0]!;
    // `&mine=1`: the signed-in gabbai has a family that matches the map's holder ("זה אני")
    if (p === `${A}/families`) return screen === 'seat-map' ? [...fixtureMapFamilies(), ...(mineFx ? [{ familyId: '01FIXTUREMAPFAMMINE0000001', name: 'מדומה', adults: [{ userId: me.userId, displayName: 'דנה מדומה' }], children: [] }] : [])] : holdersFx ? fixtureHolderFamilies() : fixtureSeatFamilies();
    if (p === `${A}/seating/holders`) {
      if (method === 'GET') return structuredClone(seatHolders);
      const b = body as { name: string; phone?: string };
      const h = { holderId: fixtureUlid(Date.now() + seatHolders.length, 40), name: b.name, phone: b.phone ?? null, createdAt: Date.now(), updatedAt: Date.now() };
      seatHolders = [...seatHolders, h]; return h;
    }
    if (p === `${A}/seating/link-suggestions`) return !holdersFx && (screen === 'overview' || screen?.startsWith('area')) ? { count: 2, suggestions: [] } : holdersFx ? { count: linkSuggestions.length, suggestions: structuredClone(linkSuggestions) } : { count: 0, suggestions: [] };
    const hs = /\/seating\/holders\/([^/]+)\/seats$/.exec(p);
    if (hs && method === 'GET') {
      if (!seatHolders.some((x) => x.holderId === hs[1])) throw new ApiCodeError(404, 'holder_not_found');
      const current = shabbatFriday(fixtureNow() ?? new Date());
      const versions = [...seatLayouts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([effectiveFrom, v]) => ({ effectiveFrom, seats: Object.values(v.asg).filter((r) => r === `holder:${hs[1]}`).length, past: effectiveFrom < current }))
        .filter((v) => v.seats > 0);
      return { total: versions.reduce((n, v) => n + v.seats, 0), versions };
    }
    const hm = /\/seating\/holders\/([^/]+)(\/link)?$/.exec(p);
    if (hm) {
      const h = seatHolders.find((x) => x.holderId === hm[1]);
      if (!h) throw new ApiCodeError(404, 'holder_not_found');
      if (method === 'DELETE') { for (const v of seatLayouts.values()) for (const [id, ref] of Object.entries(v.asg)) if (ref === `holder:${h.holderId}`) delete v.asg[id]; seatHolders = seatHolders.filter((x) => x !== h); linkSuggestions = linkSuggestions.filter((x) => x.holderId !== h.holderId); return undefined; }
      if (method === 'PUT') { const b = body as { name: string; phone?: string }; Object.assign(h, { name: b.name, phone: b.phone ?? null, updatedAt: Date.now() }); return structuredClone(h); }
      if (method === 'POST' && hm[2]) {
        const b = body as { familyId: string; ifUpdatedAt?: number };
        if (b.ifUpdatedAt !== undefined && b.ifUpdatedAt !== h.updatedAt) throw new ApiCodeError(409, 'holder_changed');
        let moved = 0;
        for (const v of seatLayouts.values()) for (const [id, ref] of Object.entries(v.asg)) if (ref === `holder:${h.holderId}`) { v.asg[id] = `family:${b.familyId}`; moved++; }
        seatHolders = seatHolders.filter((x) => x !== h); linkSuggestions = linkSuggestions.filter((x) => x.holderId !== h.holderId);
        return { familyId: b.familyId, seats: moved };
      }
    }
    if (p === `${A}/seating/layouts` && method === 'GET') {
      const today = israelDate(fixtureNow() ?? new Date());
      const inEffect = [...seatLayouts.keys()].filter((f) => f <= today).sort().pop();
      return { layouts: [...seatLayouts.entries()].map(([effectiveFrom, l]) => ({ effectiveFrom, updatedAt: l.updatedAt, seats: l.seats.length, assigned: Object.keys(l.asg).length, current: effectiveFrom === inEffect })).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)) };
    }
    const m = /\/seating\/layouts\/([^/]+)(\/assignments)?$/.exec(p);
    if (m && !m[2] && method === 'GET') {
      const v = seatLayouts.get(m[1]!);
      if (!v) throw new ApiCodeError(404, 'layout_not_found');
      return { ...v.body, effectiveFrom: m[1], seats: v.seats, updatedAt: v.updatedAt };
    }
    if (m && !m[2] && method === 'PUT') {
      const b = body as { cells: string[][]; ifUpdatedAt: number | null };
      const old = seatLayouts.get(m[1]!);
      if (seatConflictPending) {
        // "another gabbai" saved this date first: a copy of the version in effect, with three seats freed and two given to the holder
        seatConflictPending = false;
        const src = old ?? seatLayouts.get([...seatLayouts.keys()].filter((f) => f < m[1]!).sort().pop() ?? '');
        if (src) {
          const moved = { ...src.asg };
          const ids = src.seats.map((x) => x.id).filter((id) => moved[id]);
          for (const id of ids.slice(40, 43)) delete moved[id];
          const free = src.seats.map((x) => x.id).filter((id) => !moved[id]);
          for (const id of free.slice(0, 2)) moved[id] = 'holder:01FIXTUREHOLDER00000000001';
          const at = Date.now() - 20 * 60_000;
          seatLayouts.set(m[1]!, { ...src, asg: moved, updatedAt: at, asgAt: at });
          throw new ApiCodeError(409, 'layout_changed');
        }
      }
      if ((old?.updatedAt ?? null) !== b.ifUpdatedAt) throw new ApiCodeError(409, 'layout_changed');
      const seats = seatsOfBody(b.cells);
      const updatedAt = Math.max(Date.now(), (old?.updatedAt ?? 0) + 1);
      const keep = new Set(seats.map((x) => x.id));
      // a new version starts from the assignments of the latest earlier one; a seat that is gone loses its holder
      const from = old?.asg ?? seatLayouts.get([...seatLayouts.keys()].filter((f) => f < m[1]!).sort().pop() ?? '')?.asg ?? {};
      seatLayouts.set(m[1]!, { body: b as Record<string, unknown>, seats, updatedAt, asg: Object.fromEntries(Object.entries(from).filter(([id]) => keep.has(id))), asgAt: updatedAt });
      return { ...(b as object), effectiveFrom: m[1], seats, updatedAt };
    }
    if (m && m[2] && method === 'GET') { const v = seatLayouts.get(m[1]!); if (!v) throw new ApiCodeError(404, 'layout_not_found'); return { assignments: structuredClone(v.asg), updatedAt: v.asgAt }; }
    if (m && m[2] && method === 'PUT') {
      const v = seatLayouts.get(m[1]!);
      if (!v) throw new ApiCodeError(404, 'layout_not_found');
      const b = body as { assignments: Record<string, string | null>; ifUpdatedAt: number | null };
      if (b.ifUpdatedAt !== v.asgAt) throw new ApiCodeError(409, 'assignments_changed');
      const asg = { ...v.asg };
      for (const [id, ref] of Object.entries(b.assignments)) { if (ref) asg[id] = ref; else delete asg[id]; }
      v.asg = asg; v.asgAt = Math.max(Date.now(), (v.asgAt ?? 0) + 1);
      return { updatedAt: v.asgAt };
    }
    throw new ApiCodeError(404, 'not_found');
  };
  const http: Http = {
    async request(method, path, body) {
      if (path.split('?')[0] === `${K}/schedule`) {
        if (method === 'GET') return structuredClone(scheduleDoc) as any;
      }
      if (path === `${A}/schedule` && method === 'PUT') {
        if (conflictPending) {
          conflictPending = false;
          scheduleDoc = { ...scheduleDoc, updatedAt: (scheduleDoc.updatedAt ?? 0) + 60_000, sections: scheduleDoc.sections.map(s => ({ ...s, rows: s.rows.map(r => (r.id === 'w-arvit' ? { ...r, time: { kind: 'fixed' as const, at: '17:20' } } : r)) })) };
          throw new ApiCodeError(409, 'schedule_changed');
        }
        const b = body as { sections: ScheduleDoc['sections']; ifUpdatedAt: number | null };
        if (b.ifUpdatedAt !== scheduleDoc.updatedAt) throw new ApiCodeError(409, 'schedule_changed');
        scheduleDoc = { ...scheduleDoc, sections: b.sections, updatedAt: (scheduleDoc.updatedAt ?? 0) + 1000 };
        return { updatedAt: scheduleDoc.updatedAt, warnings: [] } as any;
      }
      if (path.startsWith(`${A}/schedule/weeks/`)) {
        const friday = decodeURIComponent(path.slice(`${A}/schedule/weeks/`.length));
        scheduleDoc = { ...scheduleDoc, weekOverrides: { ...scheduleDoc.weekOverrides } };
        if (method === 'PUT') { scheduleDoc.weekOverrides[friday] = body as ScheduleDoc['weekOverrides'][string]; return {} as any; }
        if (method === 'DELETE') { delete scheduleDoc.weekOverrides[friday]; return undefined as any; }
      }
      if (uploadFx && path.startsWith(`${A}/seats/week/`)) {
        const p = path.split('?')[0]!;
        if (method === 'POST' && p.endsWith('/responses/undo')) return uploadFx.undoApply((body as { event: 'erev' | 'day' }).event) as any;
        if (method === 'POST' && p.endsWith('/responses')) return uploadFx.apply(body as never) as any;
        if (method === 'GET') return uploadFx.adminWeek() as any;
      }
      if (path.split('?')[0] === `${K}/seats/me` || path.startsWith(`${A}/seats/week/`)) return seatsWeekFixture(method, path, body) as any;
      if (path.includes('/admin/seating/') || ((screen?.startsWith('seat-editor') || screen === 'seat-map' || holdersFx) && path === `${A}/families`)) return seatingFixture(method, path, body) as any;
      if (method === 'GET' && path === '/v1/me/export' && !('GET /v1/me/export' in routes)) throw new ApiCodeError(404, 'export_not_found');
      if (method === 'GET' && path === '/v1/invites/4D8F2H6NRT') throw new ApiCodeError(410, 'invite_expired');
      const key = `${method} ${path.split('?')[0]}`;
      if (screen === 'search-loading' && method === 'GET' && key.endsWith('/messages') && path.includes('before=')) throw new ApiCodeError(503, 'network');
      if (method === 'GET' && key.endsWith('/members') && !key.includes('/admin/') && !key.includes('/groups/')) return [{ userId: '01FIXTUREUSER00000000002', displayName: 'משפחת בדיוני' }, { userId: '01FIXTUREUSER00000000003', displayName: 'משפחת לדוגמה' }, { userId: '01FIXTUREUSER00000000004', displayName: 'משפחת הנחל' }] as any;
      if (method === 'POST' && key.endsWith('/messages')) {
        const b = (body ?? {}) as Partial<Message>;
        return { messageId: fixtureUlid(Date.now(), 30), channelId: b.channelId ?? cAnn, type: b.type ?? 'chat', title: b.title ?? '', body: b.body ?? '', authorId: me.userId, authorName: 'דנה בדויה', authorKind: isManagement(role) ? 'management' : 'member', joinCount: 0 } as any;
      }
      if (method === 'POST' && key.endsWith('/replies')) {
        const text = String((body as { body?: unknown } | undefined)?.body ?? '');
        return { replyId: fixtureUlid(Date.now(), 31), authorId: me.userId, authorName: 'דנה בדויה', body: text, createdAt: secs(Date.now()) } as any;
      }
      if (/\/(admin\/)?groups(\/|$)/.test(key) && method !== 'GET') return (method === 'DELETE' || method === 'PUT' && /\/admins\//.test(key) ? undefined : {}) as any;
      if (method === 'PUT' && /\/chat-settings$/.test(key)) return {} as any;
      if (method === 'POST' && /\/family\/requests\/[^/]+\/confirm$/.test(key)) return { ...familyView, adults: [meAdult, partner], received: [] } as any;
      if (method === 'POST' && /\/family\/requests\/[^/]+\/decline$/.test(key)) return undefined as any;
      if (method === 'POST' && /\/family\/children$/.test(key)) { const b = (body ?? {}) as Partial<Child>; return { id: fixtureUlid(Date.now(), 29), firstName: b.firstName ?? '', gender: b.gender ?? 'm', ...(b.birthDate ? { birthDate: b.birthDate } : {}) } as any; }
      if (method === 'PUT' && /\/family\/children\/[^/]+$/.test(key)) return { id: key.split('/').pop(), ...(body as object) } as any;
      if (method === 'DELETE' && /\/family\/children\/[^/]+$/.test(key)) return undefined as any;
      if (method === 'POST' && /\/admin\/requests\/[^/]+\/(approve|reject)$/.test(key)) return {} as any;
      // Tags are kept in memory so adding, renaming, deleting and assigning work in the fixture build.
      if (/\/admin\/tags(\/|$)/.test(key) || /\/admin\/members\/[^/]+\/tags$/.test(key)) {
        const name = String((body as { name?: unknown } | undefined)?.name ?? '').trim();
        const id = key.split('/').pop()!;
        if (method === 'GET') return tagRows() as any;
        if (method === 'POST') {
          if (tagList.length >= 20) throw new ApiCodeError(409, 'too_many_tags');
          if (tagList.some(x => x.name.toLowerCase() === name.toLowerCase())) throw new ApiCodeError(409, 'tag_exists');
          const created = { tagId: `01FIXTURETAG0000000${String(100 + Math.floor(Math.random() * 900))}`, name }; tagList = [...tagList, created]; return created as any;
        }
        if (method === 'PUT' && /\/members\//.test(key)) {
          const u = key.split('/')[key.split('/').length - 2]!;
          const ids = ((body as { tagIds?: string[] } | undefined)?.tagIds ?? []);
          const r = memberRows.find(x => x.userId === u); if (!r) throw new ApiCodeError(404, 'member_not_found');
          r.tags = tagList.filter(x => ids.includes(x.tagId)); return { tags: structuredClone(r.tags) } as any;
        }
        if (method === 'PUT') {
          if (tagList.some(x => x.tagId !== id && x.name.toLowerCase() === name.toLowerCase())) throw new ApiCodeError(409, 'tag_exists');
          tagList = tagList.map(x => (x.tagId === id ? { ...x, name } : x)); for (const r of memberRows) r.tags = r.tags.map(x => (x.tagId === id ? { ...x, name } : x));
          return { tagId: id, name } as any;
        }
        if (method === 'DELETE') { tagList = tagList.filter(x => x.tagId !== id); for (const r of memberRows) r.tags = r.tags.filter(x => x.tagId !== id); return undefined as any; }
      }
      if (method === 'GET' && /\/admin\/members$/.test(key)) return structuredClone(memberRows) as any;
      if (method === 'PUT' && /\/admin\/members\/[^/]+$/.test(key)) return {} as any;
      if (method === 'DELETE' && /\/admin\/members\/[^/]+$/.test(key)) return undefined as any;
      if (method === 'DELETE' && /\/invites\/[^/]+$/.test(key)) return undefined as any;
      if (key in routes && routes[key] === undefined) return undefined as any;
      const hit = routes[key];
      if (hit === undefined) throw new ApiCodeError(404, 'not_found');
      return structuredClone(hit) as any;
    },
  };
  return endpoints(http);
}
