// The live preview column (UX-DESIGN §14.2): the real member components fed with the draft. Phone = Home card or full schedule at 360
// wide with an "as if now" clock; Sheet = the real sheet (A4 or square) scaled to fit. Never a second copy of the rendering.
import React from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { civilDate } from '../../../dates.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Segmented, Txt, useTokens } from '../../../kit/components.tsx';
import { fullModel, homeCardModel, hasTimedRows, textIn } from '../../../schedule/memberView.ts';
import { hideSuggestions } from '../../../schedule/editor.ts';
import { Sheet, useSheetFonts } from '../../../schedule/Sheet.tsx';
import { fitSheet } from '../../../schedule/sheetModel.ts';
import type { SheetVariant } from '../../../schedule/sheetModel.ts';
import { buildSheet } from '../../../schedule/sheetSource.ts';
import type { ScheduleDoc, ScheduleWeek, ZmanimFor } from '../../../schedule/types.ts';
import { addDays, computeWeek } from '../../../schedule/week.ts';
import type { Message } from '../../../client/types.ts';
import { dateRange } from '../../../schedule/memberView.ts';
import { FullSections } from '../../Schedule.tsx';
import { ScheduleCard, useShabbatTitle } from '../../ScheduleCard.tsx';
import { FSeg, Select, TimeField } from './controls.tsx';

export type PreviewMode = 'phone' | 'sheet';
export type PreviewProps = {
  doc: ScheduleDoc;
  week: ScheduleWeek;
  zmanimFor: ZmanimFor;
  dirty: boolean;
  /** The row being edited: outlined on the sheet. */
  highlightId?: string;
  kehilaName: string;
  logoUri: string | null;
  messages: Message[];
  mode: PreviewMode;
  onMode: (mode: PreviewMode) => void;
  /** Hide a row of the selected week (the too-long banner's suggestions). */
  onHide: (rowId: string, added: boolean) => void;
  /** Narrow screens: the preview is the whole page, no column chrome. */
  narrow?: boolean;
};

const DAY_OFFSETS = [0, 1, 2, 3, 4, 5];

