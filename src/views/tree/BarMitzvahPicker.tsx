import React from 'react';
import { Platform, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Field, Segmented, Txt, useTokens } from '../../kit/components.tsx';
import type { ShabbatInfo } from '../../tree/dates.ts';
import { fromGregorian } from '../../tree/dates.ts';
import { dualGreg, gregText, hebrewText, parseGreg } from '../../tree/format.ts';
import { isoOfHebrew, patchPart, pickShabbat } from '../../tree/sheet.ts';
import type { DatePart } from '../../tree/sheet.ts';
import type { HebDate } from '../../tree/types.ts';
import { HebrewDateField } from './HebrewDateField.tsx';

/** "שבת פרשת וישב · כ״א בכסלו תשפ״ט (9.12.2028)" */
export function shabbatLine(info: ShabbatInfo): string {
  return `${info.label} · ${dualGreg(info.date)}`;
}

type Mode = 'heb' | 'greg';

/**
 * "שינוי השבת" (§17.4): the family picks the date itself, in Hebrew or Gregorian. A Shabbat is confirmed; a weekday is
 * answered with that week's Shabbat to take or to pick again. `from`: where the pickers start; `years`: Hebrew year range.
 */
export function BarMitzvahPicker({ from, years, onSet }: { from?: string; years: [number, number]; onSet: (info: ShabbatInfo) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const [mode, setMode] = React.useState<Mode>('heb');
  const start = from ? fromGregorian(from) : undefined;
  const [heb, setHeb] = React.useState<DatePart>(start ? { ...start } : {});
  const [gregIso, setGregIso] = React.useState<string | undefined>(from);
  const [gregText0, setGregText] = React.useState(from ? gregText(from) : '');
  const iso = mode === 'heb' ? isoOfHebrew(heb) : gregIso;
  const picked = iso ? pickShabbat(iso) : undefined;
  const hdate = (h: HebDate) => hebrewText(h);
  const dayName = (n: number) => t(`tree.day.${n}`);
  const typeGreg = (v: string) => { setGregText(v); setGregIso(parseGreg(v)); };
  const reset = () => { setHeb({}); setGregIso(undefined); setGregText(''); };
  return (
    <View style={{ gap: 12 }} testID="bm-picker">
      <Txt serif size="heading" accessibilityRole="header">{t('tree.bm.pick')}</Txt>
      <Segmented<Mode> options={[{ key: 'heb', label: t('tree.bm.hebrew') }, { key: 'greg', label: t('tree.bm.greg') }]} value={mode} onChange={setMode} />
      {mode === 'heb' ? (
        <HebrewDateField label={t('tree.bm.hebrew')} part={heb} onChange={p => setHeb(h => patchPart(h, p))} greg={false} years={years} testID="bm-heb" />
      ) : Platform.OS === 'web' ? (
        <View style={{ gap: 6 }}>
          <Txt size="small" bold>{t('tree.bm.greg')}</Txt>
          {React.createElement('input', {
            type: 'date', 'aria-label': t('tree.bm.greg'), 'data-testid': 'bm-greg', value: gregIso ?? '', onChange: (e: { target: { value: string } }) => setGregIso(parseGreg(e.target.value)),
            style: { minHeight: 48, border: `1px solid ${k.line}`, borderRadius: 10, background: k.surface, color: k.ink, padding: '0 12px', fontSize: 16, boxSizing: 'border-box', width: '100%' },
          })}
        </View>
      ) : <Field label={t('tree.bm.greg')} value={gregText0} onChangeText={typeGreg} ltr keyboardType="numbers-and-punctuation" placeholder="2.12.2028" />}
      {picked?.kind === 'shabbat' ? (
        <>
          <Banner tone="success" text={`✓ ${shabbatLine(picked.info)}`} />
          <Button title={t('tree.bm.set')} onPress={() => onSet(picked.info)} />
        </>
      ) : null}
      {picked?.kind === 'weekday' ? (
        <>
          <Banner text={t('tree.bm.weekday', { day: dayName(picked.day), hdate: hdate(picked.hebrew), shabbat: shabbatLine(picked.shabbat) })} />
          <Button title={t('tree.bm.useShabbat', { label: picked.shabbat.label })} onPress={() => onSet(picked.shabbat)} />
          <Button kind="secondary" title={t('tree.bm.other')} onPress={reset} />
        </>
      ) : null}
      <Txt size="caption" color={k.muted}>{t('tree.bm.note')}</Txt>
    </View>
  );
}
