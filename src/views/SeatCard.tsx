import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Button, Card, Tag, Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { TOUCH } from '../kit/theme.ts';
import { closedCardText } from '../seats/homeText.ts';
import type { Summary } from '../seats/wire.ts';

export type SeatCardState = 'ask' | 'done' | 'byGabbai' | 'closed';
/** How many of his seats are free for others, per prayer: the thanks line says so when any is. */
export type SeatCardFree = { arvit: number; shacharit: number };

/** P24: the Home reminder card (UX-DESIGN §15.2). `ask` is the question; `done`/`byGabbai` is the collapsed answer until the deadline. */
export function SeatCard({ byRole = 'gabbai', count, state, deadline, free = { arvit: 0, shacharit: 0 }, preview = false, busy = false, summary = { kind: 'kept' }, onYes, onUpdate }: { summary?: Summary; byRole?: 'gabbai' | 'tech'; count: number; state: SeatCardState; deadline: { day: string; time: string }; free?: SeatCardFree; preview?: boolean; busy?: boolean; onYes: () => void; onUpdate: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  if (state === 'closed') {
    // The final card after the deadline, until Shabbat ends (UX §21.3): no buttons, the whole card opens the read-only page.
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('seats.card.closedTitle')}. ${closedCardText(summary, t)}`} onPress={onUpdate}>
        <Card edgeColor={k.ash} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="lock" size={20} color={k.muted} />
            <Txt bold style={{ flexShrink: 1 }}>{t('seats.card.closedTitle')}</Txt>
            {preview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
          </View>
          <Txt size="small">{closedCardText(summary, t)}</Txt>
        </Card>
      </Pressable>
    );
  }
  if (state !== 'ask') {
    return (
      <Card edgeColor={k.olive} style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <Icon name="check" size={20} color={k.olive} />
            <Txt bold accessibilityRole="header" style={{ flexShrink: 1 }}>{t('seats.title')}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {preview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
            <Pressable accessibilityRole="button" onPress={onUpdate} style={{ minHeight: TOUCH, minWidth: TOUCH, justifyContent: 'center', alignItems: 'center' }}>
              <Txt bold color={k.tekhelet}>{t('seats.card.change')}</Txt>
            </Pressable>
          </View>
        </View>
        {state === 'byGabbai' ? <Txt size="small">{t(byRole === 'tech' ? 'seats.card.byTech' : 'seats.card.byGabbai')}</Txt>
          : free.arvit + free.shacharit === 0 ? <Txt size="small">{t('seats.card.doneAll', { n: count })}</Txt>
          : (['arvit', 'shacharit'] as const).filter(p => free[p] > 0).map(p => <Txt key={p} size="small">{t('seats.card.doneSome', { prayer: t(`seats.${p}Short`), need: count - free[p], free: free[p] })}</Txt>)}
      </Card>
    );
  }
  const one = count === 1;
  return (
    <Card edgeColor={k.tekhelet}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Txt bold size="heading" accessibilityRole="header">{t('seats.title')}</Txt>
        {preview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
      </View>
      <Txt>{one ? t('seats.card.questionOne') : t('seats.card.questionOther', { n: count })}</Txt>
      <Txt size="small" color={k.muted}>{t('seats.card.deadline', { day: deadline.day, time: deadline.time })}</Txt>
      <Button title={one ? t('seats.card.yesOne') : t('seats.card.yesOther')} busy={busy} onPress={onYes} />
      <Button kind="secondary" title={t('seats.card.update')} onPress={onUpdate} />
    </Card>
  );
}
