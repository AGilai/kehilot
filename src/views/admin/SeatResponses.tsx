// The gabbai's responses upload (UX-DESIGN §16.6, frame P27): the old Google Form's CSV for this week, matched to households (also those
// without an account), previewed, applied, and undoable. Web first; gabbaim only (Main gates the route). Logic is in src/seats (pure, tested).
import React from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { config } from '../../config.ts';
import { fixtureParams } from '../../client/fixtures.ts';
import type { SeatHolder } from '../../client/endpoints.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { AdminFamily } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Txt, useTokens } from '../../kit/components.tsx';
import { BackIcon } from '../../kit/Icon.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { decodeCsv, MAX_FILE_BYTES, readXlsx } from '../../import/parse.ts';
import { exactDecisions, initialMatchState, matchReducer } from '../../seats/decisions.ts';
import { fixtureResponsesCsv } from '../../seats/fixtureUpload.ts';
import { deadlineHm, formTemplateCsv, inWeek, latestPerName, parseFormCsv, parseFormTable, textTooBig } from '../../seats/formCsv.ts';
import type { FormParse } from '../../seats/formCsv.ts';
import { normalizeName } from '../../seats/match.ts';
import { familiesForMatch } from '../../seats/savePlan.ts';
import { EVENT_PRAYERS, UPLOAD_STEPS, combineResults, initialUpload, planUpload, suggestForName, uploadReducer } from '../../seats/upload.ts';
import type { ApplySummary, UploadPlan } from '../../seats/upload.ts';
import { useShabbat } from '../../seats/useShabbat.ts';
import { isNoLayout } from '../../seats/wire.ts';
import type { WeekWire } from '../../seats/wire.ts';
import { WIDE, useAdminErrText } from './shared.tsx';
import { StepRow } from './seatEditor/bits.tsx';
import { ColumnsStep, UploadStep } from './seatUpload/FileSteps.tsx';
import { MatchUploadStep } from './seatUpload/MatchUploadStep.tsx';
import type { Household } from './seatUpload/MatchUploadStep.tsx';
import { PreviewStep, ResultPanel } from './seatUpload/PreviewStep.tsx';

type Load = { status: 'loading' } | { status: 'error'; text: string } | { status: 'empty' } | { status: 'ready'; week: WeekWire; families: AdminFamily[]; holders: SeatHolder[] };
type Parsed = Extract<FormParse, { ok: true }>;
type Result = { summary: ApplySummary; plan: UploadPlan; undone: boolean };

const isNothingToUndo = (e: unknown) => (e as { code?: unknown } | null)?.code === 'nothing_to_undo';

