import React from 'react';
import { fixtureParams } from '../client/fixtures.ts';
import { config } from '../config.ts';
import { Platform, Pressable, Share, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { inviteUrl } from '../client/links.ts';
import { meLayout } from '../client/meMap.ts';
import { mutedCount } from '../client/meView.ts';
import { ApiCodeError } from '../client/errors.ts';
import { useSession } from '../client/SessionProvider.tsx';
import type { Lang } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Field, Sheet, Txt, useTokens } from '../kit/components.tsx';
import { ListGroup, NavRow } from '../kit/NavRows.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { TOUCH } from '../kit/theme.ts';
import { DeleteAccount } from './DeleteAccount.tsx';
import { DetailsCard } from './me/DetailsCard.tsx';
import { NameSheet } from './me/NameSheet.tsx';
import { PrivacySheet } from './me/PrivacySheet.tsx';
import { useErrorText } from './auth/Frame.tsx';
import { BackIcon } from '../kit/Icon.tsx';

export function BackLink({ onPress, label }: { onPress: () => void; /** Where it goes (default "חזרה"): "סקירה" on a management group screen. */ label?: string }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? t('me.back')} onPress={onPress} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{label ?? t('me.back')}</Txt></View>
    </Pressable>
  );
}

/** The system share sheet where there is one (every native build; web with navigator.share). */
const hasShareSheet = () => Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

async function shareLink(message: string, url: string): Promise<void> {
  if (Platform.OS === 'web') { await navigator.share({ text: message, url }); return; }
  await Share.share({ message });
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* the field stays selectable */ }
  return false;
}

