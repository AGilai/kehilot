import React from 'react';
import { View } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import { REPLY_MAX, COUNTER_FROM, headingText, lockText, placeholder, toChoices } from '../../client/replyView.ts';
import type { ReplyTo } from '../../client/replyView.ts';
import type { Message } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Chip, Txt, useTokens } from '../../kit/components.tsx';
import { Composer } from '../../kit/Composer.tsx';
import { useErrorText } from '../auth/Frame.tsx';

/** The recipient the box opens with: the whole family for a blessing, the author otherwise. */
export const defaultTo = (m: Message): ReplyTo => (m.replyTo === 'family' ? 'family' : 'author');

/** Errors after which this message can no longer be answered by this person. */
const ENDS = ['already_replied', 'author_left', 'target_left', 'cannot_reply_to_own'];

/**
 * §22.4 / 22.4a: heading, the "אל מי" picker (two adults), Composer with the lock line, send. Shared by the card's
 * Sheet and M3. "כל המשפחה" is preselected whenever the box mounts.
 */
export function ReplyBox({ message, onSent, to: toProp, onTo, hideHeading }: {
  message: Message; onSent: () => void;
  /** Controlled recipient (the Sheet shows the heading in its own title bar); omitted, the box keeps it itself. */
  to?: ReplyTo; onTo?: (to: ReplyTo) => void; hideHeading?: boolean;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const { sendReply } = useSession();
  const [draft, setDraft] = React.useState('');
  const [own, setOwn] = React.useState<ReplyTo>(defaultTo(message));
  const to = toProp ?? own;
  const setTo = (x: ReplyTo) => { setOwn(x); onTo?.(x); };
  const [busy, setBusy] = React.useState(false);
  const flying = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ended, setEnded] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  const gone = ended === 'target_left' || message.replyBlocked === 'target_left' ? t('detail.familyGone')
    : ended === 'author_left' || message.replyBlocked === 'author_left' ? t('reply.authorGone')
    : ended ? errText({ code: ended }) : null;
  if (gone) return <Banner text={gone} />;

  const choices = toChoices(message, t);

  async function send() {
    const body = draft.trim();
    if (!body || flying.current) return;
    flying.current = true;
    setBusy(true); setError(null);
    try {
      // `to` is left out for the author and for the whole family.
      await sendReply(message.messageId, body, to === 'author' || to === 'family' ? undefined : to);
      if (alive.current) { setDraft(''); onSent(); }
    } catch (e) {
      const code = (e as { code?: string } | null)?.code ?? '';
      if (!alive.current) return;
      if (ENDS.includes(code)) setEnded(code); else setError(errText(e));
    } finally { flying.current = false; if (alive.current) setBusy(false); }
  }

  return (
    <View style={{ gap: 10 }}>
      {hideHeading ? null : <Txt bold size="heading" accessibilityRole="header">{headingText(message, to, t)}</Txt>}
      {choices.length ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t('reply.to')} style={{ gap: 6 }}>
          <Txt size="small" bold color={k.muted}>{t('reply.to')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {choices.map(c => <Chip key={c.key} size="filter" radio icon={c.key === 'family' ? 'users' : 'user'} label={c.label} selected={to === c.key} onPress={() => setTo(c.key)} />)}
          </View>
        </View>
      ) : null}
      {error ? <Banner tone="error" text={error} /> : null}
      <Composer value={draft} onChange={setDraft} maxCodePoints={REPLY_MAX} counterFrom={COUNTER_FROM} counterLabel={n => t('reply.counter', { n })} placeholder={placeholder(message, t)}
        lockLine={lockText(message, to, t)} sendLabel={t('detail.send')} onSend={() => void send()} busy={busy} />
    </View>
  );
}
