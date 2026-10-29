import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixtureApi } from '../src/client/fixtures.ts';

// Names are invented (src/client/fixtureReplies.ts).
const K = '01FIXTUREKEHILA0000000001';
const load = async (screen: string, role: 'member' | 'listener' = 'member') => {
  const api = createFixtureApi(role, screen, 'he');
  const messages = await api.messages(K, {});
  return { api, messages };
};

test('p48: viewer fields, one reply per person, edit and delete', async () => {
  const { api, messages } = await load('p48-picker');
  const mazal = messages.find(m => m.type === 'celebration')!;
  assert.equal(mazal.replyTo, 'family');
  assert.equal(mazal.canReply, true);
  assert.equal(mazal.replied, false);
  assert.equal(mazal.replierCount, 12);
  const one = await api.message(K, mazal.messageId);
  assert.deepEqual(one.replyAdults?.map(a => a.name), ['שולמית ברקן', 'יגאל ברקן']);
  assert.deepEqual(await api.replies(K, mazal.messageId), []); // 12 replies, none readable by an outsider
  const r = await api.postReply(K, mazal.messageId, 'מזל טוב', one.replyAdults![1]!.userId);
  assert.equal(r.toName, 'יגאל ברקן');
  await assert.rejects(api.postReply(K, mazal.messageId, 'עוד אחת'), { code: 'already_replied' });
  assert.equal((await api.message(K, mazal.messageId)).replierCount, 13);
  const edited = await api.putReply(K, mazal.messageId, r.replyId, 'מזל טוב מאוד');
  assert.equal(edited.body, 'מזל טוב מאוד');
  await api.deleteReply(K, mazal.messageId, r.replyId);
  assert.equal((await api.message(K, mazal.messageId)).replied, false);
  await assert.rejects(api.deleteReply(K, mazal.messageId, r.replyId), { code: 'reply_not_found' });
});

test('p48: each spouse reads the family replies and their own personal ones only', async () => {
  const a = await load('p48-inbox-a');
  const b = await load('p48-inbox-b');
  const inboxA = await a.api.inbox(K);
  const inboxB = await b.api.inbox(K);
  assert.deepEqual([inboxA.threads[0]!.total, inboxA.threads[0]!.personal, inboxA.threads[0]!.unread], [11, 2, 1]);
  assert.deepEqual([inboxB.threads[0]!.total, inboxB.threads[0]!.personal, inboxB.threads[0]!.unread], [10, 1, 2]);
  assert.equal(inboxA.threads[0]!.replies.length, 3);
  const id = inboxA.threads[0]!.message.messageId;
  const mine = await a.api.replies(K, id);
  assert.equal(mine.length, 11);
  assert.ok(mine.every(r => r.to === 'family' || r.personal));
});

test('p48: the author reads the replies, marks them seen; a gabbai and a listener get nothing', async () => {
  const { api } = await load('p48-author');
  const inbox = await api.inbox(K);
  assert.equal(inbox.unread, 2);
  const th = inbox.threads[0]!;
  assert.equal(th.message.isRecipient, true);
  await api.markRepliesRead(K, th.message.messageId, th.replies[0]!.replyId);
  assert.equal((await api.inbox(K)).unread, 0);
  const g = createFixtureApi('gabbai', 'p48-m3', 'he');
  assert.deepEqual((await g.inbox(K)).threads, []);
  const author = (await g.messages(K, {})).find(m => m.type === 'general' && m.replyTo)!;
  assert.deepEqual(await g.replies(K, author.messageId), []);
  await assert.rejects(createFixtureApi('listener', 'p48-m3', 'he').inbox(K), { code: 'forbidden' });
});
