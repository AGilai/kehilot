import React from 'react';
import { ActivityIndicator, Pressable, View, useWindowDimensions } from 'react-native';
import { config } from '../config.ts';
import { dualDate } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Chip, Sheet, Tag, Txt, useTokens } from '../kit/components.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { useReportPad } from '../client/reportUi.ts';
import type { Prayer } from '../seats/release.ts';
import { readMapFolded, writeMapFolded } from '../seats/mapFold.ts';
import { copyArvit, footerOf, formMode, headKey, hintOf, initDraft, pickCount, runSend, saveChoices, segState, tapChair } from '../seats/seatForm.ts';
import type { FormDraft } from '../seats/seatForm.ts';
import { useMemberSeats } from '../seats/useMemberSeats.ts';
import { useShabbat } from '../seats/useShabbat.ts';
import { whenParts } from '../seats/window.ts';
import type { MemberSeats } from '../seats/wire.ts';
import { BackIcon } from '../kit/Icon.tsx';
import { BackLink } from './Me.tsx';
import { useErrorText } from './auth/Frame.tsx';
import { NumberCircles } from './seatForm/NumberCircles.tsx';
import { PrayerSegments, segText } from './seatForm/PrayerSegments.tsx';
import { SeatMap, WIDE_MIN_WIDTH } from './seatForm/SeatMap.tsx';

/** P25: the member's seat page (UX-DESIGN §15.3), on the member API. It gets only its own cut (`frames`): there is no whole-hall map here, by design. */
export function SeatPage({ week, onBack, onDone, onToast }: { /** The Friday of the Shabbat to show; the server's coming one when absent. */ week?: string; onBack: () => void; onDone: () => void; onToast: (text: string) => void }) {
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
  return <SeatPageReady data={seats.state.data} save={seats.save} onBack={onBack} onDone={onDone} onToast={onToast} />;
}

