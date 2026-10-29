import { civilDate, displayDate, israelDate, TZ } from '../dates.ts';
import he from '../i18n/he.json' with { type: 'json' };
import en from '../i18n/en.json' with { type: 'json' };
import { translate } from '../i18n/translate.ts';
import type { Inbox, InboxThread, Lang, Message, MessageType, Reply, Role } from './types.ts';

type T = (key: string, params?: Record<string, string | number>) => string;
export type ReplyKind = 'general' | 'celebration' | 'condolence';
/** Where a reply goes: `author`, `family`, or one adult's userId. */
export type ReplyTo = string;

export const REPLY_MAX = 1000;
/** The counter shows from here. */
export const COUNTER_FROM = 900;
const cp = (s: string) => [...s].length;

/** The register of the words: celebration and condolence speak to a family, everything else to the author. */
export function replyKind(type: MessageType): ReplyKind {
  return type === 'celebration' ? 'celebration' : type === 'condolence' ? 'condolence' : 'general';
}
const kindOf = (m: Message): ReplyKind => replyKind(m.type);

/** "3 תשובות פרטיות" / "12 ברכות אישיות" / "9 חברים כתבו למשפחה"; null at 0 and with no count. */
export function countText(m: Message, t: T): string | null {
  const n = m.replierCount;
  if (!n) return null;
  const kind = kindOf(m);
  return n === 1 ? t(`reply.countOne.${kind}`) : t(`reply.count.${kind}`, { n });
}

/** The card's and the box's button: reply (not yet), replied (opens my reply), none (listener, own message, no route). */
export function buttonState(m: Message, role: Role): 'reply' | 'replied' | 'none' {
  if (!m.replyTo || role === 'listener') return 'none';
  if (m.replied) return 'replied';
  return m.canReply ? 'reply' : 'none';
}

/** The pill's colour name: tekhelet for answers, pomegranate for a blessing, ash for a word to a mourning family. */
export function pillTone(type: MessageType): 'tekhelet' | 'pomegranate' | 'ash' {
  const kind = replyKind(type);
  return kind === 'celebration' ? 'pomegranate' : kind === 'condolence' ? 'ash' : 'tekhelet';
}

/** Whether the card shows the reply row at all: a count or a button. */
export const hasReplyRow = (m: Message, role: Role): boolean => !!m.replierCount || buttonState(m, role) !== 'none';

/** The pill is its own button: "תשובה פרטית לרותם אלמוג". */
export const pillA11y = (m: Message, t: T): string =>
  replyKind(m.type) === 'general' ? t('reply.buttonA11y', { name: m.authorName }) : headingText(m, 'family', t);

/** The "אל מי" picker: nothing under two adults, else the whole family first and then each adult in the stored order. */
export function toChoices(m: Message, t: T): Array<{ key: ReplyTo; label: string }> {
  const adults = m.replyAdults ?? [];
  if (adults.length < 2) return [];
  return [{ key: 'family', label: t('reply.toFamily') }, ...adults.map(a => ({ key: a.userId, label: a.name }))];
}

export const buttonLabel = (m: Message, t: T): string => t(`reply.button.${kindOf(m)}`);
export const placeholder = (m: Message, t: T): string => t(`reply.placeholder.${kindOf(m)}`);
export const receivedTitle = (m: Message, t: T): string => t(`reply.received.${kindOf(m)}`);

const adultName = (m: Message, userId: string): string => m.replyAdults?.find(a => a.userId === userId)?.name ?? '';
const isPerson = (to: ReplyTo): boolean => to !== 'author' && to !== 'family';
const family = (m: Message): string => m.targetName?.trim() ?? '';

/** The box heading; follows the recipient picker. */
export function headingText(m: Message, to: ReplyTo, t: T): string {
  const kind = kindOf(m);
  if (kind === 'general') return t('reply.title.general', { name: m.authorName });
  if (isPerson(to)) return t(`reply.title.${kind}Person`, { name: adultName(m, to) });
  return t(`reply.title.${kind}`, { family: family(m) });
}

/** The lock line under the Composer. */
export function lockText(m: Message, to: ReplyTo, t: T): string {
  if (kindOf(m) === 'general') return t('reply.lock.general', { name: m.authorName });
  if (isPerson(to)) return t('reply.lock.person', { name: adultName(m, to) });
  return t('reply.lock.family', { family: family(m) });
}

/** "נשלחה אל {name} בלבד · {time}" or "נשלחה למשפחה בלבד · {time}". */
export function sentText(reply: Reply, m: Message, time: string, t: T): string {
  if (reply.to === 'family') return t('reply.sent.family', { time });
  const name = reply.to === 'author' ? m.authorName : reply.toName || adultName(m, reply.to);
  return t('reply.sent.general', { name, time });
}

