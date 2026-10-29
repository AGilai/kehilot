// Fixture mode only (screenshots and demos): the private-reply routes, kept in memory. All names are invented.
// The rules mirror the server: one reply per person, `to` is author / family / one adult, a recipient reads what was
// sent to them, the writer reads their own, nobody else reads anything (not even a gabbai).
import { ApiCodeError } from './errors.ts';
import type { Inbox, InboxThread, Message, Reply, Role } from './types.ts';

/** Frame P48: phones 1 to 4 and their states. Wired in `fixtureNav` (src/views/Main.tsx). */
export const P48_SCREENS = ['p48-messages', 'p48-actions', 'p48-sheet', 'p48-m3', 'p48-condolence', 'p48-picker', 'p48-inbox', 'p48-inbox-a', 'p48-inbox-b', 'p48-author'];

const U = (n: number) => `01FIXTUREUSER000000000${n}`;
export const P48_PEOPLE = {
  rotem: { userId: U(60), firstName: 'רותם', lastName: 'אלמוג' },
  shulamit: { userId: U(61), firstName: 'שולמית', lastName: 'ברקן' },
  yigal: { userId: U(62), firstName: 'יגאל', lastName: 'ברקן' },
  alon: { userId: U(63), firstName: 'אלון', lastName: 'שדמי' },
};
const BARKAN = '01FIXTUREFAMILY0000000061';
const SHADMI = '01FIXTUREFAMILY0000000063';

/** Who the signed-in user is on a P48 screen; null keeps the usual fixture user. */
export function p48Who(screen: string | null): { userId: string; firstName: string; lastName: string } | null {
  if (screen === 'p48-inbox' || screen === 'p48-author') return P48_PEOPLE.rotem;
  if (screen === 'p48-inbox-a') return P48_PEOPLE.shulamit;
  if (screen === 'p48-inbox-b') return P48_PEOPLE.yigal;
  return null;
}

const WRITERS: Array<[string, string]> = [
  ['u7', 'רון לדוגמה'], ['u8', 'מיכל בדויה'], [U(70), 'נועה בדויה'], [U(71), 'אורי לדוגמה'], [U(72), 'תמר הנחל'], [U(73), 'דוד בדיוני'],
  [U(74), 'שרה מדומה'], [U(75), 'אבי ניסיון'], [U(76), 'לאה בדויה'], [U(77), 'חנה מדומה'], [U(78), 'משה דוגמה'], [U(79), 'עדי בדיוני'],
];

type Stored = Reply & { messageId: string };
type Opts = {
  kehilaId: string;
  meId: string;
  meName: string;
  role: Role;
  screen: string | null;
  now: number;
  ulid: (ms: number, n: number) => string;
  messages: Message[];
  visible: (m: Message) => boolean;
};

const MIN = 60_000;
const secs = (ms: number) => Math.floor(ms / 1000);

/** The messages P48 shows (the usual fixture list is replaced on these screens). */
export function p48Messages(o: { now: number; channelId: string; ulid: (ms: number, n: number) => string }): Message[] {
  const { now, channelId, ulid } = o;
  const base = { channelId, joinCount: 0 };
  return [
    { ...base, messageId: ulid(now - 40 * MIN, 41), type: 'weekly', title: 'שבת שלום מהקהילה הבדיונית', body: 'קבלת שבת תתקיים בשעה הרגילה.', authorId: 'm1', authorName: 'יוסי לדוגמה', authorKind: 'management' },
    { ...base, messageId: ulid(now - 90 * MIN, 42), type: 'general', title: 'מי מצטרף לשיעור גמרא בשבת בבוקר?', body: 'השיעור יתחיל בשבע וחצי. נשמח לכל מי שרוצה להצטרף.', authorId: P48_PEOPLE.rotem.userId, authorName: 'רותם אלמוג', authorKind: 'member' },
    { ...base, messageId: ulid(now - 120 * MIN, 43), type: 'celebration', title: 'מזל טוב לבר המצווה בבית ברקן', body: 'משפחת ברקן מזמינה את כולם לשמחה בשבת הקרובה.', authorId: 'm1', authorName: 'יוסי לדוגמה', authorKind: 'management', joinCount: 14, targetMemberId: P48_PEOPLE.shulamit.userId, targetFamilyId: BARKAN, targetName: 'ברקן' },
    { ...base, messageId: ulid(now - 200 * MIN, 44), type: 'condolence', title: 'השתתפות בצער משפחת שדמי', body: 'בצער רב אנו מודיעים על פטירת אבי המשפחה. יהי זכרו ברוך.', authorId: 'm1', authorName: 'יוסי לדוגמה', authorKind: 'management', targetMemberId: P48_PEOPLE.alon.userId, targetFamilyId: SHADMI, targetName: 'שדמי' },
    { ...base, messageId: ulid(now - 26 * 60 * MIN, 45), type: 'general', title: 'כיסאות לשבת', body: 'חסרים כמה כיסאות באולם. מי יכול להביא?', authorId: 'm1', authorName: 'יוסי לדוגמה', authorKind: 'management' },
    { ...base, messageId: ulid(now - 28 * 60 * MIN, 46), type: 'event', title: 'שיעור ערב שבת', body: 'שיעור קצר לפני מנחה.', authorId: 'u7', authorName: 'רון לדוגמה', authorKind: 'member' },
  ];
}

