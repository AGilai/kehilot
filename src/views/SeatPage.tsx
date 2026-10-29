import React from 'react';
import { ActivityIndicator, View, useWindowDimensions } from 'react-native';
import { config } from '../config.ts';
import { hebrewDate } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Segmented, Sheet, Tag, Txt, useTokens } from '../kit/components.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { useReportPad } from '../client/reportUi.ts';
import { releaseCounts, toggleRelease } from '../seats/release.ts';
import type { Prayer } from '../seats/release.ts';
import { readMapFolded, writeMapFolded } from '../seats/mapFold.ts';
import { headKey } from '../seats/seatForm.ts';
import { useMemberSeats } from '../seats/useMemberSeats.ts';
import { useShabbat } from '../seats/useShabbat.ts';
import { whenParts } from '../seats/window.ts';
import type { MemberSeats } from '../seats/wire.ts';
import { BackLink } from './Me.tsx';
import { useErrorText } from './auth/Frame.tsx';
import { SeatMap } from './seatForm/SeatMap.tsx';

/** P25: the member's seat page (UX-DESIGN §15.3), on the member API. It gets only its own cut (`frames`): there is no whole-hall map here, by design. */
export function SeatPage({ week, onBack, onToast }: { /** The Friday of the Shabbat to show; the server's coming one when absent. */ week?: string; onBack: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const seats = useMemberSeats(true, week);
  const errText = useErrorText();
  const head = (back: () => void) => <BackLink onPress={back} />;
  if (seats.state.status === 'loading') {
    return <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>{head(onBack)}<ActivityIndicator /></PadScroll>;
  }
  if (seats.state.status === 'error') {
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {head(onBack)}
        <Banner tone="error" text={`${t('seats.loadError')} ${errText(seats.state.code)}`} action={{ title: t('common.retry'), onPress: seats.reload }} />
      </PadScroll>
    );
  }
  return <SeatPageReady data={seats.state.data} save={seats.save} onBack={onBack} onToast={onToast} />;
}

function SeatPageReady({ data, save, onBack, onToast }: { data: MemberSeats; save: ReturnType<typeof useMemberSeats>['save']; onBack: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const [prayer, setPrayer] = React.useState<Prayer>('arvit');
  const initial = data.released;
  const [released, setReleased] = React.useState<Record<Prayer, Set<string>>>(() => ({ arvit: new Set(initial.arvit), shacharit: new Set(initial.shacharit) }));
  // A fresh server state (after a save or a re-read) replaces the draft.
  React.useEffect(() => { setReleased({ arvit: new Set(initial.arvit), shacharit: new Set(initial.shacharit) }); }, [initial]);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stale, setStale] = React.useState(false);
  const { saturday, parasha } = useShabbat(data.week);
  const deadline = whenParts(data.deadline, lang);
  const differs = (p: Prayer) => released[p].size !== initial[p].size || [...released[p]].some(x => !initial[p].has(x));
  const dirty = differs('arvit') || differs('shacharit');
  const unanswered = !(data.answered.arvit && data.answered.shacharit); // saving with no change is still the answer
  const locked = !data.open;
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [folded, setFolded] = React.useState(false);
  React.useEffect(() => { void readMapFolded().then(setFolded); }, []);
  const setMapFolded = (v: boolean) => { setFolded(v); void writeMapFolded(v); };
  const pad = useReportPad(); // the dev report pill sits above the tabs: keep Save clear of it

  const label = (p: Prayer) => t(`seats.${p}`);
  const counts = releaseCounts(data.seatCount, released[prayer]);

  function tap(key: string) {
    if (locked || busy) return;
    setStale(false);
    setReleased(r => ({ ...r, [prayer]: toggleRelease(r[prayer], key) }));
  }
  function back() { if (dirty) setConfirmLeave(true); else onBack(); }

  async function submit() {
    if (busy || (!dirty && !unanswered)) return;
    setBusy(true); setError(null); setStale(false);
    try {
      const choices = Object.fromEntries((['arvit', 'shacharit'] as Prayer[]).filter(p => differs(p) || !data.answered[p]).map(p => [p, released[p]]));
      const r = await save(choices);
      if (r?.kind === 'updated') setStale(true); // somebody else changed his seats: the page now shows the current state
      else if (r) onToast(t('seats.saved'));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  const head = (
    <>
      <BackLink onPress={back} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Txt serif size="title" accessibilityRole="header">{t('seats.title')}</Txt>
        {config.seatsPreview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
      </View>
      <Txt size="small" color={k.muted} style={{ marginTop: -8 }}>{parasha ? t('seats.shabbatLine', { parasha, date: hebrewDate(saturday, lang) }) : hebrewDate(saturday, lang)}</Txt>
    </>
  );

  if (data.seatCount === 0) {
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {head}
        <Card edgeColor={k.tekhelet}>
          <Txt bold size="heading" accessibilityRole="header">{t('seats.noneTitle')}</Txt>
          <Txt color={k.muted}>{t('seats.noneBody')}</Txt>
        </Card>
      </PadScroll>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {head}
        {locked ? <Banner tone="info" text={t('seats.closed', deadline)} /> : stale ? <Banner tone="info" text={t('seats.updatedNow')} /> : data.updatedByGabbai ? <Banner tone="info" text={t(data.updatedByRole === 'tech' ? 'seats.byTech' : 'seats.byGabbai')} /> : null}
        {error ? <Banner tone="error" text={error} /> : null}
        <Segmented<Prayer> options={[{ key: 'arvit', label: label('arvit') }, { key: 'shacharit', label: label('shacharit') }]} value={prayer} onChange={setPrayer} />
        <Txt size="small">{t('seats.summary', { prayer: t(`seats.${prayer}Short`), need: counts.need, free: counts.free })}</Txt>
        {data.frames.length > 1 ? <Txt size="small" color={k.muted}>{t('seats.split')}</Txt> : null}
        <SeatMap frames={data.frames} released={released[prayer]} head={headKey(data)} locked={locked} folded={folded} onFold={setMapFolded} onTap={tap} wide={wide} />
        <Txt size="caption" color={k.muted}>{t('seats.zoom')}</Txt>
      </PadScroll>
      {locked ? null : (
        <View style={{ borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.stone, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 + pad, gap: 6 }}>
          <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', gap: 6 }}>
            <Txt size="caption" color={k.muted} style={{ textAlign: 'center' }}>{t('seats.deadline', deadline)}</Txt>
            <Button title={t('seats.save')} busy={busy} disabled={!dirty && !unanswered} onPress={() => void submit()} />
          </View>
        </View>
      )}
      <Sheet visible={confirmLeave} title={t('seats.discardTitle')} onClose={() => setConfirmLeave(false)} closeLabel={t('seats.discardKeep')}
        footer={<Button kind="danger" title={t('seats.discardYes')} onPress={() => { setConfirmLeave(false); onBack(); }} />}>
        <Txt color={k.muted}>{t('seats.discardBody')}</Txt>
      </Sheet>
    </View>
  );
}
