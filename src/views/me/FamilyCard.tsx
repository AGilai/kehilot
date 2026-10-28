import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { canAddChild, familyState, formatBirthDate } from '../../client/familyView.ts';
import { fixtureParams } from '../../client/fixtures.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Child, FamilyView } from '../../client/types.ts';
import { config } from '../../config.ts';
import { civilDate, TZ } from '../../dates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { useErrorText } from '../auth/Frame.tsx';
import { ChildSheet } from './ChildSheet.tsx';
import { FamilyTreeRow } from './FamilyTreeRow.tsx';
import { PartnerPicker, useShortDate } from './PartnerPicker.tsx';
import { ForwardIcon } from '../../kit/Icon.tsx';

/** P2: "המשפחה שלי". Adults, the action for the state, then the children. Members and gabbaim only. */
export function FamilyCard({ onToast, onOpenTree }: { onToast: (text: string) => void; /** Opens the family tree (the §18 row above the card). */ onOpenTree?: () => void }) {
  const { t, lang, dir } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  const shortDate = useShortDate();
  const kehila = state.kehila;
  const screen = config.fixtures ? fixtureParams().screen : null;
  const [view, setView] = React.useState<FamilyView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [unlinking, setUnlinking] = React.useState(false);
  const [picking, setPicking] = React.useState(screen === 'partner-picker');
  const [sheet, setSheet] = React.useState<{ child: Child | null } | null>(screen === 'child-sheet' ? { child: null } : null);

  const kehilaId = kehila?.kehilaId;
  const load = React.useCallback(async () => {
    if (!kehilaId) return;
    try { setView(await api.family(kehilaId)); setLoadError(null); } catch (e) { setLoadError(errText(e)); }
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);
  if (!kehila) return null;

  async function run(fn: () => Promise<unknown>, done?: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); if (done) onToast(done); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  const adultRow = (a: FamilyView['adults'][number], tag?: React.ReactNode) => (
    <View key={a.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TOUCH, paddingVertical: 6, borderTopWidth: 1, borderTopColor: k.line }}>
      <Txt bold style={{ flex: 1 }}>{a.displayName}</Txt>
      {a.me ? <Tag tone="strong" label={t('family.me')} /> : tag}
    </View>
  );
  const childLine = (c: Child) => {
    const g = c.gender === 'f' ? t('children.daughter') : t('children.son');
    const date = c.birthDate ? (lang === 'he' ? formatBirthDate(c.birthDate) : new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(civilDate(c.birthDate))) : null;
    return date ? `${g} · ${date}` : g;
  };

  const header = <Txt serif size="heading" accessibilityRole="header">{t('family.title')}</Txt>;
  if (!view) {
    return (
      <Card>
        {header}
        {loadError ? (
          <>
            <Banner tone="error" text={loadError} />
            <Button kind="secondary" title={t('common.retry')} onPress={() => void load()} />
          </>
        ) : <ActivityIndicator color={k.tekhelet} />}
      </Card>
    );
  }

  const st = familyState(view);
  const partner = view.adults.find(a => !a.me);
  const sent = view.sent;
  const request = view.received[0];
  const addPartner = <Button title={t('family.addPartner')} onPress={() => setPicking(true)} disabled={busy} />;

  return (
    <>
    {onOpenTree ? <FamilyTreeRow view={view} kehilaId={kehila.kehilaId} onOpen={onOpenTree} /> : null}
    <Card>
      {header}
      {st === 'linked' ? <Txt size="small" color={k.muted}>{t('family.intro', { kehila: kehila.name })}</Txt> : null}
      {view.adults.map(a => adultRow(a))}

      {st === 'alone' ? (
        <>
          <Txt color={k.muted}>{t('family.alone')}</Txt>
          {addPartner}
          <Txt size="small" color={k.muted}>{t('family.addHint', { kehila: kehila.name })}</Txt>
        </>
      ) : null}

      {st === 'sent' && sent ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TOUCH, paddingVertical: 6, borderTopWidth: 1, borderTopColor: k.line }}>
            <Txt bold style={{ flex: 1 }}>{sent.toName}</Txt>
            <Tag label={t('family.sent')} />
          </View>
          <Txt size="small" color={k.muted}>{t('family.sentBody', { name: sent.toName, date: shortDate(sent.expiresAt) })}</Txt>
          <Button kind="secondary" title={t('family.withdraw')} disabled={busy} onPress={() => void run(() => api.withdrawPartnerRequest(kehila.kehilaId), t('family.withdrawn'))} />
        </>
      ) : null}

      {st === 'received' && request ? (
        <>
          <Banner text={t('family.received', { name: request.fromName })} />
          <Button title={t('family.confirm')} busy={busy} onPress={() => void run(() => api.confirmPartner(kehila.kehilaId, request.fromUserId))} />
          <Button kind="secondary" title={t('family.decline')} disabled={busy} onPress={() => void run(() => api.declinePartner(kehila.kehilaId, request.fromUserId))} />
          <Txt size="small" color={k.muted}>{t('family.declineNote', { name: request.fromName })}</Txt>
        </>
      ) : null}

      {(st === 'declined' || st === 'expired') && sent ? (
        <>
          <Banner text={t(st === 'declined' ? 'family.notConfirmed' : 'family.expired', { name: sent.toName })}
            action={{ title: t('family.dismiss'), onPress: () => void run(() => api.withdrawPartnerRequest(kehila.kehilaId)) }} />
          {addPartner}
        </>
      ) : null}

      {st === 'linked' && partner ? (
        unlinking ? (
          <>
            <Txt>{t('family.unlinkConfirm', { name: partner.displayName })}</Txt>
            <Button kind="danger" title={t('family.unlinkYes')} busy={busy} onPress={() => void run(async () => { await api.unlink(kehila.kehilaId); setUnlinking(false); }, t('family.unlinked'))} />
            <Button kind="secondary" title={t('family.keep')} disabled={busy} onPress={() => setUnlinking(false)} />
          </>
        ) : <Button kind="secondary" title={t('family.unlink')} disabled={busy} onPress={() => setUnlinking(true)} />
      ) : null}

      {error ? <Banner tone="error" text={error} /> : null}

      <View style={{ borderTopWidth: 1, borderTopColor: k.line, marginTop: 4, paddingTop: 8 }}>
        <Txt bold>{t('children.title', { n: view.children.length })}</Txt>
      </View>
      {view.children.length === 0 ? <Txt color={k.muted}>{t('children.empty')}</Txt> : null}
      {view.children.map(c => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TOUCH, paddingVertical: 6, borderTopWidth: 1, borderTopColor: k.line }}>
          <View style={{ flex: 1 }}>
            <Txt>{c.firstName}</Txt>
            <Txt size="small" color={k.muted}>{childLine(c)}</Txt>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t('children.edit')} ${c.firstName}`} onPress={() => setSheet({ child: c })} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Txt bold color={k.tekhelet}>{t('children.edit')}</Txt><ForwardIcon color={k.tekhelet} /></View>
          </Pressable>
        </View>
      ))}
      {canAddChild(view)
        ? <Button kind="secondary" title={t('children.add')} onPress={() => setSheet({ child: null })} />
        : <Banner tone="error" text={t('children.max')} />}
      <Txt size="small" color={k.muted}>{t('children.shared')}</Txt>

      <PartnerPicker visible={picking} kehilaId={kehila.kehilaId} kehilaName={kehila.name} onClose={() => setPicking(false)}
        onSent={() => { setPicking(false); onToast(t('family.pick.sent')); void load(); }} />
      <ChildSheet visible={!!sheet} kehilaId={kehila.kehilaId} child={sheet?.child ?? null}
        initial={screen === 'child-sheet' ? { firstName: 'נועה', gender: 'f', birth: '12.3.2015' } : undefined}
        onClose={() => setSheet(null)} onDone={() => { setSheet(null); void load(); }} onToast={onToast} />
    </Card>
    </>
  );
}