export function createRepliesFixture(o: Opts) {
  const K = `/v1/kehilot/${o.kehilaId}`;
  const people = new Map<string, string>([[o.meId, o.meName], ...WRITERS, ...Object.values(P48_PEOPLE).map(p => [p.userId, `${p.firstName} ${p.lastName}`] as [string, string])]);
  const families = new Map<string, string[]>([[BARKAN, [P48_PEOPLE.shulamit.userId, P48_PEOPLE.yigal.userId]], [SHADMI, [P48_PEOPLE.alon.userId]]]);
  const store: Stored[] = [];
  const marker = new Map<string, string>();
  let counter = 100;

  const adultsOf = (m: Message): string[] => (m.targetFamilyId && families.get(m.targetFamilyId)) || (m.targetMemberId ? [m.targetMemberId] : []);
  const routeOf = (m: Message): 'author' | 'family' | null =>
    (m.type === 'general' || m.type === 'event') && m.authorKind === 'member' ? 'author'
      : (m.type === 'celebration' || m.type === 'condolence') && m.targetMemberId ? 'family' : null;
  const recipientsOf = (m: Message, to: string): string[] => (to === 'author' ? [m.authorId] : to === 'family' ? adultsOf(m) : [to]);
  const isRecipient = (m: Message, u: string): boolean => (routeOf(m) === 'author' ? m.authorId === u : adultsOf(m).includes(u));
  const readable = (m: Message, r: Stored, u: string): boolean => r.authorId === u || recipientsOf(m, r.to).includes(u);
  const msgOf = (id: string) => o.messages.find(x => x.messageId === id);
  const mine = (id: string) => store.find(r => r.messageId === id && r.authorId === o.meId);

  /** The viewer's copy of a reply. */
  function view(r: Stored): Reply {
    const { messageId: _m, ...out } = r;
    if (r.authorId === o.meId) return r.to !== 'author' && r.to !== 'family' ? { ...out, toName: people.get(r.to) ?? '' } : out;
    const seen = marker.get(`${o.meId}|${r.messageId}`) ?? '';
    return { ...out, ...(r.to === o.meId ? { personal: true } : {}), unread: r.replyId > seen };
  }
  const received = (m: Message): Stored[] => store.filter(r => r.messageId === m.messageId && r.authorId !== o.meId && readable(m, r, o.meId));

  function decorate(m: Message): Message {
    const route = routeOf(m);
    const count = new Set(store.filter(r => r.messageId === m.messageId).map(r => r.authorId)).size;
    const out: Message = { ...m };
    if (m.targetMemberId || count) out.replierCount = count;
    if (!route) return out;
    const recipient = isRecipient(m, o.meId);
    out.replyTo = route;
    out.isRecipient = recipient;
    out.canReply = !recipient && o.role !== 'listener';
    out.replied = !!mine(m.messageId);
    return out;
  }

  function seed(m: Message, from: Array<[string, string]>, body: (i: number) => string, to: (i: number) => string, ago = 30): void {
    from.forEach(([id, name], i) => {
      const at = o.now - (ago + i * 7) * MIN;
      store.push({ replyId: o.ulid(at, counter++), messageId: m.messageId, authorId: id, authorName: name, body: body(i), createdAt: secs(at), to: to(i) });
    });
  }
  /** Leaves exactly `n` of the replies the user can read unread. */
  function unreadOnly(m: Message, userId: string, n: number): void {
    const visible = store.filter(r => r.messageId === m.messageId && r.authorId !== userId && readable(m, r, userId)).sort((a, b) => (a.replyId < b.replyId ? -1 : 1));
    const upTo = visible[visible.length - n - 1]?.replyId;
    if (upTo) marker.set(`${userId}|${m.messageId}`, upTo);
  }

  const BLESS = ['מזל טוב ושמחה גדולה!', 'מברכים מכל הלב, שתזכו לנחת.', 'שמחים בשמחתכם, מזל טוב!', 'שתזכו לראות ילדיכם מתברכים בכל טוב.', 'מזל טוב, נתראה בשמחה.'];
  const WORDS = ['משתתפים בצערכם, המקום ינחם אתכם.', 'זכרו היה ברוך, חבק אתכם בכל לב.', 'מחבקים אתכם בימים האלה.'];
  const NOTES = ['אשמח להצטרף, תודה על ההודעה.', 'מתי בדיוק מתחילים? אשמח לדעת.', 'אביא איתי עוד שניים.', 'תודה רבה, נתראה בשבת.', 'אצטרף ברצון.'];
  const found = (type: string) => o.messages.find(x => x.type === type);

  if (o.screen?.startsWith('p48-')) {
    const author = o.messages.find(x => x.authorId === P48_PEOPLE.rotem.userId)!;
    const mazal = found('celebration')!;
    const cond = found('condolence')!;
    seed(author, WRITERS.slice(1, 6), i => NOTES[i % NOTES.length]!, () => 'author');
    // 12 repliers: 9 to the family, 2 to Shulamit, 1 to Yigal (§22.4a).
    seed(mazal, WRITERS.slice(0, 12), i => BLESS[i % BLESS.length]!, i => (i === 3 || i === 8 ? P48_PEOPLE.shulamit.userId : i === 5 ? P48_PEOPLE.yigal.userId : 'family'), 20);
    seed(cond, WRITERS.slice(0, 9), i => WORDS[i % WORDS.length]!, () => 'family', 50);
    if (o.screen === 'p48-inbox' || o.screen === 'p48-author') unreadOnly(author, o.meId, 2);
    if (o.screen === 'p48-inbox-a') unreadOnly(mazal, o.meId, 1);
    if (o.screen === 'p48-inbox-b') unreadOnly(mazal, o.meId, 2);
  } else {
    // The usual fixture list: the blessing for the "family" (or for me with ?screen=m3target), a condolence and a member's note.
    const celebration = o.messages.find(x => x.type === 'celebration' && x.targetMemberId);
    const condolence = o.messages.find(x => x.type === 'condolence' && x.targetMemberId);
    if (celebration) {
      const writers: Array<[string, string]> = celebration.targetMemberId === o.meId ? [['u7', 'רון לדוגמה'], ['u8', 'מיכל בדויה'], [U(70), 'נועה בדויה']] : [[o.meId, 'דנה בדויה'], ['u7', 'רון לדוגמה'], ['u8', 'מיכל בדויה']];
      seed(celebration, writers, i => (celebration.targetMemberId === o.meId ? BLESS[i]! : i === 0 ? 'מזל טוב! נשמח לחגוג איתכם.' : BLESS[i]!), () => 'family', 60);
    }
    if (condolence) seed(condolence, [['u7', 'רון לדוגמה'], ['u8', 'מיכל בדויה']], i => WORDS[i]!, () => 'family', 90);
  }

  /** Answers a request, or `undefined` when it is not one of the reply routes (or the list/GET of a message). */
  function handle(method: string, fullPath: string, body: unknown): unknown {
    const path = fullPath.split('?')[0]!;
    if (!path.startsWith(`${K}/`)) return undefined;
    const rest = path.slice(K.length);
    if (method === 'GET' && rest === '/messages') return structuredClone(o.messages.filter(o.visible).map(decorate));
    if (method === 'GET' && rest === '/replies/inbox') return structuredClone(inbox());
    const mm = /^\/messages\/([^/]+)(\/.*)?$/.exec(rest);
    if (!mm) return undefined;
    const m = msgOf(mm[1]!);
    if (!m) return undefined;
    const tail = mm[2] ?? '';
    if (method === 'GET' && tail === '') {
      const out = decorate(m);
      if (out.replyTo === 'family' && out.canReply) out.replyAdults = adultsOf(m).map(userId => ({ userId, name: people.get(userId) ?? '' }));
      return structuredClone(out);
    }
    if (method === 'GET' && tail === '/replies') {
      return structuredClone(store.filter(r => r.messageId === m.messageId && readable(m, r, o.meId)).sort((a, b) => (a.replyId < b.replyId ? -1 : 1)).map(view));
    }
    if (method === 'POST' && tail === '/replies') return structuredClone(post(m, (body ?? {}) as { body?: unknown; to?: unknown }));
    if (method === 'POST' && tail === '/replies/read') {
      const upTo = String((body as { upTo?: unknown } | undefined)?.upTo ?? '');
      if (!upTo) throw new ApiCodeError(400, 'invalid_up_to');
      const key = `${o.meId}|${m.messageId}`;
      if ((marker.get(key) ?? '') < upTo) marker.set(key, upTo);
      return null;
    }
    const rm = /^\/replies\/([^/]+)$/.exec(tail);
    if (rm && (method === 'PUT' || method === 'DELETE')) {
      const r = store.find(x => x.messageId === m.messageId && x.replyId === rm[1] && x.authorId === o.meId);
      if (!r) throw new ApiCodeError(404, 'reply_not_found');
      if (method === 'DELETE') { store.splice(store.indexOf(r), 1); return null; }
      const text = String((body as { body?: unknown } | undefined)?.body ?? '').trim();
      if (!text || [...text].length > 1000) throw new ApiCodeError(400, 'invalid_body');
      r.body = text; r.updatedAt = secs(Date.now());
      return structuredClone(view(r));
    }
    return undefined;
  }

  function post(m: Message, b: { body?: unknown; to?: unknown }): Reply {
    const route = routeOf(m);
    if (!route) throw new ApiCodeError(409, 'replies_not_allowed');
    if (isRecipient(m, o.meId)) throw new ApiCodeError(409, 'cannot_reply_to_own');
    const text = typeof b.body === 'string' ? b.body.trim() : '';
    if (!text || [...text].length > 1000) throw new ApiCodeError(400, 'invalid_body');
    const adults = adultsOf(m);
    let to: string = route;
    if (b.to !== undefined && b.to !== null && b.to !== route) {
      if (typeof b.to !== 'string' || route === 'author' || !adults.includes(b.to)) throw new ApiCodeError(400, 'invalid_to');
      to = adults.length > 1 ? b.to : 'family';
    }
    if (mine(m.messageId)) throw new ApiCodeError(409, 'already_replied');
    const at = Date.now();
    const r: Stored = { replyId: o.ulid(at, counter++), messageId: m.messageId, authorId: o.meId, authorName: o.meName, body: text, createdAt: secs(at), to };
    store.push(r);
    return view(r);
  }

  function inbox(): Inbox {
    if (o.role === 'listener') throw new ApiCodeError(403, 'forbidden');
    const threads: InboxThread[] = [];
    for (const m of o.messages) {
      if (!routeOf(m) || !isRecipient(m, o.meId)) continue;
      const got = received(m).sort((a, b) => (a.replyId < b.replyId ? 1 : -1));
      if (got.length === 0) continue;
      const replies = got.map(view);
      threads.push({ message: decorate(m), total: got.length, unread: replies.filter(r => r.unread).length, personal: replies.filter(r => r.personal).length, replies: replies.slice(0, 3) });
    }
    threads.sort((a, b) => (a.replies[0]!.replyId < b.replies[0]!.replyId ? 1 : -1));
    return { unread: threads.reduce((n, t) => n + t.unread, 0), threads };
  }

  return { handle, decorate };
}