/** "{n}/1000" from 900 code points; null before. */
export function counterText(text: string): string | null {
  const n = cp(text);
  return n >= COUNTER_FROM ? `${n}/${REPLY_MAX}` : null;
}

export function canSendReply(text: string): boolean {
  const n = cp(text.trim());
  return n >= 1 && n <= REPLY_MAX;
}

const DICTS = { he, en } as const;
const hhmm = (ms: number): string =>
  new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

/**
 * §2 times: "היום, 09:58", "אתמול, 22:03", otherwise the Hebrew date first with the Gregorian in brackets.
 * `t` is optional: the two fixed phrases then come straight from the Hebrew or English file, without display isolates.
 */
export function replyTime(seconds: number, lang: Lang, nowMs: number, t?: T): string {
  const ms = seconds * 1000;
  const day = israelDate(new Date(ms));
  const today = israelDate(new Date(nowMs));
  const phrase = (key: string, time: string): string =>
    t ? t(key, { time }) : translate(DICTS[lang], he, key).replace('{time}', time);
  if (day === today) return phrase('reply.time.today', hhmm(ms));
  const yesterday = israelDate(new Date(civilDate(today).getTime() - 24 * 3600 * 1000));
  if (day === yesterday) return phrase('reply.time.yesterday', hhmm(ms));
  return displayDate(day, lang);
}

/** The newest reply I wrote (old blessings may hold several). */
export function myReply(replies: Reply[], me: string): Reply | undefined {
  let best: Reply | undefined;
  for (const r of replies) if (r.authorId === me && (!best || r.replyId > best.replyId)) best = r;
  return best;
}

/**
 * The replyId to send to `markRepliesSeen` when the mailbox card shows every unread reply of the thread
 * (the newest three are shown); null when some unread ones are not shown (M3 marks those) or none are unread.
 */
export function readUpTo(thread: InboxThread): string | null {
  if (thread.unread <= 0 || thread.unread > thread.replies.length) return null;
  let top: string | null = null;
  for (const r of thread.replies) if (top === null || r.replyId > top) top = r.replyId;
  return top;
}

/** "1 חדשה" at 1, else "{n} חדשות". */
export const newText = (n: number, t: T): string => (n === 1 ? t('reply.newOne') : t('reply.new', { n }));

/** "עוד תשובה אחת" at 1, else "עוד {n} תשובות". */
export const moreText = (n: number, t: T): string => (n === 1 ? t('inbox.moreOne') : t('inbox.more', { n }));

/** The Me row's status. */
export function mailboxStatus(inbox: Inbox | null, t: T): string {
  if (!inbox || inbox.threads.length === 0) return t('inbox.rowEmpty');
  return inbox.unread > 1 ? t('inbox.rowNew', { n: inbox.unread }) : inbox.unread === 1 ? t('inbox.rowNewOne') : t('inbox.rowNone');
}

/** "הודעה שלכם · 3 תשובות · 2 חדשות" or "ברכות למשפחה שלכם · 11 ברכות · 2 אישיות · 1 חדשות"; zero parts are left out. */
export function threadLine(thread: InboxThread, t: T): string {
  const parts: string[] = [];
  const familyRoute = thread.message.replyTo ? thread.message.replyTo === 'family' : replyKind(thread.message.type) !== 'general';
  const one = thread.total === 1;
  parts.push(familyRoute ? (one ? t('inbox.familyOne') : t('inbox.family', { n: thread.total })) : one ? t('inbox.mineOne') : t('inbox.mine', { n: thread.total }));
  if (familyRoute && thread.personal > 0) parts.push(thread.personal === 1 ? t('inbox.personalOne') : t('inbox.personal', { n: thread.personal }));
  if (thread.unread > 0) parts.push(newText(thread.unread, t));
  return parts.join(' · ');
}

/** The message delete confirm: names the private replies that go with it. */
export const deleteMessageBody = (replies: number | undefined, t: T): string =>
  replies && replies > 0 ? t('detail.deleteBodyReplies', { n: replies }) : t('detail.deleteBody');

/** The reply delete confirm: "היא תימחק גם אצל {name}." for an author or one adult, "…אצל המשפחה." for the family. */
export function deleteReplyBody(reply: Reply, m: Message, t: T): string {
  if (reply.to === 'family') return t('reply.deleteBody.family');
  const name = reply.to === 'author' ? m.authorName : reply.toName || adultName(m, reply.to);
  return t('reply.deleteBody.general', { name });
}

/** The recipient's list: other people's replies, newest first (ids are ULIDs), each with whether it carries the personal tag. */
export function receivedOrder(replies: Reply[], me: string): Array<{ reply: Reply; personal: boolean }> {
  return replies.filter(r => r.authorId !== me).sort((a, b) => (a.replyId < b.replyId ? 1 : a.replyId > b.replyId ? -1 : 0)).map(reply => ({ reply, personal: !!reply.personal }));
}
