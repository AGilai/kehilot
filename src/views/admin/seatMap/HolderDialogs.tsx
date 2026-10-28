// The map editor's holder actions (UX-DESIGN §16.7 from the families panel): link a holder without an account to a registered family (the
// same confirm as P30, calling the same link route) and delete a holder (its seats become free in every version first; the confirm shows
// how many, per version). Both write on the server at once, so the editor only offers them with no unsaved map changes.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { SeatHolder } from '../../../client/endpoints.ts';
import type { AdminFamily } from '../../../client/types.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, PickList, Tag, Txt, useTokens } from '../../../kit/components.tsx';
import { deleteLines } from '../../../seats/holderActions.ts';
import type { HolderSeats } from '../../../seats/holderActions.ts';
import { linkOutcome } from '../../../seats/holders.ts';
import { normalizeName } from '../../../seats/match.ts';
import { countText } from './AssignPanel.tsx';
import { Dialog } from './Dialog.tsx';

export function familyLabel(f: AdminFamily, and: string): string {
  const firsts = f.adults.map((a) => (a.displayName.endsWith(` ${f.name}`) ? a.displayName.slice(0, -f.name.length - 1) : a.displayName.split(' ')[0]!)).filter(Boolean);
  return firsts.length ? `${firsts.join(and)} ${f.name}` : f.name;
}

/** Pick a family (no `familyId` yet), then the confirm with both cards and "what happens". `counts`: seats per ref in the open version. */
export function LinkHolderDialog({ holder, familyId, families, counts, mineId, busy, error, onFamily, onGo, onClose }: {
  holder: SeatHolder; familyId: string | null; families: AdminFamily[]; counts: Map<string, number>; mineId: string | null; busy: boolean; error: string | null;
  onFamily: (id: string | null) => void; onGo: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const [query, setQuery] = React.useState('');
  const and = t('seatEditor.and');
  const fam = familyId ? families.find((f) => f.familyId === familyId) ?? null : null;
  const hSeats = counts.get(`holder:${holder.holderId}`) ?? 0;
  if (!fam) {
    const q = normalizeName(query);
    const rows = families.filter((f) => !q || normalizeName(`${f.name} ${f.adults.map((a) => a.displayName).join(' ')}`).includes(q))
      .sort((a, b) => (a.familyId === mineId ? -1 : b.familyId === mineId ? 1 : 0))
      .map((f) => ({ id: f.familyId, title: familyLabel(f, and), subtitle: `${countText(t, counts.get(`family:${f.familyId}`) ?? 0)}${f.familyId === mineId ? ` · ${t('seatMap.holder.mine')}` : ''}` }));
    return (
      <Dialog visible title={t('seatMap.holder.linkTitle', { name: holder.name })} onClose={onClose} width={560} footer={<Button kind="secondary" title={t('common.cancel')} onPress={onClose} />}>
        <Txt size="small" color={k.muted}>{t('seatMap.holder.linkPick')}</Txt>
        <PickList query={query} onQuery={setQuery} placeholder={t('seatHolders.link.search')} state="ready" empty={t('seatEditor.match.noFamilies')} rows={rows} selected={null} onSelect={(id) => onFamily(id)} max={6} />
      </Dialog>
    );
  }
  const fSeats = counts.get(`family:${fam.familyId}`) ?? 0;
  const out = linkOutcome(hSeats, fSeats);
  const household = familyLabel(fam, and);
  const card = (tag: string, name: string, seats: number, strong: boolean, note: string) => (
    <Card style={{ flex: 1, minWidth: 220 }}>
      <View style={{ alignSelf: 'flex-start' }}><Tag label={tag} tone={strong ? 'strong' : 'plain'} /></View>
      <Txt bold size="heading" content>{name}</Txt>
      <Txt size="small">{countText(t, seats)}</Txt>
      <Txt size="caption" color={k.muted}>{note}</Txt>
    </Card>
  );
  return (
    <Dialog visible title={t('seatHolders.link.title', { name: holder.name })} onClose={onClose} width={720}
      footer={(
        <>
          <Button title={t('seatHolders.link.confirm')} busy={busy} onPress={onGo} />
          <Button kind="secondary" title={t('seatMap.holder.other')} disabled={busy} onPress={() => onFamily(null)} />
          <Button kind="secondary" title={t('common.cancel')} disabled={busy} onPress={onClose} />
        </>
      )}>
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        {card(t('seatEditor.match.noAccount'), holder.name, hSeats, false, t('seatHolders.link.noAccountSide'))}
        {card(fam.familyId === mineId ? t('seatMap.holder.mine') : t('seatHolders.link.registered'), household, fSeats, true, t('seatHolders.link.registeredSide'))}
      </View>
      {error ? <View accessibilityRole="alert"><Banner tone="error" text={error} /></View> : null}
      <Card edgeColor={k.tekhelet}>
        <Txt bold accessibilityRole="header">{t('seatHolders.link.what')}</Txt>
        <Txt>{`• ${t('seatHolders.link.what1', { household })}`}</Txt>
        <Txt>{`• ${t('seatHolders.link.what2')}`}</Txt>
        <Txt>{`• ${t('seatHolders.link.what3')}`}</Txt>
        <Txt>{`• ${t('seatHolders.link.what4')}`}</Txt>
      </Card>
      {out.union ? <Banner tone="error" text={t('seatHolders.link.union', { household, family: out.family, total: out.total })} /> : null}
    </Dialog>
  );
}

/** `usage` null while it loads. */
export function DeleteHolderDialog({ holder, usage, dateLabel, busy, error, onGo, onClose }: {
  holder: SeatHolder; usage: HolderSeats | null; dateLabel: (from: string) => string; busy: boolean; error: string | null; onGo: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const lines = usage ? deleteLines(usage) : [];
  return (
    <Dialog visible alert title={t('seatMap.holder.deleteTitle', { name: holder.name })} onClose={() => { if (!busy) onClose(); }} width={520}
      footer={(
        <>
          <Button kind="danger" title={t('seatMap.holder.deleteGo')} busy={busy} disabled={!usage || busy} onPress={onGo} />
          <Button kind="secondary" title={t('common.cancel')} disabled={busy} onPress={onClose} />
        </>
      )}>
      {!usage && !error ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator color={k.tekhelet} /><Txt color={k.muted}>{t('seatMap.holder.deleteLoading')}</Txt></View> : null}
      {usage ? (
        lines.length ? (
          <View style={{ gap: 4 }}>
            <Txt>{t('seatMap.holder.deleteBody')}</Txt>
            {lines.map((l) => (
              <Txt key={l.from}>{`• ${t(l.seats === 1 ? 'seatMap.holder.deleteLineOne' : 'seatMap.holder.deleteLine', { n: l.seats, from: dateLabel(l.from) })}${l.past ? ` ${t('seatMap.holder.deletePast')}` : ''}`}</Txt>
            ))}
          </View>
        ) : <Txt>{t('seatMap.holder.deleteNone')}</Txt>
      ) : null}
      <Txt size="small" color={k.muted}>{t('seatMap.holder.deleteAfter')}</Txt>
      {error ? <View accessibilityRole="alert"><Banner tone="error" text={error} /></View> : null}
    </Dialog>
  );
}
