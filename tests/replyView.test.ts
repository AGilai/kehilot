import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buttonLabel, buttonState, canSendReply, countText, counterText, headingText, lockText, mailboxStatus, myReply,
  hasReplyRow, newText, moreText, deleteMessageBody, deleteReplyBody, receivedOrder, pillA11y, pillTone, placeholder, readUpTo, toChoices, withReplyFields, needsReplyFields, receivedTitle, replyKind, replyTime, sentText, threadLine,
} from '../src/client/replyView.ts';
import type { InboxThread, Message, Reply } from '../src/client/types.ts';

// All names are invented.
const he = JSON.parse(readFileSync(new URL('../src/i18n/he.json', import.meta.url), 'utf8'));
const en = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8'));
const look = (d: any, key: string): string => key.split('.').reduce((o, p) => o?.[p], d);
/** The real Hebrew copy, without the display isolates, so the expected strings read as written. */
const t = (key: string, p?: Record<string, string | number>): string => {
  const s = look(he, key);
  assert.equal(typeof s, 'string', `missing key ${key}`);
  return s.replace(/\{(\w+)\}/g, (m, n) => (p && n in p ? String(p[n]) : m));
};

const msg = (over: Partial<Message> = {}): Message =>
  ({ messageId: 'M1', channelId: 'c1', type: 'general', title: 'שיעור חדש', body: 'b', authorId: 'u-rotem', authorName: 'רותם בדיוני', authorKind: 'member', joinCount: 0, ...over });
const bless = (over: Partial<Message> = {}): Message =>
  msg({ type: 'celebration', targetName: 'פלוני', targetMemberId: 'u-shulamit', replyTo: 'family', replyAdults: [{ userId: 'u-shulamit', name: 'שולמית פלוני' }, { userId: 'u-yigal', name: 'יגאל פלוני' }], ...over });

test('replyKind maps the type to a register', () => {
  assert.equal(replyKind('general'), 'general');
  assert.equal(replyKind('event'), 'general');
  assert.equal(replyKind('celebration'), 'celebration');
  assert.equal(replyKind('condolence'), 'condolence');
});

test('countText: null at 0 and with no count, one, many, per kind', () => {
  assert.equal(countText(msg({ replierCount: 0 }), t), null);
  assert.equal(countText(msg(), t), null);
  assert.equal(countText(msg({ replierCount: 1 }), t), 'תשובה פרטית אחת');
  assert.equal(countText(msg({ replierCount: 3 }), t), '3 תשובות פרטיות');
  assert.equal(countText(bless({ replierCount: 12 }), t), '12 ברכות אישיות');
  assert.equal(countText(bless({ replierCount: 1 }), t), 'ברכה אישית אחת');
  assert.equal(countText(bless({ type: 'condolence', replierCount: 9 }), t), '9 חברים כתבו למשפחה');
  assert.equal(countText(bless({ type: 'condolence', replierCount: 1 }), t), 'חבר אחד כתב למשפחה');
});

test('buttonState', () => {
  assert.equal(buttonState(msg({ replyTo: 'author', canReply: true }), 'member'), 'reply');
  assert.equal(buttonState(msg({ replyTo: 'author', canReply: true, replied: true }), 'gabbai'), 'replied');
  assert.equal(buttonState(msg({ replyTo: 'author', canReply: false, replied: true }), 'member'), 'replied');
  assert.equal(buttonState(msg({ replyTo: 'author', canReply: true }), 'listener'), 'none');
  assert.equal(buttonState(msg({ canReply: true }), 'member'), 'none');
  assert.equal(buttonState(msg({ replyTo: 'author', canReply: false }), 'member'), 'none');
});

test('button labels, placeholders and received titles follow the type', () => {
  assert.equal(buttonLabel(msg(), t), 'תשובה פרטית');
  assert.equal(buttonLabel(bless(), t), 'ברכה אישית');
  assert.equal(buttonLabel(bless({ type: 'condolence' }), t), 'מילה למשפחה');
  assert.equal(placeholder(msg(), t), 'כתבו תשובה');
  assert.equal(placeholder(bless(), t), 'כתבו ברכה למשפחה');
  assert.equal(placeholder(bless({ type: 'condolence' }), t), 'כתבו למשפחה כמה מילים');
  assert.equal(receivedTitle(msg(), t), 'תשובות שהגיעו');
  assert.equal(receivedTitle(bless(), t), 'ברכות שהגיעו');
  assert.equal(receivedTitle(bless({ type: 'condolence' }), t), 'מילים שהגיעו');
});

