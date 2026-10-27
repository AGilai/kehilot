import React from 'react';
import { Platform, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import { fixtureSeatHall } from '../../client/fixtures.ts';
import { hebrewDate } from '../../dates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button, Card, Check, Chip, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { fonts } from '../../kit/theme.ts';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { FRONT_ROW, HALL } from '../../seats/hall.ts';
import { printModel } from '../../seats/printModel.ts';
import type { PrintModel, PrintSeat } from '../../seats/printModel.ts';
import type { Prayer } from '../../seats/release.ts';
import { useShabbat } from '../../seats/useShabbat.ts';
import { cardWindow, whenParts } from '../../seats/window.ts';
import { BackLink } from '../Me.tsx';

type Choice = Prayer | 'both';
const PAGE_W = 1123;
const PAGE_H = 794;
// Hall geometry on paper (px): 29 columns of 32 with a 2 px gap (6 blocks), a row-number column on each side. Fits the 1043 px inside the page margins.
const CELL_W = 32, GAP = 2, PITCH = CELL_W + GAP, ROW_W = 30, ROW_H = 24, ROW_PITCH = 28, HEAD = 22;
const HALL_W = ROW_W * 2 + HALL.cols * PITCH + 4;
const HALL_H = HEAD + HALL.rows * ROW_PITCH;
const HATCH = 'repeating-linear-gradient(135deg, #e6e6e6 0 4px, #fff 4px 9px)';
const INK = '#000000';
const PAPER = '#FFFFFF';

/** P26: the gabbai's hall map, to print (UX-DESIGN §15.5). Web prints through the browser; the phone's PDF is not built yet. */
export function SeatPrint({ onBack, onToast }: { onBack: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const { friday, saturday, parasha } = useShabbat();
  const [choice, setChoice] = React.useState<Choice>('arvit');
  const [names, setNames] = React.useState(false); // off by default and never remembered: the print may be posted in the hall
  const [width, setWidth] = React.useState(0);
  const data = React.useMemo(() => fixtureSeatHall(HALL), []);
  const prayers: Prayer[] = choice === 'both' ? ['arvit', 'shacharit'] : [choice];
  const scale = width > 0 ? Math.min(1, width / PAGE_W) : 1;
  const sheet = {
    parasha: parasha ?? '',
    hebrew: hebrewDate(saturday, lang),
    kehila: state.kehila?.name ?? '',
    deadline: whenParts(cardWindow(friday).closesAt, lang),
    now: whenParts(new Date(), lang),
    open: new Date() < cardWindow(friday).closesAt,
  };

  function print() {
    if (Platform.OS !== 'web') { onToast(t('seats.print.phoneSoon')); return; }
    printPages();
  }

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 1180, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Txt serif size="title" accessibilityRole="header">{t('seats.print.title')}</Txt>
        <Tag tone="preview" label={t('seats.preview')} />
      </View>
      <Card style={{ gap: 10, maxWidth: 680, width: '100%' }}>
        <Txt size="small" color={k.muted}>{t('seats.print.sub', { parasha: parasha ?? '' })}</Txt>
        <Txt bold size="small">{t('seats.print.prayer')}</Txt>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip label={t('seats.arvitShort')} selected={choice === 'arvit'} onPress={() => setChoice('arvit')} />
          <Chip label={t('seats.shacharitShort')} selected={choice === 'shacharit'} onPress={() => setChoice('shacharit')} />
          <Chip label={t('seats.print.both')} selected={choice === 'both'} onPress={() => setChoice('both')} />
        </View>
        <Check label={t('seats.print.names')} note={t('seats.print.namesNote')} value={names} onChange={setNames} />
        <Button icon="send" title={t('seats.print.go')} onPress={print} />
      </Card>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', gap: 16 }}>
        {prayers.map(p => {
          const model = printModel(data.hall, data.allocations, data.released[p], { names });
          return (
            <View key={p} style={{ width: PAGE_W * scale, height: PAGE_H * scale, overflow: 'hidden', backgroundColor: '#e9e9e9', borderWidth: 1, borderColor: k.line }}>
              <View style={{ width: PAGE_W, height: PAGE_H, transformOrigin: 'top left', transform: [{ scale }] } as object}>
                <PrintPage model={model} prayer={p} names={names} sheet={sheet} />
              </View>
            </View>
          );
        })}
      </View>
    </PadScroll>
  );
}

type Sheet = { parasha: string; hebrew: string; kehila: string; deadline: { day: string; time: string }; now: { day: string; time: string }; open: boolean };

/** One A4 landscape page: fixed paper colours (black on white), never dark mode. */
function PrintPage({ model, prayer, names, sheet }: { model: PrintModel; prayer: Prayer; names: boolean; sheet: Sheet }) {
  const { t } = useI18n();
  const T = (children: React.ReactNode, o: { size?: number; bold?: boolean; serif?: boolean; style?: object } = {}) => (
    <Txt color={INK} style={{ fontSize: o.size ?? 12.5, lineHeight: Math.round((o.size ?? 12.5) * 1.35), fontFamily: o.serif ? fonts.title : o.bold ? fonts.uiBold : fonts.ui, ...o.style }}>{children}</Txt>
  );
  const bimah = HALL.blocks.find(b => b.bimah)!;
  const left = (x: number) => ROW_W + 2 + x * PITCH;
  const top = (row: number) => HEAD + row * ROW_PITCH;
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
          <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: INK, paddingHorizontal: 8, marginTop: 2 }}>{T(t('seats.print.fixture'), { size: 11 })}</View>
        </View>
      </View>
      <View style={{ alignSelf: 'center', borderWidth: 2, borderColor: INK, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 26, paddingVertical: 2 }}>{T(t('seats.print.ark'), { size: 14, serif: true })}</View>
      <View style={{ width: HALL_W, height: HALL_H, alignSelf: 'center', direction: 'ltr' }}>
        {HALL.blocks.map(b => (
          <View key={b.id} style={{ position: 'absolute', left: left(b.x), top: 0, width: b.cols * PITCH - GAP, alignItems: 'center' }}>{T(b.name, { size: 12, bold: true, style: { textAlign: 'center' } })}</View>
        ))}
        {Array.from({ length: HALL.rows }, (_, r) => (
          <React.Fragment key={r}>
            <View style={{ position: 'absolute', left: 0, top: top(r), width: ROW_W, height: ROW_H, alignItems: 'center', justifyContent: 'center' }}>{T(r === FRONT_ROW ? t('seats.frontShort') : r, { size: r === FRONT_ROW ? 9 : 11, style: { textAlign: 'center' } })}</View>
            <View style={{ position: 'absolute', left: ROW_W + 4 + HALL.cols * PITCH, top: top(r), width: ROW_W, height: ROW_H, alignItems: 'center', justifyContent: 'center' }}>{T(r === FRONT_ROW ? t('seats.frontShort') : r, { size: r === FRONT_ROW ? 9 : 11, style: { textAlign: 'center' } })}</View>
          </React.Fragment>
        ))}
        <View style={{ position: 'absolute', left: left(bimah.x), top: top(bimah.bimah![0]!), width: bimah.cols * PITCH - GAP, height: bimah.bimah!.length * ROW_PITCH - 4, borderWidth: 2, borderColor: INK, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eeeeee', ...(Platform.OS === 'web' ? ({ backgroundImage: HATCH } as object) : null) }}>
          {T(t('seats.bimah'), { size: 14, serif: true })}
        </View>
        {model.seats.map(s => <PaperSeat key={s.key} seat={s} left={left(s.x)} top={top(s.row)} names={names} />)}
      </View>
      <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: INK }}>
        <CountCell title={t('seats.print.total')} c={model.total} first />
        {model.blocks.map(b => <CountCell key={b.id} title={b.name} c={b} />)}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
        <LegendItem state="taken" text={t('seats.print.legendTaken')} />
        <LegendItem state="released" text={t('seats.print.legendReleased')} />
        <LegendItem state="free" text={t('seats.print.legendFree')} />
        <View style={{ marginStart: 'auto' }}>{T(names ? t('seats.print.withNames') : t('seats.print.noNames'), { size: 12.5 })}</View>
      </View>
    </View>
  );

  function CountCell({ title, c, first }: { title: string; c: { taken: number; released: number; free: number }; first?: boolean }) {
    return (
      <View style={{ flex: 1, paddingHorizontal: 6, paddingVertical: 4, borderStartWidth: first ? 0 : 1, borderStartColor: INK }}>
        {T(title, { size: 12.5, bold: true })}
        {T(`${t('seats.print.taken')} ${c.taken} · ${t('seats.print.released')} ${c.released} · ${t('seats.print.free')} ${c.free}`, { size: 11 })}
      </View>
    );
  }
  function LegendItem({ state, text }: { state: PrintSeat['state']; text: string }) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <PaperBox state={state} w={26} h={18} />
        {T(text, { size: 12.5 })}
      </View>
    );
  }
}

