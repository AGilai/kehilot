import { config } from '../config.ts';
import { ApiCodeError } from './errors.ts';
import { endpoints } from './endpoints.ts';
import type { Http } from './http.ts';
import type { Shabbat, Zmanim } from '../types.ts';
import type { Channel, Kehila, Lang, Message, Reply, Role } from './types.ts';

export type FixtureParams = { role: Role; lang: Lang | null; screen: string | null };

/** Fixture mode is for screenshots and demos only: it must never run beside a real API. */
export function assertFixturesAllowed(apiUrl: string = config.apiUrl): void {
  if (apiUrl) throw new Error('EXPO_PUBLIC_FIXTURES and EXPO_PUBLIC_API_URL are both set');
}

/** Screens that open the signed-in app at once (the others are for the sign-in screens). */
export const FIXTURE_APP_SCREENS = ['profile', 'switcher', 'home', 'messages', 'messages-all', 'm3', 'm3b', 'm3target', 'chat'];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A valid-looking ULID for a time, so fixtures group by day like real messages. */
function fixtureUlid(ms: number, n: number): string {
  let t = ''; let v = ms;
  for (let i = 0; i < 10; i++) { t = CROCKFORD[v % 32] + t; v = Math.floor(v / 32); }
  return t + '0000000000000000'.slice(0, 15) + CROCKFORD[n % 32];
}

const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#C9D3F5"/><circle cx="480" cy="110" r="52" fill="#F2D27A"/><path d="M0 400 L200 170 L340 320 L450 230 L640 400 Z" fill="#2A3F94"/></svg>')}`;

export function fixtureZmanim(date: string): Zmanim {
  const at = (hm: string) => new Date(`${date}T${hm}:00+02:00`).toISOString();
  return { date, source: 'fixture', times: { sunrise: at('05:51'), sofZmanShma: at('08:37'), sofZmanTfilla: at('09:33'), minchaGedola: at('11:54'), plagHaMincha: at('15:49'), sunset: at('16:57'), nightfall: at('17:16') } };
}
export function fixtureShabbat(friday: string): Shabbat {
  return { friday, parasha: 'פרשת נח', petahTikva: new Date(`${friday}T16:17:00+02:00`).toISOString(), telAviv: new Date(`${friday}T16:36:00+02:00`).toISOString() };
}

export function parseFixtureParams(search: string): FixtureParams {
  const q = new URLSearchParams(search);
  const role = q.get('role');
  const lang = q.get('lang');
  return {
    role: role === 'listener' || role === 'gabbai' ? role : 'member',
    lang: lang === 'he' || lang === 'en' ? lang : null,
    screen: q.get('screen'),
  };
}

export function fixtureParams(): FixtureParams {
  const search = typeof window !== 'undefined' && window.location ? window.location.search : '';
  return parseFixtureParams(search);
}

