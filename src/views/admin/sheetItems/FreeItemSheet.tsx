// Sheet "פריט לשבוע הזה" (UX-DESIGN §19.3, P44 phone 3): a free line for this week's sheet only. Mazal tov, an event or a notice; no message
// and no notification are sent.
import React from 'react';
import { View } from 'react-native';
import type { SheetLine } from '../../../client/templates.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Button, Field, Segmented, Sheet, Txt, useTokens } from '../../../kit/components.tsx';
import { PAPER, mazalParts } from '../../../schedule/sheetModel.ts';

export type FreeKind = 'celebration' | 'event' | 'notice';

/** The line on paper colour, in the sheet's own ink: the family name bold. */
export function PaperLine({ line, label }: { line: Pick<SheetLine, 'main' | 'sub'>; label: string }) {
  const k = useTokens();
  return (
    <View style={{ gap: 6 }}>
      <Txt size="caption" bold color={k.muted}>{label}</Txt>
      <View accessible accessibilityLabel={[line.main.map(p => p.text).join(''), line.sub].filter(Boolean).join(' ')} style={{ backgroundColor: PAPER.paper, borderWidth: 1, borderColor: PAPER.line, borderRadius: 8, padding: 12, gap: 2 }}>
        <Txt content color={PAPER.ink}>
          {line.main.map((p, i) => <Txt key={i} bold={p.bold} color={p.bold ? PAPER.pom : PAPER.ink} content>{p.text}</Txt>)}
        </Txt>
        {line.sub ? <Txt size="small" color={PAPER.mute} content>{line.sub}</Txt> : null}
      </View>
    </View>
  );
}

export function FreeItemSheet({ visible, onClose, onAdd, busy }: { visible: boolean; onClose: () => void; onAdd: (body: { type: FreeKind; text: string; bold: string }) => void; busy?: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  const [kind, setKind] = React.useState<FreeKind>('celebration');
  const [surname, setSurname] = React.useState('');
  const [text, setText] = React.useState('');
  React.useEffect(() => { if (visible) { setKind('celebration'); setSurname(''); setText(''); } }, [visible]);
  const bold = kind === 'celebration' ? surname.trim() : '';
  const first = text.split('\n')[0] ?? '';
  const preview = { main: mazalParts(first, bold || undefined), sub: text.split('\n').slice(1).join(' ').trim() };
  return (
    <Sheet visible={visible} title={t('sheetItems.addFree')} onClose={onClose} closeLabel={t('common.cancel')}
      footer={<Button title={t('sheetItems.addBtn')} busy={busy} disabled={!text.trim()} onPress={() => onAdd({ type: kind, text: text.trim(), bold })} />}>
      <Segmented value={kind} onChange={setKind} options={[
        { key: 'celebration', label: t('sheetItems.freeMazal') }, { key: 'event', label: t('sheetItems.freeEvent') }, { key: 'notice', label: t('sheetItems.freeNotice') },
      ]} />
      {kind === 'celebration' ? <Field label={t('sheetItems.freeSurname')} value={surname} onChangeText={setSurname} maxLength={60} /> : null}
      <Field label={t('sheetItems.freeText')} value={text} onChangeText={setText} multiline maxLength={300} />
      {text.trim() ? <PaperLine line={preview} label={t('sheetItems.preview')} /> : null}
      <Txt size="small" color={k.muted}>{t('sheetItems.freeNote')}</Txt>
    </Sheet>
  );
}