/** Taken: grey fill, thin line. Released: white, thick line, diagonal. Free: dashed. Readable in black and white. */
function PaperBox({ state, w, h, label, strike, grey }: { state: PrintSeat['state']; w: number; h: number; label?: string; strike?: boolean; grey?: string }) {
  const base = { width: w, height: h, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } as const;
  const diag = Math.sqrt(w * w + h * h);
  return (
    <View style={[base, state === 'taken' ? { backgroundColor: grey ?? '#c8c8c8', borderWidth: 1, borderColor: INK } : state === 'released' ? { backgroundColor: PAPER, borderWidth: 2, borderColor: INK } : { backgroundColor: PAPER, borderWidth: 1.2, borderStyle: 'dashed', borderColor: '#444444' }]}>
      {state === 'released' ? <View style={{ position: 'absolute', width: diag, height: 2, backgroundColor: INK, transform: [{ rotate: `${-Math.atan2(h, w)}rad` }] }} /> : null}
      {label ? <Txt color={INK} style={{ fontSize: 10, lineHeight: 12, textDecorationLine: strike ? 'line-through' : 'none', textAlign: 'center' }} numberOfLines={1}>{label}</Txt> : null}
    </View>
  );
}

function PaperSeat({ seat, left, top, names }: { seat: PrintSeat; left: number; top: number; names: boolean }) {
  return (
    <View style={{ position: 'absolute', left, top }}>
      <PaperBox state={seat.state} w={CELL_W} h={ROW_H} label={names ? seat.name : undefined} strike={seat.state === 'released'} grey={names ? '#e6e6e6' : undefined} />
    </View>
  );
}

/** Web: copy the page(s) into a print-only root, hide the app, open the browser's print dialog (A4 landscape), then clean up. */
function printPages() {
  if (typeof document === 'undefined') return;
  const pages = Array.from(document.querySelectorAll('[data-seat-page]')) as HTMLElement[];
  if (!pages.length) return;
  const style = document.createElement('style');
  style.textContent = '@page{size:A4 landscape;margin:0}#seat-print-root{display:none}@media print{body>*:not(#seat-print-root){display:none!important}#seat-print-root{display:block!important}}';
  const root = document.createElement('div');
  root.id = 'seat-print-root';
  pages.forEach((p, i) => {
    const copy = p.cloneNode(true) as HTMLElement;
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
