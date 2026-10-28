// The effective-date dialog (UX-DESIGN §16.5): a one-line diff, the Shabbat select (default = the first one not yet open for release), the
// replace and open-week warnings (ruling 6), progress of the three writes, partial-save handling. A conflict closes this dialog; the parent opens
// the conflict dialog.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../../../kit/components.tsx';
import { dateRange } from '../../../schedule/memberView.ts';
import { scheduleWeekOf } from '../../../schedule/week.ts';
import type { SeatLayoutRow } from '../../../client/endpoints.ts';
import { summarize } from '../../../seats/editModel.ts';
import type { ChangeSet, DraftIssue } from '../../../seats/editModel.ts';
import { defaultEffectiveFrom, effectiveOptions, replaceWarning } from '../../../seats/effectiveFrom.ts';
import type { SaveProgress, SaveResult, SaveStage } from '../../../seats/runSave.ts';
import { useShabbatTitle } from '../../ScheduleCard.tsx';
import { Select } from '../scheduleEditor/controls.tsx';
import { Dialog } from './Dialog.tsx';

export type SavePhase = { name: 'idle' } | { name: 'running'; progress: SaveProgress } | { name: 'failed'; result: Extract<SaveResult, { ok: false }>; text: string };

export function SaveDialog({ shifts, visible, cs, issues, layouts, openedFrom, now, from, onFrom, isOpen, phase, newHolders, onGo, onClose, partial }: {
  /** The change moved seats (a row or column added or removed in front of others). */ shifts: boolean; visible: boolean; cs: ChangeSet; issues: DraftIssue[]; layouts: SeatLayoutRow[]; openedFrom: string | null; now: Date; from: string; onFrom: (f: string) => void;
  /** Ruling 6: that Shabbat already takes answers. */ isOpen: boolean; phase: SavePhase; newHolders: number; onGo: () => void; onClose: () => void;
  /** The partial-save card (holders made so far, retry/discard), shown after a failed write. */ partial: React.ReactNode;
}) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const title = useShabbatTitle();
  const busy = phase.name === 'running';
  const options = React.useMemo(() => {
    const list = effectiveOptions(now, 14);
    return (list.includes(from) ? list : [from, ...list]).map((f) => {
      const w = scheduleWeekOf(f);
      const hint = [f === defaultEffectiveFrom(now) ? t('seatMap.save.default') : '', f === openedFrom ? t('seatMap.save.opened') : layouts.some((l) => l.effectiveFrom === f) ? t('seatMap.save.hasVersion') : ''].filter(Boolean).join(' · ');
      return { key: f, label: title({ friday: w.friday, shabbat: w.shabbat, weekdays: [], thursday: w.thursday }), side: dateRange(w.friday, w.thursday, lang), hint: hint || undefined };
    });
  }, [now, from, layouts, openedFrom, title, t, lang]);
  const s = summarize(cs);
  const n = Object.keys(cs.cells).length + Object.keys(cs.assign).filter((p) => !(p in cs.cells)).length + (s.names ? 1 : 0) + (s.size ? 1 : 0);
  const parts = [s.assigned ? t('seatMap.save.assigned', { n: s.assigned }) : '', s.freed ? t('seatMap.save.freed', { n: s.freed }) : '', s.cells ? t('seatMap.save.cells', { n: s.cells }) : '', s.names ? t('seatMap.save.names') : '', s.size && !s.cells ? t('seatMap.save.size') : ''].filter(Boolean);
  // saving over a version of that date that is not the one opened replaces it (an in-place save of the opened version is the normal case)
  const warn = from === openedFrom ? null : replaceWarning(layouts.filter((l) => l.effectiveFrom === from), from);
  const issueText = (i: DraftIssue) => t(i.code === 'no-seats' ? 'seatMap.save.noSeats' : i.code === 'block-name' ? 'seatMap.save.blockName' : i.code === 'row-label' ? 'seatMap.save.rowLabel' : 'seatMap.save.tooManyBlocks');
  const cur = phase.name === 'running' ? phase.progress : null;
  const order: SaveStage[] = ['holders', 'layout', 'assignments'];
  const line = (stage: SaveStage, label: string) => {
    const failedAt = phase.name === 'failed' ? phase.result.stage : null;
    const done = (cur && (cur.step === 'done' || order.indexOf(cur.step) > order.indexOf(stage))) || (failedAt && order.indexOf(failedAt) > order.indexOf(stage));
    const active = cur && cur.step === stage;
    const bad = failedAt === stage;
    return (
      <View key={stage} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30 }}>
        <View style={{ width: 22, alignItems: 'center' }}>{active ? <ActivityIndicator color={k.tekhelet} size="small" /> : <Txt bold color={bad ? k.danger : done ? k.olive : k.muted}>{bad ? '!' : done ? '✓' : '○'}</Txt>}</View>
        <Txt color={active || done ? k.ink : k.muted} bold={!!active}>{label}</Txt>
      </View>
    );
  };
  const locked = phase.name === 'failed' && !phase.result.conflict;
  return (
    <Dialog visible={visible} title={t('seatMap.save.title')} onClose={() => { if (!busy && !locked) onClose(); }} width={600}
      footer={<><Button title={busy ? t('seatMap.save.saving') : t('seatMap.save.go')} busy={busy} disabled={busy || issues.length > 0 || n === 0} onPress={onGo} /><Button kind="secondary" title={t('seatMap.save.cancel')} disabled={busy || locked} onPress={onClose} /></>}>
      <Txt accessibilityLiveRegion="polite">{n ? t('seatMap.save.diff', { n, parts: parts.join(' · ') }) : t('seatMap.save.diffNone')}</Txt>
      {newHolders ? <Txt color={k.gold}>{t('seatMap.save.newHolders', { n: newHolders })}</Txt> : null}
      {shifts ? <Banner text={t('seatMap.save.shift')} /> : null}
      {issues.map((i, idx) => <Banner key={idx} tone="error" text={issueText(i)} />)}
      <View style={{ gap: 6, zIndex: 20 }}>
        <Txt bold>{t('seatMap.save.from')}</Txt>
        <View pointerEvents={busy || locked ? 'none' : 'auto'} style={{ opacity: busy || locked ? 0.5 : 1 }}><Select label={t('seatMap.save.from')} value={from} options={options} width={460} icon="cal" onChange={onFrom} /></View>
        <Txt size="small" color={k.muted}>{t('seatMap.save.fromHelp')}</Txt>
        {warn ? <Banner text={t('seatMap.save.replaces')} /> : null}
        {isOpen ? (
          <View accessibilityRole="alert" style={{ gap: 4, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: k.gold, borderStartWidth: 6, backgroundColor: k.surface }}>
            <Txt bold color={k.gold}>{t('seatMap.save.openTitle')}</Txt>
            <Txt size="small">{t('seatMap.save.openBody')}</Txt>
          </View>
        ) : null}
      </View>
      {phase.name !== 'idle' ? <Card>{line('holders', t('seatMap.save.stepHolders'))}{line('layout', t('seatMap.save.stepLayout'))}{line('assignments', t('seatMap.save.stepAssign'))}</Card> : null}
      {phase.name === 'failed' && !phase.result.conflict ? <Banner tone="error" text={phase.text} action={{ title: t('common.retry'), onPress: onGo }} /> : null}
      {phase.name === 'failed' && !phase.result.conflict ? partial : null}
    </Dialog>
  );
}
