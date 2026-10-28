// Holders without an account, link suggestions and the confirm (UX-DESIGN §16.7, frame P30). Gabbaim only. A holder is personal data: this
// screen keeps it in memory only. Nothing is linked without the explicit confirm below, even on an exact phone match.
import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { config } from '../../config.ts';
import { fixtureParams } from '../../client/fixtures.ts';
import type { SeatHolder } from '../../client/endpoints.ts';
import { formatPhone } from '../../client/phone.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { AdminFamily } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, PickList, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { BackIcon } from '../../kit/Icon.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { dismissKey, holderBody, holderRows, linkError, linkOutcome, loadDismissed, saveDismissed, seatCountsByRef, visibleSuggestions, whyKey } from '../../seats/holders.ts';
import type { HolderRow, LinkSuggestion } from '../../seats/holders.ts';
import { normalizeName } from '../../seats/match.ts';
import { useAdminErrText, useShortDate } from './shared.tsx';
import { Dialog } from './seatMap/Dialog.tsx';

type Load = { status: 'loading' } | { status: 'error'; text: string } | { status: 'ready'; holders: SeatHolder[]; families: AdminFamily[]; suggestions: LinkSuggestion[]; counts: Map<string, number> };
type Form = { id: string | null; name: string; phone: string };
type Link = { holder: SeatHolder; suggestion: LinkSuggestion | null; familyId: string | null; query: string };

const store = (): { getItem(k: string): string | null; setItem(k: string, v: string): void } | undefined => {
  try { return typeof localStorage !== 'undefined' ? localStorage : undefined; } catch { return undefined; }
};

function familyLabel(f: AdminFamily, and: string): string {
  const firsts = f.adults.map((a) => (a.displayName.endsWith(` ${f.name}`) ? a.displayName.slice(0, -f.name.length - 1) : a.displayName.split(' ')[0]!)).filter(Boolean);
  return firsts.length ? `${firsts.join(and)} ${f.name}` : f.name;
}