// All names below are invented.
export function createFixtureApi(role: Role, screen: string | null = null, lang: Lang | null = null) {
  assertFixturesAllowed();
  const kehila: Kehila = {
    kehilaId: '01FIXTUREKEHILA0000000001', name: 'קהילת בדיוני', role, classification: '', logoVersion: null,
    canBroadcast: role === 'gabbai', pendingRequest: false,
    notify: { mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [] },
    groups: [], adminGroups: [], settings: { pollSeconds: 60 },
  };
  const me = {
    userId: '01FIXTUREUSER00000000001', email: 'dana@example.invalid',
    // ?screen=profile shows the profile form; ?screen=switcher gives three Kehilot and no remembered choice.
    profile: screen === 'profile' ? null : { firstName: lang === 'en' ? 'Dana' : 'דנה', lastName: lang === 'en' ? 'Example' : 'בדויה', lang: lang ?? ('he' as Lang) },
    kehilot: [
      { kehilaId: kehila.kehilaId, name: kehila.name, role, logoVersion: null },
      ...(screen === 'switcher' ? [
        { kehilaId: '01FIXTUREKEHILA0000000002', name: 'בית כנסת הדוגמה', role: 'gabbai' as Role, logoVersion: null },
        { kehilaId: '01FIXTUREKEHILA0000000003', name: 'קהילת הנחל המצויר', role: 'listener' as Role, logoVersion: null },
      ] : []),
    ],
  };
  const ch = (channelId: string, name: string, over: Partial<Channel> = {}) => ({
    channelId, name, listenersCanRead: true, postPolicy: 'management' as const, canPost: role === 'gabbai', inAudience: true,
    conversation: false, chatHourlyLimit: 0, isAdmin: role === 'gabbai', ...over,
  });
  const channels = [
    ch('01FIXTURECHANNEL00000001', 'הודעות הקהילה'),
    ch('01FIXTURECHANNEL00000002', 'שמחות ואבלות'),
    ch('01FIXTURECHANNEL00000003', 'שיחת הקהילה', { conversation: true, canPost: role !== 'listener', chatHourlyLimit: 30 }),
    ...(role === 'gabbai' ? [ch('01FIXTURECHANNEL00000004', 'קבוצת הנוער', { inAudience: false })] : []),
  ];
  const [cAnn, cJoy, cChat, cYouth] = [channels[0]!.channelId, channels[1]!.channelId, channels[2]!.channelId, channels[3]?.channelId ?? channels[0]!.channelId];
  // ?screen=m3target makes the signed-in user the family a blessing is aimed at.
  const targetId = screen === 'm3target' ? me.userId : '01FIXTUREUSER00000000002';
  const now = Date.now();
  const H = 3600_000;
  const mk = (ago: number, n: number, over: Partial<Message>): Message => ({
    messageId: fixtureUlid(now - ago, n), channelId: cAnn, type: 'weekly', title: '', body: '', authorId: 'm1', authorName: 'יוסי לדוגמה',
    authorKind: 'management', joinCount: 0, ...over,
  });
  const messages: Message[] = [
    mk(1 * H, 1, { type: 'weekly', title: 'שבת שלום מהקהילה הבדיונית', body: 'הודעת דוגמה בלבד. קבלת שבת תתקיים בשעה הרגילה.' }),
    mk(2 * H, 2, { channelId: cJoy, type: 'celebration', title: 'מזל טוב לבר המצווה בבית בדיוני', body: 'משפחת בדיוני מזמינה את כולם לשמחה בשבת הקרובה.', joinCount: 12, targetMemberId: targetId, targetName: 'בדיוני', replierCount: 3 }),
    mk(5 * H, 3, { channelId: cJoy, type: 'condolence', title: 'השתתפות בצער משפחת לדוגמה', body: 'בצער רב אנו מודיעים על פטירתו של אבי המשפחה. יהי זכרו ברוך.', targetMemberId: targetId, targetName: 'לדוגמה', replierCount: 2 }),
    mk(26 * H, 4, { type: 'event', title: 'שיעור ערב שבת', body: 'שיעור קצר לפני מנחה, בהשתתפות כולם.' }),
    mk(3 * H, 5, { channelId: cChat, type: 'chat', authorKind: 'member', authorId: 'u7', authorName: 'רון לדוגמה', body: 'מי מביא כיסאות לשבת?' }),
    mk(2.5 * H, 6, { channelId: cChat, type: 'chat', authorKind: 'member', authorId: 'u8', authorName: 'מיכל בדויה', body: 'צילמתי את הסוכה, הנה:', image: { contentType: 'image/jpeg', bytes: 40000 } }),
    mk(1.5 * H, 7, { channelId: cChat, type: 'chat', authorKind: 'member', authorId: me.userId, authorName: 'דנה בדויה', body: 'אני אביא, תודה!' }),
    ...(role === 'gabbai' ? [mk(4 * H, 8, { channelId: cYouth, type: 'weekly', title: 'מפגש נוער בשבת', body: 'הודעה בקבוצה שאינה בקהל שלי.' })] : []),
  ];
  const celebration = messages[1]!;
  // The server returns replies only to the target and to their own author; a gabbai gets none.
  const someReply = (n: number, authorId: string, authorName: string, body: string): Reply =>
    ({ replyId: fixtureUlid(now - n * H, n), authorId, authorName, body, createdAt: new Date(now - n * H).toISOString() });
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
    [`GET /v1/kehilot/${kehila.kehilaId}/messages`]: messages,
    [`GET /v1/kehilot/${kehila.kehilaId}/changes`]: { cursor: 'fixture', more: false, changes: [] },
  };
  for (const m of messages) {
    const base = `/v1/kehilot/${kehila.kehilaId}/messages/${m.messageId}`;
    routes[`GET ${base}`] = m;
    routes[`GET ${base}/replies`] = repliesFor(m);
    routes[`POST ${base}/read`] = undefined;
    routes[`POST ${base}/join`] = { joinCount: m.joinCount + 1, joined: true };
    routes[`DELETE ${base}`] = undefined;
    if (m.image) routes[`GET ${base}/image`] = { url: PICTURE, expiresAt: new Date(now + 300_000).toISOString() };
  }
  for (const x of me.kehilot.slice(1)) {
    routes[`GET /v1/kehilot/${x.kehilaId}`] = { ...kehila, kehilaId: x.kehilaId, name: x.name, role: x.role };
    routes[`GET /v1/kehilot/${x.kehilaId}/channels`] = channels;
  }
  // Invite previews (public): 7K3M9Q2XPA is valid, 4D8F2H6NRT has expired. Same codes as views/useIncomingLink.ts.
  routes['GET /v1/invites/7K3M9Q2XPA'] = { kehilaName: kehila.name, role: 'member', expiresAt: '2026-11-20T12:00:00.000Z' };
  routes[`POST /v1/kehilot/${kehila.kehilaId}/membership-request`] = {};
  const http: Http = {
    async request(method, path, body) {
      if (method === 'GET' && path === '/v1/invites/4D8F2H6NRT') throw new ApiCodeError(410, 'invite_expired');
      const key = `${method} ${path.split('?')[0]}`;
      if (method === 'POST' && key.endsWith('/replies')) {
        const text = String((body as { body?: unknown } | undefined)?.body ?? '');
        return { replyId: fixtureUlid(Date.now(), 31), authorId: me.userId, authorName: 'דנה בדויה', body: text, createdAt: new Date().toISOString() } as any;
      }
      if (key in routes && routes[key] === undefined) return undefined as any;
      const hit = routes[key];
      if (hit === undefined) throw new ApiCodeError(404, 'not_found');
      return structuredClone(hit) as any;
    },
  };
  return endpoints(http);
}

