// Step 4 (UX-DESIGN §16.6, frame P27): what the file would change, before anything is saved; and, after the apply, what happened and how to undo it.
import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Chip, Tag, Txt, useTokens } from '../../../kit/components.tsx';
import type { ApplySummary, PlanRow, UploadPlan } from '../../../seats/upload.ts';
import type { WirePrayer } from '../../../seats/wire.ts';

const SHOWN = 40;

/** "ערבית 1 · שחרית 0" for the chosen side of a row. */
function sideText(r: PlanRow, side: 'now' | 'file', name: (p: WirePrayer) => string): string {
  return r.lines.map((l) => `${name(l.prayer)} ${l[side]}`).join(' · ');
}

export function PreviewStep({ plan, undoFirst, busy, error, onOverride, onApply, onBack }: {
  plan: UploadPlan; /** An earlier upload for this Shabbat is undone first. */ undoFirst: boolean; busy: boolean; error: string | null;
  onOverride: (ref: string, on: boolean) => void; onApply: () => void; onBack: () => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const [all, setAll] = React.useState(false);
  const prayerName = (p: WirePrayer) => t(p === 'erev' ? 'seatUpload.prayer.erev' : 'seatUpload.prayer.day');
  const s = plan.summary;
  const errors = plan.rows.filter((r) => r.status === 'error');
  const conflicts = plan.rows.filter((r) => r.status !== 'duplicate' && r.conflict && r.status !== 'error');
  const changes = plan.rows.filter((r) => r.status === 'change');
  const skipped = plan.rows.filter((r) => r.status === 'skipped' || r.status === 'duplicate');
  const reason = (r: PlanRow) => {
    switch (r.reason) {
      case 'above': return t('seatUpload.preview.above', { max: r.seats, what: r.lines.filter((l) => l.file > r.seats).map((l) => `${prayerName(l.prayer)} ${l.file}`).join(' · ') });
      case 'noSeats': return t('seatUpload.preview.noSeats');
      case 'noSeatsRequest': return t('seatUpload.preview.noSeatsRequest');
      case 'duplicate': return t('seatUpload.preview.duplicate');
      default: return t('seatUpload.preview.skip');
    }
  };
  const nothing = plan.calls.length === 0;
  return (
    <View style={{ gap: 16 }}>
      <View accessibilityLiveRegion="polite">
        <Txt serif size="heading" accessibilityRole="header">{t('seatUpload.preview.summary', { change: s.change, noAccount: s.changeNoAccount, same: s.same, skipped: s.skipped, errors: s.errors })}</Txt>
      </View>
      {error ? <View accessibilityRole="alert"><Banner tone="error" text={error} /></View> : null}
      {undoFirst ? <Banner text={t('seatUpload.preview.undoFirst')} /> : null}

      {errors.length ? (
        <Card edgeColor={k.pomegranate}>
          <Txt bold accessibilityRole="header">{t('seatUpload.preview.errors', { n: errors.length })}</Txt>
          {errors.map((r) => (
            <View key={r.key} style={{ gap: 2 }}>
              <Txt><Txt bold content>{`"${r.name}": `}</Txt>{reason(r)}</Txt>
              <Txt size="caption" color={k.muted}>{t('seatUpload.preview.notApplied')}</Txt>
            </View>
          ))}
        </Card>
      ) : null}

      {conflicts.length ? (
        <Card edgeColor={k.gold}>
          <Txt bold accessibilityRole="header">{t('seatUpload.preview.kept', { n: conflicts.length })}</Txt>
          <Txt size="small" color={k.muted}>{t('seatUpload.preview.keptHelp')}</Txt>
          {conflicts.map((r) => (
            <View key={r.key} style={{ gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: k.line }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Txt bold content>{r.refName}</Txt>
                {r.noAccount ? <Tag label={t('seatEditor.match.noAccount')} /> : null}
                <Tag label={t('seatUpload.preview.answeredApp')} tone="strong" />
              </View>
              <Txt size="small">{t('seatUpload.preview.compare', { app: sideText(r, 'now', prayerName), file: sideText(r, 'file', prayerName) })}</Txt>
              <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
                <Chip size="filter" label={t('seatUpload.preview.useApp')} selected={!r.overridden} onPress={() => onOverride(r.ref!, false)} />
                <Chip size="filter" label={t('seatUpload.preview.useFile')} selected={r.overridden} onPress={() => onOverride(r.ref!, true)} />
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {changes.length ? (
        <Card>
          <Txt bold accessibilityRole="header">{t('seatUpload.preview.changes', { n: changes.length })}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: k.line }}>
            <View style={{ flex: 2 }}><Txt size="small" bold color={k.muted}>{t('seatUpload.col.household')}</Txt></View>
            <View style={{ width: 70 }}><Txt size="small" bold color={k.muted}>{t('seatUpload.col.seats')}</Txt></View>
            <View style={{ flex: 2 }}><Txt size="small" bold color={k.muted}>{t('seatUpload.col.change')}</Txt></View>
          </View>
          {(all ? changes : changes.slice(0, SHOWN)).map((r) => (
            <View key={r.key} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 40 }}>
              <View style={{ flex: 2, flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Txt content>{r.refName}</Txt>
                {r.noAccount ? <Tag label={t('seatEditor.match.noAccount')} /> : null}
              </View>
              <View style={{ width: 70 }}><Txt>{r.seats}</Txt></View>
              <View style={{ flex: 2 }}>
                <Txt size="small">{r.lines.filter((l) => l.file !== l.now && !l.kept).map((l) => `${prayerName(l.prayer)} ${l.now} ← ${l.file}`).join(' · ')}</Txt>
              </View>
            </View>
          ))}
          {changes.length > SHOWN && !all ? <View style={{ alignSelf: 'flex-start' }}><Button kind="secondary" title={t('seatUpload.preview.showAll', { n: changes.length })} onPress={() => setAll(true)} /></View> : null}
        </Card>
      ) : null}

      {plan.requests.length ? (
        <Card>
          <Txt bold accessibilityRole="header">{t('seatUpload.preview.requests')}</Txt>
          {plan.requests.map((r) => (
            <View key={r.area} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 36 }}>
              <View style={{ flex: 2 }}><Txt>{r.area}</Txt></View>
              <View style={{ width: 70 }}><Txt bold>{r.seats}</Txt></View>
              <View style={{ flex: 1 }}><Txt size="small" color={k.muted}>{t('seatUpload.preview.households', { n: r.households })}</Txt></View>
            </View>
          ))}
          <Txt size="small" color={k.muted}>{t('seatUpload.preview.requestsNote')}</Txt>
        </Card>
      ) : null}

      {skipped.length ? (
        <Card>
          <Txt bold accessibilityRole="header">{t('seatUpload.preview.skipped', { n: skipped.length })}</Txt>
          {skipped.slice(0, SHOWN).map((r) => <Txt key={r.key} size="small"><Txt size="small" bold content>{`"${r.name}": `}</Txt>{reason(r)}</Txt>)}
        </Card>
      ) : null}

      {nothing && !errors.length ? <Banner text={t('seatUpload.preview.nothing')} /> : null}
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button kind="secondary" title={t('seatUpload.back')} onPress={onBack} disabled={busy} />
        <Button title={t('seatUpload.preview.apply')} busy={busy} disabled={nothing} onPress={onApply} />
      </View>
      <Txt size="small" color={k.muted}>{t('seatUpload.preview.orderNote')}</Txt>
    </View>
  );
}

export function ResultPanel({ summary, plan, names, busy, error, undone, onUndo, onAgain }: {
  summary: ApplySummary; plan: UploadPlan; /** Household names for the warnings, by ref. */ names: (ref: string) => string; busy: boolean; error: string | null;
  undone: boolean; onUndo: () => void; onAgain: () => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const requests = Object.values(summary.requestTotals).reduce((n, x) => n + x, 0);
  const groups = (['app_answer_kept', 'no_seats', 'above_seats'] as const).map((code) => ({ code, refs: summary.warnings.filter((w) => w.code === code).map((w) => w.household) })).filter((g) => g.refs.length);
  return (
    <View style={{ gap: 16 }}>
      <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
        <Banner tone="success" text={undone ? t('seatUpload.result.undone') : t('seatUpload.result.done', { n: plan.summary.change, requests: plan.requests.reduce((n, r) => n + r.households, 0) })} />
        {!undone ? <Txt size="small" color={k.muted}>{t('seatUpload.result.detail', { released: summary.released, requests })}</Txt> : null}
      </View>
      {error ? <View accessibilityRole="alert"><Banner tone="error" text={error} /></View> : null}
      {!undone && groups.length ? (
        <Card edgeColor={k.gold}>
          <Txt bold accessibilityRole="header">{t('seatUpload.result.warnings')}</Txt>
          {groups.map((g) => (
            <View key={g.code} style={{ gap: 2 }}>
              <Txt size="small" bold>{t(`seatUpload.warn.${g.code}`, { n: g.refs.length })}</Txt>
              <Txt size="small" color={k.muted} content>{g.refs.slice(0, 12).map(names).join(' · ')}{g.refs.length > 12 ? ` · +${g.refs.length - 12}` : ''}</Txt>
            </View>
          ))}
        </Card>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        {!undone ? <Button kind="secondary" title={t('seatUpload.result.undo')} busy={busy} onPress={onUndo} /> : null}
        <Button kind={undone ? 'primary' : 'secondary'} title={t('seatUpload.result.again')} disabled={busy} onPress={onAgain} />
      </View>
      {!undone ? <Txt size="small" color={k.muted}>{t('seatUpload.result.undoHelp')}</Txt> : null}
    </View>
  );
}
