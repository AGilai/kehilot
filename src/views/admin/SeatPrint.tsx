import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import { config } from '../../config.ts';
import { hebrewDate } from '../../dates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Check, Chip, Segmented, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import { fonts } from '../../kit/theme.ts';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { PRINT_STYLES, PRINT_STYLE_DEFAULT, PRINT_STYLE_KEY, legendItems, parsePrintStyle, pendingNotch, seatFill } from '../../seats/printStyle.ts';
import type { PrintStyle } from '../../seats/printStyle.ts';
import type { Prayer } from '../../seats/release.ts';
import { useShabbat } from '../../seats/useShabbat.ts';
import { whenParts } from '../../seats/window.ts';
import { householdsOf, isNoLayout, layoutPrint, printGeometry } from '../../seats/wire.ts';
import type { LayoutPrint, LayoutPrintSeat, PrintGeometry, PrintState, Rect, WeekWire } from '../../seats/wire.ts';
import { BackLink } from '../Me.tsx';
import { useAdminErrText } from './shared.tsx';
import { SeatBehalf } from './SeatBehalf.tsx';
import type { BehalfSave } from './SeatBehalf.tsx';

type Choice = Prayer | 'both';
const PAGE_W = 1123;
const PAGE_H = 794;
const HATCH = 'repeating-linear-gradient(135deg, #e6e6e6 0 4px, #fff 4px 9px)';
const INK = '#000000';
const PAPER = '#FFFFFF';

type Load = { status: 'loading' } | { status: 'error'; text: string } | { status: 'empty' } | { status: 'ready'; week: WeekWire };

