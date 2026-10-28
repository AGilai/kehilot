import React from 'react';
import { View } from 'react-native';
import type { SheetLine } from '../../client/templates.ts';
import type { Message } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import { PAPER } from '../../schedule/sheetModel.ts';
import { MessageRow } from '../MessageRow.tsx';

/** The gold dashed "missing" chip: the field's name, so colour is never the only cue (`ymiss` in P43). */
function MissingChip({ name }: { name: string }) {
  const k = useTokens();
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1.5, borderStyle: 'dashed', borderColor: k.gold }}>
      <Txt size="small" bold color={k.gold}>{name}</Txt>
    </View>
  );
}

/**
 * §19.2 item 3: what the message will look like, as members see it, and (for types on the sheet) the sheet line in the
 * paper colours with one caption. A `region`, not a live region: it would read every keystroke.
 */
export function TemplatePreview({ message, meta, sheetLine, caption, missing }: {
  message: Message; meta: string; sheetLine: SheetLine | null; caption: 'sheetAuto' | 'sheetPending' | null; /** Names of the required fields still empty. */ missing: string[];
}) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <View role="region" accessibilityLabel={t('compose.tpl.previewRegion')} style={{ gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: k.line, backgroundColor: k.stone }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="eye" size={16} color={k.muted} />
        <Txt size="caption" bold color={k.muted}>{t('compose.tpl.preview')}</Txt>
      </View>
      <MessageRow message={message} meta={meta} muted={false} onPress={() => {}} />
      {missing.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{missing.map(name => <MissingChip key={name} name={name} />)}</View>
      ) : null}
      {sheetLine && caption ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="print" size={16} color={k.muted} />
            <Txt size="caption" bold color={k.muted}>{t('compose.tpl.previewSheet')}</Txt>
          </View>
          <View style={{ padding: 12, gap: 2, borderRadius: 8, borderWidth: 1, borderColor: PAPER.line, backgroundColor: PAPER.paper }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
              {sheetLine.icon ? <Icon name={sheetLine.icon} size={16} color={PAPER.pom} /> : null}
              <Txt content color={PAPER.ink} style={{ flex: 1, textDecorationLine: sheetLine.cancelled ? 'line-through' : 'none' }}>
                {sheetLine.main.map((p, i) => <Txt key={i} content bold={p.bold} color={PAPER.ink}>{p.text}</Txt>)}
              </Txt>
            </View>
            {sheetLine.sub ? <Txt content size="small" color={PAPER.mute}>{sheetLine.sub}</Txt> : null}
            {sheetLine.blessing ? <Txt content size="small" color={PAPER.mute}>{sheetLine.blessing}</Txt> : null}
          </View>
          <Txt size="caption" color={k.muted}>{t(`compose.tpl.${caption}`)}</Txt>
        </View>
      ) : null}
    </View>
  );
}
