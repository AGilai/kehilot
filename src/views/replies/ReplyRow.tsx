import React from 'react';
import { Pressable, View } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import { buttonLabel, buttonState, countText, newText, pillA11y, pillTone, replyKind } from '../../client/replyView.ts';
import type { Message } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';

/** A card has a private-reply route when it is one of these types; used only by the compose preview. */
const PREVIEW_TYPES: Array<Message['type']> = ['general', 'event', 'celebration', 'condolence'];
export const previewHasRow = (m: Message): boolean => m.authorKind === 'member' && PREVIEW_TYPES.includes(m.type);

/**
 * §22.3 reply row under the card body: the count at the start, the pill at the end. Nothing when there is neither.
 * `preview` (the compose preview): a static pill, disabled, and no count.
 */
export function ReplyRow({ message, unreadNew = 0, onReply, onOpenReplies, preview }: {
  message: Message; unreadNew?: number; onReply?: () => void; onOpenReplies?: () => void; preview?: boolean;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const role = state.kehila?.role;
  const kind = replyKind(message.type);
  const tone = k[pillTone(message.type)];
  const count = preview ? null : countText(message, t);
  const btn = preview ? 'reply' : role ? buttonState(message, role) : 'none';
  if (!count && btn === 'none') return null;

  const heart = kind !== 'general';
  const countIcon = <Icon name={heart ? 'heart' : 'lock'} size={16} color={k.muted} />;
  // The condolence count is ash and never animates; the new marker is pomegranate and bold.
  const countView = count ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      <Txt size="small" bold color={k.muted}>{count}</Txt>
      {countIcon}
      {unreadNew > 0 ? <Txt size="small" bold color={k.pomegranate}>{' · '}{newText(unreadNew, t)}</Txt> : null}
    </View>
  ) : null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 48, borderTopWidth: 1, borderTopColor: k.line, marginTop: 4, paddingTop: 4 }}>
      {countView && onOpenReplies && message.isRecipient ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${count}${unreadNew > 0 ? '. ' + newText(unreadNew, t) : ''}`} onPress={onOpenReplies}
          style={{ minHeight: 48, justifyContent: 'center', flexShrink: 1 }}>{countView}</Pressable>
      ) : countView ?? <View />}
      {btn === 'reply' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={pillA11y(message, t)} accessibilityState={{ disabled: !!preview }} disabled={preview} onPress={onReply}
          hitSlop={{ top: 4, bottom: 4 }}
          style={{ height: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: tone, backgroundColor: k.surface }}>
          <Icon name={heart ? 'heart' : 'reply'} size={16} color={tone} />
          <Txt size="small" bold color={tone}>{buttonLabel(message, t)}</Txt>
        </Pressable>
      ) : btn === 'replied' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('reply.done')} onPress={onReply} hitSlop={{ top: 4, bottom: 4 }}
          style={{ height: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface }}>
          <Txt size="small" bold color={k.olive}>{t('reply.done')}</Txt>
          <Icon name="check" size={16} color={k.olive} />
        </Pressable>
      ) : null}
    </View>
  );
}
