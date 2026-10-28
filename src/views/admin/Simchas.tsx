import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import { counts, filterWeeks, mazalDraft, quietNames, simchaSub, simchaTag, simchaTitle, weekHeader } from '../../client/simchasView.ts';
import type { SimchaFilter } from '../../client/simchasView.ts';
import type { SimchaItem, SimchaWeek } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Chip, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { Figure } from '../../tree/Figure.tsx';
import { fromGregorian } from '../../tree/dates.ts';
import type { Person } from '../../tree/types.ts';
import { BackLink } from '../Me.tsx';
import { useAdminErrText } from './shared.tsx';

/** A figure of the child's age (the 12th or 13th birthday is the date). Nothing but the date and gender is used. */
function avatarPerson(i: SimchaItem, key: string): Person {
  const h = fromGregorian(i.date);
  return { id: key, relation: 'child', gender: i.kind === 'bar' ? 'm' : 'f', birth: { day: h.day, month: h.month, year: (h.year ?? 5787) - (i.kind === 'bar' ? 13 : 12) } };
}

function Row({ item, id }: { item: SimchaItem; id: string }) {
  const { t } = useI18n();
  const k = useTokens();
  const tag = simchaTag(item, t);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8, backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, paddingHorizontal: 12 }}>
      <Figure person={avatarPerson(item, id)} size={44} style="B" />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold>{simchaTitle(item, t)}</Txt>
        <Txt size="small" color={k.muted}>{simchaSub(item, t)}</Txt>
      </View>
      {tag ? <Tag label={tag.text} tone={tag.manual ? 'plain' : 'strong'} /> : null}
    </View>
  );
}

/** P36 (UX §17.14): the next 8 weeks of bar and bat mitzvahs from the family trees; gabbaim only. Minimal data: first name, surname, date. */
export function Simchas({ onBack, onMazalTov }: { onBack: () => void; /** Starts a mazal tov message for this week's simchas; the weekly sheet lists the week's celebration messages. */ onMazalTov: (draft: { title: string; body: string }) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [weeks, setWeeks] = React.useState<SimchaWeek[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<SimchaFilter>('all');
  React.useEffect(() => {
    let live = true;
    api.simchas(kehilaId, 8).then(r => { if (live) setWeeks(r.weeks); }, e => { if (live) { setError(errText(e)); setWeeks([]); } });
    return () => { live = false; };
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = weeks ? counts(weeks) : { all: 0, bar: 0, bat: 0 };
  const shown = weeks ? filterWeeks(weeks, filter) : [];
  const quiet = weeks ? quietNames(weeks, filter) : '';
  const draft = weeks ? mazalDraft(weeks, t) : undefined;
  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 12, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{t('simchas.title')}</Txt>
      <Txt size="small" color={k.muted}>{t('simchas.intro')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {!weeks ? <ActivityIndicator color={k.tekhelet} /> : null}
      {weeks && n.all > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {(['all', 'bar', 'bat'] as const).map(f => <Chip key={f} size="filter" selected={filter === f} label={t(`simchas.filter.${f}`, { n: n[f] })} onPress={() => setFilter(f)} />)}
        </View>
      ) : null}
      {weeks && !error && n.all === 0 ? <><Txt color={k.muted}>{t('simchas.none')}</Txt><Txt size="small" color={k.muted}>{t('simchas.noneNote')}</Txt></> : null}
      {shown.map(w => {
        const head = weekHeader(w);
        return (
          <View key={w.week} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, paddingTop: 8 }}>
              <Txt bold accessibilityRole="header" style={{ flexShrink: 1 }}>{head.title}</Txt>
              <Txt size="small" color={k.muted}>{head.greg}</Txt>
            </View>
            {w.items.map((item, i) => <Row key={`${item.kind}-${item.firstName}-${item.date}-${i}`} item={item} id={`${w.week}-${i}`} />)}
          </View>
        );
      })}
      {weeks && n.all > 0 && quiet ? <Txt size="small" color={k.muted}>{t('simchas.quietWeeks', { parashot: quiet })}</Txt> : null}
      {draft ? (
        <View style={{ gap: 4 }}>
          <Button kind="secondary" title={t('simchas.toSheet')} onPress={() => onMazalTov(draft)} />
          <Txt size="small" color={k.muted}>{t('simchas.toSheetNote')}</Txt>
        </View>
      ) : null}
      <Txt size="small" color={k.muted}>{t('simchas.privacy')}</Txt>
    </PadScroll>
  );
}