/** P26: the gabbai's hall map, to print (UX-DESIGN §15.5), on the real layout and states; plus the on-behalf edit (§16). Web prints through the browser; the phone's PDF is not built yet. */
export function SeatPrint({ onBack, onEditor, onToast }: { onBack: () => void; /** Opens the seating editor (the empty state points there). */ onEditor?: () => void; onToast: (text: string) => void }) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state } = useSession();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId;
  const { friday, saturday, parasha } = useShabbat();
  const [load, setLoad] = React.useState<Load>({ status: 'loading' });
  const fetchWeek = React.useCallback(async (quiet = false): Promise<WeekWire | null> => {
    if (!kehilaId) return null;
    if (!quiet) setLoad({ status: 'loading' });
    try {
      const week = await api.seatWeek(kehilaId, friday);
      setLoad({ status: 'ready', week });
      return week;
    } catch (e) {
      setLoad(isNoLayout(e) ? { status: 'empty' } : { status: 'error', text: errText(e) });
      return null;
    }
  }, [api, kehilaId, friday]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void fetchWeek(); }, [fetchWeek]);

  const [choice, setChoice] = React.useState<Choice>('arvit');
  const [names, setNames] = React.useState(false); // off by default and never remembered: the print may be posted in the hall
  const [style, setStyle] = React.useState<PrintStyle>(PRINT_STYLE_DEFAULT); // remembered per device, unlike the names
  const [selected, setSelected] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    try { AsyncStorage.getItem(PRINT_STYLE_KEY).then(v => v, () => null).then(v => { if (live) setStyle(parsePrintStyle(v)); }, () => {}); } catch { /* storage blocked */ }
    return () => { live = false; };
  }, []);
  function pickStyle(next: PrintStyle) {
    setStyle(next);
    try { AsyncStorage.setItem(PRINT_STYLE_KEY, next).catch(() => {}); } catch { /* storage blocked */ }
  }
  const styleName = (x: PrintStyle) => t(`seats.print.style${x === 'green' ? 'Green' : x === 'greenRed' ? 'GreenRed' : 'Bw'}`);
  const [width, setWidth] = React.useState(0);
  const win = useWindowDimensions().width;
  const wide = win >= 1100;
  const phone = win < 700;
  const panelRef = React.useRef<View>(null);
  const pickSeat = (ref: string) => {
    setSelected(ref);
    if (Platform.OS === 'web') setTimeout(() => (panelRef.current as unknown as { scrollIntoView?: (o: object) => void } | null)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 0);
  };
  const prayers: Prayer[] = choice === 'both' ? ['arvit', 'shacharit'] : [choice];
  const scale = width > 0 ? Math.min(1, width / PAGE_W) : 1;
  const week = load.status === 'ready' ? load.week : null;
  const picked = React.useMemo(() => {
    const h = week && selected ? householdsOf(week).find(x => x.ref === selected) : null;
    return new Set(h ? h.seats.map(x => x.id) : []);
  }, [week, selected]);
  const closesAt = week ? new Date(week.deadline) : new Date();
  const sheet = {
    parasha: parasha ?? '',
    hebrew: hebrewDate(saturday, lang),
    kehila: state.kehila?.name ?? '',
    deadline: whenParts(closesAt, lang),
    now: whenParts(new Date(), lang),
    open: week?.open ?? false,
  };

  function print() {
    if (Platform.OS !== 'web') { onToast(t('seats.print.phoneSoon')); return; }
    printPages();
  }

  /** On behalf: one PUT per prayer that changed; a 409 re-reads the week (the draft restarts from the current state). */
  const saveBehalf: BehalfSave = async (bodies) => {
    if (!kehilaId || !week) return { ok: false };
    try {
      for (const { body } of bodies) await api.putSeatWeek(kehilaId, week.week, body);
      await fetchWeek(true);
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      await fetchWeek(true);
      return code === 'week_changed' ? { ok: false, stale: true } : { ok: false, error: errText(e) };
    }
  };

  const head = (
    <>
      <BackLink onPress={onBack} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Txt serif size="title" accessibilityRole="header">{t('seats.print.title')}</Txt>
        {config.seatsPreview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
      </View>
    </>
  );

  if (load.status === 'loading' || load.status === 'error' || load.status === 'empty') {
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {head}
        {load.status === 'loading' ? <ActivityIndicator /> : null}
        {load.status === 'error' ? <Banner tone="error" text={`${t('seats.print.loadError')} ${load.text}`} action={{ title: t('common.retry'), onPress: () => void fetchWeek() }} /> : null}
        {load.status === 'empty' ? (
          <Card edgeColor={k.tekhelet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="grid" size={28} color={k.tekhelet} />
              <Txt bold size="heading" accessibilityRole="header" style={{ flex: 1 }}>{t('seats.print.emptyTitle')}</Txt>
            </View>
            <Txt color={k.muted}>{t('seats.print.emptyBody')}</Txt>
            {Platform.OS === 'web' ? (onEditor ? <Button icon="grid" title={t('seats.print.emptyGo')} onPress={onEditor} /> : null) : <Txt size="caption" color={k.muted}>{t('seatMap.phone.banner')}</Txt>}
          </Card>
        ) : null}
      </PadScroll>
    );
  }

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 1500, alignSelf: 'center' }}>
      {head}
      {wide ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 20 }}>
          <View style={{ width: 400, gap: 14, ...(Platform.OS === 'web' ? ({ position: 'sticky', top: 12 } as object) : null) }}>
      <Card style={{ gap: 10, width: '100%' }}>
        <Txt size="small" color={k.muted}>{t('seats.print.sub', { parasha: parasha ?? '' })}</Txt>
        <Txt bold size="small">{t('seats.print.prayer')}</Txt>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip label={t('seats.arvitShort')} selected={choice === 'arvit'} onPress={() => setChoice('arvit')} />
          <Chip label={t('seats.shacharitShort')} selected={choice === 'shacharit'} onPress={() => setChoice('shacharit')} />
          <Chip label={t('seats.print.both')} selected={choice === 'both'} onPress={() => setChoice('both')} />
        </View>
        <Txt bold size="small">{t('seats.print.style')}</Txt>
        <Segmented<PrintStyle> options={PRINT_STYLES.map(x => ({ key: x, label: styleName(x) }))} value={style} onChange={pickStyle} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {legendItems(style).map(i => <PaperBox key={i.state} state={i.state} style={style} w={26} h={18} />)}
        </View>
        <Txt size="caption" color={k.muted}>{t('seats.print.styleNote')}</Txt>
        <Check label={t('seats.print.names')} note={t('seats.print.namesNote')} value={names} onChange={setNames} />
        <Button icon="print" title={t('seats.print.go')} onPress={print} />
      </Card>
      <View ref={panelRef} style={{ width: '100%' }}><SeatBehalf week={load.week} selected={selected} onSelect={setSelected} save={saveBehalf} phone={phone} /></View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', gap: 16 }}>
        {prayers.map(p => {
          const model = layoutPrint(load.week, p, { names });
          return (
            <View key={p} style={{ width: PAGE_W * scale, height: PAGE_H * scale, overflow: 'hidden', backgroundColor: '#e9e9e9', borderWidth: 1, borderColor: k.line }}>
              <View style={{ width: PAGE_W, height: PAGE_H, transformOrigin: dir === 'rtl' ? 'top right' : 'top left', transform: [{ scale }] } as object}>
                <PrintPage model={model} prayer={p} names={names} sheet={sheet} style={style} onSeat={s => { if (s.ref) pickSeat(s.ref); }} picked={picked} household={id => (load.week.households[id] ?? '')} />
              </View>
            </View>
          );
        })}
      </View>
          </View>
        </View>
      ) : (
        <>
      <Card style={{ gap: 10, maxWidth: 680, width: '100%' }}>
        <Txt size="small" color={k.muted}>{t('seats.print.sub', { parasha: parasha ?? '' })}</Txt>
        <Txt bold size="small">{t('seats.print.prayer')}</Txt>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip label={t('seats.arvitShort')} selected={choice === 'arvit'} onPress={() => setChoice('arvit')} />
          <Chip label={t('seats.shacharitShort')} selected={choice === 'shacharit'} onPress={() => setChoice('shacharit')} />
          <Chip label={t('seats.print.both')} selected={choice === 'both'} onPress={() => setChoice('both')} />
        </View>
        <Txt bold size="small">{t('seats.print.style')}</Txt>
        <Segmented<PrintStyle> options={PRINT_STYLES.map(x => ({ key: x, label: styleName(x) }))} value={style} onChange={pickStyle} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {(['taken', 'pending', 'released', 'free'] as const).map(st => <PaperBox key={st} state={st} style={style} w={26} h={18} />)}
        </View>
        <Txt size="caption" color={k.muted}>{t('seats.print.styleNote')}</Txt>
        <Check label={t('seats.print.names')} note={t('seats.print.namesNote')} value={names} onChange={setNames} />
        <Button icon="print" title={t('seats.print.go')} onPress={print} />
      </Card>
      <View ref={panelRef} style={{ width: '100%' }}><SeatBehalf week={load.week} selected={selected} onSelect={setSelected} save={saveBehalf} phone={phone} /></View>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', gap: 16 }}>
        {prayers.map(p => {
          const model = layoutPrint(load.week, p, { names });
          return (
            <View key={p} style={{ width: PAGE_W * scale, height: PAGE_H * scale, overflow: 'hidden', backgroundColor: '#e9e9e9', borderWidth: 1, borderColor: k.line }}>
              <View style={{ width: PAGE_W, height: PAGE_H, transformOrigin: 'top left', transform: [{ scale }] } as object}>
                <PrintPage model={model} prayer={p} names={names} sheet={sheet} style={style} onSeat={s => { if (s.ref) pickSeat(s.ref); }} picked={picked} household={id => (load.week.households[id] ?? '')} />
              </View>
            </View>
          );
        })}
      </View>
        </>
      )}
    </PadScroll>
  );
}