/** A link that can be sent: the share sheet, or where there is none a copyable field and a copy button. */
export function LinkShare({ code, onToast }: { code: string; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { state } = useSession();
  const url = inviteUrl(code);
  const message = t('me.invite.shareMessage', { kehila: state.kehila?.name ?? '', url });
  const [open, setOpen] = React.useState(false);
  async function go() {
    if (hasShareSheet()) {
      try { await shareLink(message, url); } catch { /* the user dismissed the sheet */ }
      return;
    }
    setOpen(true);
  }
  return (
    <View style={{ gap: 8 }}>
      <Button kind="secondary" title={t('me.links.share')} onPress={() => void go()} />
      {open ? (
        <>
          <Field label={t('me.invite.field')} value={url} onChangeText={() => {}} editable={false} selectTextOnFocus />
          <Button title={t('me.invite.copy')} onPress={() => { void copyText(url).then(ok => { if (ok) onToast(t('me.invite.copied')); }); }} />
        </>
      ) : null}
    </View>
  );
}


/**
 * §18.2 Me (P41), read-only: one details card (name, role, tags, phone and list state, my tree name, the family line and
 * the button to the tree), then "שלי בקהילה", "התראות ושפה" and "החשבון". Every edit lives in the family tree; the only
 * exception is a listener's name (החשבון › פרטיות ונתונים › "השם שלי"). Community things are in the Kehila menu.
 */
export function Me({ onPrefs, onTree, onGroups, onBack, onToast, onLeft }: { onPrefs?: () => void; /** Opens the family tree at my figure. */ onTree?: () => void; /** Opens "הקבוצות שלי". */ onGroups?: () => void; onBack?: () => void; onToast: (text: string) => void; onLeft?: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { signOut, api } = useAuth();
  const { state, editProfile, leaveKehila } = useSession();
  const k = useTokens();
  const kehila = state.kehila;
  const profile = state.me?.profile;
  const role = kehila?.role;
  const layout = meLayout(role);

  const [view, setView] = React.useState<'me' | 'delete'>(config.fixtures && (fixtureParams().screen === 'delete' || fixtureParams().screen === 'delete-ticked') ? 'delete' : 'me');
  const [privacy, setPrivacy] = React.useState(false);
  const [naming, setNaming] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [leaveError, setLeaveError] = React.useState<string | null>(null);
  // The partner's name for the leave confirm (members and gabbaim in a family only).
  const [partner, setPartner] = React.useState<string | null>(null);
  const [groups, setGroups] = React.useState<string | null>(null);
  const kehilaId = kehila?.kehilaId;
  const errText = useErrorText();
  React.useEffect(() => {
    if (!asking || !kehilaId || role === 'listener') { setPartner(null); return; }
    let live = true;
    api.family(kehilaId).then(f => { if (live) setPartner(f.adults.find(a => !a.me)?.displayName ?? null); }, () => { if (live) setPartner(null); });
    return () => { live = false; };
  }, [asking, kehilaId, role, api]);
  React.useEffect(() => {
    if (!kehilaId) return;
    let live = true;
    api.myGroups(kehilaId).then(rows => {
      if (!live) return;
      const n = rows.filter(g => g.isMember).length;
      const admin = rows.find(g => g.isAdmin);
      setGroups(`${n > 0 ? t('me.groups.status', { n }) : t('me.groups.statusNone')}${admin ? ` · ${t('me.groups.statusAdmin', { name: admin.name })}` : ''}`);
    }, () => { if (live) setGroups(null); });
    return () => { live = false; };
  }, [api, kehilaId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view === 'delete') return <DeleteAccount onBack={() => setView('me')} onExport={() => { setPrivacy(true); setView('me'); }} />;
  if (!profile || !kehila) return null;

  // The UI flips at once; the server is told next. When it refuses, the screen keeps the new language and says so.
  async function chooseLang(l: Lang) {
    if (l === lang || !profile) return;
    setLang(l);
    try { await editProfile({ firstName: profile.firstName, lastName: profile.lastName, lang: l }); }
    catch { onToast(t('me.lang.failed')); }
  }
  async function leave() {
    if (!kehila || busy) return;
    setBusy(true); setLeaveError(null);
    try { await leaveKehila(kehila.kehilaId); onToast(t('me.leave.done')); onLeft?.(); }
    catch (e) {
      setLeaveError(e instanceof ApiCodeError && e.code === 'last_gabbai' ? t('me.leave.lastGabbai') : errText(e));
      setBusy(false);
    }
  }
  const muted = mutedCount(kehila.notify);
  const langSwitch = (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 10, borderWidth: 1, borderColor: k.line, backgroundColor: k.stone }}>
      {(['he', 'en'] as const).map(l => (
        <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} accessibilityLabel={t(`lang.${l}`)} onPress={() => void chooseLang(l)}
          style={{ minHeight: 40, minWidth: 62, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: lang === l ? k.tekhelet : 'transparent', backgroundColor: lang === l ? k.surface : 'transparent' }}>
          <Txt size="small" bold={lang === l} color={lang === l ? k.tekhelet : k.muted}>{t(`lang.${l}`)}</Txt>
        </Pressable>
      ))}
    </View>
  );
  const rowOf = (id: string) => {
    switch (id) {
      case 'groups': return <NavRow key={id} icon="users" title={t('me.groups.mine')} status={groups ?? undefined} onPress={onGroups} />;
      case 'prefs': return <NavRow key={id} icon="bell" title={t('me.prefs')} status={muted > 0 ? t('me.prefsMuted', { n: muted }) : t('me.prefsAll')} onPress={onPrefs} />;
      case 'lang': return <NavRow key={id} icon="lang" title={t('me.lang.title')} end={langSwitch} />;
      case 'privacy': return <NavRow key={id} icon="shield" title={t('privacy.title')} status={t('me.account.privacySub')} onPress={() => setPrivacy(true)} />;
      case 'leave': return <NavRow key={id} action icon="door" title={t('me.leave.action')} onPress={() => setAsking(true)} />;
      case 'signOut': return <NavRow key={id} action icon="out" title={t('me.signOut')} onPress={() => void signOut()} />;
      default: return <NavRow key={id} action danger icon="trash" title={t('me.deleteAction')} onPress={() => setView('delete')} />;
    }
  };
  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      {onBack ? <BackLink onPress={onBack} /> : null}
      <View accessible accessibilityRole="header" accessibilityLabel={t('me.title')} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
      <DetailsCard onTree={layout.card.tree ? onTree : undefined} />
      {layout.sections.map(s => <ListGroup key={s.id} label={t(`me.${s.id}.title`)}>{s.rows.map(r => rowOf(r.id))}</ListGroup>)}
      {privacy ? <PrivacySheet onClose={() => setPrivacy(false)} onName={role === 'listener' ? () => { setPrivacy(false); setNaming(true); } : undefined} /> : null}
      {naming ? <NameSheet onClose={() => setNaming(false)} onToast={onToast} /> : null}
      <Sheet visible={asking} title={t('me.leave.action')} onClose={() => { setAsking(false); setLeaveError(null); }}
        footer={<Button kind="danger" title={t('me.leave.yes')} onPress={() => void leave()} busy={busy} />}>
        <Txt>{t(role === 'listener' ? 'me.leave.confirmListener' : 'me.leave.confirm', { kehila: kehila.name })}</Txt>
        {partner ? <Txt size="small">{t('me.leave.family', { name: partner })}</Txt> : null}
        <Txt size="small" color={k.muted}>{t('me.leave.posts')}</Txt>
        {leaveError ? <Banner tone="error" text={leaveError} /> : null}
      </Sheet>
    </PadScroll>
  );
}
