// The conflict dialog (UX-DESIGN §16.5, reusable for a versioned editor): a newer version exists. Primary: re-apply my changes on top of it
// (overlapping places are listed with a choice, theirs kept by default). Also: show their changes, and "save anyway (overwrite)" behind a second
// confirm. Never a silent overwrite.
import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Txt, useTokens } from '../../../kit/components.tsx';
import { Radio } from '../seatEditor/bits.tsx';
import { Dialog } from './Dialog.tsx';

export type ConflictLine = { key: string; where: string; theirs: string; mine?: string; /** No choice: the place is no longer a seat in my version. */ gone?: boolean };
export type ConflictState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; theirsAt: string | null; theirs: number; yours: number; overlap: number; overlaps: ConflictLine[]; theirChanges: ConflictLine[] };

export function ConflictDialog({ visible, state, pick, onPick, onApply, onOverwrite, onClose, busy }: {
  visible: boolean; state: ConflictState; pick: Record<string, 'mine' | 'theirs'>; onPick: (key: string, v: 'mine' | 'theirs') => void;
  onApply: () => void; onOverwrite: () => void; onClose: () => void; busy: boolean;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const [show, setShow] = React.useState(false);
  const [sure, setSure] = React.useState(false);
  React.useEffect(() => { if (visible) { setShow(false); setSure(false); } }, [visible]);
  const ready = state.phase === 'ready' ? state : null;
  return (
    <Dialog visible={visible} alert title={t('seatMap.conflict.title')} onClose={onClose} width={620}
      footer={sure ? (
        <>
          <Txt size="small" bold color={k.danger} style={{ width: '100%' }}>{t('seatMap.conflict.sure')}</Txt>
          <Button kind="danger" title={t('seatMap.conflict.sureYes')} busy={busy} onPress={onOverwrite} />
          <Button kind="secondary" title={t('seatMap.save.cancel')} onPress={() => setSure(false)} />
        </>
      ) : (
        <>
          <Button title={t('seatMap.conflict.apply')} busy={busy} disabled={!ready || busy} onPress={onApply} />
          <Button kind="secondary" title={show ? t('seatMap.conflict.hide') : t('seatMap.conflict.show')} disabled={!ready} onPress={() => setShow((s) => !s)} />
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => setSure(true)} style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: k.danger, justifyContent: 'center' }}>
            <Txt bold color={k.danger}>{t('seatMap.conflict.overwrite')}</Txt>
          </Pressable>
          <Button kind="secondary" title={t('seatMap.conflict.later')} onPress={onClose} />
        </>
      )}>
      {state.phase === 'loading' ? <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><ActivityIndicator color={k.tekhelet} /><Txt color={k.muted}>{t('seatMap.conflict.loading')}</Txt></View> : null}
      {state.phase === 'error' ? <Banner tone="error" text={t('seatMap.conflict.failed')} /> : null}
      {ready ? (
        <>
          <Txt>{ready.theirsAt ? t('seatMap.conflict.body', { time: ready.theirsAt }) : t('seatMap.conflict.bodyNoTime')}</Txt>
          <Txt bold>{t('seatMap.conflict.counts', { theirs: ready.theirs, yours: ready.yours, overlap: ready.overlap })}</Txt>
          {ready.overlaps.length ? (
            <View style={{ gap: 6 }}>
              <Txt bold color={k.gold}>{t('seatMap.conflict.overlapTitle')}</Txt>
              {ready.overlaps.slice(0, 12).map((o) => (
                <View key={o.key} style={{ gap: 2, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: k.line }}>
                  <Txt size="small" bold content>{o.where}</Txt>
                  {o.gone ? <Txt size="small" color={k.muted}>{`${t('seatMap.conflict.theirs', { value: o.theirs })} · ${t('seatMap.conflict.gone')}`}</Txt> : <>
                  <Radio on={(pick[o.key] ?? 'theirs') === 'theirs'} label={t('seatMap.conflict.theirs', { value: o.theirs })} onPress={() => onPick(o.key, 'theirs')} />
                  <Radio on={pick[o.key] === 'mine'} label={t('seatMap.conflict.mine', { value: o.mine ?? '' })} onPress={() => onPick(o.key, 'mine')} /></>}
                </View>
              ))}
            </View>
          ) : null}
          {show ? (
            <View style={{ gap: 3 }}>
              {ready.theirChanges.length === 0 ? <Txt size="small" color={k.muted}>{t('seatMap.conflict.noChanges')}</Txt> : null}
              {ready.theirChanges.slice(0, 20).map((c) => <Txt key={c.key} size="small" content>{`${c.where}: ${c.theirs}`}</Txt>)}
            </View>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
