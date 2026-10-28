import React from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button, Card, Txt, useTokens } from '../../kit/components.tsx';

/** The two round status buttons of the person sheet (UX-DESIGN §17.4, §17.15, P32): the memorial candle (outline off, lit on) and
 *  the heart with a pulse (rose; not shown for the deceased). 44 px, `title` on web (hover / long-press), a label always. */
const uri = (svg: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${svg}</svg>`);
const candleSvg = (lit: boolean, stroke: string, dark: boolean) => lit
  ? `<circle cx="12" cy="6.6" r="5.6" fill="#FFB547" opacity="${dark ? '.45' : '.3'}"/><path d="M7 11h10l-1.2 10H8.2z" fill="${dark ? '#D9D2BF' : '#F4EEDD'}" stroke="${dark ? '#B9AE96' : '#8A7E6A'}" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 2.4c2 2.2 2.7 3.5 2.7 4.8a2.7 2.7 0 0 1-5.4 0c0-1.3.7-2.6 2.7-4.8z" fill="#F28C1C"/><path d="M12 5.1c.9 1 1.2 1.7 1.2 2.3a1.2 1.2 0 0 1-2.4 0c0-.6.3-1.3 1.2-2.3z" fill="#FFE08A"/>`
  : `<path d="M7 11h10l-1.2 10H8.2z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 3.4c1.7 1.9 2.3 3.1 2.3 4.2a2.3 2.3 0 0 1-4.6 0c0-1.1.6-2.3 2.3-4.2z" fill="none" stroke="${stroke}" stroke-width="1.4"/>`;
const heartSvg = (on: boolean, c: string) =>
  `<path d="M12 20.6s-7.8-4.7-7.8-10.4A4.4 4.4 0 0 1 12 7.5a4.4 4.4 0 0 1 7.8 2.7c0 5.7-7.8 10.4-7.8 10.4z" fill="${c}" fill-opacity="${on ? '.55' : '.2'}" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 12.6h3.4l1.5-2.8 2.3 5.2 1.7-3.4H19" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;

function Round({ on, kind, label, onPress, testID, dark }: { on: boolean; kind: 'candle' | 'heal'; label: string; onPress: () => void; testID: string; dark: boolean }) {
  const k = useTokens();
  const heal = kind === 'heal';
  const border = on ? (heal ? k.heal : '#E7A64A') : k.line;
  const web = { title: label, 'aria-pressed': on } as object;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} {...web}
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: border, backgroundColor: on ? (heal ? k.healBg : dark ? '#3A2D1C' : '#FFF4E0') : k.surface, alignItems: 'center', justifyContent: 'center' }}>
      <Image source={{ uri: uri(heal ? heartSvg(on, k.heal) : candleSvg(on, k.muted, dark)) }} style={{ width: 24, height: 24 }} contentFit="contain" accessible={false} />
    </Pressable>
  );
}

export type StatusProps = {
  name: string; dark: boolean;
  showCandle: boolean; showHeart: boolean;
  deceased: boolean; ill: boolean; ask: 'deceased' | 'ill' | null;
  /** "נפטר/ה · כ״ג בשבט תשע״ח" or the plain word. */
  deceasedCaption: string;
  onToggle: (what: 'deceased' | 'ill') => void; onConfirm: () => void; onCancel: () => void;
};
export function StatusButtons(p: StatusProps) {
  const { t } = useI18n();
  const k = useTokens();
  if (!p.showCandle && !p.showHeart) return null;
  const caption = p.deceased ? p.deceasedCaption : p.ill ? t('tree.ill.caption') : '';
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
        {p.showCandle ? <Round testID="status-deceased" kind="candle" on={p.deceased} dark={p.dark} label={t('tree.dec.button')} onPress={() => p.onToggle('deceased')} /> : null}
        {p.showHeart && !p.deceased ? <Round testID="status-ill" kind="heal" on={p.ill} dark={p.dark} label={t('tree.ill.button')} onPress={() => p.onToggle('ill')} /> : null}
        {caption ? <Txt size="small" bold color={p.deceased ? k.muted : k.heal} content style={{ flexShrink: 1 }}>{caption}</Txt> : null}
      </View>
      {p.ask ? (
        <Card edgeColor={p.ask === 'ill' ? k.heal : k.ash}>
          <View testID="status-confirm"><Txt>{t(p.ask === 'ill' ? 'tree.ill.confirm' : 'tree.dec.confirm', { name: p.name })}</Txt></View>
          <Button title={t(p.ask === 'ill' ? 'tree.ill.yes' : 'tree.dec.yes')} onPress={p.onConfirm} />
          <Button kind="secondary" title={t('tree.dec.cancel')} onPress={p.onCancel} />
        </Card>
      ) : null}
    </View>
  );
}
