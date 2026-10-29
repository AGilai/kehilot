import React from 'react';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Message } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ActivityIndicator } from 'react-native';
import { Banner, Sheet, Toast, Txt, useTokens } from '../../kit/components.tsx';
import { headingText } from '../../client/replyView.ts';
import type { ReplyTo } from '../../client/replyView.ts';
import { ReplyBox, defaultTo } from './ReplyBox.tsx';

/**
 * P48 1b: the reply Sheet from the card. Fetches the single message (it carries the adults to choose from), shows
 * "על: {title}" muted, then the box. Closes on send with the Toast "נשלחה". The Sheet is a Modal, which traps focus
 * and returns it to the pill that opened it.
 */
export function ReplySheet({ messageId, visible, onClose }: { messageId: string; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const { state, loadHit } = useSession();
  const [full, setFull] = React.useState<Message | null>(null);
  const [toast, setToast] = React.useState(false);
  const [to, setTo] = React.useState<ReplyTo>('author');
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!visible) return;
    let live = true;
    setFull(null); setFailed(false);
    loadHit(messageId).then(h => {
      if (!live) return;
      if (h.kind === 'full') { setFull(h.message); setTo(defaultTo(h.message)); } else setFailed(true);
    }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [visible, messageId, loadHit, attempt]);
  React.useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(false), 2500);
    return () => clearTimeout(id);
  }, [toast]);
  // The feed's copy keeps the live flags (replied, count); the fetched one adds replyAdults / replyBlocked.
  const feedCopy = state.feed.messages[messageId];
  const m = full ? { ...full, ...(feedCopy ? { replierCount: feedCopy.replierCount, replied: feedCopy.replied } : null) } : null;
  return (
    <>
      <Sheet visible={visible} title={m ? headingText(m, to, t) : t('reply.button.general')} onClose={onClose}>
        {m ? (
          <>
            {m.title ? <Txt content size="small" color={k.muted}>{t('reply.about', { title: m.title })}</Txt> : null}
            <ReplyBox message={m} to={to} onTo={setTo} hideHeading onSent={() => { setToast(true); onClose(); }} />
          </>
        ) : failed ? <Banner tone="error" text={t('session.loadError')} action={{ title: t('common.retry'), onPress: () => setAttempt(a => a + 1) }} />
          : <ActivityIndicator color={k.tekhelet} />}
      </Sheet>
      <Toast text={t('reply.toast')} visible={toast} />
    </>
  );
}
