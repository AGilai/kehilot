import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { fixtureNow, FIXTURE_PICTURE } from '../client/fixtures.ts';
import { config } from '../config.ts';
import { useSchedule } from '../client/useSchedule.ts';
import { useSheetItems } from '../client/useSheetItems.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Txt, useTokens } from '../kit/components.tsx';
import { fullModel, hasTimedRows } from '../schedule/memberView.ts';
import { printSheetPage } from '../schedule/printSheet.ts';
import type { PrintRequest } from '../schedule/printSheet.ts';
import { Sheet, useSheetFonts } from '../schedule/Sheet.tsx';
import { ITEMS_LOAD_ERROR, buildSheet, canPrintSheet } from '../schedule/sheetSource.ts';
import { israelNow } from '../schedule/week.ts';
import { zmanimForLocation } from '../schedule/zmanim.ts';

/** The Kehila logo as a data URI, '' until it is known (never: no logo). */
export function useLogoUri(): { uri: string | null; ready: boolean } {
  const { state, logo } = useSession();
  const kehila = state.kehila;
  const [held, setHeld] = React.useState<{ key: string; uri: string | null } | null>(null);
  const key = kehila ? `${kehila.kehilaId}:${kehila.logoVersion ?? ''}` : '';
  React.useEffect(() => {
    if (!kehila) return;
    let live = true;
    void logo(kehila.kehilaId, kehila.logoVersion).then(uri => { if (live) setHeld({ key, uri }); }, () => { if (live) setHeld({ key, uri: null }); });
    return () => { live = false; };
  }, [kehila?.kehilaId, kehila?.logoVersion, logo]); // eslint-disable-line react-hooks/exhaustive-deps
  return held?.key === key ? { uri: held.uri, ready: true } : { uri: null, ready: !kehila?.logoVersion };
}

/**
 * The print page (web, opened in a new tab by Print on P22): only the sheet, exactly P23's A4, and the browser's print dialog.
 * Everyone who can see the schedule can open it; the lines come from the server sheet list, so a guest whose rules hide
 * celebrations prints none.
 */
export function SchedulePrintPage({ request }: { request: PrintRequest }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { state, retry } = useSchedule();
  const session = useSession().state;
  const fonts = useSheetFonts();
  const logo = useLogoUri();
  const { width } = useWindowDimensions();
  const now = React.useMemo(() => fixtureNow() ?? new Date(), []);
  const doc = state.status === 'ready' ? state.doc : null;
  const zmanimFor = React.useMemo(() => zmanimForLocation(doc?.location), [doc]);
  // The week's lines come from the server list (the print page reads it as any other role does: a guest whose rules hide mazal tov gets none).
  const computed = React.useMemo(() => (doc && hasTimedRows(doc) ? fullModel(doc, israelNow(now), zmanimFor, request.weekIndex).computed : null), [doc, now, zmanimFor, request.weekIndex]);
  const sheet = useSheetItems(computed?.week.friday ?? null);
  const model = React.useMemo(() => {
    if (!doc || !computed || !session.kehila) return null;
    // Fixtures only: ?logo=1 gives the sheet a logo, ?pin=1 gives the sheet a pinned notice (the editor that sets it is a later task).
    const pinned = config.fixtures && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pin') === '1'
      ? { title: 'ערב לימוד לנשים', line: 'יום שלישי · 20:30', imageUri: FIXTURE_PICTURE } : null;
    return buildSheet(doc, computed, { kehilaName: session.kehila.name, logoUri: config.fixtures && new URLSearchParams(window.location.search).get('logo') === '1' ? FIXTURE_PICTURE : logo.uri, items: sheet.page?.items ?? [], pinned }, request.variant);
  }, [doc, computed, request.variant, session.kehila, sheet.page, logo.uri]);
  const ready = !!model && fonts && logo.ready && canPrintSheet(sheet.status);

  // Open the print dialog once, when the sheet is complete (fonts, logo and the week's messages are in).
  const printed = React.useRef(false);
  React.useEffect(() => {
    if (!ready || printed.current || (config.fixtures && new URLSearchParams(window.location.search).get('noprint') === '1')) return;
    printed.current = true;
    const timer = setTimeout(() => { printSheetPage(); }, 400);
    return () => clearTimeout(timer);
  }, [ready]);

  const w = request.variant === 'a4' ? 595 : 540;
  const scale = Math.min(1, Math.max(0.3, (width - 32) / w));
  const h = request.variant === 'a4' ? 842 : 540;
  return (
    <View style={{ flex: 1, backgroundColor: '#E9E9E9', alignItems: 'center', padding: 16, gap: 12, overflow: 'scroll' as 'scroll' }}>
      {state.status === 'error' ? <Banner tone="error" text={t('schedule.error')} action={{ title: t('common.retry'), onPress: retry }} /> : null}
      {state.status === 'loading' ? <Txt color={k.muted}>{t('common.loading')}</Txt> : null}
      {sheet.status === 'error' ? <Banner tone="error" text={ITEMS_LOAD_ERROR[lang]} action={{ title: t('common.retry'), onPress: () => { void sheet.reload(); } }} /> : null}
      {doc && !model ? <Txt color={k.muted}>{t('schedule.empty')}</Txt> : null}
      {model ? (
        <>
          <View style={{ width: w * scale, height: h * scale, shadowColor: '#14183C', shadowOpacity: 0.18, shadowRadius: 12 }}>
            <View style={{ width: w, height: h, transformOrigin: 'top left', transform: [{ scale }] } as object}><Sheet model={model} /></View>
          </View>
          <Button kind="secondary" icon="print" title={t('schedule.print')} disabled={!ready} onPress={() => { printSheetPage(); }} />
        </>
      ) : null}
    </View>
  );
}
