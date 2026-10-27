// The formula builder (UX-DESIGN §14.2): label and note, fixed / formula / text-only, the formula as a sentence, the live result box,
// warnings with one-tap fixes, the "this week only" box and the footer. One component for the inline accordion (desktop) and the bottom
// sheet (phone): the controls are the same, they just wrap.
import React from 'react';
import { View } from 'react-native';
import { dayOfWeek, civilDate } from '../../../dates.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Check, Field, Txt, useTokens } from '../../../kit/components.tsx';
import { anchorDates, describe, parseClock } from '../../../schedule/formula.ts';
import { explainFormula, formulaWarnings } from '../../../schedule/editor.ts';
import type { FormulaPatch, IssueControl } from '../../../schedule/editor.ts';
import { clockLabel, dateRange } from '../../../schedule/memberView.ts';
import type { AnchorId, Clock, Formula, RowOverride, ScheduleWeek, Section, ShabbatDay, Text, Time, ZmanimFor } from '../../../schedule/types.ts';
import { FSeg, Labeled, Select, Stepper, TimeField, onKeys } from './controls.tsx';
import type { Option } from './controls.tsx';

const ltr = (value: string) => `⁦${value}⁩`;
const GROUPS: Array<{ key: 'Morning' | 'Noon' | 'Evening'; anchors: AnchorId[] }> = [
  { key: 'Morning', anchors: ['alotHaShachar', 'misheyakir', 'sunrise', 'sofZmanShmaMGA', 'sofZmanShmaGRA', 'sofZmanTfilaGRA'] },
  { key: 'Noon', anchors: ['chatzot', 'minchaGedola', 'minchaKetana', 'plagHaMincha'] },
  { key: 'Evening', anchors: ['sunset', 'candleLighting', 'tzeit', 'shabbatEnd'] },
];

export function useDayLetter(): (date: string) => string {
  const { lang } = useI18n();
  return date => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'he-IL', { timeZone: 'Asia/Jerusalem', weekday: lang === 'en' ? 'short' : 'narrow' }).format(civilDate(date));
}

