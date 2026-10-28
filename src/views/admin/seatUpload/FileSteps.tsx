// Steps 1 and 2 of the responses upload (UX-DESIGN §16.6, frame P27): choose the event and the file, then check once how the Form's
// columns were read. The file is read in the browser and never leaves this screen's memory except through the confirmed apply.
import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { textStart } from '../../../i18n/direction.ts';
import { Banner, Button, Card, Tag, Txt, useTokens } from '../../../kit/components.tsx';
import type { ColumnKey, FormParse } from '../../../seats/formCsv.ts';
import { AREAS } from '../../../seats/formCsv.ts';
import { WIRED_EVENTS } from '../../../seats/upload.ts';
import type { UploadEvent } from '../../../seats/upload.ts';

const EVENTS: UploadEvent[] = ['shabbat', 'hag', 'megila'];

/** "These answers are for: Shabbat · Holiday · Megillah". Only Shabbat is wired on the server; the others show "soon". */
function EventPicker({ value, onChange, parasha }: { value: UploadEvent; onChange: (e: UploadEvent) => void; parasha: string | null }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <View style={{ gap: 8 }}>
      <Txt bold>{t('seatUpload.event.label')}</Txt>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {EVENTS.map((e) => {
          const wired = WIRED_EVENTS.includes(e);
          const on = e === value;
          return (
            <Pressable key={e} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !wired }} disabled={!wired} onPress={() => onChange(e)}
              style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: on ? 2 : 1, borderColor: on ? k.tekhelet : k.line, backgroundColor: on ? k.surface : k.stone, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: wired ? 1 : 0.7 }}>
              <Txt bold color={on ? k.tekhelet : wired ? k.ink : k.muted}>{e === 'shabbat' && parasha ? t('seatUpload.event.shabbatParasha', { parasha }) : t(`seatUpload.event.${e}`)}</Txt>
              {wired ? null : <Tag label={t('seatUpload.soon')} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function UploadStep({ event, onEvent, parasha, problem, text, onText, onRead, onPick, onTemplate, web }: {
  event: UploadEvent; onEvent: (e: UploadEvent) => void; parasha: string | null; problem: string | null; text: string; onText: (v: string) => void;
  onRead: () => void; onPick: () => void; onTemplate: () => void; web: boolean;
}) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  return (
    <View style={{ gap: 16 }}>
      <Txt serif size="display" accessibilityRole="header">{t('seatUpload.title')}</Txt>
      <Txt color={k.muted}>{t('seatUpload.lead')}</Txt>
      {problem ? <View accessibilityRole="alert"><Banner tone="error" text={problem} /></View> : null}
      <Card edgeColor={k.tekhelet}>
        <EventPicker value={event} onChange={onEvent} parasha={parasha} />
        <Txt size="small" color={k.muted}>{t('seatUpload.how')}</Txt>
        {web ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('seatUpload.pick')} onPress={onPick}
            style={{ minHeight: 120, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: k.tekhelet, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 16, backgroundColor: k.stone }}>
            <Txt bold>{t('seatUpload.pick')}</Txt>
            <Txt size="small" color={k.muted} style={{ textAlign: 'center' }}>{t('seatUpload.pickHelp')}</Txt>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button kind="secondary" title={t('seatUpload.template')} onPress={onTemplate} />
          <Txt size="small" color={k.muted}>{t('seatUpload.templateHelp')}</Txt>
        </View>
        <Txt size="small" color={k.muted}>{t('seatUpload.headersHelp')}</Txt>
      </Card>
      <Card>
        <Txt bold>{t('seatUpload.paste')}</Txt>
        <TextInput accessibilityLabel={t('seatUpload.paste')} multiline numberOfLines={5} value={text} onChangeText={onText} placeholder={t('seatUpload.pasteHint')} placeholderTextColor={k.muted}
          style={{ minHeight: 110, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, padding: 12, color: k.ink, fontSize: 14, textAlignVertical: 'top', writingDirection: dir, textAlign: textStart(lang) }} />
        <View style={{ alignSelf: 'flex-start' }}><Button kind="secondary" title={t('seatUpload.read')} disabled={!text.trim()} onPress={onRead} /></View>
      </Card>
      <Banner text={t('seatUpload.privacy')} />
    </View>
  );
}

const MEANING: Record<ColumnKey, string> = {
  stamp: 'stamp', name: 'name', erev: 'erev', day: 'day', hag: 'unused', megila: 'unused', req0: 'requests', req1: 'requests', req2: 'requests',
};
const ORDER: ColumnKey[] = ['stamp', 'name', 'erev', 'day', 'hag', 'megila', 'req0', 'req1', 'req2'];

export function ColumnsStep({ parsed, rows, older, later, undated, days, onBack, onNext }: {
  parsed: Extract<FormParse, { ok: true }>; rows: number; older: number; later: number; undated: number; days: string; onBack: () => void; onNext: () => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const found = ORDER.filter((c) => parsed.columns[c]);
  return (
    <View style={{ gap: 16 }}>
      <Txt serif size="heading" accessibilityRole="header">{t('seatUpload.columns.title')}</Txt>
      <Txt color={k.muted}>{t('seatUpload.columns.lead')}</Txt>
      <Card>
        {found.map((c) => (
          <View key={c} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap', minHeight: 40 }}>
            <View style={{ flex: 1, minWidth: 160 }}><Txt content>{parsed.columns[c]!}</Txt></View>
            <Txt color={k.muted}>{'←'}</Txt>
            <View style={{ flex: 1, minWidth: 160 }}><Txt bold>{t(`seatUpload.meaning.${MEANING[c]}`, { area: c.startsWith('req') ? AREAS[Number(c.slice(3))]! : '' })}</Txt></View>
          </View>
        ))}
        {parsed.unknownHeaders.length ? <Txt size="small" color={k.muted}>{t('seatUpload.columns.unknown', { list: parsed.unknownHeaders.join(' · ') })}</Txt> : null}
        {(['erev', 'day'] as const).filter((c) => !parsed.columns[c]).map((c) => <Banner key={c} tone="error" text={t('seatUpload.columns.missing', { col: t(`seatUpload.meaning.${c}`) })} />)}
      </Card>
      <Banner text={t('seatUpload.released')} />
      <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
        <Txt bold>{t('seatUpload.window.main', { n: rows, old: older, days })}</Txt>
        {later ? <Txt size="small" color={k.muted}>{t('seatUpload.window.later', { n: later })}</Txt> : null}
        {undated ? <Txt size="small" color={k.gold}>{t('seatUpload.window.undated', { n: undated })}</Txt> : null}
        {parsed.unreadable ? <Txt size="small" color={k.gold}>{t('seatUpload.window.unreadable', { n: parsed.unreadable })}</Txt> : null}
        {rows === 0 ? <Banner tone="error" text={t('seatUpload.window.none')} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <Button kind="secondary" title={t('seatUpload.back')} onPress={onBack} />
        <Button title={t('seatUpload.columns.next')} disabled={rows === 0 || !parsed.columns.erev && !parsed.columns.day} onPress={onNext} />
      </View>
    </View>
  );
}
