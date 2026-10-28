import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { saveTree } from '../../client/tree.ts';
import { planSteps, saveAll } from '../../client/myDetails.ts';
import type { MineDraft, SaveOutcome as MineOutcome } from '../../client/myDetails.ts';
import type { TreeDoc } from '../../client/tree.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Sheet, Toast, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import type { Person } from '../../tree/types.ts';
import type { Slot } from '../../tree/layout.ts';
import type { Target } from '../../tree/sheet.ts';
import { useErrorText } from '../auth/Frame.tsx';
import { PersonSheet, makeId, sheetTitle } from './PersonSheet.tsx';
import { LinkBannerView, SpouseLinkSheet } from './LinkParts.tsx';
import { PartnerPicker } from '../me/PartnerPicker.tsx';
import { ApiCodeError } from '../../client/errors.ts';
import { figureLink } from '../../client/linking.ts';
import { Banner, Button } from '../../kit/components.tsx';
import { useLinking } from './useLinking.ts';
import type { SaveOutcome } from './PersonSheet.tsx';
import { TreeScreen, useWide } from './TreeScreen.tsx';

type Picked = { target: Target; newId: string; key: string } | null;
const open = (target: Target): Picked => { const newId = makeId(); return { target, newId, key: 'id' in target ? target.id : newId }; };

/**
 * The tree screen with the person sheet (bottom sheet, or the 400 px side panel when wide). The sheet writes the whole tree
 * through `saveTree`; a 409 reloads the newer tree and says so. `readOnly` is the gabbai's view: the sheet shows the values only.
 */
