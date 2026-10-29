import React from 'react';
import { Pressable, View } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import { buttonState, headingText, replyKind } from '../../client/replyView.ts';
import { roleFeatures } from '../../client/roleView.ts';
import { isManagement } from '../../client/roles.ts';
import type { Message } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import type { IconName } from '../../kit/Icon.tsx';
import { useErrorText } from '../auth/Frame.tsx';
import { defaultTo } from './ReplyBox.tsx';

/** The 500 ms long-press delay on the card, shared with the card's Pressable. */
export const LONG_PRESS_MS = 500;

function ActionRow({ icon, label, color, onPress }: { icon: IconName; label: string; color?: string; onPress: () => void }) {
  const k = useTokens();
  const c = color ?? k.ink;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: k.line }}>
      <Icon name={icon} size={22} color={c} />
      <Txt bold color={c} style={{ flex: 1 }}>{label}</Txt>
    </Pressable>
  );
}

/**
 * P48 1a: the card's actions Sheet. Opens on a 500 ms long press and, on web, from the card's `more` button. The
 * reply row comes first (only while the person can reply), then "פתיחת ההודעה", then mute (the member) and delete
 * (the author or management). Every action is also on M3.
 */
export function CardActions({ message, visible, onClose, onReply, onOpen }: {
  message: Message; visible: boolean; onClose: () => void; onReply: () => void; onOpen: () => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const { state, setNotify, removeMessage } = useSession();
  const { kehila, me } = state;
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!kehila || !me) return null;
  const role = kehila.role;
  const canReply = buttonState(message, role) === 'reply';
  const canMute = roleFeatures(role).directory && message.authorKind === 'member' && message.type !== 'chat' && message.authorId !== me.userId;
  const muted = kehila.notify.mutedMembers.includes(message.authorId);
  const canDelete = message.authorId === me.userId || isManagement(role);
  const n = message.replierCount ?? 0;

  async function doMute() {
    setError(null);
    const list = kehila!.notify.mutedMembers.filter(x => x !== message.authorId);
    try { await setNotify({ mutedMembers: muted ? list : [...list, message.authorId] }); onClose(); } catch (e) { setError(errText(e)); }
  }
  async function doDelete() {
    setConfirm(false); onClose();
    try { await removeMessage(message.messageId); } catch { /* the card stays; M3 shows the error */ }
  }

  return (
    <>
      <Sheet visible={visible && !confirm} title={t('actions.title')} onClose={onClose}>
        {message.title ? <Txt content size="small" color={k.muted} numberOfLines={2}>{message.title}</Txt> : null}
        {error ? <Banner tone="error" text={error} /> : null}
        <View>
          {canReply ? <ActionRow icon={replyKind(message.type) === 'general' ? 'reply' : 'heart'} label={headingText(message, defaultTo(message), t)} color={k.tekhelet} onPress={() => { onClose(); onReply(); }} /> : null}
          <ActionRow icon="eye" label={t('actions.open')} onPress={() => { onClose(); onOpen(); }} />
          {canMute ? <ActionRow icon={muted ? 'bell' : 'belloff'} label={muted ? t('detail.unmuteMember') : t('detail.muteMember')} onPress={() => void doMute()} /> : null}
          {canDelete ? <ActionRow icon="trash" label={t('detail.delete')} color={k.danger} onPress={() => setConfirm(true)} /> : null}
        </View>
      </Sheet>
      <Sheet visible={visible && confirm} title={t('detail.deleteTitle')} onClose={() => setConfirm(false)}>
        <Txt>{n > 0 ? t('detail.deleteBodyReplies', { n }) : t('detail.deleteBody')}</Txt>
        <Button kind="danger" title={t('detail.deleteYes')} onPress={() => void doDelete()} />
      </Sheet>
    </>
  );
}