export function SeatResponses({ onBack, onEditor, onToast }: { onBack: () => void; onEditor?: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state } = useSession();
  const errText = useAdminErrText();
  const { width } = useWindowDimensions();
  const kehilaId = state.kehilaId;
  const wide = width >= WIDE;
  const { friday, parasha } = useShabbat();

  const [load, setLoad] = React.useState<Load>({ status: 'loading' });
  const fetchAll = React.useCallback(async (quiet = false) => {
    if (!kehilaId) return;
    if (!quiet) setLoad({ status: 'loading' });
    try {
      const [week, families, holders] = await Promise.all([api.seatWeek(kehilaId, friday), api.adminFamilies(kehilaId), api.seatHolders(kehilaId)]);
      setLoad({ status: 'ready', week, families, holders });
    } catch (e) { setLoad(isNoLayout(e) ? { status: 'empty' } : { status: 'error', text: errText(e) }); }
  }, [api, kehilaId, friday]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void fetchAll(); }, [fetchAll]);

  const [ui, dispatchUi] = React.useReducer(uploadReducer, undefined, initialUpload);
  const [match, dispatch] = React.useReducer(matchReducer, undefined, initialMatchState);
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [text, setText] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);

  const ingest = React.useCallback((r: FormParse) => {
    if (!r.ok) { setProblem(t(`seatUpload.problem.${r.problem}`)); return; }
    setProblem(null); setParsed(r); setResult(null); setApplyError(null);
    dispatch({ type: 'reset' });
    dispatchUi({ type: 'step', step: 'columns' });
  }, [t]);

  function pick() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv,.xlsx,text/csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > MAX_FILE_BYTES) { setProblem(t('seatUpload.problem.big')); return; }
        const bytes = new Uint8Array(await file.arrayBuffer());
        ingest(/\.xlsx$/i.test(file.name) ? parseFormTable(await readXlsx(bytes)) : parseFormCsv(decodeCsv(bytes)));
      } catch { setProblem(t('seatUpload.problem.read')); }
    };
    input.click();
  }
  function downloadTemplate() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const url = URL.createObjectURL(new Blob([formTemplateCsv()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = t('seatUpload.templateFile'); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // The week's answers: this week only, the latest per household.

  const ready = load.status === 'ready' ? load : null;
  const hm = ready ? deadlineHm(ready.week.deadline) : '12:00';
  const win = React.useMemo(() => (parsed ? inWeek(parsed.answers, friday, hm) : null), [parsed, friday, hm]);
  const latest = React.useMemo(() => latestPerName(win?.rows ?? [], normalizeName), [win]);
  const answers = latest.latest;
  const holding = React.useMemo(() => new Set(Object.keys(ready?.week.households ?? {}).filter((r) => r.startsWith('family:')).map((r) => r.slice(7))), [ready]);
  const kehilaFamilies = React.useMemo(() => (ready ? familiesForMatch(ready.families, holding) : []), [ready, holding]);
  const holderList = React.useMemo(() => (ready ? ready.holders.map((h) => ({ id: h.holderId, name: h.name, phone: h.phone ?? undefined })) : []), [ready]);
  const results = React.useMemo(() => new Map(answers.map((a) => [normalizeName(a.name), suggestForName(normalizeName(a.name), a.name, kehilaFamilies, holderList)])), [answers, kehilaFamilies, holderList]);

  const labelOf = React.useCallback((kind: 'family' | 'holder', id: string) => {
    if (!ready) return id;
    if (kind === 'holder') return ready.holders.find((h) => h.holderId === id)?.name ?? id;
    const f = ready.families.find((x) => x.familyId === id);
    if (!f) return id;
    const firsts = f.adults.map((a) => (a.displayName.endsWith(` ${f.name}`) ? a.displayName.slice(0, -f.name.length - 1) : a.displayName.split(' ')[0]!)).filter(Boolean);
    return t('seatEditor.match.familyLabel', { name: f.name, firsts: firsts.join(t('seatEditor.and')) });
  }, [ready, t]);
  const households = React.useMemo<Household[]>(() => (ready ? [
    ...ready.families.map((f) => ({ ref: `family:${f.familyId}`, label: labelOf('family', f.familyId), noAccount: false, search: normalizeName(`${f.name} ${f.adults.map((a) => a.displayName).join(' ')}`) })),
    ...ready.holders.map((h) => ({ ref: `holder:${h.holderId}`, label: h.name, noAccount: true, search: normalizeName(h.name) })),
  ] : []), [ready, labelOf]);
  const nameOfRef = React.useCallback((ref: string) => households.find((h) => h.ref === ref)?.label ?? ready?.week.households[ref] ?? ref, [households, ready]);

  const prayers = EVENT_PRAYERS[ui.event];
  const plan = React.useMemo(() => (ready ? planUpload({ week: ready.week, answers, decisions: match.decisions, overrides: ui.overrides, prayers, nameOf: nameOfRef }) : null), [ready, answers, match.decisions, ui.overrides, prayers, nameOfRef]);
  const undoable = ready ? prayers.filter((p) => ready.week.prayers[p]?.canUndo) : [];

  // fixture builds only: ?screen=seat-upload-preview opens at the preview with the exact matches confirmed
  const preset = config.fixtures ? fixtureParams().screen : null;
  const presetDone = React.useRef(false);
  React.useEffect(() => {
    if (!preset?.startsWith('seat-upload') || preset === 'seat-upload' || presetDone.current || !ready) return;
    presetDone.current = true;
    const r = parseFormCsv(fixtureResponsesCsv(friday));
    if (!r.ok) return;
    const a = latestPerName(inWeek(r.answers, friday).rows, normalizeName).latest;
    const rs = a.map((x) => suggestForName(normalizeName(x.name), x.name, familiesForMatch(ready.families, holding), ready.holders.map((h) => ({ id: h.holderId, name: h.name, phone: h.phone ?? undefined }))));
    setParsed(r);
    dispatch({ type: 'merge', decisions: exactDecisions(rs, initialMatchState()) });
    dispatchUi({ type: 'step', step: 'preview' });
  }, [preset, ready, friday, holding]);

  async function apply() {
    if (!ready || !kehilaId || busy) return;
    setBusy(true); setApplyError(null);
    try {
      let week = ready.week;
      let p = plan!;
      if (undoable.length) {
        // a second upload for the same event first undoes the first (UX §16.6); the plan is made again on what that leaves
        for (const e of undoable) { try { await api.undoSeatResponses(kehilaId, friday, e); } catch (err) { if (!isNothingToUndo(err)) throw err; } }
        week = await api.seatWeek(kehilaId, friday);
        p = planUpload({ week, answers, decisions: match.decisions, overrides: ui.overrides, prayers, nameOf: nameOfRef });
      }
      const done = [];
      try { for (const call of p.calls) done.push(await api.applySeatResponses(kehilaId, friday, call)); } finally { await fetchAll(true); }
      const sum = combineResults(done);
      // a request-only household with no seats carries a release of zero: the server's no_seats there is not a problem
      const seatless = new Set(p.rows.filter((r) => r.seats === 0 && r.status === 'change').map((r) => r.ref));
      sum.warnings = sum.warnings.filter((w) => !(w.code === 'no_seats' && seatless.has(w.household)));
      setResult({ summary: sum, plan: p, undone: false });
    } catch (e) { setApplyError(errText(e)); await fetchAll(true); }
    finally { setBusy(false); }
  }

  async function undo() {
    if (!kehilaId || busy) return;
    setBusy(true); setApplyError(null);
    try {
      let skipped = 0;
      for (const e of prayers) { try { skipped += (await api.undoSeatResponses(kehilaId, friday, e)).skipped; } catch (err) { if (!isNothingToUndo(err)) throw err; } }
      await fetchAll(true);
      setResult((r) => (r ? { ...r, undone: true } : r));
      onToast(skipped ? t('seatUpload.result.undoneSkipped', { n: skipped }) : t('seatUpload.result.undoneToast'));
    } catch (e) { setApplyError(errText(e)); await fetchAll(true); }
    finally { setBusy(false); }
  }

  const reset = () => { setParsed(null); setText(''); setResult(null); setApplyError(null); setProblem(null); dispatch({ type: 'reset' }); dispatchUi({ type: 'reset' }); };

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('editor.back')} onPress={onBack} style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('editor.back')}</Txt></View>
    </Pressable>
  );

  if (!wide || Platform.OS !== 'web') {
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {back}
        <Txt serif size="title" accessibilityRole="header">{t('seatUpload.title')}</Txt>
        <Banner tone="info" text={t('seatUpload.webOnly')} />
      </PadScroll>
    );
  }
  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, backgroundColor: k.surface, borderBottomWidth: 1, borderBottomColor: k.line, minHeight: 56, flexWrap: 'wrap' }}>
      {back}
      <Txt serif size="heading" accessibilityRole="header">{t('seatUpload.band')}</Txt>
      <View style={{ paddingVertical: 8 }}><StepRow step={ui.step} steps={UPLOAD_STEPS} label={(s) => t(`seatUpload.step.${s}`)} /></View>
      <View style={{ flex: 1 }} />
      <Txt size="small" color={k.muted}>{parasha ? t('seatUpload.event.shabbatParasha', { parasha }) : t('seatUpload.event.shabbat')}</Txt>
    </View>
  );
  const frame = (body: React.ReactNode) => (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, width: '100%', maxWidth: 980, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">{body}</ScrollView>
    </View>
  );
  if (load.status === 'loading') return frame(<Txt color={k.muted}>{t('seatEditor.loading')}</Txt>);
  if (load.status === 'error') return frame(<Banner tone="error" text={load.text} action={{ title: t('common.retry'), onPress: () => { void fetchAll(); } }} />);
  if (load.status === 'empty') {
    return frame(
      <View style={{ gap: 12, maxWidth: 600 }}>
        <Txt serif size="heading" accessibilityRole="header">{t('seatUpload.empty.title')}</Txt>
        <Txt color={k.muted}>{t('seatUpload.empty.body')}</Txt>
        {onEditor ? <View style={{ alignSelf: 'flex-start' }}><Button title={t('seats.print.emptyGo')} onPress={onEditor} /></View> : null}
      </View>,
    );
  }

  let body: React.ReactNode;
  if (result && plan) {
    body = <ResultPanel summary={result.summary} plan={result.plan} names={nameOfRef} busy={busy} error={applyError} undone={result.undone} onUndo={() => { void undo(); }} onAgain={reset} />;
  } else if (ui.step === 'upload' || !parsed || !win) {
    body = (
      <>
        {undoable.length ? <Banner text={t('seatUpload.earlier')} action={{ title: t('seatUpload.result.undo'), onPress: () => { void undo(); } }} /> : null}
        {applyError ? <Banner tone="error" text={applyError} /> : null}
        <UploadStep event={ui.event} onEvent={(e) => dispatchUi({ type: 'event', event: e })} parasha={parasha} problem={problem} text={text} onText={setText}
          onRead={() => { if (textTooBig(text)) { setProblem(t('seatUpload.problem.big')); return; } ingest(parseFormCsv(text)); }} onPick={pick} onTemplate={downloadTemplate} web />
      </>
    );
  } else if (ui.step === 'columns') {
    body = <ColumnsStep parsed={parsed} rows={win.rows.length} older={win.older} later={win.later} undated={win.undated} days={friday} onBack={reset} onNext={() => dispatchUi({ type: 'step', step: 'match' })} />;
  } else if (ui.step === 'match') {
    body = <MatchUploadStep answers={answers} results={results} state={match} dispatch={dispatch} households={households} labelOf={labelOf} onBack={() => dispatchUi({ type: 'step', step: 'columns' })} onNext={() => dispatchUi({ type: 'step', step: 'preview' })} />;
  } else {
    body = plan ? <PreviewStep plan={plan} undoFirst={undoable.length > 0} busy={busy} error={applyError} onOverride={(ref, on) => dispatchUi({ type: 'override', ref, on })} onApply={() => { void apply(); }} onBack={() => dispatchUi({ type: 'step', step: 'match' })} /> : null;
  }
  return frame(body);
}
