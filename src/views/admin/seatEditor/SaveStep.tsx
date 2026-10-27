// Step 4 (UX-DESIGN §16.5): the effective Shabbat and the save. Three writes in a fixed order with visible progress:
// holders without an account, the layout, the assignments. A 409 is never overwritten without a second, explicit confirm.
import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider.tsx';
import { fixtureNow } from '../../../client/fixtures.ts';
import type { SeatLayoutRow } from '../../../client/endpoints.ts';
import { useSession } from '../../../client/SessionProvider.tsx';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../../../kit/components.tsx';
import { dateRange } from '../../../schedule/memberView.ts';
import { scheduleWeekOf } from '../../../schedule/week.ts';
import { defaultEffectiveFrom, effectiveOptions } from '../../../seats/effectiveFrom.ts';
import { effectiveFamilies } from '../../../seats/decisions.ts';
import type { MatchState } from '../../../seats/decisions.ts';
import { runSave } from '../../../seats/runSave.ts';
import type { SaveCarry, SaveProgress, SaveResult, SaveStage } from '../../../seats/runSave.ts';
import { assignmentsFor, buildLayout, holdersToCreate, refsFor } from '../../../seats/savePlan.ts';
import type { ParsedHall } from '../../../seats/paste.ts';
import { useShabbatTitle } from '../../ScheduleCard.tsx';
import { Select } from '../scheduleEditor/controls.tsx';
import { useAdminErrText } from '../shared.tsx';

type Phase = { name: 'idle' } | { name: 'running'; progress: SaveProgress } | { name: 'failed'; result: Extract<SaveResult, { ok: false }>; confirmOverwrite: boolean } | { name: 'done'; holders: number };