type Sheet = { parasha: string; hebrew: string; kehila: string; deadline: { day: string; time: string }; now: { day: string; time: string }; open: boolean };

/** One A4 landscape page: fixed paper colours (black on white), never dark mode. The hall is the server's layout: bimah and ark are its own cells. */
function PrintPage({ model, prayer, names, sheet, style, onSeat, picked, household }: { model: LayoutPrint; prayer: Prayer; names: boolean; sheet: Sheet; style: PrintStyle; onSeat: (seat: LayoutPrintSeat) => void; picked: Set<string>; household: (ref: string) => string }) {
  const { t } = useI18n();
  const T = (children: React.ReactNode, o: { size?: number; bold?: boolean; serif?: boolean; style?: object } = {}) => (
    <Txt color={INK} style={{ fontSize: o.size ?? 12.5, lineHeight: Math.round((o.size ?? 12.5) * 1.35), fontFamily: o.serif ? fonts.title : o.bold ? fonts.uiBold : fonts.ui, ...o.style }}>{children}</Txt>
  );
  const g = React.useMemo(() => printGeometry(model.rows, model.cols), [model.rows, model.cols]);
  const left = (col: number) => g.rowW + 2 + col * g.pitch;
  const top = (row: number) => g.head + row * g.rowPitch;
  const rect = (r: Rect) => ({ position: 'absolute' as const, left: left(r.col), top: top(r.row), width: r.cols * g.pitch - g.gap, height: r.rows * g.rowPitch - 4 });
  const rowLabel = (r: number) => model.rowLabels[r] ?? '';
  return (
    <View {...({ dataSet: { seatPage: prayer } } as object)} style={{ width: PAGE_W, height: PAGE_H, backgroundColor: PAPER, paddingHorizontal: 34, paddingVertical: 34, gap: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 8 }}>
        <View style={{ flex: 1 }}>
          {T(t('seats.print.page', { parasha: sheet.parasha }), { size: 24, serif: true })}
          {T(`${sheet.hebrew} · ${sheet.kehila}`, { size: 13 })}
        </View>
        {T(t(`seats.${prayer}`), { size: 30, serif: true })}
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          {T(t('seats.print.status', { day: sheet.now.day, time: sheet.now.time, state: sheet.open ? t('seats.print.open', sheet.deadline) : t('seats.print.closedState') }), { size: 13 })}
          {T(t('seats.print.printed', sheet.now), { size: 13 })}
          {config.seatsPreview ? <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: INK, paddingHorizontal: 8, marginTop: 2 }}>{T(t('seats.print.fixture'), { size: 11 })}</View> : null}
        </View>
      </View>
      {model.ark.length ? null : <View style={{ alignSelf: 'center', borderWidth: 2, borderColor: INK, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 26, paddingVertical: 2 }}>{T(t('seats.print.ark'), { size: 14, serif: true })}</View>}
      <View style={{ width: g.hallW, height: g.hallH, alignSelf: 'center', direction: 'ltr' }}>
        {model.blocks.map(b => (
          <View key={`${b.colStart}`} style={{ position: 'absolute', left: left(b.colStart), top: 0, width: (b.colEnd - b.colStart + 1) * g.pitch - g.gap, alignItems: 'center' }}>{T(b.name, { size: 12, bold: true, style: { textAlign: 'center' } })}</View>
        ))}
        {Array.from({ length: model.rows }, (_, r) => (
          <React.Fragment key={r}>
            <View style={{ position: 'absolute', left: 0, top: top(r), width: g.rowW, height: g.cellH, alignItems: 'center', justifyContent: 'center' }}>{T(rowLabel(r), { size: 11, style: { textAlign: 'center' } })}</View>
            <View style={{ position: 'absolute', left: g.rowW + 4 + model.cols * g.pitch, top: top(r), width: g.rowW, height: g.cellH, alignItems: 'center', justifyContent: 'center' }}>{T(rowLabel(r), { size: 11, style: { textAlign: 'center' } })}</View>
          </React.Fragment>
        ))}
        {model.ark.map((r, i) => (
          <View key={`ark${i}`} style={{ ...rect(r), borderWidth: 2, borderColor: INK, borderTopLeftRadius: 6, borderTopRightRadius: 6, alignItems: 'center', justifyContent: 'center' }}>{T(t('seats.print.ark'), { size: 13, serif: true })}</View>
        ))}
        {model.bimah.map((r, i) => (
          <View key={`bimah${i}`} style={{ ...rect(r), borderWidth: 2, borderColor: INK, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eeeeee', ...(Platform.OS === 'web' ? ({ backgroundImage: HATCH } as object) : null) }}>
            {T(t('seats.bimah'), { size: 14, serif: true })}
          </View>
        ))}
        {model.seats.map(s => <PaperSeat key={s.id} seat={s} left={left(s.col)} top={top(s.row)} g={g} names={names} style={style} outlined={picked.has(s.id)} label={s.ref ? `${household(s.ref)}, ${t(`seats.print.${s.state}`)}` : undefined} onPress={s.ref ? () => onSeat(s) : undefined} />)}
      </View>
      <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: INK }}>
        <CountCell title={t('seats.print.total')} c={model.total} first />
        {[...model.blocks].reverse().map(b => <CountCell key={b.colStart} title={b.name} c={b} />)}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
        {legendItems(style).map(i => <LegendItem key={i.state} state={i.state} text={t(`seats.print.legend${i.state[0]!.toUpperCase()}${i.state.slice(1)}`)} />)}
        {T(t(style === 'green' ? 'seats.print.noteGreen' : style === 'greenRed' ? 'seats.print.noteGreenRed' : 'seats.print.noteBw'), { size: 12.5, bold: true })}
        <View style={{ marginStart: 'auto' }}>{T(names ? t('seats.print.withNames') : t('seats.print.noNames'), { size: 12.5 })}</View>
      </View>
    </View>
  );

  function CountCell({ title, c, first }: { title: string; c: { taken: number; released: number; free: number; pending: number }; first?: boolean }) {
    return (
      <View style={{ flex: 1, paddingHorizontal: 6, paddingVertical: 4, borderStartWidth: first ? 0 : 1, borderStartColor: INK }}>
        {T(title, { size: 12.5, bold: true })}
        {T(`${t('seats.print.taken')} ${c.taken} · ${t('seats.print.pending')} ${c.pending} · ${t('seats.print.released')} ${c.released} · ${t('seats.print.free')} ${c.free}`, { size: 11 })}
      </View>
    );
  }
  function LegendItem({ state, text }: { state: PrintState; text: string }) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <PaperBox state={state} style={style} w={26} h={18} />
        {T(text, { size: 12.5 })}
      </View>
    );
  }
}

