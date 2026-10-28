// The gabbai's seating editor, first part (UX-DESIGN §16, frame P28): paste the hall from a spreadsheet, check how it was read, match every
// name to a household, save. Gabbaim only (Main gates the route); web desktop-first, a notice on a phone. Logic is in src/seats (pure, tested).
import React from 'react';
import { Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { config } from '../../config.ts';
import { fixtureParams } from '../../client/fixtures.ts';
import type { SeatHolder, SeatLayoutRow } from '../../client/endpoints.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { AdminFamily } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { textStart } from '../../i18n/direction.ts';
import { Banner, Button, Card, Txt, useTokens } from '../../kit/components.tsx';
import { BackIcon } from '../../kit/Icon.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { effectiveFamilies, initialMatchState, matchReducer } from '../../seats/decisions.ts';
import { fixturePasteTsv, fixtureSeatFamilies } from '../../seats/fixturePaste.ts';
import { readPaste } from '../../seats/readPaste.ts';
import type { PasteProblem } from '../../seats/readPaste.ts';
import { defaultBlockNames, familiesForMatch } from '../../seats/savePlan.ts';
import type { ParsedHall } from '../../seats/paste.ts';
import { initialSaveSession, saveSessionReducer } from '../../seats/saveSession.ts';
import { WIDE, useAdminErrText } from './shared.tsx';
import { CheckStep } from './seatEditor/CheckStep.tsx';
import { MatchStep } from './seatEditor/MatchStep.tsx';
import { SaveStep } from './seatEditor/SaveStep.tsx';
import { StepRow } from './seatEditor/bits.tsx';
import { MapEditor } from './seatMap/MapEditor.tsx';
import type { StepKey } from './seatEditor/bits.tsx';

type Load = { status: 'loading' } | { status: 'error'; code: unknown } | { status: 'ready'; families: AdminFamily[]; holders: SeatHolder[]; layouts: SeatLayoutRow[]; holding: Set<string> };

/** Fixture builds: `?screen=seat-map` opens the map editor on an invented saved hall; the `seat-editor*` screens are the paste flow. */
const isSeatFixture = (screen: string | null | undefined): boolean => !!screen && (screen === 'seat-map' || screen.startsWith('seat-editor'));

export function SeatEditor({ onBack, onDirty, onToast }: { onBack: () => void; onDirty: (dirty: boolean) => void; onToast: (text: string) => void }) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const session = useSession();
  const errText = useAdminErrText();
  const { width } = useWindowDimensions();
  const kehilaId = session.state.kehilaId;
  const wide = width >= WIDE;

  const [load, setLoad] = React.useState<Load>({ status: 'loading' });
  const fetchAll = React.useCallback(async () => {
    if (!kehilaId) return;
    setLoad({ status: 'loading' });
    try {
      const [families, holders, layouts] = await Promise.all([api.adminFamilies(kehilaId), api.seatHolders(kehilaId), api.seatLayouts(kehilaId)]);
      // Households that already hold seats rank lower among equal suggestions (best effort: a failure only loses the ranking hint).
      const holding = new Set<string>();
      const current = layouts.layouts.find((l) => l.current);
      if (current) {
        try { for (const ref of Object.values((await api.seatAssignments(kehilaId, current.effectiveFrom)).assignments)) if (ref.startsWith('family:')) holding.add(ref.slice(7)); } catch { /* ignore */ }
      }
      setLoad({ status: 'ready', families: config.fixtures && fixtureParams().screen !== 'seat-map' && isSeatFixture(fixtureParams().screen) ? fixtureSeatFamilies() : families, holders, layouts: layouts.layouts, holding });
    } catch (e) { setLoad({ status: 'error', code: e }); }
  }, [api, kehilaId]);
  React.useEffect(() => { void fetchAll(); }, [fetchAll]);

  // fixture builds only: ?screen=seat-editor-check | seat-editor-match | seat-editor-save preload an invented paste
  const preset = config.fixtures ? fixtureParams().screen : null;
  const [step, setStep] = React.useState<StepKey>(preset === 'seat-editor-match' ? 'match' : preset === 'seat-editor-check' ? 'check' : preset === 'seat-editor-save' ? 'save' : 'paste');
  const [parsed, setParsed] = React.useState<ParsedHall | null>(() => (preset && preset !== 'seat-editor' && preset.startsWith('seat-editor') ? readPaste(fixturePasteTsv()).parsed : null));
  const [problem, setProblem] = React.useState<{ code: PasteProblem; rows: number; cols: number } | null>(null);
  const [blockNames, setBlockNames] = React.useState<string[]>(() => (parsed ? defaultBlockNames(parsed.blocks.length) : []));
  const [match, dispatch] = React.useReducer(matchReducer, undefined, initialMatchState);
  const [saveSession, dispatchSave] = React.useReducer(saveSessionReducer, undefined, initialSaveSession);
  const [layouts, setLayouts] = React.useState<SeatLayoutRow[] | null>(null);
  const [holdersNow, setHoldersNow] = React.useState<SeatHolder[] | null>(null);
  const [saved, setSaved] = React.useState(false);
  // The map editor (P29) is the home of a Kehila that has a map; the paste flow (P28) makes the first one or replaces it.
  const [view, setView] = React.useState<'map' | 'paste' | null>(null);
  const [mapDirty, setMapDirty] = React.useState(false);

  const accept = React.useCallback((input: { text?: string; html?: string }) => {
    const r = readPaste(input);
    if (!r.parsed) { setProblem({ code: r.problem ?? 'no-seats', rows: r.rows, cols: r.cols }); return; }
    setProblem(null);
    setParsed(r.parsed);
    setBlockNames(defaultBlockNames(r.parsed.blocks.length));
    dispatch({ type: 'reset' });
    setStep('check');
  }, []);

  // The paste event on web: the HTML flavour first (it keeps merged cells), the plain text beside it. A paste into the text box is left to it.
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || step !== 'paste') return;
    const handler = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      const data = e.clipboardData;
      if (!data) return;
      e.preventDefault();
      accept({ text: data.getData('text/plain'), html: data.getData('text/html') });
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [step, accept]);

  const hasMap = load.status === 'ready' && (preset === 'seat-map' || (layouts ?? load.layouts).length > 0);
  const effView: 'map' | 'paste' = view ?? (hasMap ? 'map' : 'paste');
  const dirty = (effView === 'paste' && !!parsed && !saved) || (effView === 'map' && mapDirty);
  React.useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const [text, setText] = React.useState('');
  const familiesForMatching = React.useMemo(() => (load.status === 'ready' ? familiesForMatch(load.families, load.holding) : []), [load]);
  const holdersForMatching = React.useMemo(() => (load.status === 'ready' ? load.holders.map((h) => ({ id: h.holderId, name: h.name, phone: h.phone ?? undefined })) : []), [load]);
  const labelOf = React.useCallback((kind: 'family' | 'holder', id: string) => {
    if (load.status !== 'ready') return id;
    if (kind === 'holder') return load.holders.find((h) => h.holderId === id)?.name ?? id;
    const f = load.families.find((x) => x.familyId === id);
    if (!f) return id;
    const firsts = f.adults.map((a) => (a.displayName.endsWith(` ${f.name}`) ? a.displayName.slice(0, -f.name.length - 1) : a.displayName.split(' ')[0]!)).filter(Boolean);
    return t('seatEditor.match.familyLabel', { name: f.name, firsts: firsts.join(t('seatEditor.and')) });
  }, [load, t]);

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('editor.back')} onPress={onBack} style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('editor.back')}</Txt></View>
    </Pressable>
  );

  // phone: view only (UX §16, "Phone: view only"): the hall and the list of households, read only; without a map, a notice
  if (!wide && load.status === 'ready' && hasMap) {
    return <MapEditor phone scratch={false} families={load.families} holders={holdersNow ?? load.holders} layouts={layouts ?? load.layouts} onLayouts={setLayouts} onHolders={setHoldersNow} onBack={onBack} onPaste={() => {}} onDirty={() => {}} onToast={onToast} />;
  }
  if (!wide) {
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {back}
        <Txt serif size="display" accessibilityRole="header">{t('seatEditor.title')}</Txt>
        <Banner tone="info" text={t('seatEditor.phone.banner')} />
        <Card edgeColor={k.gold}>
          <Txt serif size="heading" accessibilityRole="header">{t('seatEditor.phone.title')}</Txt>
          <Txt color={k.muted}>{t('seatEditor.phone.body')}</Txt>
        </Card>
      </PadScroll>
    );
  }

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, backgroundColor: k.surface, borderBottomWidth: 1, borderBottomColor: k.line, minHeight: 56, flexWrap: 'wrap' }}>
      {back}
      <Txt serif size="heading" accessibilityRole="header">{t('seatEditor.title')}</Txt>
      {effView === 'paste' ? <View style={{ paddingVertical: 8 }}><StepRow step={step} /></View> : null}
      <View style={{ flex: 1 }} />
      <Txt size="small" color={k.muted}>{session.state.kehila?.name}</Txt>
    </View>
  );

  if (load.status !== 'ready') {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ padding: 24, maxWidth: 760 }}>
          {load.status === 'error' ? <Banner tone="error" text={errText(load.code)} action={{ title: t('common.retry'), onPress: () => { void fetchAll(); } }} /> : <Txt color={k.muted}>{t('seatEditor.loading')}</Txt>}
        </View>
      </View>
    );
  }

  let body: React.ReactNode;
  if (effView === 'map') {
    body = (
      <MapEditor scratch={!hasMap || (layouts ?? load.layouts).length === 0} phone={false} families={load.families} holders={holdersNow ?? load.holders} layouts={layouts ?? load.layouts}
        onLayouts={setLayouts} onHolders={setHoldersNow} onBack={onBack} onPaste={() => { setView('paste'); setStep('paste'); setParsed(null); }} onDirty={setMapDirty} onToast={onToast} />
    );
  } else if (step === 'paste' || !parsed) {
    body = (
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, width: '100%', maxWidth: 820, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Txt serif size="display" accessibilityRole="header">{t('seatEditor.start.title')}</Txt>
        <Txt color={k.muted}>{t('seatEditor.start.lead')}</Txt>
        {problem ? (
          <View accessibilityRole="alert" style={{ gap: 6 }}>
            <Banner tone="error" text={t(`seatEditor.problem.${problem.code}`, { rows: problem.rows, cols: problem.cols })} />
            {problem.code === 'no-seats' || problem.code === 'responses-tab' ? <Txt size="small" color={k.muted}>{t('seatEditor.problem.hint')}</Txt> : null}
          </View>
        ) : null}
        <Card edgeColor={k.tekhelet}>
          <Txt serif size="heading" accessibilityRole="header">{t('seatEditor.start.card')}</Txt>
          {(['one', 'two', 'three'] as const).map((s, i) => <Txt key={s}>{`${i + 1}. ${t(`seatEditor.start.step.${s}`)}`}</Txt>)}
          <Txt bold color={k.tekhelet}>{t('seatEditor.start.mapTab')}</Txt>
          <View accessibilityRole="button" accessibilityLabel={t('seatEditor.start.target')} focusable
            style={{ minHeight: 150, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: k.tekhelet, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16, backgroundColor: k.stone }}>
            <Txt bold>{t('seatEditor.start.target')}</Txt>
            <Txt size="small" color={k.muted} style={{ textAlign: 'center' }}>{t('seatEditor.start.targetHelp')}</Txt>
          </View>
          <Txt size="small" color={k.muted}>{t('seatEditor.start.grammar')}</Txt>
          <Txt size="small" color={k.muted}>{t('seatEditor.start.nothingSaved')}</Txt>
        </Card>
        <Card>
          <Txt bold>{t('seatEditor.start.fallback')}</Txt>
          <TextInput accessibilityLabel={t('seatEditor.start.fallback')} multiline numberOfLines={5} value={text} onChangeText={setText} placeholder={t('seatEditor.start.fallbackHint')} placeholderTextColor={k.muted}
            style={{ minHeight: 110, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, padding: 12, color: k.ink, fontSize: 14, textAlignVertical: 'top', writingDirection: dir, textAlign: textStart(lang) }} />
          <View style={{ alignSelf: 'flex-start' }}><Button kind="secondary" title={t('seatEditor.start.read')} disabled={!text.trim()} onPress={() => accept({ text })} /></View>
        </Card>
        <Banner text={t('seatEditor.start.privacy')} />
        {(layouts ?? load.layouts).length === 0 ? (
          <Card>
            <Txt color={k.muted}>{t('seatMap.start.scratchHelp')}</Txt>
            <View style={{ alignSelf: 'flex-start' }}><Button kind="secondary" title={t('seatMap.start.scratch')} onPress={() => setView('map')} /></View>
          </Card>
        ) : (
          <View style={{ alignSelf: 'flex-start' }}><Button kind="secondary" title={t('seatMap.band.back')} onPress={() => setView('map')} /></View>
        )}
      </ScrollView>
    );
  } else if (step === 'check') {
    body = (
      <CheckStep parsed={parsed} cells={match.cells} blockNames={blockNames} families={effectiveFamilies(parsed, match.cells).length}
        onBlockName={(i, v) => setBlockNames((n) => n.map((x, j) => (j === i ? v : x)))}
        onRepaste={() => { setParsed(null); setStep('paste'); dispatch({ type: 'reset' }); }} onNext={() => setStep('match')} />
    );
  } else if (step === 'match') {
    body = (
      <MatchStep parsed={parsed} blockNames={blockNames} state={match} dispatch={dispatch} families={familiesForMatching} holders={holdersForMatching} labelOf={labelOf}
        onBack={() => setStep('check')} onSave={() => setStep('save')} />
    );
  } else {
    body = (
      <SaveStep parsed={parsed} state={match} blockNames={blockNames} layouts={layouts ?? load.layouts} onLayouts={setLayouts} session={saveSession} dispatch={dispatchSave}
        onBack={() => setStep('match')} onDone={() => { onDirty(false); setSaved(true); onToast(t('seatEditor.save.toast')); onBack(); }} />
    );
  }
  return <View style={{ flex: 1 }}>{header}{body}</View>;
}
