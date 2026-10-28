// Sheet "פריט בגיליון" (UX-DESIGN §19.3, P44 phone 3): edit the line, see it as printed, move it, open its message, take it off the sheet.
import React from 'react';
import { View } from 'react-native';
import { editLine, lineOf, lineText } from '../../../client/sheetItems.ts';
import type { SheetItem } from '../../../client/types.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Button, Field, Sheet, Txt, useTokens } from '../../../kit/components.tsx';
import { NavRow } from '../../../kit/NavRows.tsx';
import { PAPER } from '../../../schedule/sheetModel.ts';
import { PaperLine } from './FreeItemSheet.tsx';

export function ItemSheet({ item, index, count, onClose, onSave, onMove, onOpen, onRemove, busy }: {
  item: SheetItem | null; index: number; count: number; onClose: () => void; onSave: (line: { text: string; bold: string }) => void;
  onMove: (direction: 'up' | 'down') => void; onOpen: () => void; onRemove: () => void; busy?: boolean;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const [text, setText] = React.useState('');
  const start = item ? lineText(item) : { text: '', bold: '' };
  React.useEffect(() => { setText(item ? lineText(item).text : ''); }, [item?.itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return <Sheet visible={false} title="" onClose={onClose}><View /></Sheet>;
  const next = editLine(item, text);
  const preview = { ...item, line: next };
  const dirty = text !== start.text;
  return (
    <Sheet visible title={t('sheetItems.item.title')} onClose={onClose} closeLabel={t('common.cancel')}
      footer={<Button title={t('common.save')} busy={busy} disabled={!dirty || !text.trim()} onPress={() => onSave(next)} />}>
      <View style={{ gap: 6 }}>
        <Field label={t('sheetItems.item.line')} value={text} onChangeText={setText} multiline />
        {next.bold ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Txt size="caption" color={k.muted}>{t('sheetItems.freeSurname')}</Txt><Txt size="small" bold color={PAPER.pom} content>{next.bold}</Txt></View> : null}
        <Txt size="small" color={k.muted}>{t('sheetItems.item.lineHelp')}</Txt>
      </View>
      <PaperLine line={lineOf(preview)} label={t('sheetItems.preview')} />
      <View style={{ borderWidth: 1, borderColor: k.line, borderRadius: 12, backgroundColor: k.surface, overflow: 'hidden' }}>
        <NavRow action icon="up" title={t('sheetItems.item.up')} onPress={index > 1 ? () => onMove('up') : undefined} />
        <NavRow action icon="chev" title={t('sheetItems.item.down')} onPress={index < count ? () => onMove('down') : undefined} />
        {item.kind === 'message' && item.message ? <NavRow action icon="msg" title={t('sheetItems.item.open')} status={item.postedBy || undefined} onPress={onOpen} /> : null}
      </View>
      <NavRow action danger icon="trash" title={t('sheetItems.item.remove')} onPress={onRemove} />
    </Sheet>
  );
}
