import React from 'react';
import { Pressable, View } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import { REPLY_MAX, COUNTER_FROM, deleteReplyBody, placeholder, replyTime, sentText } from '../../client/replyView.ts';
import type { Message, Reply } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { Composer } from '../../kit/Composer.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { useErrorText } from '../auth/Frame.tsx';

/**
 * §22.4: the reply I sent, in an olive-edged Card: "נשלחה אל … בלבד · …", the text, then "עריכה" and "מחיקה".
 * Edit swaps the text for a Composer (no recipient picker: the recipient is fixed) with "שמירה" and "ביטול".
 */
export function MyReply({ message, reply, onLayout }: { message: Message; reply: Reply; onLayout?: React.ComponentProps<typeof View>['onLayout'] }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const { editReply, deleteReply } = useSession();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(reply.body);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  async function save() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    try { await editReply(message.messageId, reply.replyId, body); if (alive.current) setEditing(false); }
    catch (e) { if (alive.current) setError(errText(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function remove() {
    setConfirm(false); setError(null);
    try { await deleteReply(message.messageId, reply.replyId); } catch (e) { if (alive.current) setError(errText(e)); }
  }
  const text = (label: string, onPress: () => void, color: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minHeight: TOUCH, minWidth: TOUCH, justifyContent: 'center' }}>
      <Txt bold color={color}>{label}</Txt>
    </Pressable>
  );

  return (
    <View onLayout={onLayout}>
      <Card edgeColor={k.olive}>
        <Txt size="caption" bold color={k.olive}>{sentText(reply, message, replyTime(reply.createdAt, lang, Date.now(), t), t)}</Txt>
        {error ? <Banner tone="error" text={error} /> : null}
        {editing ? (
          <>
            <Composer value={draft} onChange={setDraft} maxCodePoints={REPLY_MAX} counterFrom={COUNTER_FROM} counterLabel={n => t('reply.counter', { n })}
              placeholder={placeholder(message, t)} sendLabel={t('reply.save')} onSend={() => void save()} busy={busy} />
            <View style={{ alignSelf: 'flex-start' }}>{text(t('reply.cancel'), () => { setEditing(false); setDraft(reply.body); setError(null); }, k.tekhelet)}</View>
          </>
        ) : (
          <>
            <Txt content>{reply.body}</Txt>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {text(t('reply.edit'), () => { setDraft(reply.body); setEditing(true); }, k.tekhelet)}
              {text(t('reply.delete'), () => setConfirm(true), k.danger)}
            </View>
          </>
        )}
      </Card>
      <Sheet visible={confirm} title={t('reply.deleteTitle')} onClose={() => setConfirm(false)}>
        <Txt>{deleteReplyBody(reply, message, t)}</Txt>
        <Button kind="danger" title={t('reply.delete')} onPress={() => void remove()} />
        <Button kind="secondary" title={t('reply.cancel')} onPress={() => setConfirm(false)} />
      </Sheet>
    </View>
  );
}
