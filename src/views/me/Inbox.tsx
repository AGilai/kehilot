import React from 'react';
import { Pressable, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { roleFeatures } from '../../client/roleView.ts';
import { moreText, readUpTo, threadLine } from '../../client/replyView.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { InboxThread } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Icon, ForwardIcon } from '../../kit/Icon.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { BackLink } from '../Me.tsx';
import { Stripe } from '../MessageRow.tsx';
import { ReceivedRow } from '../replies/ReceivedList.tsx';

/** Newest activity first: the newest reply's id (ULIDs sort by time), else the message id. */
const activity = (th: InboxThread): string => th.replies.reduce((top, r) => (r.replyId > top ? r.replyId : top), th.message.messageId);

/**
 * §22.5 / P48 phones 3, 3a, 3b: Me › private replies. One card per answered message with the type's stripe, the title, the
 * thread line, up to three replies and "עוד {n} תשובות" (M3). Only what the server returned to this user is shown. Every
 * unread reply the card shows is reported seen; the dots stay for this visit. A replier's name links to the phone list
 * when that list has them.
 */
export function Inbox({ onBack, onOpen, onPhoneList }: { onBack: () => void; /** Opens M3 at "תשובות שהגיעו". */ onOpen: (messageId: string) => void; /** Opens the phone list. */ onPhoneList?: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state, markRepliesSeen, loadInbox } = useSession();
  const kehilaId = state.kehilaId;
  const canLink = !!onPhoneList && roleFeatures(state.kehila?.role).phoneList;
  const [listed, setListed] = React.useState<Set<string>>(() => new Set());
  const [fresh, setFresh] = React.useState<Set<string>>(() => new Set());
  const now = Date.now();

  React.useEffect(() => { void loadInbox().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!kehilaId || !canLink) return;
    let live = true;
    api.phoneList(kehilaId).then(rows => { if (live) setListed(new Set(rows.flatMap(f => f.people.map(p => p.userId)))); }, () => {});
    return () => { live = false; };
  }, [api, kehilaId, canLink]);

  const threads = [...(state.inbox?.threads ?? [])].sort((a, b) => (activity(a) < activity(b) ? 1 : -1));
  // What each card shows is read: remember which dots to keep for this visit, then tell the server.
  const sig = threads.map(th => `${th.message.messageId}:${th.unread}:${readUpTo(th) ?? ''}`).join('|');
  React.useEffect(() => {
    for (const th of threads) {
      const up = readUpTo(th);
      if (!up) continue;
      setFresh(prev => new Set([...prev, ...th.replies.filter(r => r.unread).map(r => r.replyId)]));
      void markRepliesSeen(th.message.messageId, up).catch(() => {});
    }
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 12, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} label={t('me.tab')} />
      <Txt serif size="title" accessibilityRole="header">{t('inbox.title')}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="lock" size={16} color={k.muted} />
        <Txt size="small" color={k.muted} style={{ flex: 1 }}>{t('inbox.privacy')}</Txt>
      </View>
      {threads.length === 0 ? <Txt color={k.muted}>{t('inbox.rowEmpty')}</Txt> : null}
      {threads.map(th => {
        const m = th.message;
        const more = th.total - th.replies.length;
        return (
          <View key={m.messageId} style={{ flexDirection: 'row', backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, overflow: 'hidden' }}>
            <Stripe type={m.type} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${m.title}. ${threadLine(th, t)}`} onPress={() => onOpen(m.messageId)}
                style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt serif bold numberOfLines={1}>{m.title}</Txt>
                  <Txt size="small" color={k.muted}>{threadLine(th, t)}</Txt>
                </View>
                <ForwardIcon color={k.muted} />
              </Pressable>
              {th.replies.map(r => (
                <ReceivedRow key={r.replyId} flat reply={r} personal={!!r.personal} unread={!!r.unread || fresh.has(r.replyId)} now={now}
                  onName={canLink && listed.has(r.authorId) ? onPhoneList : undefined} />
              ))}
              {more > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => onOpen(m.messageId)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: k.line }}>
                  <Txt size="small" bold color={k.tekhelet}>{moreText(more, t)}</Txt>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </PadScroll>
  );
}
