// The history list (UX-DESIGN §16.5): versions newest first with their dates, when saved and how many seats; past ones open read-only, "restore"
// makes a new draft from one. The server records no author, so none is shown.
import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Tag, Txt, useTokens } from '../../../kit/components.tsx';
import { whenLabel } from '../../../seats/mapSave.ts';
import type { HistoryRow } from '../../../seats/mapSave.ts';
import { Dialog } from './Dialog.tsx';

export function HistoryDialog({ visible, rows, openFrom, dirtyCount, dateLabel, onOpen, onView, onRestore, onClose }: {
  visible: boolean; rows: HistoryRow[]; openFrom: string | null; dirtyCount: number; dateLabel: (from: string) => string;
  onOpen: (from: string) => void; onView: (from: string) => void; onRestore: (from: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <Dialog visible={visible} title={t('seatMap.history.title')} onClose={onClose} width={640} footer={<Button kind="secondary" title={t('common.close')} onPress={onClose} />}>
      {dirtyCount ? <Banner text={t('seatMap.history.draft', { n: dirtyCount })} /> : null}
      {rows.length === 0 ? <Txt color={k.muted}>{t('seatMap.history.none')}</Txt> : null}
      {rows.map((r) => (
        <View key={r.from} style={{ gap: 6, padding: 12, borderRadius: 10, borderWidth: r.from === openFrom ? 2 : 1, borderColor: r.from === openFrom ? k.tekhelet : k.line, backgroundColor: k.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Txt bold>{t('seatMap.history.row', { n: r.n, from: dateLabel(r.from) })}</Txt>
            {r.current ? <Tag label={t('seatMap.history.current')} tone="strong" /> : null}
            {r.scheduled ? <Tag label={t('seatMap.history.scheduled')} /> : null}
            {r.from === openFrom ? <Tag label={t('seatMap.history.opened')} /> : null}
          </View>
          <Txt size="small" color={k.muted}>{[r.until ? t('seatMap.history.until', { to: dateLabel(r.until) }) : '', t('seatMap.history.saved', { when: whenLabel(r.updatedAt) }), t('seatMap.history.counts', { seats: r.seats, assigned: r.assigned })].filter(Boolean).join(' · ')}</Txt>
          {r.readOnly && !r.current ? <Txt size="caption" color={k.muted}>{t('seatMap.history.readOnly')}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {r.readOnly && !r.current ? <Button kind="secondary" title={t('seatMap.history.view')} onPress={() => onView(r.from)} /> : <Button kind="secondary" title={t('seatMap.history.open')} disabled={r.from === openFrom} onPress={() => onOpen(r.from)} />}
            <Button kind="secondary" title={t('seatMap.history.restore')} disabled={r.from === openFrom} onPress={() => onRestore(r.from)} />
          </View>
        </View>
      ))}
    </Dialog>
  );
}
