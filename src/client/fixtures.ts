import { config } from '../config.ts';
import { ApiCodeError } from './errors.ts';
import { endpoints } from './endpoints.ts';
import type { Http } from './http.ts';
import type { Shabbat, Zmanim } from '../types.ts';
import { HALL, allSeats, seatKey } from '../seats/hall.ts';
import type { Hall, SeatRef } from '../seats/hall.ts';
import { memberView } from '../seats/frame.ts';
import type { Allocation, MemberSeats } from '../seats/frame.ts';
import type { Prayer } from '../seats/release.ts';
import { dayOfWeek, israelDate, upcomingFriday } from '../dates.ts';
import { addDays } from '../schedule/week.ts';
import { israelInstant } from '../seats/window.ts';
import type { Formula, Row, ScheduleDoc } from '../schedule/types.ts';
import type { Channel, Child, FamilyView, Kehila, Lang, Message, MessageType, Reply, Role, RoleTag } from './types.ts';

export type FixtureParams = { role: Role; lang: Lang | null; screen: string | null; card: string | null };

/** Fixture mode is for screenshots and demos only: it must never run beside a real API. */
export function assertFixturesAllowed(apiUrl: string = config.apiUrl): void {
  if (apiUrl) throw new Error('EXPO_PUBLIC_FIXTURES and EXPO_PUBLIC_API_URL are both set');
}

/** Screens that open the signed-in app at once (the others are for the sign-in screens). */
/** Screens for the P-frames. `me-linked` is P2's main state and P6's member-with-a-partner check;
 *  `leave-listener` is P6's guest listener; `home-card` takes `&card=` (P7). */
export const FRAME_SCREENS = ['phone-list', 'phone-list-empty', 'me', 'me-family', 'me-request', 'me-linked', 'partner-picker', 'child-sheet', 'privacy', 'privacy-ready', 'kehila-info', 'leave-listener', 'home-card', 'age13', 'age13-under', 'terms', 'delete', 'delete-ticked', 'admin-families', 'admin-link', 'overview-privacy', 'compose-family'];