test('headingText', () => {
  assert.equal(headingText(msg(), 'author', t), 'תשובה פרטית לרותם בדיוני');
  assert.equal(headingText(bless(), 'family', t), 'ברכה אישית למשפחת פלוני');
  assert.equal(headingText(bless(), 'u-shulamit', t), 'ברכה אישית לשולמית פלוני');
  const c = bless({ type: 'condolence', targetName: 'ניסיון', replyAdults: [{ userId: 'u-alon', name: 'אלון ניסיון' }] });
  assert.equal(headingText(c, 'family', t), 'מילה אישית למשפחת ניסיון');
  assert.equal(headingText(c, 'u-alon', t), 'מילה אישית לאלון ניסיון');
});

test('lockText for the author, the family and one adult', () => {
  assert.equal(lockText(msg(), 'author', t), 'תגיע רק אל רותם בדיוני. לא תוצג לשאר הקהילה, גם לא לגבאים.');
  assert.equal(lockText(bless(), 'family', t), 'יגיע למשפחת פלוני בלבד. לא יוצג לשאר הקהילה, גם לא לגבאים.');
  assert.equal(lockText(bless(), 'u-yigal', t), 'תגיע רק אל יגאל פלוני. לא לבן או לבת הזוג, לא לשאר המשפחה, לא לשאר הקהילה ולא לגבאים.');
});

test('sentText says who got it', () => {
  const r = (to: string, extra: Partial<Reply> = {}): Reply => ({ replyId: 'r1', authorId: 'me', authorName: 'דנה בדויה', body: 'x', createdAt: 1, to, ...extra });
  assert.equal(sentText(r('author'), msg(), '09:58', t), 'נשלחה אל רותם בדיוני בלבד · 09:58');
  assert.equal(sentText(r('family'), bless(), '09:58', t), 'נשלחה למשפחה בלבד · 09:58');
  assert.equal(sentText(r('u-yigal', { toName: 'יגאל פלוני' }), bless(), '09:58', t), 'נשלחה אל יגאל פלוני בלבד · 09:58');
  assert.equal(sentText(r('u-yigal'), bless(), '09:58', t), 'נשלחה אל יגאל פלוני בלבד · 09:58');
});

test('counterText shows from 900, canSendReply counts code points', () => {
  assert.equal(counterText('א'.repeat(899)), null);
  assert.equal(counterText('א'.repeat(900)), '900/1000');
  assert.equal(counterText('😀'.repeat(950)), '950/1000');
  assert.equal(canSendReply(''), false);
  assert.equal(canSendReply('   '), false);
  assert.equal(canSendReply('מזל טוב'), true);
  assert.equal(canSendReply('😀'.repeat(1000)), true);
  assert.equal(canSendReply('😀'.repeat(1001)), false);
});

test('replyTime: today, yesterday, otherwise the Hebrew date first', () => {
  // 2026-10-28 09:58 Israel (UTC+2 after the clocks went back) is 07:58Z.
  const now = Date.parse('2026-10-28T10:30:00Z');
  const at = (iso: string) => Date.parse(iso) / 1000;
  assert.equal(replyTime(at('2026-10-28T07:58:00Z'), 'he', now, t), 'היום, 09:58');
  assert.equal(replyTime(at('2026-10-27T20:03:00Z'), 'he', now, t), 'אתמול, 22:03');
  assert.equal(replyTime(at('2026-10-26T10:00:00Z'), 'he', now, t), 'יום ב׳, ט״ו בחשוון (26.10)');
  assert.equal(replyTime(at('2026-10-28T07:58:00Z'), 'he', now), 'היום, 09:58');
  assert.equal(replyTime(at('2026-10-27T20:03:00Z'), 'en', now), 'Yesterday, 22:03');
  // just after Israel midnight is already the next day
  assert.equal(replyTime(at('2026-10-27T22:30:00Z'), 'he', Date.parse('2026-10-28T09:00:00Z'), t), 'היום, 00:30');
});

test('myReply is the newest of mine', () => {
  const r = (id: string, a: string): Reply => ({ replyId: id, authorId: a, authorName: a, body: id, createdAt: 1, to: 'family' });
  assert.equal(myReply([r('01A', 'me'), r('01C', 'me'), r('01B', 'x'), r('01D', 'x')], 'me')?.replyId, '01C');
  assert.equal(myReply([r('01B', 'x')], 'me'), undefined);
  assert.equal(myReply([], 'me'), undefined);
});

test('readUpTo: only when every unread reply is among those shown', () => {
  const r = (id: string): Reply => ({ replyId: id, authorId: 'x', authorName: 'x', body: id, createdAt: 1, to: 'author' });
  const th = (unread: number, ids: string[]): InboxThread => ({ message: msg(), total: 9, unread, personal: 0, replies: ids.map(r) });
  assert.equal(readUpTo(th(2, ['03', '02', '01'])), '03');
  assert.equal(readUpTo(th(3, ['03', '02', '01'])), '03');
  assert.equal(readUpTo(th(5, ['03', '02', '01'])), null);
  assert.equal(readUpTo(th(0, ['03', '02', '01'])), null);
  assert.equal(readUpTo(th(1, [])), null);
});