function SeatPageReady({ data, save, onBack, onDone, onToast }: { data: MemberSeats; save: ReturnType<typeof useMemberSeats>['save']; onBack: () => void; onDone: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const [draft, setDraft] = React.useState<FormDraft>(() => initDraft(data));
  const [selected, setSelected] = React.useState<Prayer>('arvit');
  // A fresh server state (after a save or a re-read) replaces the draft.
  const first = React.useRef(true);
  React.useEffect(() => { if (first.current) { first.current = false; return; } setDraft(initDraft(data)); }, [data]);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stale, setStale] = React.useState(false);
  const { saturday, parasha } = useShabbat(data.week);
  const deadline = whenParts(data.deadline, lang);
  const mode = formMode(data);
  const locked = !data.open;
  const n = data.seatCount;
  const dirty = (['arvit', 'shacharit'] as Prayer[]).some((p) => draft[p].released.size !== data.released[p].size || [...draft[p].released].some((x) => !data.released[p].has(x)));
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_MIN_WIDTH;
  const [folded, setFolded] = React.useState(false);
  React.useEffect(() => { void readMapFolded().then(setFolded); }, []);
  const setMapFolded = (v: boolean) => { setFolded(v); void writeMapFolded(v); };
  const pad = useReportPad();
  const multiRow = data.frames.some((f) => f.rows.filter((r) => r.mine).length > 1);
  const nameOf = (p: Prayer) => t(p === 'arvit' ? 'seats.form.nameArvit' : 'seats.form.nameShacharit');
  const states = { arvit: segState(draft.arvit, n), shacharit: segState(draft.shacharit, n) };
  const pd = draft[selected];
  const hint = hintOf(pd, n, multiRow, locked);
  const footer = footerOf(draft, data, selected);
  const mapReleased = locked ? data.released[selected] : pd.released;

  const edit = (f: (d: FormDraft) => FormDraft) => { if (locked || busy) return; setStale(false); setDraft(f); };
  const back = () => { if (dirty && !locked) setConfirmLeave(true); else onBack(); };

  const sending = React.useRef(false);
  async function submit() {
    if (sending.current || !footer || footer.kind === 'next') return;
    sending.current = true;
    setBusy(true); setError(null); setStale(false);
    try {
      const a = await runSend(() => save(saveChoices(draft, data)), { toast: t('seats.form.savedToast'), onToast, onDone });
      if (a === 'stale') setStale(true);
      else if (a === 'none') setError(t('seats.loadError'));
    } catch (e) { setError(errText(e)); } finally { sending.current = false; setBusy(false); }
  }

  const shabbat = parasha ? t('seats.shabbatLine', { parasha, date: dualDate(saturday, lang) }) : dualDate(saturday, lang);
  const titleBlock = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('me.back')} onPress={back} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <BackIcon color={k.tekhelet} />
      </Pressable>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt serif accessibilityRole="header" style={{ fontSize: 19, lineHeight: 26 }}>{t('seats.form.title')}</Txt>
          {config.seatsPreview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
        </View>
        <Txt color={k.muted} style={{ fontSize: 12.5, lineHeight: 17 }}>{shabbat}</Txt>
      </View>
    </View>
  );
  const dialog = (
    <Sheet visible={confirmLeave} title={t('seats.discardTitle')} onClose={() => setConfirmLeave(false)} closeLabel={t('seats.discardKeep')}
      footer={<Button kind="danger" title={t('seats.discardYes')} onPress={() => { setConfirmLeave(false); onBack(); }} />}>
      <Txt color={k.muted}>{t('seats.discardBody')}</Txt>
    </Sheet>
  );
  const colStyle = { padding: 16, gap: 14, width: '100%' as const, maxWidth: wide ? 1040 : 680, alignSelf: 'center' as const };

  if (mode === 'noSeats') {
    return (
      <PadScroll contentContainerStyle={colStyle}>
        {titleBlock}
        <Card edgeColor={k.tekhelet}>
          <Txt bold size="heading" accessibilityRole="header">{t('seats.noneTitle')}</Txt>
          <Txt color={k.muted}>{t('seats.noneBody')}</Txt>
        </Card>
        <Txt size="small" color={k.muted}>{t('seats.form.noSeatsLater')}</Txt>
        {dialog}
      </PadScroll>
    );
  }

  const when = (ms: number | null) => { const d = ms ? whenParts(new Date(ms), lang) : { day: '', time: '' }; return d; };
  const answeredAt = Math.max(data.answeredAt.arvit ?? 0, data.answeredAt.shacharit ?? 0) || null;
  const banner = (() => {
    if (mode === 'notSent') return <Banner tone="info" text={t('seats.form.notSent')} />;
    if (mode === 'closed') return <Banner tone="info" text={t('seats.form.closed', deadline)} />;
    if (stale) return <Banner tone="info" text={t('seats.updatedNow')} />;
    if (mode === 'answered') {
      if (data.updatedByGabbai) {
        const w = when(data.updatedByAt);
        return <Banner tone="info" text={data.updatedByRole === 'tech' ? t('seats.byTech') : t('seats.form.byStaffAt', w)} />;
      }
      const a = when(answeredAt);
      return <Banner tone="success" text={t('seats.form.answered', { day: a.day, time: a.time, day2: deadline.day, time2: deadline.time })} />;
    }
    return null;
  })();

  const segments = <PrayerSegments value={selected} states={states} onChange={setSelected} />;
  const mapCard = mode === 'notSent'
    ? <SeatMap frames={data.frames} released={new Set()} head={headKey(data)} locked folded={folded} onFold={setMapFolded} onTap={() => {}} wide={wide} chairHeight={wide ? 74 : undefined} />
    : data.frames.length > 0
      ? <SeatMap frames={data.frames} released={mapReleased} head={headKey(data)} locked={locked} folded={folded} onFold={setMapFolded} onTap={(key) => edit((d) => tapChair(d, data, selected, key))} wide={wide} chairHeight={wide ? 74 : undefined} />
      : null;
  const sameChip = selected === 'shacharit' && draft.arvit.answered && !locked ? (
    <View testID="seat-same" style={{ alignItems: 'flex-start' }}>
      <Chip size="filter" icon="copy" label={t('seats.form.same', { state: segText(t, states.arvit) })} onPress={() => edit(copyArvit)} />
    </View>
  ) : null;
  const countValue = locked ? data.released[selected].size : pd.answered ? pd.released.size : null;
  const question = (
    <>
      <Txt serif accessibilityRole="header" style={{ fontSize: 17, lineHeight: 24 }}>{t('seats.form.count', { when: t(selected === 'arvit' ? 'seats.form.whenArvit' : 'seats.form.whenShacharit') })}</Txt>
      <NumberCircles n={n} value={countValue} locked={locked} onPick={(c) => edit((d) => pickCount(d, data, selected, c))} />
      <Txt size="small" color={k.muted} accessibilityLiveRegion="polite" style={{ minHeight: 20 }}>{hint === 'none' ? t('seats.form.hint.none') : t(`seats.form.hint.${hint}`, { n })}</Txt>
    </>
  );

  const pill = (p: Prayer) => {
    const st = states[p];
    const label = st.kind === 'free' ? t('seats.form.pill', { prayer: nameOf(p), need: n - st.n, free: st.n }) : `${nameOf(p)}: ${st.kind === 'unanswered' ? t('seats.form.stateUnanswered') : segText(t, st)}`;
    return (
      <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: p === selected }} onPress={() => setSelected(p)}
        style={{ flex: 1, minHeight: 32, borderRadius: 16, borderWidth: p === selected ? 1.5 : 1, borderColor: p === selected ? k.tekhelet : k.line, paddingHorizontal: 10, justifyContent: 'center' }}>
        <Txt size="caption" bold={p === selected} color={p === selected ? k.tekhelet : k.muted} style={{ textAlign: 'center' }} numberOfLines={1}>{label}</Txt>
      </Pressable>
    );
  };
  const buttonTitle = !footer ? '' : footer.kind === 'next' ? t('seats.form.next', { prayer: nameOf(footer.to) }) : footer.kind === 'send' ? t('seats.form.send') : t('seats.form.sendChanges');
  const disabled = !footer || (footer.kind !== 'next' && !footer.enabled);
  const caption = !footer ? '' : footer.kind === 'send' && !footer.enabled ? t('seats.form.bothFirst') : footer.kind === 'sendChanges' && !footer.enabled ? t('seats.form.noChanges') : t('seats.form.foot', deadline);
  const sendButton = !footer ? null : (
    <View testID="seat-send">
      <Button title={buttonTitle} busy={busy} disabled={disabled} onPress={() => { if (footer.kind === 'next') setSelected(footer.to); else void submit(); }} />
    </View>
  );
  const pills = !footer ? null : <View style={{ flexDirection: 'row', gap: 8 }}>{(['arvit', 'shacharit'] as Prayer[]).map(pill)}</View>;

  if (wide) {
    return (
      <View style={{ flex: 1 }}>
        <PadScroll contentContainerStyle={colStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            {titleBlock}
            <View style={{ width: 420 }}>{segments}</View>
          </View>
          {banner}
          {error ? <Banner tone="error" text={error} /> : null}
          {mode === 'notSent' ? mapCard : (
            <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>{mapCard}</View>
              <View style={{ flex: 1, gap: 14 }}>
                {sameChip}
                {question}
                {footer ? (
                  <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: k.line, paddingTop: 12 }}>
                    {pills}
                    <View style={{ width: 200 }}>{sendButton}</View>
                    <Txt size="caption" color={k.muted}>{caption}</Txt>
                  </View>
                ) : null}
              </View>
            </View>
          )}
        </PadScroll>
        {dialog}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <PadScroll contentContainerStyle={colStyle}>
        {titleBlock}
        {banner}
        {error ? <Banner tone="error" text={error} /> : null}
        {mode === 'notSent' ? null : segments}
        {mapCard}
        {mode === 'notSent' ? null : (<>{sameChip}{question}</>)}
      </PadScroll>
      {footer ? (
        <View style={{ borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.surface, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 + pad, gap: 6 }}>
          <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', gap: 6 }}>
            {pills}
            {sendButton}
            <Txt size="caption" color={k.muted} style={{ textAlign: 'center' }}>{caption}</Txt>
          </View>
        </View>
      ) : null}
      {dialog}
    </View>
  );
}
