// Home's "השבוע בקהילה" (UX-DESIGN §19.3, P44 phone 4): the Shabbat's sheet items, one list with the print and the management screen.
import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { homeRows, inItems, lineOf } from '../client/sheetItems.ts';
import { useSheetItems } from '../client/useSheetItems.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Card, Txt, useTokens } from '../kit/components.tsx';
import { ForwardIcon, Icon } from '../kit/Icon.tsx';
import { TOUCH } from '../kit/theme.ts';
import { openPrintPage, sharePdf } from '../schedule/printSheet.ts';
import { parashaOf } from '../schedule/parasha.ts';
import { zmanimForLocation } from '../schedule/zmanim.ts';
import { computeWeek } from '../schedule/week.ts';
import { buildSheet } from '../schedule/sheetSource.ts';
import type { ScheduleDoc, ScheduleWeek } from '../schedule/types.ts';
import { typeIcon, LineText } from './admin/sheetItems/SheetItemRow.tsx';
import { useLogoUri } from './SchedulePrint.tsx';

/** Hidden when the list is empty or the fetch failed. Pending items never show (filtered again here for management). */
export function WeekCard({ week, doc, onOpen, onToast }: { week: ScheduleWeek; doc: ScheduleDoc | null; onOpen: (messageId: string) => void; onToast?: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const session = useSession();
  const logo = useLogoUri();
  const sheet = useSheetItems(week.friday);
  const [printing, setPrinting] = React.useState(false);
  const page = sheet.status === 'ready' ? sheet.page : null;
  const { rows, more } = page ? homeRows(inItems(page)) : { rows: [], more: 0 };
  if (!page || rows.length === 0) return null;

  const parasha = parashaOf(week.shabbat, lang) || t('schedule.shabbatPlain').replace(/^(שבת|Shabbat)\s*/, '');
  async function print() {
    if (Platform.OS === 'web') { if (!openPrintPage(0)) onToast?.(t('schedule.printError')); return; }
    const kehila = session.state.kehila;
    if (printing) return;
    if (!doc || !kehila || !page) { onToast?.(t('schedule.printError')); return; }
    setPrinting(true);
    try {
      const computed = computeWeek({ version: 1, sections: doc.sections, weekOverrides: doc.weekOverrides }, week.friday, zmanimForLocation(doc.location));
      await sharePdf(buildSheet(doc, computed, { kehilaName: kehila.name, logoUri: logo.uri, items: page.items }));
    } catch { onToast?.(t('schedule.printError')); } finally { setPrinting(false); }
  }

  return (
    <Card>
      <Txt size="caption" bold color={k.muted} accessibilityRole="header">{t('home.week.title', { parasha }).trim()}</Txt>
      {rows.map(item => {
        const body = (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <Icon name={typeIcon(item)} size={20} color={item.type === 'event' ? k.tekhelet : k.pomegranate} />
            <LineText item={item} />
          </View>
        );
        const label = (() => { const l = lineOf(item); return [l.main.map(p => p.text).join(''), l.sub].filter(Boolean).join(', '); })();
        return item.kind === 'message' && item.message ? (
          <Pressable key={item.itemId} accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(item.message!.messageId)}
            style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: k.line }}>
            {body}<ForwardIcon size={16} color={k.muted} />
          </Pressable>
        ) : (
          <View key={item.itemId} style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: k.line }}>{body}</View>
        );
      })}
      {more > 0 ? <Txt size="small" color={k.muted}>{t('home.week.more', { n: more })}</Txt> : null}
      <Pressable accessibilityRole="link" accessibilityState={{ busy: printing }} onPress={() => { void print(); }} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="print" size={18} color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('home.week.print')}</Txt></View>
      </Pressable>
    </Card>
  );
}
