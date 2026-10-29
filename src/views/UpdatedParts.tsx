import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Tag, Txt, useTokens } from '../kit/components.tsx';
import { eventChangeLabel, eventChangeParts, isCancelled, updatedLine, updatedMeta } from '../client/messageView.ts';
import type { Message } from '../client/types.ts';

/** The meta line: "{type} · {time}" plus " · עודכן 14:30" / " · שונה 11:05" with the first word bold. */
export function MetaText({ message, meta }: { message: Message; meta: string }) {
  const { t } = useI18n();
  const k = useTokens();
  const upd = updatedMeta(message, t);
  const space = upd ? upd.indexOf(' ') : -1;
  return (
    <Txt size="caption" color={k.muted} style={{ flexShrink: 1 }}>
      {meta}
      {upd ? <>{' · '}<Txt size="caption" bold color={k.muted}>{space > 0 ? upd.slice(0, space) : upd}</Txt>{space > 0 ? upd.slice(space) : ''}</> : null}
    </Txt>
  );
}

/** An event whose time, date or place changed: "בשעה ~~20:30~~ 21:00". Struck runs are not read, so the label says "old ← new". */
export function ChangeLine({ message, lines }: { message: Message; lines?: number }) {
  const { lang } = useI18n();
  const k = useTokens();
  const parts = eventChangeParts(message, lang);
  if (!parts) return null;
  return (
    <View accessible accessibilityLabel={eventChangeLabel(parts)}>
    <Txt size="small" numberOfLines={lines}>
      {parts.map((p, i) => (
        <Txt key={i} size="small" bold={!p.struck && i % 3 === 2} color={p.struck ? k.muted : undefined}
          style={p.struck ? { textDecorationLine: 'line-through' } : undefined}>{p.text}</Txt>
      ))}
    </Txt>
    </View>
  );
}

export function CancelledTag({ message }: { message: Message }) {
  const { t } = useI18n();
  if (!isCancelled(message)) return null;
  return <View style={{ alignSelf: 'flex-start' }}><Tag label={t('msg.cancelled')} tone="pomegranate" /></View>;
}

/** The card's closing caption above a hairline (updated condolence with shiva details). */
export function UpdatedFooter({ message }: { message: Message }) {
  const { t } = useI18n();
  const k = useTokens();
  const line = updatedLine(message, t);
  if (!line) return null;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: k.line, paddingTop: 6 }}>
      <Txt size="caption" color={k.muted}>{line}</Txt>
    </View>
  );
}