export const FIXTURE_APP_SCREENS = ['profile', 'switcher', 'home', 'me', 'messages', 'messages-all', 'm3', 'm3b', 'm3target', 'chat', 'search-loading', 'compose', 'compose-target', 'compose-image', 'm5', 'overview', 'approvals', 'members', 'invite-member', 'groups', 'channels', 'channel-sheet', 'group-admin', 'import',
  'phone-list', 'phone-list-empty', 'me-family', 'me-request', 'me-linked', 'partner-picker', 'child-sheet', 'privacy', 'privacy-ready', 'kehila-info', 'leave-listener', 'home-card', 'age13', 'age13-under', 'terms', 'profile-age', 'delete', 'delete-ticked', 'admin-families', 'admin-link', 'overview-privacy', 'compose-family', 'tags-manage', 'tags-assign', 'tags-empty', 'schedule', 'schedule-none', 'seats', 'seats-split', 'seats-none', 'seats-closed', 'seats-gabbai', 'seat-print'];

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
    role: role === 'listener' || role === 'gabbai' ? role : 'member',
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
  const meFirst = card === 'request' || screen === 'me-request' ? 'יוסי' : screen === 'leave-listener' ? 'רון' : 'דנה';
  const meLast = screen === 'leave-listener' ? 'אורח' : 'בדיוני';
  const meName = `${meFirst} ${meLast}`;
  const PRIVACY_CONTACT = 'עמית דוגמה, גבאי · pratiyut@example.org';
  const TERMS_AT = Math.floor(Date.parse('2026-10-27T10:00:00+02:00') / 1000);
  // P4 main state: a number on file and the switch on. P1 empty: a number, switch off.
  const phoneOn = !!screen && ['me', 'me-family', 'me-request', 'me-linked', 'child-sheet', 'partner-picker', 'phone-list'].includes(screen);
  const hasPhone = phoneOn || screen === 'phone-list-empty' || card === 'phone';
  const kehila: Kehila = {
    kehilaId: '01FIXTUREKEHILA0000000001', name: screen === 'leave-listener' ? 'מניין נווה דמיון' : frame ? 'קהילת אור הדוגמה' : 'קהילת בדיוני', role, classification: '', logoVersion: null,
    canBroadcast: role === 'gabbai', pendingRequest: false,
    // ?screen=m5 shows M5 with some choices already made (one muted channel, type and member).
    notify: screen === 'm5'
      ? { mutedChannels: ['01FIXTURECHANNEL00000002'], mutedTypes: ['event'], membersBroadcasts: 'management_only', mutedMembers: ['m1'], chatChannels: [] }
      : { mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [] },
    // A listener admitted to the youth group reads its channel and posts in its chat (spec §3c).
    groups: role === 'listener' ? ['01FIXTUREGROUP00000000001'] : [], adminGroups: [], tags: [] as RoleTag[], settings: { pollSeconds: 60 },
    privacyContact: screen === 'kehila-info' || screen === 'overview-privacy' || screen === 'privacy' || screen === 'privacy-ready' ? PRIVACY_CONTACT : '',
    showPhone: phoneOn,
    cards: {
      gabbaiLink: card === 'gabbai' ? { gabbaiName: 'עמית דוגמה', partnerName: 'דנה בדיוני' } : null,
      request: card === 'request' ? { fromUserId: '01FIXTUREUSER00000000005', fromName: 'דנה בדיוני' } : null,
      imported: card === 'imported',
      phoneAsk: card === 'phone' || card === 'phone-nonumber',
      terms: role === 'gabbai' && (screen === 'terms' || card === 'terms'),
    },
    ...(role === 'gabbai' ? { typeRules: { celebration: { post: 'broadcasters' as const, listeners: false }, condolence: { post: 'management' as const, listeners: true } } } : {}),
    ...(role === 'gabbai' ? { termsAccepted: screen === 'terms' || card === 'terms' ? null : { name: 'עמית דוגמה', at: TERMS_AT } } : {}),
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
      ...(screen === 'switcher' ? [
        { kehilaId: '01FIXTUREKEHILA0000000002', name: 'בית כנסת הדוגמה', role: 'gabbai' as Role, logoVersion: null },
        { kehilaId: '01FIXTUREKEHILA0000000003', name: 'קהילת הנחל המצויר', role: 'listener' as Role, logoVersion: null },
      ] : []),
    ],
  };
  // The Compose screens show a member who may broadcast (a plain member has no Compose at all).
  const broadcaster = role === 'gabbai' || (role === 'member' && !!screen && screen.startsWith('compose'));
  // What the server computes per channel: all five for a gabbai, general + the two configurable types for a broadcaster.
  const postable = (): MessageType[] => (role === 'gabbai' ? ['general', 'weekly', 'event', 'celebration', 'condolence'] : broadcaster ? ['general', 'celebration', 'condolence'] : []);
  const ch = (channelId: string, name: string, over: Partial<Channel> = {}) => ({
    channelId, name, listenersCanRead: true, postPolicy: 'management' as const, canPost: role === 'gabbai', inAudience: true,
    conversation: false, chatHourlyLimit: 0, isAdmin: role === 'gabbai', postableTypes: [] as MessageType[], ...over,
  });
  const allChannels = [
    // The one main channel (stored name `announcements`, shown through channelLabel()); members with broadcast permission post here.
    ch('01FIXTURECHANNEL00000001', 'announcements', { postPolicy: 'broadcasters', canPost: broadcaster, postableTypes: postable() }),
    // A group's channel: listeners do not read it.
    ch('01FIXTURECHANNEL00000002', 'שיעור הדף', { listenersCanRead: false, inAudience: role !== 'listener', ...(role === 'gabbai' ? { groups: ['01FIXTUREGROUP00000000002'], postableTypes: postable() } : {}) }),
    // The server never returns the whole-Kehila chat to a listener; the one it returns is the admitted group's chat.
    ch('01FIXTURECHANNEL00000003', role === 'listener' ? 'שיחת קבוצת הנוער' : 'שיחת הקהילה', { conversation: true, listenersCanRead: role === 'listener' ? false : true, canPost: true, chatHourlyLimit: 30, ...(role === 'gabbai' ? { groups: ['01FIXTUREGROUP00000000001'] } : {}) }),
    ...(role === 'gabbai' ? [ch('01FIXTURECHANNEL00000004', 'קבוצת הנוער', { inAudience: false, postableTypes: postable() })] : []),
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
    ...(role === 'gabbai' ? [mk(4 * H, 8, { channelId: cYouth, type: 'weekly', title: 'מפגש נוער בשבת', body: 'הודעה בקבוצה שאינה בקהל שלי.' })] : []),
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
    if (role === 'gabbai' && m.targetMemberId !== me.userId) return [];
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
  const adminFam = screen === 'admin-families' || screen === 'admin-link';
  const U = (n: number) => `01FIXTUREUSER000000000${n}`;
  const memberRows = adminFam ? [
    { userId: U(21), displayName: 'דנה בדיוני', role: 'member', classification: 'א', canBroadcast: true, groups: [], tags: [] },
    { userId: U(22), displayName: 'יוסי בדיוני', role: 'member', classification: '', canBroadcast: false, groups: [], tags: [] as RoleTag[] },
    { userId: U(23), displayName: 'מיכל דוגמה', role: 'member', classification: 'קבוע', canBroadcast: true, groups: [], tags: [] as RoleTag[] },
    { userId: U(24), displayName: 'אבי ניסיון', role: 'member', classification: '', canBroadcast: false, groups: [], tags: [] as RoleTag[] },
    { userId: U(25), displayName: 'אברהם אלמוני', role: 'member', classification: '', canBroadcast: false, groups: [], tags: [] as RoleTag[] },
  ] : [
    { userId: me.userId, displayName: 'דנה בדויה', role: 'gabbai', classification: 'קבוע', canBroadcast: true, groups: ['01FIXTUREGROUP00000000001'], tags: [] as RoleTag[] },
    { userId: 'm1', displayName: 'יוסי לדוגמה', role: 'gabbai', classification: 'א', canBroadcast: true, groups: [], tags: [] as RoleTag[] },
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
  if (screen === 'me' || screen === 'me-family' || screen === 'me-linked') kehila.tags = ['גזבר', 'ועד שמחות'].flatMap(tagNamed);
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
  const linked = screen === 'me-linked' || screen === 'child-sheet';
  const familyView: FamilyView = {
    familyId: '01FIXTUREFAMILY0000000001', name: 'בדיוני',
    adults: linked ? [meAdult, partner] : [meAdult],
    children: linked ? kids : [],
    sent: null,
    received: screen === 'me-request' ? [{ fromUserId: partner.userId, fromName: 'דנה בדיוני', expiresAt: secs(now + 6 * 24 * H) }] : [],
    notice: null,
  };
  routes[`GET ${K}/family`] = familyView;
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
  if (screen !== 'schedule-none') routes[`GET ${K}/schedule`] = fixtureLongRows(fixtureScheduleDoc(overrideFriday(israelDate(fixtureNow() ?? new Date()))));
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
  for (const c of ['gabbai_link', 'imported', 'phone']) routes[`POST ${K}/me/cards/${c}/dismiss`] = undefined;
  const http: Http = {
    async request(method, path, body) {
      if (method === 'GET' && path === '/v1/me/export' && !('GET /v1/me/export' in routes)) throw new ApiCodeError(404, 'export_not_found');
      if (method === 'GET' && path === '/v1/invites/4D8F2H6NRT') throw new ApiCodeError(410, 'invite_expired');
      const key = `${method} ${path.split('?')[0]}`;
      if (screen === 'search-loading' && method === 'GET' && key.endsWith('/messages') && path.includes('before=')) throw new ApiCodeError(503, 'network');
      if (method === 'GET' && key.endsWith('/members') && !key.includes('/admin/') && !key.includes('/groups/')) return [{ userId: '01FIXTUREUSER00000000002', displayName: 'משפחת בדיוני' }, { userId: '01FIXTUREUSER00000000003', displayName: 'משפחת לדוגמה' }, { userId: '01FIXTUREUSER00000000004', displayName: 'משפחת הנחל' }] as any;
      if (method === 'POST' && key.endsWith('/messages')) {
        const b = (body ?? {}) as Partial<Message>;
        return { messageId: fixtureUlid(Date.now(), 30), channelId: b.channelId ?? cAnn, type: b.type ?? 'chat', title: b.title ?? '', body: b.body ?? '', authorId: me.userId, authorName: 'דנה בדויה', authorKind: role === 'gabbai' ? 'management' : 'member', joinCount: 0 } as any;
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


// --- Seat-release preview (UX-DESIGN §15; the seats are the gabbai-side data, the member only ever gets memberView's cut) ---
// All names are invented.
export type SeatVariant = 'default' | 'split' | 'none' | 'closed' | 'gabbai';
const SURNAMES = ['בדיוני', 'דוגמה', 'ניסוי', 'אלמוני', 'פלוני', 'מדומה', 'קהילתי', 'ניסיון', 'דגמי', 'שמי', 'תבנית', 'דמיוני', 'אקראי', 'מקרי', 'פיקטיבי'];
const MINE: Record<'default' | 'split', SeatRef[]> = {
  default: [{ block: 'CR', row: 6, col: 1 }, { block: 'CR', row: 6, col: 2 }, { block: 'CR', row: 6, col: 3 }],
  split: [{ block: 'R', row: 2, col: 0 }, { block: 'CR', row: 6, col: 2 }, { block: 'CR', row: 6, col: 3 }],
};

/** The whole hall for the gabbai: fixed pseudo-random households over the 205 seats (about one in eight stays unallocated) and what each prayer released. */
export function fixtureSeatHall(hall: Hall = HALL): { hall: Hall; allocations: Allocation[]; released: Record<Prayer, Set<string>> } {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const taken = new Set([...MINE.default, ...MINE.split].map(seatKey));
  const allocations: Allocation[] = [{ householdId: 'me', name: 'דוגמה', seats: MINE.default }];
  let current: Allocation | null = null;
  let left = 0;
  let n = 0;
  for (const seat of allSeats(hall)) {
    const key = seatKey(seat);
    if (taken.has(key)) { current = null; continue; }
    if (rnd() < 0.13) { current = null; continue; }
    if (!current || left === 0) {
      n++;
      current = { householdId: `h${n}`, name: SURNAMES[n % SURNAMES.length]!, seats: [] };
      left = 1 + Math.floor(rnd() * 3);
      allocations.push(current);
    }
    current.seats.push(seat); left--;
  }
  const released: Record<Prayer, Set<string>> = { arvit: new Set(), shacharit: new Set() };
  for (const a of allocations.slice(1)) for (const s of a.seats) {
    if (rnd() < 0.15) released.arvit.add(seatKey(s));
    if (rnd() < 0.25) released.shacharit.add(seatKey(s));
  }
  return { hall, allocations, released };
}

export type FixtureMemberSeats = MemberSeats & { closed: boolean; source: 'member' | 'gabbai'; answers: Record<Prayer, string[]> };
/** What the member page receives in the preview: his frames cut from the gabbai-side hall, and his current answers. */
export function fixtureMemberSeats(variant: SeatVariant = 'default'): FixtureMemberSeats {
  const h = fixtureSeatHall();
  const me = h.allocations[0]!;
  const seats = variant === 'split' ? MINE.split : variant === 'none' ? [] : MINE.default;
  const allocations = [{ ...me, seats }, ...h.allocations.slice(1)];
  const cut = memberView(h.hall, allocations, 'me');
  const mineKeys = seats.map(seatKey);
  const answers: Record<Prayer, string[]> = variant === 'gabbai' ? { arvit: [mineKeys[2]!], shacharit: [] } : { arvit: [], shacharit: [] };
  return { ...cut, closed: variant === 'closed', source: variant === 'gabbai' ? 'gabbai' : 'member', answers };
}

export function seatVariantOf(screen: string | null): SeatVariant {
  return screen === 'seats-split' ? 'split' : screen === 'seats-none' ? 'none' : screen === 'seats-closed' ? 'closed' : screen === 'seats-gabbai' ? 'gabbai' : 'default';
}