test('mailboxStatus and threadLine', () => {
  assert.equal(mailboxStatus(null, t), 'עוד לא הגיעו תשובות');
  assert.equal(mailboxStatus({ unread: 0, threads: [] }, t), 'עוד לא הגיעו תשובות');
  const th = (over: Partial<InboxThread>): InboxThread => ({ message: msg(), total: 3, unread: 0, personal: 0, replies: [], ...over });
  assert.equal(mailboxStatus({ unread: 0, threads: [th({})] }, t), 'אין חדשות');
  assert.equal(mailboxStatus({ unread: 4, threads: [th({ unread: 4 })] }, t), '4 חדשות');
  assert.equal(threadLine(th({ total: 3, unread: 2 }), t), 'הודעה שלכם · 3 תשובות · 2 חדשות');
  assert.equal(threadLine(th({ total: 3 }), t), 'הודעה שלכם · 3 תשובות');
  assert.equal(threadLine(th({ message: bless(), total: 11, personal: 2, unread: 1 }), t), 'ברכות למשפחה שלכם · 11 ברכות · 2 אישיות · 1 חדשה');
  assert.equal(threadLine(th({ message: bless(), total: 11 }), t), 'ברכות למשפחה שלכם · 11 ברכות');
});

test('every key replyView uses exists in both languages', () => {
  const used = ['time.today', 'time.yesterday', 'new', 'unreadA11y', 'personalTag', 'formerMember'].map(k => `reply.${k}`);
  for (const k of used) for (const d of [he, en]) assert.equal(typeof look(d, k), 'string', k);
});

test('pill colour per kind', () => {
  assert.equal(pillTone('general'), 'tekhelet');
  assert.equal(pillTone('event'), 'tekhelet');
  assert.equal(pillTone('celebration'), 'pomegranate');
  assert.equal(pillTone('condolence'), 'ash');
});

test('toChoices: no picker under two adults, otherwise the family first then the adults in order', () => {
  assert.deepEqual(toChoices(bless({ replyAdults: [] }), t), []);
  assert.deepEqual(toChoices(bless({ replyAdults: undefined }), t), []);
  assert.deepEqual(toChoices(bless({ replyAdults: [{ userId: 'u-a', name: 'שולמית פלוני' }] }), t), []);
  assert.deepEqual(toChoices(bless(), t), [
    { key: 'family', label: 'כל המשפחה' },
    { key: 'u-shulamit', label: 'שולמית פלוני' },
    { key: 'u-yigal', label: 'יגאל פלוני' },
  ]);
});

test('the pill has its own name', () => {
  assert.equal(pillA11y(msg(), t), 'תשובה פרטית לרותם בדיוני');
  assert.equal(pillA11y(bless(), t), 'ברכה אישית למשפחת פלוני');
});

test('hasReplyRow: nothing to show means no row', () => {
  assert.equal(hasReplyRow(msg({ replierCount: 0 }), 'member'), false);
  assert.equal(hasReplyRow(msg({ replierCount: 2 }), 'listener'), true);
  assert.equal(hasReplyRow(msg({ replyTo: 'author', canReply: true }), 'member'), true);
});

test('deleteMessageBody: plain at 0 replies, the count when there are some', () => {
  assert.equal(deleteMessageBody(0, t), 'ההודעה תימחק לכל הקהילה.');
  assert.equal(deleteMessageBody(undefined, t), 'ההודעה תימחק לכל הקהילה.');
  assert.equal(deleteMessageBody(3, t), 'ההודעה תימחק לכל הקהילה, ואיתה 3 התשובות הפרטיות שהגיעו עליה. אי אפשר לשחזר.');
});

test('deleteReplyBody: the person for author/adult, the family for family', () => {
  const r = (to: string, toName?: string): Reply => ({ replyId: 'R1', authorId: 'me', authorName: 'x', body: 'b', createdAt: 1, to, toName });
  assert.equal(deleteReplyBody(r('author'), msg(), t), 'היא תימחק גם אצל רותם בדיוני.');
  assert.equal(deleteReplyBody(r('family'), bless(), t), 'היא תימחק גם אצל המשפחה.');
  assert.equal(deleteReplyBody(r('u-shulamit', 'שולמית פלוני'), bless(), t), 'היא תימחק גם אצל שולמית פלוני.');
});