/** Shapes never change with the style: taken 1 px line, pending 1 px line + black corner notch (top-left), released 2 px line + diagonal, free 1.2 px dashed line. Only the fill does (§15.9, §16.12.4). */
function PaperBox({ state, style, w, h, label, strike }: { state: PrintState; style: PrintStyle; w: number; h: number; label?: string; strike?: boolean }) {
  const base = { width: w, height: h, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: seatFill(style, state) } as const;
  const diag = Math.sqrt(w * w + h * h);
  const L = pendingNotch(h);
  return (
    <View style={[base, state === 'taken' || state === 'pending' ? { borderWidth: 1, borderColor: INK } : state === 'released' ? { borderWidth: 2, borderColor: INK } : { borderWidth: 1.2, borderStyle: 'dashed', borderColor: INK }]}>
      {state === 'pending' ? <View style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderTopWidth: L, borderTopColor: INK, borderRightWidth: L, borderRightColor: 'transparent' }} /> : null}
      {state === 'released' ? <View style={{ position: 'absolute', width: diag, height: 2, backgroundColor: INK, transform: [{ rotate: `${-Math.atan2(h, w)}rad` }] }} /> : null}
      {label ? <Txt color={INK} style={{ fontSize: 10, lineHeight: 12, textDecorationLine: strike ? 'line-through' : 'none', textAlign: 'center' }} numberOfLines={1}>{label}</Txt> : null}
    </View>
  );
}