export function SeatHolders({ onBack, onToast }: { onBack: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state } = useSession();
  const errText = useAdminErrText();
  const date = useShortDate();
  const kehilaId = state.kehilaId!;
  const [load, setLoad] = React.useState<Load>({ status: 'loading' });
  const [dismissed, setDismissed] = React.useState<Set<string>>(() => loadDismissed(store(), kehilaId));
  const [onlySuggested, setOnlySuggested] = React.useState(false);
  const [form, setForm] = React.useState<Form | null>(null);
  const [formError, setFormError] = React.useState<{ field: 'name' | 'phone' | null; text: string } | null>(null);
  const [remove, setRemove] = React.useState<HolderRow | null>(null);
  const [link, setLink] = React.useState<Link | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dlgError, setDlgError] = React.useState<string | null>(null);

  const fetchAll = React.useCallback(async (quiet = false) => {
    if (!quiet) setLoad({ status: 'loading' });
    try {
      const [holders, families] = await Promise.all([api.seatHolders(kehilaId), api.adminFamilies(kehilaId)]);
      // best effort: a failed suggestions or seat-count read only loses that hint
      const [sug, layouts] = await Promise.allSettled([api.seatLinkSuggestions(kehilaId), api.seatLayouts(kehilaId)]);
      let counts = new Map<string, number>();
      const current = layouts.status === 'fulfilled' ? layouts.value.layouts.find((l) => l.current) : undefined;
      if (current) { try { counts = seatCountsByRef((await api.seatAssignments(kehilaId, current.effectiveFrom)).assignments); } catch { /* ignore */ } }
      setLoad({ status: 'ready', holders, families, suggestions: sug.status === 'fulfilled' ? sug.value.suggestions : [], counts });
    } catch (e) { setLoad({ status: 'error', text: errText(e) }); }
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void fetchAll(); }, [fetchAll]);

  const ready = load.status === 'ready' ? load : null;
  // fixture builds only: ?screen=seat-link opens the confirm for the first suggestion
  const presetOpened = React.useRef(false);
  React.useEffect(() => {
    if (!ready || presetOpened.current || !config.fixtures || fixtureParams().screen !== 'seat-link') return;
    presetOpened.current = true;
    const s = ready.suggestions[0];
    const h = s && ready.holders.find((x) => x.holderId === s.holderId);
    if (s && h) setLink({ holder: h, suggestion: s, familyId: s.familyId, query: '' });
  }, [ready]);
  const visible = React.useMemo(() => (ready ? visibleSuggestions(ready.suggestions, dismissed) : []), [ready, dismissed]);
  const rows = React.useMemo(() => (ready ? holderRows(ready.holders, new Map([...ready.counts].filter(([r]) => r.startsWith('holder:')).map(([r, n]) => [r.slice(7), n])), visible, onlySuggested) : []), [ready, visible, onlySuggested]);
  const familyOf = (id: string) => ready?.families.find((f) => f.familyId === id);
  const and = t('seatEditor.and');

  async function saveForm() {
    if (!form || busy) return;
    const r = holderBody(form.name, form.phone);
    if (!r.ok) { setFormError({ field: r.field, text: t(r.field === 'name' ? 'seatHolders.form.badName' : 'seatHolders.form.badPhone') }); return; }
    setBusy(true); setFormError(null);
    try {
      if (form.id) await api.putSeatHolder(kehilaId, form.id, r.body); else await api.createSeatHolder(kehilaId, r.body);
      setForm(null); onToast(t(form.id ? 'seatHolders.toast.saved' : 'seatHolders.toast.created')); await fetchAll(true);
    } catch (e) { setFormError({ field: null, text: errText(e) }); } finally { setBusy(false); }
  }
  async function doRemove() {
    if (!remove || busy) return;
    setBusy(true); setDlgError(null);
    try { await api.deleteSeatHolder(kehilaId, remove.holder.holderId); setRemove(null); onToast(t('seatHolders.toast.deleted')); await fetchAll(true); }
    catch (e) { setDlgError(errText(e)); } finally { setBusy(false); }
  }
  async function doLink() {
    if (!link?.familyId || busy) return;
    const fam = familyOf(link.familyId);
    setBusy(true); setDlgError(null);
    try {
      await api.linkSeatHolder(kehilaId, link.holder.holderId, { familyId: link.familyId, ifUpdatedAt: link.holder.updatedAt });
      setLink(null); onToast(t('seatHolders.toast.linked', { household: fam ? familyLabel(fam, and) : '' })); await fetchAll(true);
    } catch (e) {
      const kind = linkError(e);
      setDlgError(kind === 'changed' ? t('seatHolders.link.changed') : kind === 'retry' ? t('seatHolders.link.retry') : kind === 'gone' ? t('seatHolders.link.gone') : errText(e));
      if (kind === 'changed' || kind === 'gone') await fetchAll(true);
    } finally { setBusy(false); }
  }
  function notThem(s: LinkSuggestion) {
    const next = new Set(dismissed).add(dismissKey(s.holderId, s.familyId));
    setDismissed(next); saveDismissed(store(), kehilaId, next); setLink(null);
  }

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('editor.back')} onPress={onBack} style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('editor.back')}</Txt></View>
    </Pressable>
  );

  const seatText = (n: number) => (n === 0 ? t('seatMap.panel.countNone') : n === 1 ? t('seatMap.panel.countOne') : t('seatMap.panel.countN', { n }));
  const card = (title: string, tag: string, name: string, phone: string | null, seats: number, tone: 'plain' | 'strong') => (
    <Card style={{ flex: 1, minWidth: 220 }}>
      <View style={{ alignSelf: 'flex-start' }}><Tag label={tag} tone={tone} /></View>
      <Txt bold size="heading" content>{name}</Txt>
      {phone ? <Txt size="small" color={k.muted} content>{formatPhone(phone)}</Txt> : null}
      <Txt size="small">{seatText(seats)}</Txt>
      <Txt size="caption" color={k.muted}>{title}</Txt>
    </Card>
  );

  const linkDialog = () => {
    if (!link || !ready) return null;
    const fam = link.familyId ? familyOf(link.familyId) : null;
    const hSeats = ready.counts.get(`holder:${link.holder.holderId}`) ?? 0;
    if (!fam) {
      // manual: pick a registered household
      const q = normalizeName(link.query);
      const rowsF = ready.families.filter((f) => !q || normalizeName(`${f.name} ${f.adults.map((a) => a.displayName).join(' ')}`).includes(q))
        .map((f) => ({ id: f.familyId, title: familyLabel(f, and), subtitle: seatText(ready.counts.get(`family:${f.familyId}`) ?? 0) }));
      return (
        <Dialog visible title={t('seatHolders.link.pickTitle', { name: link.holder.name })} onClose={() => setLink(null)} width={560}
          footer={<Button kind="secondary" title={t('common.cancel')} onPress={() => setLink(null)} />}>
          <PickList query={link.query} onQuery={(v) => setLink({ ...link, query: v })} placeholder={t('seatHolders.link.search')} state="ready" empty={t('seatEditor.match.noFamilies')}
            rows={rowsF} selected={null} onSelect={(id) => setLink({ ...link, familyId: id })} max={6} />
        </Dialog>
      );
    }
    const fSeats = ready.counts.get(`family:${fam.familyId}`) ?? 0;
    const out = linkOutcome(hSeats, fSeats);
    const household = familyLabel(fam, and);
    const s = link.suggestion;
    return (
      <Dialog visible title={t('seatHolders.link.title', { name: link.holder.name })} onClose={() => { setLink(null); setDlgError(null); }} width={720}
        footer={(
          <>
            <Button title={t('seatHolders.link.confirm')} busy={busy} onPress={() => { void doLink(); }} />
            {s ? <Button kind="secondary" title={t('seatHolders.link.notThem')} disabled={busy} onPress={() => notThem(s)} /> : null}
            <Button kind="secondary" title={t('common.cancel')} disabled={busy} onPress={() => { setLink(null); setDlgError(null); }} />
          </>
        )}>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          {card(t('seatHolders.link.noAccountSide'), t('seatEditor.match.noAccount'), link.holder.name, link.holder.phone, hSeats, 'plain')}
          {card(t('seatHolders.link.registeredSide'), t('seatHolders.link.registered'), household, null, fSeats, 'strong')}
        </View>
        {dlgError ? <View accessibilityRole="alert"><Banner tone="error" text={dlgError} /></View> : null}
        <Card edgeColor={k.tekhelet}>
          <Txt bold accessibilityRole="header">{t('seatHolders.link.what')}</Txt>
          <Txt>{`• ${t('seatHolders.link.what1', { household })}`}</Txt>
          <Txt>{`• ${t('seatHolders.link.what2')}`}</Txt>
          <Txt>{`• ${t('seatHolders.link.what3')}`}</Txt>
          <Txt>{`• ${t('seatHolders.link.what4')}`}</Txt>
        </Card>
        {out.union ? <Banner tone="error" text={t('seatHolders.link.union', { household, family: out.family, total: out.total })} /> : null}
        <Txt size="small" color={k.muted}>{t('seatHolders.link.never')}</Txt>
      </Dialog>
    );
  };

  const formDialog = form ? (
    <Dialog visible title={t(form.id ? 'seatHolders.form.editTitle' : 'seatHolders.form.newTitle')} onClose={() => { setForm(null); setFormError(null); }} width={520}
      footer={(
        <>
          <Button title={t(form.id ? 'seatHolders.form.save' : 'seatHolders.form.create')} busy={busy} onPress={() => { void saveForm(); }} />
          <Button kind="secondary" title={t('common.cancel')} disabled={busy} onPress={() => { setForm(null); setFormError(null); }} />
        </>
      )}>
      <Field label={t('seatHolders.form.name')} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} maxCodePoints={60} error={formError?.field === 'name' ? formError.text : null} />
      <Field label={t('seatHolders.form.phone')} value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} ltr keyboardType="phone-pad" error={formError?.field === 'phone' ? formError.text : null} />
      <Txt size="small" color={k.muted}>{t('seatHolders.form.phoneHelp')}</Txt>
      {formError && !formError.field ? <View accessibilityRole="alert"><Banner tone="error" text={formError.text} /></View> : null}
      <Banner text={t('seatHolders.form.privacy')} />
    </Dialog>
  ) : null;

  const removeDialog = remove ? (
    <Dialog visible alert title={t('seatHolders.delete.title', { name: remove.holder.name })} onClose={() => { setRemove(null); setDlgError(null); }} width={480}
      footer={(
        <>
          <Button kind="danger" title={t('seatHolders.delete.confirm')} busy={busy} onPress={() => { void doRemove(); }} />
          <Button kind="secondary" title={t('common.cancel')} disabled={busy} onPress={() => { setRemove(null); setDlgError(null); }} />
        </>
      )}>
      <Txt>{t('seatHolders.delete.body', { n: remove.seats })}</Txt>
      {dlgError ? <Banner tone="error" text={dlgError} /> : null}
    </Dialog>
  ) : null;

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 1000, alignSelf: 'center' }}>
      {back}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Txt serif size="title" accessibilityRole="header" style={{ flex: 1 }}>{t('seatHolders.title')}</Txt>
        <Button title={t('seatHolders.new')} onPress={() => { setForm({ id: null, name: '', phone: '' }); setFormError(null); }} />
      </View>
      <Txt color={k.muted}>{t('seatHolders.lead')}</Txt>
      {load.status === 'loading' ? <ActivityIndicator color={k.tekhelet} /> : null}
      {load.status === 'error' ? <Banner tone="error" text={load.text} action={{ title: t('common.retry'), onPress: () => { void fetchAll(); } }} /> : null}
      {ready ? (
        <>
          {visible.length ? (
            <View style={{ gap: 8 }}>
              <Banner text={`${t('seatHolders.suggest.count', { n: visible.length })} ${t('seatHolders.suggest.lead')}`} />
              <View style={{ alignSelf: 'flex-start' }}><Button kind="secondary" title={onlySuggested ? t('seatHolders.suggest.all') : t('seatHolders.suggest.only')} onPress={() => setOnlySuggested((v) => !v)} /></View>
            </View>
          ) : null}
          {rows.length === 0 ? <Txt color={k.muted}>{t('seatHolders.empty')}</Txt> : null}
          {rows.map((r) => {
            const s = r.suggestion;
            const fam = s ? familyOf(s.familyId) : null;
            const why = s ? whyKey(s.why) : null;
            return (
              <Card key={r.holder.holderId} edgeColor={s ? k.gold : undefined}>
                <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
                    <Txt bold size="heading" content>{r.holder.name}</Txt>
                    <Txt size="small" color={k.muted} content>{r.holder.phone ? formatPhone(r.holder.phone) : '—'}</Txt>
                    <Txt size="small" color={k.muted}>{`${seatText(r.seats)} · ${t('seatHolders.created', { date: date(Math.floor(r.holder.createdAt / 1000)) })}`}</Txt>
                  </View>
                  <View style={{ flex: 1.4, minWidth: 260, gap: 6 }}>
                    {s && fam ? (
                      <>
                        <Txt size="small"><Txt size="small" bold>{t('seatHolders.suggest.could')}</Txt>{' '}<Txt size="small" bold content>{familyLabel(fam, and)}</Txt></Txt>
                        <Txt size="small" color={k.muted}>{t(`seatHolders.why.${why!.key}`)}{why!.weak ? ` · ${t('seatHolders.why.noPhone')}` : ''}</Txt>
                        <View style={{ alignSelf: 'flex-start' }}><Button title={t('seatHolders.suggest.review')} onPress={() => { setLink({ holder: r.holder, suggestion: s, familyId: s.familyId, query: '' }); setDlgError(null); }} /></View>
                      </>
                    ) : null}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button kind="secondary" title={t('seatHolders.edit')} onPress={() => { setForm({ id: r.holder.holderId, name: r.holder.name, phone: r.holder.phone ? formatPhone(r.holder.phone) : '' }); setFormError(null); }} />
                  <Button kind="secondary" title={t('seatEditor.match.optLink')} onPress={() => { setLink({ holder: r.holder, suggestion: null, familyId: null, query: '' }); setDlgError(null); }} />
                  <Button kind="secondary" title={t('seatHolders.delete.open')} onPress={() => { setRemove(r); setDlgError(null); }} />
                </View>
              </Card>
            );
          })}
          <Txt size="small" color={k.muted}>{t('seatHolders.privacy')}</Txt>
        </>
      ) : null}
      {formDialog}{removeDialog}{linkDialog()}
    </PadScroll>
  );
}