export function SaveStep({ parsed, state, blockNames, layouts, onLayouts, onBack, onDone }: {
  parsed: ParsedHall; state: MatchState; blockNames: string[]; layouts: SeatLayoutRow[]; onLayouts: (rows: SeatLayoutRow[]) => void; onBack: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const kehilaId = useSession().state.kehilaId!;
  const errText = useAdminErrText();
  const title = useShabbatTitle();
  const now = React.useMemo(() => fixtureNow() ?? new Date(), []);
  const [from, setFrom] = React.useState(() => defaultEffectiveFrom(now));
  const [phase, setPhase] = React.useState<Phase>({ name: 'idle' });
  const carry = React.useRef<SaveCarry>({});
  const options = React.useMemo(() => {
    const list = effectiveOptions(now, 14);
    return (list.includes(from) ? list : [from, ...list]).map((f) => {
      const w = scheduleWeekOf(f);
      const exists = layouts.some((l) => l.effectiveFrom === f);
      return { key: f, label: title({ friday: w.friday, shabbat: w.shabbat, weekdays: [], thursday: w.thursday }), side: dateRange(w.friday, w.thursday), hint: [f === defaultEffectiveFrom(now) ? t('seatEditor.save.default') : '', exists ? t('seatEditor.save.hasVersion') : ''].filter(Boolean).join(' · ') || undefined };
    });
  }, [now, from, layouts, title, t]);
  const built = React.useMemo(() => buildLayout(parsed, blockNames, state.cells), [parsed, blockNames, state.cells]);
  const holders = React.useMemo(() => holdersToCreate(parsed, state), [parsed, state]);
  const households = effectiveFamilies(parsed, state.cells).filter((f) => state.decisions[f.familyKey] && state.decisions[f.familyKey]!.kind !== 'skip').length;
  const existing = layouts.find((l) => l.effectiveFrom === from);

  const run = async (overwrite: boolean) => {
    if (!built) return;
    let guard = existing?.updatedAt ?? null;
    if (overwrite) {
      try {
        const fresh = (await api.seatLayouts(kehilaId)).layouts;
        onLayouts(fresh);
        guard = fresh.find((l) => l.effectiveFrom === from)?.updatedAt ?? null;
      } catch (e) { setPhase({ name: 'failed', result: { ok: false, stage: 'layout', code: (e as { code?: string }).code ?? 'generic', conflict: false, carry: carry.current }, confirmOverwrite: false }); return; }
    }
    setPhase({ name: 'running', progress: { step: 'holders', done: 0, total: holders.length } });
    const result = await runSave({
      from, layoutGuard: guard, holders, layout: built.layout,
      assign: (seats, created) => assignmentsFor(parsed, state.cells, built.rowOffset, seats, refsFor(state, created)),
    }, {
      createHolder: (b) => api.createSeatHolder(kehilaId, b),
      putLayout: (f, b) => api.putSeatLayout(kehilaId, f, b),
      assignmentsGuard: async (f) => (await api.seatAssignments(kehilaId, f)).updatedAt,
      putAssignments: (f, b) => api.putSeatAssignments(kehilaId, f, b),
    }, carry.current, (progress) => setPhase({ name: 'running', progress }));
    carry.current = result.carry;
    if (result.ok) {
      try { onLayouts((await api.seatLayouts(kehilaId)).layouts); } catch { /* the list is only a hint */ }
      setPhase({ name: 'done', holders: Object.keys(result.carry.created ?? {}).length });
    } else setPhase({ name: 'failed', result, confirmOverwrite: false });
  };

  const stageLine = (stage: SaveStage, label: string) => {
    const order: SaveStage[] = ['holders', 'layout', 'assignments'];
    const cur = phase.name === 'running' ? phase.progress : null;
    const failedAt = phase.name === 'failed' ? phase.result.stage : null;
    const doneStage = phase.name === 'done' || (cur && (cur.step === 'done' || order.indexOf(cur.step) > order.indexOf(stage))) || (failedAt && order.indexOf(failedAt) > order.indexOf(stage));
    const active = cur && cur.step === stage;
    const bad = failedAt === stage;
    const extra = stage === 'holders' && holders.length && (active || doneStage) ? ` (${cur && cur.step === 'holders' ? cur.done : holders.length}/${holders.length})` : '';
    return (
      <View key={stage} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 }}>
        <View style={{ width: 22, alignItems: 'center' }}>
          {active ? <ActivityIndicator color={k.tekhelet} size="small" /> : <Txt bold color={bad ? k.danger : doneStage ? k.olive : k.muted}>{bad ? '!' : doneStage ? '✓' : '○'}</Txt>}
        </View>
        <Txt color={active || doneStage ? k.ink : k.muted} bold={!!active}>{label}{extra}</Txt>
      </View>
    );
  };
  const busy = phase.name === 'running';
  const failed = phase.name === 'failed' ? phase : null;
  const failText = failed ? (failed.result.code === 'invalid_layout' && failed.result.field ? `${errText({ code: failed.result.code })} (${failed.result.field})` : errText({ code: failed.result.code })) : '';
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: k.surface, borderBottomWidth: 1, borderBottomColor: k.line }}>
        <Button kind="secondary" title={t('seatEditor.save.back')} disabled={busy || phase.name === 'done'} onPress={onBack} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, width: '100%', maxWidth: 760, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {phase.name === 'done' ? (
          <>
            <Banner tone="success" text={t('seatEditor.save.done', { seats: parsed.counts.seats, holders: phase.holders })} />
            <Txt color={k.muted}>{t('seatEditor.save.doneHelp')}</Txt>
            <Button title={t('seatEditor.save.finish')} onPress={onDone} />
          </>
        ) : (
          <>
            <Txt serif size="heading" accessibilityRole="header">{t('seatEditor.save.title')}</Txt>
            <Card>
              <Txt>{t('seatEditor.save.summary', { seats: parsed.counts.seats, households, blocks: parsed.blocks.length })}</Txt>
              <Txt color={holders.length ? k.gold : k.muted}>{holders.length ? t('seatEditor.save.newHolders', { n: holders.length }) : t('seatEditor.save.noNewHolders')}</Txt>
            </Card>
            <View style={{ gap: 6, zIndex: 20 }}>
              <Txt bold>{t('seatEditor.save.from')}</Txt>
              <Select label={t('seatEditor.save.from')} value={from} options={options} width={420} icon="cal" onChange={(f) => { if (!busy) setFrom(f); }} />
              <Txt size="small" color={k.muted}>{t('seatEditor.save.fromHelp')}</Txt>
              {existing ? <Banner text={t('seatEditor.save.replaces')} /> : null}
            </View>
            {!built ? <Banner tone="error" text={t('seatEditor.save.notReady')} /> : null}
            {phase.name !== 'idle' ? (
              <Card>
                {stageLine('holders', t('seatEditor.save.stepHolders'))}
                {stageLine('layout', t('seatEditor.save.stepLayout'))}
                {stageLine('assignments', t('seatEditor.save.stepAssign'))}
              </Card>
            ) : null}
            {failed && failed.result.conflict ? (
              <View accessibilityRole="alert" style={{ gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: k.gold, borderStartWidth: 6, backgroundColor: k.surface }}>
                <Txt bold>{t('seatEditor.save.conflictTitle')}</Txt>
                <Txt size="small">{t(failed.result.stage === 'layout' ? 'seatEditor.save.conflictLayout' : 'seatEditor.save.conflictAssign')}</Txt>
                {failed.confirmOverwrite ? (
                  <>
                    <Txt size="small" bold color={k.danger}>{t('seatEditor.save.overwriteSure')}</Txt>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Button kind="danger" title={t('seatEditor.save.overwriteYes')} onPress={() => { void run(true); }} />
                      <Button kind="secondary" title={t('seatEditor.save.cancel')} onPress={() => setPhase({ name: 'failed', result: failed.result, confirmOverwrite: false })} />
                    </View>
                  </>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Button kind="danger" title={t('seatEditor.save.overwrite')} onPress={() => setPhase({ name: 'failed', result: failed.result, confirmOverwrite: true })} />
                    <Button kind="secondary" title={t('seatEditor.save.cancel')} onPress={() => setPhase({ name: 'idle' })} />
                  </View>
                )}
              </View>
            ) : failed ? <Banner tone="error" text={failText} action={{ title: t('common.retry'), onPress: () => { void run(false); } }} /> : null}
            <Button title={busy ? t('seatEditor.save.saving') : t('seatEditor.save.go')} busy={busy} disabled={busy || !built || (!!failed && failed.result.conflict)} onPress={() => { void run(false); }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