/** On screen (not on paper) an allocated seat opens "update for <household>" (§15.5); the picked household's seats get a 2 px tekhelet outline (§16.12.1). */
function PaperSeat({ seat, left, top, g, names, style, onPress, outlined, label }: { seat: LayoutPrintSeat; left: number; top: number; g: PrintGeometry; names: boolean; style: PrintStyle; onPress?: () => void; outlined?: boolean; label?: string }) {
  const box = <PaperBox state={seat.state} style={style} w={g.cellW} h={g.cellH} label={names ? seat.name : undefined} strike={seat.state === 'released'} />;
  return (
    <View style={{ position: 'absolute', left, top }}>
      {outlined ? <View pointerEvents="none" {...({ dataSet: { screenOnly: '1' } } as object)} style={{ position: 'absolute', left: -3, top: -3, right: -3, bottom: -3, borderWidth: 2, borderColor: '#2A3F94', borderRadius: 8 }} /> : null}
      {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>{box}</Pressable> : box}
    </View>
  );
}

/** Web: copy the page(s) into a print-only root, hide the app, open the browser's print dialog (A4 landscape), then clean up. */
function printPages() {
  if (typeof document === 'undefined') return;
  const pages = Array.from(document.querySelectorAll('[data-seat-page]')) as HTMLElement[];
  if (!pages.length) return;
  const style = document.createElement('style');
  style.textContent = '@page{size:A4 landscape;margin:0}#seat-print-root{display:none}#seat-print-root,#seat-print-root *{print-color-adjust:exact;-webkit-print-color-adjust:exact}@media print{body>*:not(#seat-print-root){display:none!important}#seat-print-root{display:block!important}}';
  const root = document.createElement('div');
  root.id = 'seat-print-root';
  pages.forEach((p, i) => {
    const copy = p.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-screen-only]').forEach(n => n.remove()); // the picked household's outline is never on paper
    copy.style.breakAfter = i < pages.length - 1 ? 'page' : 'auto';
    copy.style.setProperty('print-color-adjust', 'exact');
    copy.style.setProperty('-webkit-print-color-adjust', 'exact');
    root.appendChild(copy);
  });
  document.head.appendChild(style);
  document.body.appendChild(root);
  const done = () => { root.remove(); style.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