test('receivedOrder: newest first, mine left out, personal flag from the reply', () => {
  const r = (id: string, over: Partial<Reply> = {}): Reply => ({ replyId: id, authorId: 'u-' + id, authorName: 'n' + id, body: 'b', createdAt: 1, to: 'family', ...over });
  const list = [r('A'), r('C', { personal: true, unread: true }), r('B'), r('Z', { authorId: 'me' })];
  const out = receivedOrder(list, 'me');
  assert.deepEqual(out.map(x => x.reply.replyId), ['C', 'B', 'A']);
  assert.deepEqual(out.map(x => x.personal), [true, false, false]);
  assert.deepEqual(list.map(x => x.replyId), ['A', 'C', 'B', 'Z'], 'input is not mutated');
});

test('sentText to a named adult, with toName', () => {
  const rep: Reply = { replyId: 'R1', authorId: 'me', authorName: 'x', body: 'b', createdAt: 1, to: 'u-shulamit', toName: 'שולמית פלוני' };
  assert.equal(sentText(rep, bless(), 'היום, 09:58', t), 'נשלחה אל שולמית פלוני בלבד · היום, 09:58');
});

test('spouses: each mailbox counts only what that spouse may see (A: 11 with 2 personal, B: 10 with 1)', () => {
  const th = (total: number, personal: number, unread: number): InboxThread => ({ message: bless(), total, unread, personal, replies: [] });
  const a = { unread: 2, threads: [th(11, 2, 2)] };
  const b = { unread: 2, threads: [th(10, 1, 2)] };
  assert.equal(threadLine(a.threads[0]!, t), 'ברכות למשפחה שלכם · 11 ברכות · 2 אישיות · 2 חדשות');
  assert.equal(threadLine(b.threads[0]!, t), 'ברכות למשפחה שלכם · 10 ברכות · אישית אחת · 2 חדשות');
  assert.equal(mailboxStatus(a, t), '2 חדשות');
  assert.equal(mailboxStatus({ unread: 3, threads: a.threads }, t), '3 חדשות');
  assert.equal(mailboxStatus({ unread: 0, threads: a.threads }, t), 'אין חדשות');
  assert.equal(mailboxStatus({ unread: 0, threads: [] }, t), 'עוד לא הגיעו תשובות');
});

test('n = 1 picks the singular in Hebrew and English', () => {
  const th = (over: Partial<InboxThread>): InboxThread => ({ message: msg(), total: 3, unread: 0, personal: 0, replies: [], ...over });
  assert.equal(mailboxStatus({ unread: 1, threads: [th({ unread: 1 })] }, t), '1 חדשה');
  assert.equal(newText(1, t), '1 חדשה');
  assert.equal(newText(2, t), '2 חדשות');
  assert.equal(threadLine(th({ total: 1 }), t), 'הודעה שלכם · תשובה אחת');
  assert.equal(threadLine(th({ message: bless(), total: 1 }), t), 'ברכות למשפחה שלכם · ברכה אחת');
  assert.equal(threadLine(th({ message: bless(), total: 10, personal: 1, unread: 1 }), t), 'ברכות למשפחה שלכם · 10 ברכות · אישית אחת · 1 חדשה');
  assert.equal(moreText(1, t), 'עוד תשובה אחת');
  assert.equal(moreText(2, t), 'עוד 2 תשובות');
  assert.equal(countText(msg({ replierCount: 1 }), t), 'תשובה פרטית אחת');
  assert.equal(countText(bless({ replierCount: 1 }), t), 'ברכה אישית אחת');
  assert.equal(countText(msg({ type: 'condolence', replierCount: 1 }), t), 'חבר אחד כתב למשפחה');
  const te = (key: string, p?: Record<string, string | number>): string => look(en, key).replace(/\{(\w+)\}/g, (_m: string, n: string) => String(p?.[n]));
  assert.equal(threadLine(th({ message: bless(), total: 1, personal: 1, unread: 1 }), te), 'To your family · 1 blessing · 1 personal · 1 new');
  assert.equal(mailboxStatus({ unread: 1, threads: [th({ unread: 1 })] }, te), '1 new');
  assert.equal(moreText(1, te), '1 more reply');
  assert.equal(threadLine(th({ total: 1 }), te), 'Your message · 1 reply');
});

test('withReplyFields merges the single GET fields into the feed copy; needsReplyFields asks for them once', () => {
  const feedCopy = bless({ replyAdults: undefined, canReply: true, replierCount: 3 });
  const full = bless({ canReply: true, replierCount: 1, replyBlocked: 'author_left' });
  assert.equal(needsReplyFields(feedCopy), true);
  const merged = withReplyFields(feedCopy, full);
  assert.equal(merged.replierCount, 3);
  assert.equal(merged.replyAdults?.length, 2);
  assert.equal(merged.replyBlocked, 'author_left');
  assert.equal(needsReplyFields(merged), false);
  assert.equal(needsReplyFields({ ...feedCopy, canReply: false }), false);
  assert.equal(withReplyFields(feedCopy, undefined), feedCopy);
  assert.equal(toChoices(merged, t).length, 3);
});
