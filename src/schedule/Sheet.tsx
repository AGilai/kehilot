import React from 'react';
import { Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import { Heebo_400Regular, Heebo_700Bold, Heebo_800ExtraBold } from '@expo-google-fonts/heebo';
import { NotoSerifHebrew_500Medium, NotoSerifHebrew_700Bold, NotoSerifHebrew_800ExtraBold } from '@expo-google-fonts/noto-serif-hebrew';
import { allowedImage } from './sheetHtml.ts';
import { PAPER, SHEET_TEXT, fitSheet, innerBox, sheetLayout, shownItems } from './sheetModel.ts';
import type { SheetLineItem, SheetBand, SheetColumn, SheetFit, SheetModel, SheetRow } from './sheetModel.ts';

const F = { ui: 'Heebo_400Regular', bold: 'Heebo_700Bold', heavy: 'Heebo_800ExtraBold', serif: 'NotoSerifHebrew_500Medium', serifBold: 'NotoSerifHebrew_700Bold', serifHeavy: 'NotoSerifHebrew_800ExtraBold' } as const;

/** The sheet's own fonts (weights the app does not load elsewhere). Resolves to true also on failure: the sheet falls back to system fonts. */
export function useSheetFonts(): boolean {
  const [loaded, error] = useFonts({ Heebo_400Regular, Heebo_700Bold, Heebo_800ExtraBold, NotoSerifHebrew_500Medium, NotoSerifHebrew_700Bold, NotoSerifHebrew_800ExtraBold });
  return loaded || !!error;
}

/** Test ids / print hooks: the print page copies the element carrying this data attribute. */
export const SHEET_DATA = { dataSet: { sheetPage: '1' } } as object;

const t = (size: number, family: string, color: string, extra: TextStyle = {}): TextStyle => ({ fontSize: size, lineHeight: Math.round(size * 1.35 * 100) / 100, fontFamily: family, color, writingDirection: 'rtl', ...extra });
const ltr = (value: string) => `⁦${value}⁩`;

/**
 * "Classic two columns" (P23): one component for the editor preview, the web print page and the PNG. Fixed paper palette, a fixed
 * page size (A4 595x842 pt or square 540), never a second page: `fit` (default: `fitSheet(model)`) shrinks, then drops optional parts.
 */
export function Sheet({ model, fit, highlightId }: { model: SheetModel; fit?: SheetFit; /** The editor's preview: the row being edited gets an outline (a row id of the week). */ highlightId?: string }) {
  const f = React.useMemo(() => fit ?? fitSheet(model), [fit, model]);
  const L = sheetLayout(model.variant, f);
  const inner = innerBox(model.variant, f);
  const a = model.variant === 'a4';
  const items = shownItems(model, f).mazal;
  const pinned = model.pinned;
  const image = pinned && !f.dropImage ? allowedImage(pinned.imageUri) : '';
  const hasNote = !!pinned && (!!image || !!pinned.title || !!pinned.line);

  const band = (b: SheetBand | null) => {
    if (!b) return null;
    const small = t(L.bandSize, F.ui, PAPER.ink, { textAlign: 'center' });
    const big = t(L.bandTimeSize, F.bold, PAPER.ink);
    return (
      <View style={{ backgroundColor: PAPER.soft, borderRadius: 6, paddingVertical: a ? 5 : 3, paddingHorizontal: 4, marginBottom: a ? 8 : 4 }}>
        {b.kind === 'candles' ? (
          <Text style={small}>{b.label} · {b.cities.map((c, i) => <Text key={i}>{i > 0 ? ' · ' : ''}{c.name ? `${c.name} ` : ''}<Text style={big}>{ltr(c.time)}</Text></Text>)}</Text>
        ) : (
          <Text style={small}>{b.days} · <Text style={big}>{b.range}</Text></Text>
        )}
      </View>
    );
  };

  const row = (r: SheetRow) => {
    const mark = r.override ? ' *' : '';
    const top = r.gap ? L.gap : 0;
    const lit = highlightId !== undefined && r.id === highlightId ? ({ outlineColor: PAPER.tek, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 1, backgroundColor: PAPER.soft } as object) : null;
    if (r.kind === 'text') {
      return <Text key={r.id} style={[t(L.textFont, F.ui, r.override ? PAPER.tek : PAPER.mute, { textAlign: 'center', paddingTop: 2 + top, paddingBottom: 4, paddingHorizontal: 8 }), lit]}>{r.label}{mark}</Text>;
    }
    return (
      <View key={r.id} style={[{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingVertical: L.rowPad, marginTop: top }, lit]}>
        <Text style={[t(L.rowFont, F.ui, PAPER.ink), { flexShrink: 1 }]}>{r.label}{mark}</Text>
        <View style={{ flex: 1, minWidth: 14, marginBottom: Math.round(L.rowFont * 0.28), borderBottomWidth: 1.5, borderBottomColor: PAPER.line, borderStyle: 'dotted' }} />
        <Text style={t(L.timeFont, F.bold, r.override ? PAPER.tek : PAPER.ink, { writingDirection: 'ltr' })}>{ltr(r.time)}</Text>
      </View>
    );
  };

  const column = (c: SheetColumn | null) => (
    <View style={{ flex: 1 }}>
      {c ? (
        <>
          <Text style={t(L.h2Size, F.serifHeavy, PAPER.tek, { textAlign: 'center', marginBottom: 4, lineHeight: Math.round(L.h2Size * 1.6) })}>{c.title}</Text>
          {band(c.band)}
          {c.rows.map(row)}
        </>
      ) : null}
    </View>
  );

  const spine = (
    <View style={{ width: L.spine, alignItems: 'center' }}>
      <View style={{ position: 'absolute', top: 6, bottom: 6, width: 6, borderLeftWidth: 2, borderRightWidth: 2, borderColor: PAPER.tek }} />
      {[{ top: 0 }, { top: '50%', marginTop: -5 }, { bottom: 0 }].map((pos, i) => (
        <View key={i} style={[{ position: 'absolute', width: 10, height: 10, backgroundColor: PAPER.paper, borderWidth: 2, borderColor: PAPER.tek, transform: [{ rotate: '45deg' }] }, pos as object]} />
      ))}
    </View>
  );

  const ornament = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 8 }}>
      <View style={{ flex: 1, borderTopWidth: 1.5, borderTopColor: PAPER.line }} />
      <View style={{ width: 6, height: 6, backgroundColor: PAPER.tek, transform: [{ rotate: '45deg' }] }} />
      <View style={{ width: 8, height: 8, backgroundColor: PAPER.pom, transform: [{ rotate: '45deg' }] }} />
      <View style={{ width: 6, height: 6, backgroundColor: PAPER.tek, transform: [{ rotate: '45deg' }] }} />
      <View style={{ flex: 1, borderTopWidth: 1.5, borderTopColor: PAPER.line }} />
    </View>
  );

  const mazal = (list: SheetLineItem[]) => list.map((item, i) => (
    <View key={item.id} style={i > 0 ? { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: PAPER.line, borderStyle: 'dotted' } : undefined}>
      <Text style={t(L.mazalFont, F.ui, PAPER.ink, { textAlign: 'center', lineHeight: Math.round(L.mazalFont * 1.45 * 100) / 100, paddingVertical: 2, paddingHorizontal: 4 })}>
        {item.main.map((p, j) => <Text key={j} style={p.bold ? { fontFamily: F.heavy, color: PAPER.pom } : undefined}>{p.text}</Text>)}
        {item.sub ? `\n${item.sub}` : ''}
      </Text>
    </View>
  ));

  const note = pinned && hasNote ? (
    <View style={{ borderWidth: 1.5, borderColor: PAPER.tek, borderRadius: 8, overflow: 'hidden', alignSelf: 'flex-start', width: '100%' }}>
      {image ? (
        <View style={{ width: `${f.imageScale * 100}%`, alignSelf: 'center', aspectRatio: 4 / 3, backgroundColor: PAPER.soft }}>
          <Image accessibilityLabel="" source={{ uri: image }} contentFit="cover" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        </View>
      ) : null}
      {pinned.title || pinned.line ? (
        <View style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
          {pinned.title ? <Text style={t(17, F.serifBold, PAPER.tek, { textAlign: 'center', lineHeight: 24 })}>{pinned.title}</Text> : null}
          {pinned.line ? <Text style={t(11, F.ui, PAPER.ink, { textAlign: 'center' })}>{pinned.line}</Text> : null}
        </View>
      ) : null}
    </View>
  ) : null;

  let bottom: React.ReactNode = null;
  if (a) {
    const cell = (child: React.ReactNode) => <View style={{ flex: 1 }}>{child}</View>;
    const gap = <View style={{ width: L.spine }} />;
    if (note && items.length) bottom = <View style={{ flexDirection: 'row', gap: L.colGap, marginTop: 4 }}>{cell(<>{ornament}{note}</>)}{gap}{cell(<>{ornament}{mazal(items)}</>)}</View>;
    else if (note) bottom = <View style={{ flexDirection: 'row', gap: L.colGap, marginTop: 4 }}>{cell(<>{ornament}{note}</>)}{gap}{cell(null)}</View>;
    else bottom = <View style={{ marginTop: 4 }}>{ornament}{mazal(items)}</View>;
  } else if (items.length) {
    bottom = (
      <View style={{ marginTop: 'auto', borderTopWidth: 2, borderTopColor: PAPER.tek, paddingTop: 6 }}>
        <Text style={t(L.mazalFont, F.ui, PAPER.ink, { textAlign: 'center', lineHeight: Math.round(L.mazalFont * 1.45 * 100) / 100 })}>
          {items.map((item, i) => <Text key={item.id}>{i > 0 ? ' · ' : ''}{item.main.map((p, j) => <Text key={j} style={p.bold ? { fontFamily: F.heavy, color: PAPER.pom } : undefined}>{p.text}</Text>)}</Text>)}
        </Text>
      </View>
    );
  }

  const logo = allowedImage(model.logoUri);
  const tile = { width: L.logo, height: L.logo, borderRadius: 10, overflow: 'hidden' as const, alignItems: 'center' as const, justifyContent: 'center' as const };
  const logoBox = logo ? (
    <View style={[tile, { backgroundColor: '#FFFFFF' }]}><Image accessibilityLabel="" source={{ uri: logo }} contentFit="contain" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /></View>
  ) : (
    <View style={[tile, { borderWidth: 1.5, borderColor: PAPER.tek }]}>
      {[a ? 9 : 6, undefined].map((top, i) => <View key={i} style={{ position: 'absolute', left: a ? 10 : 7, right: a ? 10 : 7, height: 2, backgroundColor: PAPER.tek, opacity: 0.5, ...(top !== undefined ? { top } : { bottom: a ? 9 : 6 }) }} />)}
      <Text style={t(a ? 30 : 20, F.serifHeavy, PAPER.tek, { lineHeight: a ? 40 : 28 })}>{model.initial}</Text>
    </View>
  );
  const kehilaShort = model.kehilaName.replace(/^קהילת\s+/, '');

  return (
    <View {...SHEET_DATA} accessibilityRole="image" accessibilityLabel={`${SHEET_TEXT.title} ${model.parasha ?? ''}`.trim()}
      style={{ width: L.w, height: L.h, backgroundColor: PAPER.paper, paddingTop: L.padTop, paddingBottom: L.padBottom, paddingHorizontal: L.padSide, overflow: 'hidden', direction: 'rtl' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: L.frameInset, bottom: L.frameInset, left: L.frameInset, right: L.frameInset, borderWidth: 1, borderColor: PAPER.line, borderRadius: 6 }} />
      <View style={{ width: inner.w, height: inner.h, ...(f.scale < 1 ? ({ transform: [{ scale: f.scale }], transformOrigin: 'top right' } as object) : null) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: a ? 16 : 10, paddingBottom: a ? 10 : 4 }}>
        {logoBox}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text accessibilityRole="header" style={t(L.titleSize, F.serif, PAPER.tek, { textAlign: 'center', lineHeight: Math.round(L.titleSize * 1.1) })}>
            {model.parasha ? <>{SHEET_TEXT.title} <Text style={{ fontFamily: F.serifHeavy }}>{model.parasha}</Text></> : SHEET_TEXT.titleNoParasha}
          </Text>
          <Text style={t(L.hdateSize, F.ui, PAPER.mute, { marginTop: a ? 4 : 2, textAlign: 'center' })}>{model.hebrewDate}</Text>
        </View>
        <View style={{ width: L.logo }}>
          {model.kehilaName ? <Text style={t(a ? 10 : 9, F.ui, PAPER.mute, { textAlign: 'center', lineHeight: a ? 13 : 12 })}>{SHEET_TEXT.kehila}{'\n'}<Text style={{ fontFamily: F.bold }}>{kehilaShort}</Text></Text> : null}
        </View>
      </View>
      <View style={{ height: 7, borderTopWidth: 2, borderBottomWidth: 2, borderColor: PAPER.tek, marginTop: 2, marginBottom: a ? 14 : 8 }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 1.5, height: 1, backgroundColor: PAPER.tek, opacity: 0.45 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: L.colGap }}>
        {column(model.shabbat)}
        {spine}
        {column(model.weekday)}
      </View>
      {bottom}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: !a && items.length ? 6 : 'auto', paddingTop: a ? 6 : 4, borderTopWidth: 1, borderTopColor: PAPER.line }}>
        <Text style={t(L.footFont, F.ui, PAPER.tek)}>{model.footnote ? SHEET_TEXT.footnote : ''}</Text>
        <Text style={t(L.footFont, F.ui, PAPER.mute)}>{SHEET_TEXT.blessing}</Text>
      </View>
      </View>
    </View>
  );
}
