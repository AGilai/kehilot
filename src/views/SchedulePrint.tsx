import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { fixtureNow, FIXTURE_PICTURE } from '../client/fixtures.ts';
import { config } from '../config.ts';
import { useSchedule } from '../client/useSchedule.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Txt, useTokens } from '../kit/components.tsx';
import { fullModel, hasTimedRows } from '../schedule/memberView.ts';
import { printSheetPage } from '../schedule/printSheet.ts';
import type { PrintRequest } from '../schedule/printSheet.ts';
import { Sheet, useSheetFonts } from '../schedule/Sheet.tsx';
import { buildSheet } from '../schedule/sheetSource.ts';
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
 * Everyone who can see the schedule can open it; the mazal tov come from the person's own feed, so a guest whose type rules hide
 * celebrations prints none.
 */
export function SchedulePrintPage({ request }: { request: PrintRequest }) {
  const { t } = useI18n();
  const k = useTokens();
  const { state, retry } = useSchedule();
  const session = useSession().state;
  const fonts = useSheetFonts();
  const logo = useLogoUri();
  const { width } = useWindowDimensions();
  const now = React.useMemo(() => fixtureNow() ?? new Date(), []);
  const doc = state.status === 'ready' ? state.doc : null;
  const zmanimFor = React.useMemo(() => zmanimForLocation(doc?.location), [doc]);
  const model = React.useMemo(() => {
    if (!doc || !hasTimedRows(doc) || !session.kehila) return null;
    // Limit: the mazal tov come from the feed the client holds (the newest page the API returned); the messages API has no type or date filter,
    // so a celebration older than that page is missing from the sheet. A server-side filter would fix it.
    const computed = fullModel(doc, israelNow(now), zmanimFor, request.weekIndex).computed;
    // Fixtures only: ?logo=1 gives the sheet a logo, ?pin=1 gives the sheet a pinned notice (the editor that sets it is a later task).
    const pinned = config.fixtures && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pin') === '1'
      ? { title: 'ערב לימוד לנשים', line: 'יום שלישי · 20:30', imageUri: FIXTURE_PICTURE } : null;
    return buildSheet(doc, computed, { kehilaName: session.kehila.name, logoUri: config.fixtures && new URLSearchParams(window.location.search).get('logo') === '1' ? FIXTURE_PICTURE : logo.uri, messages: Object.values(session.feed.messages), pinned }, request.variant);
  }, [doc, now, zmanimFor, request, session.kehila, session.feed.messages, logo.uri]);
  const ready = !!model && fonts && logo.ready && session.feed.loaded;

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
      {doc && !model ? <Txt color={k.muted}>{t('schedule.empty')}</Txt> : null}
      {model ? (
        <>
          <View style={{ width: w * scale, height: h * scale, shadowColor: '#14183C', shadowOpacity: 0.18, shadowRadius: 12 }}>
            <View style={{ width: w, height: h, transformOrigin: 'top left', transform: [{ scale }] } as object}><Sheet model={model} /></View>
          </View>
          <Button kind="secondary" icon="print" title={t('schedule.print')} onPress={() => { printSheetPage(); }} />
        </>
      ) : null}
    </View>
  );
}