function PhonePreview({ doc, week, zmanimFor }: Pick<PreviewProps, 'doc' | 'week' | 'zmanimFor'>) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const title = useShabbatTitle();
  const [view, setView] = React.useState<'home' | 'full'>('home');
  const [offset, setOffset] = React.useState(0);
  const [time, setTime] = React.useState('15:40');
  const date = addDays(week.friday, offset);
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const now = React.useMemo(() => ({ date, minutes }), [date, minutes]);
  const card = React.useMemo(() => homeCardModel(doc, now, zmanimFor), [doc, now, zmanimFor]);
  const full = React.useMemo(() => (hasTimedRows(doc) ? fullModel(doc, now, zmanimFor, 0) : null), [doc, now, zmanimFor]);
  const dayName = (d: string) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' }).format(civilDate(d));
  return (
    <View style={{ gap: 12, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', alignSelf: 'stretch' }}>
        <View style={{ minWidth: 180, flex: 1 }}>
          <FSeg label={t('editor.phoneView')} value={view} onChange={setView} options={[{ key: 'home', label: t('editor.phoneHome') }, { key: 'full', label: t('editor.phoneFull') }]} />
        </View>
        <View style={{ gap: 4 }}>
          <Txt size="caption" bold>{t('editor.asIf')}</Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Select label={t('editor.asIfDay')} value={offset} width={130} onChange={setOffset}
              options={DAY_OFFSETS.map(o => ({ key: o, label: dayName(addDays(week.friday, o)) }))} />
            <TimeField label={t('editor.asIfTime')} value={time} width={86} onChange={v => v && setTime(v)} />
          </View>
        </View>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" {...({ 'aria-hidden': true } as object)}
        style={{ width: 360, borderRadius: 32, borderWidth: 6, borderColor: k.ink, backgroundColor: k.stone, padding: 12, gap: 12 }}>
        {view === 'home' ? (
          card ? <ScheduleCard model={card} doc={doc} cachedAt={null} onFull={() => setView('full')} /> : <Txt color={k.muted}>{t('editor.previewEmpty')}</Txt>
        ) : full ? (
          <>
            <View style={{ alignItems: 'center' }}>
              <Txt bold>{title(full.week)}</Txt>
              <Txt size="caption" color={k.muted}>{dateRange(full.week.friday, full.week.thursday)}</Txt>
            </View>
            <FullSections doc={doc} model={full} />
          </>
        ) : <Txt color={k.muted}>{t('editor.previewEmpty')}</Txt>}
      </View>
    </View>
  );
}

function SheetPreview({ doc, week, zmanimFor, highlightId, kehilaName, logoUri, messages, onHide, available }: Pick<PreviewProps, 'doc' | 'week' | 'zmanimFor' | 'highlightId' | 'kehilaName' | 'logoUri' | 'messages' | 'onHide'> & { available: number }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const fonts = useSheetFonts();
  const [variant, setVariant] = React.useState<SheetVariant>('a4');
  const computed = React.useMemo(() => computeWeek(doc, week.friday, zmanimFor), [doc, week.friday, zmanimFor]);
  const model = React.useMemo(() => buildSheet(doc, computed, { kehilaName, logoUri, messages }, variant), [doc, computed, kehilaName, logoUri, messages, variant]);
  const fit = React.useMemo(() => fitSheet(model), [model]);
  const paper = variant === 'a4' ? { w: 595, h: 842 } : { w: 540, h: 540 };
  const scale = Math.min(1, Math.max(0.3, (available - 8) / paper.w));
  const long = fit.overflow || fit.dropped.length > 0;
  const suggestions = long ? hideSuggestions(computed, 3) : [];
  const droppedText = fit.dropped.map(d => (d.kind === 'image' ? t('editor.droppedImage') : model.mazalTov.find(m => m.id === d.id)?.title.map(p => p.text).join('') ?? '')).filter(Boolean).join(', ');
  return (
    <View style={{ gap: 12 }}>
      <FSeg label={t('editor.sheetVariant')} value={variant} onChange={setVariant} style={{ alignSelf: 'flex-start', width: 300 }}
        options={[{ key: 'a4', label: 'A4' }, { key: 'square', label: t('editor.sheetSquare') }]} />
      {long ? (
        <View style={{ gap: 8 }}>
          <Banner text={t('editor.tooLong')} />
          {droppedText ? <Txt size="small" color={k.muted}>{t('editor.dropped', { list: droppedText })}</Txt> : null}
          {suggestions.length ? (
            <View style={{ gap: 6, alignItems: 'flex-start' }}>
              {suggestions.map(row => <Button key={row.id} kind="secondary" title={t('editor.hideSuggestion', { row: textIn(row.label, lang) })} onPress={() => onHide(row.id, !!row.added)} />)}
            </View>
          ) : null}
        </View>
      ) : null}
      {fonts ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" {...({ 'aria-hidden': true } as object)}
          style={{ width: paper.w * scale, height: paper.h * scale, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', ...({ boxShadow: '0 2px 12px rgba(21,26,51,0.2)' } as object) }}>
          <View style={{ width: paper.w, height: paper.h, transform: [{ scale }] }}><Sheet model={model} fit={fit} highlightId={highlightId} /></View>
        </View>
      ) : <Txt color={k.muted}>{t('common.loading')}</Txt>}
    </View>
  );
}

/** The right column (wide) or the "preview" page (narrow). */
export function Preview(p: PreviewProps) {
  const { t } = useI18n();
  const k = useTokens();
  const [width, setWidth] = React.useState(552);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  return (
    <View onLayout={onLayout} style={{ gap: 16, padding: p.narrow ? 16 : 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Segmented value={p.mode} onChange={p.onMode} options={[{ key: 'phone', label: t('editor.previewPhone') }, { key: 'sheet', label: t('editor.previewSheet') }]} />
        </View>
        <Txt size="caption" color={p.dirty ? k.gold : k.muted}>{p.dirty ? t('editor.draftCaption') : t('editor.savedCaption')}</Txt>
      </View>
      {p.mode === 'phone' ? <PhonePreview doc={p.doc} week={p.week} zmanimFor={p.zmanimFor} /> : <SheetPreview {...p} available={width} />}
      <Txt size="caption" color={k.muted}>{t('editor.previewNote')}</Txt>
    </View>
  );
}