export function TreeRoute({ onBack, readOnly, familyId, familyName }: { onBack: () => void; readOnly?: boolean; familyId?: string; familyName?: string }) {
  const { t } = useI18n();
  const k = useTokens();
  const wide = useWide();
  const { api } = useAuth();
  const { state, editProfile, setPhone, setShowPhone } = useSession();
  const errText = useErrorText();
  const kehilaId = state.kehila?.kehilaId;
  const docRef = React.useRef<TreeDoc | null>(null);
  const [doc, setDoc] = React.useState<TreeDoc | null>(null);
  const [picked, setPicked] = React.useState<Picked>(null);
  const [linkSlot, setLinkSlot] = React.useState<Slot | null>(null);
  const [invitePicker, setInvitePicker] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (text: string) => { setToast(text); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3500); };
  React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const profile = state.me?.profile;
  const kehila = state.kehila;
  const mine = profile && kehila ? { cur: { first: profile.firstName, last: profile.lastName ?? '', phone: profile.phone ?? null, showPhone: kehila.showPhone }, kehilaName: kehila.name } : undefined;

  // A request confirmed (here or on the other phone) or a link cancelled changes the tree on the server: load it again.
  const reloadTree = React.useCallback(async () => {
    if (!kehilaId) return;
    try { const d = await api.familyTree(kehilaId); docRef.current = d; setDoc(d); } catch { /* the tree on screen stays; the next open loads it */ }
  }, [api, kehilaId]);
  const linking = useLinking(api, kehilaId, !readOnly, reloadTree);

  const saveTreeDoc = async (people: Person[], feed: number): Promise<SaveOutcome> => {
    const cur = docRef.current;
    if (!kehilaId || !cur) return { ok: false, message: t('errors.version_conflict') };
    try {
      const out = await saveTree(api, kehilaId, people, cur.version);
      docRef.current = out.doc; setDoc(out.doc);
      if (!out.ok) { say(t('tree.conflictNotSaved')); return { ok: false, message: t('tree.conflictNotSaved') }; } // reloaded underneath; the sheet keeps the draft (it rebases onto the new tree)
      say(feed > 0 ? t(feed === 1 ? 'tree.feedDoneOne' : 'tree.feedDone', { n: feed }) : t('tree.saved'));
      return { ok: true };
    } catch (e) { return { ok: false, message: errText(e) }; }
  };
  /** My details first (name, phone, switch: the existing routes), then the tree. The first failure stops the run; what went through stays. */
  const onSave = async (people: Person[], feed: number, extra?: { mine: MineDraft | null; treeChanged: boolean }): Promise<SaveOutcome> => {
    if (!extra?.mine || !mine || !profile) return saveTreeDoc(people, feed);
    const steps = planSteps(mine.cur, extra.mine);
    let treeOut = { ok: true } as SaveOutcome;
    const out: MineOutcome = await saveAll(steps, {
      profile: s => editProfile({ firstName: s.first, lastName: s.last, lang: profile.lang }),
      phone: s => setPhone(s.phone),
      showPhone: s => setShowPhone(s.show),
    }, extra.treeChanged ? async () => { treeOut = await saveTreeDoc(people, feed); return treeOut; } : null);
    if (out.ok) { if (!extra.treeChanged) say(t('tree.mine.saved')); return { ok: true }; }
    if (out.failed === 'tree') {
      const why = treeOut.ok ? errText(out.error) : treeOut.message;
      return { ok: false, message: out.done.length ? t('tree.mine.treeFailed', { why }) : why };
    }
    const phoneErr = out.failed === 'phone' && out.error instanceof ApiCodeError && out.error.code === 'invalid_phone';
    const lead = t(out.failed === 'profile' ? 'tree.mine.failProfile' : out.failed === 'phone' ? 'tree.mine.failPhone' : 'tree.mine.failSwitch');
    return { ok: false, message: [lead, phoneErr ? t('me.phone.invalid') : errText(out.error), out.done.length ? t('tree.mine.doneBefore') : ''].filter(Boolean).join(' ') };
  };
  const openId = (id: string) => setPicked(open({ id }));
  const openSlot = (slot: Slot) => {
    if (!readOnly && slot.relation === 'spouse' && linking.model.canRequest) { linking.clearError(); setLinkSlot(slot); } else setPicked(open({ create: slot }));
  };
  const target = picked?.target;
  const inviteFor = (tg: Target) => {
    const p = 'id' in tg ? docRef.current?.people.find(x => x.id === tg.id) : undefined;
    if (readOnly || !kehilaId || !p) return undefined;
    const link = figureLink(linking.model, p);
    if (link.kind === 'none') return undefined;
    return { link, busy: linking.busy, error: linking.error, onInvite: () => { linking.clearError(); setInvitePicker(true); },
      onWithdraw: () => linking.run(() => api.withdrawPartnerRequest(kehilaId)).then(ok => { if (ok) say(t('family.withdrawn')); return ok; }) };
  };
  const unlinkFor = (tg: Target) => {
    const p = 'id' in tg ? docRef.current?.people.find(x => x.id === tg.id) : undefined;
    const name = linking.model.linkedName;
    if (readOnly || !kehilaId || !p || p.relation !== 'spouse' || !p.userId || !name) return undefined;
    return { name, busy: linking.busy, error: linking.error, onUnlink: () => linking.run(() => api.unlink(kehilaId)).then(ok => { if (ok) say(t('family.unlinked')); return ok; }) };
  };
  const exists = !!target && ('id' in target ? !!docRef.current?.people.some(p => p.id === target.id) : true);
  const title = picked && exists ? sheetTitle(docRef.current?.people ?? [], picked.target, t) : '';
  const content = picked && exists && docRef.current ? (
    <PersonSheet key={picked.key} myId={state.me?.userId ?? null} people={docRef.current.people} target={picked.target} newId={picked.newId} readOnly={readOnly} mine={mine} unlink={unlinkFor(picked.target)} invite={inviteFor(picked.target)}
      onSave={onSave} onOpen={next => setPicked(open(next))} onClose={() => setPicked(null)} />
  ) : null;
  const selectedId = picked && 'id' in picked.target ? picked.target.id : null;
  const panel = wide ? (
    picked && content ? (
      <View style={{ flex: 1 }} testID="tree-panel">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 8 }}>
          <Txt serif size="title" accessibilityRole="header" style={{ flex: 1 }} content>{title}</Txt>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setPicked(null)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={22} color={k.ink} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8 }}>{content}</ScrollView>
      </View>
    ) : <View style={{ padding: 16 }}><Txt color={k.muted}>{t('tree.legend.tap')}</Txt></View>
  ) : undefined;
  return (
    <View style={{ flex: 1 }}>
      <TreeScreen onBack={onBack} readOnly={readOnly} familyId={familyId} familyName={familyName} selectedId={selectedId}
        onOpenPerson={openId} onOpenSlot={openSlot}
        top={linking.loadError && !linking.view ? (
          <View style={{ gap: 8 }}><Banner tone="error" text={linking.loadError} /><Button kind="secondary" title={t('common.retry')} onPress={() => void linking.reload()} /></View>
        ) : linking.model.banner && kehilaId ? <LinkBannerView banner={linking.model.banner} linking={linking} kehilaId={kehilaId} onToast={say} /> : null}
        pendingSpouse={linking.model.slot.kind === 'pending' ? linking.model.slot.name : null} onDoc={d => { docRef.current = d; }} doc={doc} panel={panel} />
      {!wide ? <Sheet visible={!!picked && !!content} title={title} onClose={() => setPicked(null)}>{content}</Sheet> : null}
      {!readOnly && kehila && linkSlot ? (
        <SpouseLinkSheet visible gender={linkSlot.gender} slot={linking.model.slot} kehilaId={kehila.kehilaId} kehilaName={kehila.name} linking={linking}
          onManual={() => { const sl = linkSlot; setLinkSlot(null); setPicked(open({ create: sl })); }} onClose={() => setLinkSlot(null)} onToast={say} />
      ) : null}
      {!readOnly && kehila ? (
        <PartnerPicker visible={invitePicker} kehilaId={kehila.kehilaId} kehilaName={kehila.name} onClose={() => setInvitePicker(false)}
          onSent={() => { setInvitePicker(false); say(t('family.pick.sent')); void linking.reload(); }} />
      ) : null}
      <Toast text={toast ?? ''} visible={!!toast} />
    </View>
  );
}