/** The live result: the big time, the plain-language summary, the calculation step by step, and the anchor on each day (Sun-Thu: the picked one outlined). */
export function ResultBox({ time, week, zmanimFor, thisWeek }: { time: Time; week: ScheduleWeek; zmanimFor: ZmanimFor; thisWeek?: boolean }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const letter = useDayLetter();
  if (time.kind === 'none') return null;
  const explained = time.kind === 'formula' ? explainFormula(time.formula, week, zmanimFor) : null;
  const result = time.kind === 'fixed' ? time.at : explained?.result ?? null;
  const summary = time.kind === 'formula' ? describe(time.formula, lang) : t('editor.fixedSummary');
  let steps: string | null = null;
  if (time.kind === 'formula' && explained) {
    const f = time.formula;
    const pick = explained.days[explained.pick]!;
    const parts = [`${f.day === 'earliest' || f.day === 'latest' ? `${t(f.day === 'earliest' ? 'editor.stepEarliest' : 'editor.stepLatest')} ` : ''}${letter(pick.date)} ${ltr(clockLabel(explained.steps.anchor))}`];
    if (f.offset.minutes > 0) parts.push(`${t(f.offset.direction === 'before' ? 'editor.stepMinus' : 'editor.stepPlus', { n: f.offset.minutes })} = ${ltr(clockLabel(explained.steps.afterOffset))}`);
    if (f.rounding.mode !== 'none') parts.push(`${t('editor.stepRound')} = ${ltr(clockLabel(explained.steps.rounded))}`);
    if (explained.bound && explained.result) parts.push(`${t(explained.bound === 'notLaterThan' ? 'editor.stepNotAfter' : 'editor.stepNotBefore', { time: ltr(clockLabel(f[explained.bound]!)) })} = ${ltr(clockLabel(explained.result))}`);
    steps = parts.join(' ← ');
  }
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 14, borderRadius: 12, backgroundColor: k.surface, borderWidth: 1, borderColor: k.line }}>
      <View style={{ minWidth: 96, alignItems: 'flex-start', gap: 2 }}>
        {thisWeek ? <Txt size="caption" color={k.muted}>{t('schedule.thisWeek')}</Txt> : null}
        <Txt accessibilityRole="header" style={{ fontSize: 34, lineHeight: 42, fontVariant: ['tabular-nums'], writingDirection: 'ltr' }} bold color={k.tekhelet}>{result ? clockLabel(result) : '—'}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
        {result === null ? <Txt color={k.danger}>{t('editor.cannotCompute')}</Txt> : null}
        <Txt>{summary}</Txt>
        {steps ? <Txt size="small" color={k.muted}>{steps}</Txt> : null}
        {explained && explained.days.length > 1 ? (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {explained.days.map((d, i) => (
              <View key={d.date} style={{ minWidth: 56, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', borderWidth: i === explained.pick ? 2 : 1, borderColor: i === explained.pick ? k.tekhelet : k.line, backgroundColor: i === explained.pick ? k.stone : k.surface }}>
                <Txt size="caption" color={k.muted}>{letter(d.date)}{i === explained.pick ? ` · ${t(time.kind === 'formula' && time.formula.day === 'latest' ? 'editor.latestShort' : 'editor.earliestShort')}` : ''}</Txt>
                <Txt size="small" bold style={{ fontVariant: ['tabular-nums'], writingDirection: 'ltr' }}>{d.anchor ? clockLabel(d.anchor) : '—'}</Txt>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The gold dashed "this week only" box of one row. */
export function WeekOnlyBox({ editable, week, override, usual, canTime, onChange, error }: {
  editable: boolean; week: ScheduleWeek; override: RowOverride | undefined; usual: Clock | null; canTime: boolean; onChange: (o: RowOverride | null) => void; error?: boolean;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const on = !!override;
  const range = dateRange(week.friday, week.thursday);
  return (
    <View style={{ padding: 12, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: k.gold, backgroundColor: k.surface, gap: 8 }}>
      <Check disabled={!editable} value={on} onChange={v => onChange(v ? (canTime && usual ? { kind: 'time', at: usual } : { kind: 'hide' }) : null)}
        label={`${t('editor.weekOnly')} · ${range}`} note={editable ? t('editor.weekOnlyNote') : t('editor.weekOnlyLocked')} />
      {on && override ? (
        <>
          {canTime ? (
            <FSeg label={t('editor.weekOnly')} value={override.kind === 'time' ? 'time' : 'hide'} onChange={key => onChange(key === 'hide' ? { kind: 'hide' } : { kind: 'time', at: usual ?? '12:00' })}
              options={[{ key: 'time', label: t('editor.weekOther') }, { key: 'hide', label: t('editor.weekHide') }]} />
          ) : null}
          {override.kind === 'time' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <Labeled label={t('editor.weekTime')}><TimeField value={override.at} label={t('editor.weekTime')} error={error} onChange={at => at && onChange({ ...override, at })} /></Labeled>
              <View style={{ flex: 1, minWidth: 200 }}>
                <Field label={t('editor.weekNote')} value={override.note ?? ''} maxCodePoints={200} onChangeText={note => { const next: RowOverride = { kind: 'time', at: override.at }; if (note) next.note = note; onChange(next); }} />
              </View>
            </View>
          ) : <Txt size="small" color={k.muted}>{t('editor.weekHidden')}</Txt>}
          {usual ? <Txt size="small" color={k.muted}>{t('editor.weekUsually', { time: ltr(clockLabel(usual)) })}</Txt> : null}
        </>
      ) : null}
    </View>
  );
}

export type BuilderProps = {
  sectionKind: Section['kind'];
  label: Text;
  note: string | undefined;
  time: Time;
  /** Row.day (Shabbat sections only). */
  day: ShabbatDay | undefined;
  /** The candle-lighting row flag; undefined = not offered (extra rows). */
  candles?: boolean;
  week: ScheduleWeek;
  zmanimFor: ZmanimFor;
  /** Messages by control (server and local validation), shown on the control. */
  errors: Partial<Record<IssueControl, string>>;
  onLabel: (label: Text) => void;
  onNote: (note: string) => void;
  onKind: (kind: Time['kind']) => void;
  onFixed: (at: Clock) => void;
  onFormula: (patch: FormulaPatch) => void;
  onDay: (day: ShabbatDay) => void;
  onCandles?: (on: boolean) => void;
  weekBox?: React.ReactNode;
  thisWeek?: boolean;
  onDuplicate?: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** Phone: no key hints. */
  narrow?: boolean;
  /** A row just added: the name field takes focus. */
  autoFocusName?: boolean;
};

export function FormulaBuilder(p: BuilderProps) {
  const { t } = useI18n();
  const k = useTokens();
  const [asking, setAsking] = React.useState(false);
  const formula = p.time.kind === 'formula' ? p.time.formula : null;
  const err = (c: IssueControl) => p.errors[c];

  const dayOptions: Array<Option<string>> = p.sectionKind === 'shabbat'
    ? [{ key: 'friday', label: t('editor.dayFriday'), hint: t('editor.dayFridayHint') }, { key: 'shabbat', label: t('editor.dayShabbat'), hint: t('editor.dayShabbatHint') }]
    : [{ key: 'earliest', label: t('editor.dayEarliest'), hint: t('editor.dayEarliestHint') }, { key: 'latest', label: t('editor.dayLatest'), hint: t('editor.dayLatestHint') }];
  const anchorOptions: Array<Option<AnchorId>> = GROUPS.flatMap(g => g.anchors.map(anchor => {
    let side = '';
    if (formula) {
      const probe: Formula = { ...formula, anchor };
      const minutes = anchorDates(probe, p.week).map(d => p.zmanimFor(d)?.[anchor]).filter((c): c is string => !!c).map(c => parseClock(c)!);
      if (minutes.length) { const at = formula.day === 'latest' ? Math.max(...minutes) : Math.min(...minutes); side = clockLabel(`${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`); }
    }
    return { key: anchor, label: t(`editor.anchors.${anchor}`), group: t(`editor.group${g.key}`), side };
  }));
  const warnings = formula ? formulaWarnings(formula, p.sectionKind, p.week, p.zmanimFor) : [];
  const letter = useDayLetter();

  const warningText = (w: ReturnType<typeof formulaWarnings>[number]) => {
    const params = { ...w.params, row: p.label.he || t('editor.rowFallback'), day: w.params.date ? letter(w.params.date) : '' };
    const code = w.code === 'afterSunset' ? 'warnAfterSunset' : w.code === 'earlyEnd' ? 'warnEarlyEnd' : w.code === 'lateCandles' ? 'warnLateCandles' : w.code === 'boundsCross' ? 'warnBoundsCross' : 'warnBoundWins';
    return { title: t(`editor.${code}Title`), body: t(`editor.${code}`, Object.fromEntries(Object.entries(params).map(([key, v]) => [key, key === 'time' || key === 'exact' || key === 'sunset' || key === 'earliest' || key === 'latest' ? ltr(clockLabel(v)) : v]))) };
  };
  const fixLabel = (patch: FormulaPatch) => t(patch.roundMode === 'up' ? 'editor.fixUp' : 'editor.fixDown');
  const toggleBound = (key: 'notEarlierThan' | 'notLaterThan', on: boolean) => {
    if (!on) { p.onFormula({ [key]: null }); return; }
    const explained = formula ? explainFormula(formula, p.week, p.zmanimFor) : null;
    p.onFormula({ [key]: explained?.result ?? '12:00' });
  };

  return (
    <View accessibilityRole="none" style={{ gap: 14 }} {...onKeys(key => { if (key.key === 'Escape') p.onClose(); })}>
      {Object.values(p.errors).length ? <Banner tone="error" text={[...new Set(Object.values(p.errors))].join(' · ')} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Field label={t('editor.rowName')} value={p.label.he} maxCodePoints={60} error={err('label')} autoFocus={p.autoFocusName} selectTextOnFocus={p.autoFocusName} onChangeText={he => p.onLabel({ ...p.label, he })} />
        </View>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Field label={t('editor.rowNameEn')} value={p.label.en ?? ''} maxCodePoints={60} ltr onChangeText={en => p.onLabel({ he: p.label.he, en })} />
        </View>
      </View>
      <Field label={t('editor.rowNote')} value={p.note ?? ''} maxCodePoints={200} error={err('note')} onChangeText={p.onNote} placeholder={t('editor.rowNotePlaceholder')} />
      <Labeled label={t('editor.kind')}>
        <FSeg label={t('editor.kind')} value={p.time.kind} onChange={p.onKind} style={{ alignSelf: 'flex-start', width: p.narrow ? undefined : 420 }}
          options={[{ key: 'fixed', label: t('editor.kindFixed') }, { key: 'formula', label: t('editor.kindFormula') }, { key: 'none', label: t('editor.kindNone') }]} />
      </Labeled>

      {p.time.kind === 'fixed' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <Labeled label={t('editor.fixedTime')}><TimeField value={p.time.at} label={t('editor.fixedTime')} error={!!err('time')} onChange={at => at && p.onFixed(at)} /></Labeled>
          <Txt size="caption" color={k.muted} style={{ flex: 1, minWidth: 200, paddingBottom: 12 }}>{t('editor.timeHint')}</Txt>
        </View>
      ) : null}

      {formula ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', zIndex: 5 }}>
          <Labeled label={t('editor.anchor')} style={{ zIndex: 4 }}>
            <Select label={t('editor.anchor')} value={formula.anchor} options={anchorOptions} filterable width={200} error={!!err('anchor')} onChange={anchor => p.onFormula({ anchor })} />
          </Labeled>
          <Labeled label={t('editor.day')} style={{ zIndex: 3 }}>
            <Select label={t('editor.day')} value={formula.day} options={dayOptions} width={200} error={!!err('day')} onChange={day => p.onFormula({ day: day as Formula['day'] })} />
          </Labeled>
          <Labeled label={t('editor.minutes')}><Stepper label={t('editor.minutes')} value={formula.offset.minutes} max={720} onChange={minutes => p.onFormula({ minutes })} /></Labeled>
          <Labeled label=" ">
            <FSeg label={t('editor.direction')} value={formula.offset.direction} onChange={direction => p.onFormula({ direction })} style={{ width: 150 }}
              options={[{ key: 'before', label: t('editor.before') }, { key: 'after', label: t('editor.after') }]} />
          </Labeled>
          <Labeled label={t('editor.round')} style={{ zIndex: 2 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Select label={t('editor.round')} value={formula.rounding.mode} width={140} onChange={roundMode => p.onFormula({ roundMode: roundMode as Formula['rounding']['mode'] })}
                options={[{ key: 'none', label: t('editor.roundNone') }, { key: 'down', label: t('editor.roundDown'), hint: t('editor.roundDownHint') }, { key: 'up', label: t('editor.roundUp'), hint: t('editor.roundUpHint') }, { key: 'nearest', label: t('editor.roundNearest') }]} />
              {formula.rounding.mode !== 'none' ? (
                <Select label={t('editor.roundTo')} value={formula.rounding.step} width={130} error={!!err('rounding')} onChange={roundStep => p.onFormula({ roundStep: roundStep as 1 | 5 | 10 | 15 })}
                  options={[{ key: 1, label: t('editor.step1') }, { key: 5, label: t('editor.step', { n: 5 }) }, { key: 10, label: t('editor.step', { n: 10 }) }, { key: 15, label: t('editor.step', { n: 15 }) }]} />
              ) : null}
            </View>
          </Labeled>
        </View>
      ) : null}
      {formula ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Check label={t('editor.notBefore')} value={formula.notEarlierThan !== undefined} onChange={on => toggleBound('notEarlierThan', on)} />
            <TimeField value={formula.notEarlierThan} label={t('editor.notBefore')} disabled={formula.notEarlierThan === undefined} error={!!err('notEarlierThan')} onChange={at => at && p.onFormula({ notEarlierThan: at })} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Check label={t('editor.notAfter')} value={formula.notLaterThan !== undefined} onChange={on => toggleBound('notLaterThan', on)} />
            <TimeField value={formula.notLaterThan} label={t('editor.notAfter')} disabled={formula.notLaterThan === undefined} error={!!err('notLaterThan')} onChange={at => at && p.onFormula({ notLaterThan: at })} />
          </View>
        </View>
      ) : null}

      {p.sectionKind === 'shabbat' && p.time.kind !== 'formula' ? (
        <Labeled label={t('editor.whichDay')}>
          <FSeg label={t('editor.whichDay')} value={p.day ?? 'shabbat'} onChange={p.onDay} style={{ alignSelf: 'flex-start', width: 260 }}
            options={[{ key: 'friday', label: t('editor.dayFriday') }, { key: 'shabbat', label: t('editor.dayShabbat') }]} />
        </Labeled>
      ) : null}
      {p.onCandles && p.sectionKind === 'shabbat' ? (
        <Check label={t('editor.isCandles')} note={t('editor.isCandlesNote')} value={!!p.candles} onChange={p.onCandles} />
      ) : null}

      <ResultBox time={p.time} week={p.week} zmanimFor={p.zmanimFor} thisWeek={p.thisWeek} />
      {warnings.map(w => {
        const text = warningText(w);
        return <Banner key={w.code} text={`${text.title}. ${text.body}`} action={w.fix ? { title: fixLabel(w.fix), onPress: () => p.onFormula(w.fix!) } : undefined} />;
      })}

      {p.weekBox}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: k.line, paddingTop: 10 }}>
        {asking ? (
          <>
            <Txt bold style={{ flexShrink: 1 }}>{t('editor.deleteAsk')}</Txt>
            <Button kind="danger" title={t('editor.deleteYes')} onPress={p.onDelete} />
            <Button kind="secondary" title={t('common.cancel')} onPress={() => setAsking(false)} />
          </>
        ) : (
          <>
            {p.onDuplicate ? <Button kind="secondary" icon="copy" title={t('editor.duplicate')} onPress={p.onDuplicate} /> : null}
            <Button kind="secondary" icon="trash" title={t('editor.deleteRow')} onPress={() => setAsking(true)} />
            <View style={{ flex: 1, minWidth: 8 }}>{p.narrow ? null : <Txt size="caption" color={k.muted}>{t('editor.keys')}</Txt>}</View>
            <Button kind="secondary" title={t('editor.close')} onPress={p.onClose} />
          </>
        )}
      </View>
    </View>
  );
}
