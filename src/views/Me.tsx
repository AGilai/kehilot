import React from 'react';
import { fixtureParams } from '../client/fixtures.ts';
import { config } from '../config.ts';
import { fromEpochSeconds } from '../client/time.ts';
import { Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { NAME_MAX } from '../auth/validate.ts';
import { inviteUrl } from '../client/links.ts';
import { roleFeatures } from '../client/roleView.ts';
import { ApiCodeError } from '../client/errors.ts';
import { useSession } from '../client/SessionProvider.tsx';
import type { InviteRow, Lang } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Chip, Field, Txt, useTokens } from '../kit/components.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { TOUCH } from '../kit/theme.ts';
import { DeleteAccount } from './DeleteAccount.tsx';
import { MyGroups } from './MyGroups.tsx';
import { FamilyCard } from './me/FamilyCard.tsx';
import { TagChips } from './TagChips.tsx';
import { KehilaInfo } from './me/KehilaInfo.tsx';
import { PhoneCard } from './me/PhoneCard.tsx';
import { PrivacyCard } from './me/PrivacyCard.tsx';
import { useErrorText } from './auth/Frame.tsx';
import { BackIcon } from '../kit/Icon.tsx';

export function BackLink({ onPress }: { onPress: () => void }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('me.back')} onPress={onPress} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('me.back')}</Txt></View>
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

/** "הקישורים שלי": the caller's own unexpired listener links, with copy/share and revoke (confirmed). */
function MyLinks({ kehilaId, version, onToast }: { kehilaId: string; version: number; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const { api } = useAuth();
  const k = useTokens();
  const errText = useErrorText();
  const [rows, setRows] = React.useState<InviteRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const all = await api.invites(kehilaId);
      setRows(all.filter(r => r.mine && r.role === 'listener' && r.usesLeft > 0));
      setError(null);
    } catch (e) { setError(errText(e)); setRows(prev => prev ?? []); }
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load, version]);

  async function revoke(code: string) {
    setBusy(true);
    try { await api.revokeInvite(kehilaId, code); setAsking(null); onToast(t('me.links.revoked')); await load(); }
    catch (e) {
      // Already gone (expired, or removed on another device): the list is simply refreshed.
      if (e instanceof ApiCodeError && e.code === 'invite_not_found') { setAsking(null); await load(); } else setError(errText(e));
    } finally { setBusy(false); }
  }
  const date = (seconds: number) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' }).format(fromEpochSeconds(seconds));

  return (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{t('me.links.title')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {rows && rows.length === 0 && !error ? <Txt color={k.muted}>{t('me.links.empty')}</Txt> : null}
      {(rows ?? []).map(r => (
        <View key={r.code} style={{ gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: k.line }}>
          <Txt>{t('me.links.usesLeft', { n: r.usesLeft })}</Txt>
          <Txt size="small" color={k.muted}>{t('me.links.expires', { date: date(r.expiresAt) })}</Txt>
          <LinkShare code={r.code} onToast={onToast} />
          {asking === r.code ? (
            <View style={{ gap: 8 }}>
              <Txt size="small">{t('me.links.revokeConfirm')}</Txt>
              <Button kind="danger" title={t('me.links.revokeYes')} onPress={() => void revoke(r.code)} busy={busy} />
              <Button kind="secondary" title={t('me.links.keep')} onPress={() => setAsking(null)} disabled={busy} />
            </View>
          ) : <Button kind="secondary" title={t('me.links.revoke')} onPress={() => setAsking(r.code)} />}
        </View>
      ))}
    </Card>
  );
}

/**
 * M7, the cloud part: name, language, invites (member, gabbai), notification preferences, leaving, sign out and
 * account deletion. A listener sees the name, the language, groups, notification preferences, sign out and delete.
 */
export function Me({ onPrefs, onPhoneList, onTree, onBack, onToast, onLeft, onManage, onGroup }: { onPrefs?: () => void; /** Opens the phone list (members and gabbaim). */ onPhoneList?: () => void; /** Opens the family tree. */ onTree?: () => void; /** A group admin opens one group's screen. */ onGroup?: (g: { groupId: string; name: string }) => void; /** Gabbai: opens management mode. */ onManage?: () => void; onBack?: () => void; onToast: (text: string) => void; onLeft?: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { signOut, api } = useAuth();
  const { state, editProfile, leaveKehila } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  const kehila = state.kehila;
  const profile = state.me?.profile;
  const role = kehila?.role;
  const canInvite = role === 'member' || role === 'gabbai';

  const [view, setView] = React.useState<'me' | 'delete'>(config.fixtures && (fixtureParams().screen === 'delete' || fixtureParams().screen === 'delete-ticked') ? 'delete' : 'me');
  // "Want a copy first?" returns here and scrolls to the privacy card.
  const scrollRef = React.useRef<ScrollView>(null);
  const toPrivacy = React.useRef(false);
  const [editing, setEditing] = React.useState(false);
  const [first, setFirst] = React.useState('');
  const [last, setLast] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const [asking, setAsking] = React.useState(false);
  const [leaveError, setLeaveError] = React.useState<string | null>(null);
  const [about, setAbout] = React.useState(false);
  // The partner's name for the leave confirm (members and gabbaim in a family only).
  const [partner, setPartner] = React.useState<string | null>(null);
  const kehilaId = kehila?.kehilaId;
  React.useEffect(() => {
    if (!asking || !kehilaId || role === 'listener') { setPartner(null); return; }
    let live = true;
    api.family(kehilaId).then(f => { if (live) setPartner(f.adults.find(a => !a.me)?.displayName ?? null); }, () => { if (live) setPartner(null); });
    return () => { live = false; };
  }, [asking, kehilaId, role, api]);

  if (view === 'delete') return <DeleteAccount onBack={() => setView('me')} onExport={() => { toPrivacy.current = true; setView('me'); }} />;
  if (!profile) return null;

  const valid = !!first.trim() && [...first].length <= NAME_MAX && [...last].length <= NAME_MAX;
  async function saveName() {
    if (!valid || busy || !profile) return;
    setBusy(true); setError(null);
    try { await editProfile({ firstName: first.trim(), lastName: last.trim(), lang: profile.lang }); setEditing(false); onToast(t('me.profile.saved')); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  // The UI flips at once; the server is told next. When it refuses, the screen keeps the new language and says so.
  async function chooseLang(l: Lang) {
    if (l === lang || !profile) return;
    setLang(l);
    try { await editProfile({ firstName: profile.firstName, lastName: profile.lastName, lang: l }); }
    catch { onToast(t('me.lang.failed')); }
  }
  async function invite() {
    if (!kehila || busy) return;
    setBusy(true); setInviteError(null); setCreated(null);
    try {
      const r = await api.createInvite(kehila.kehilaId);
      setCreated(r.code); setVersion(v => v + 1);
    } catch (e) {
      setInviteError(e instanceof ApiCodeError && e.code === 'too_many_invites' ? t('me.links.tooMany') : errText(e));
    } finally { setBusy(false); }
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

  return (
    <PadScroll ref={scrollRef} contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      {onBack ? <BackLink onPress={onBack} /> : null}
      <Txt serif size="title" accessibilityRole="header">{t('me.title')}</Txt>
      {role === 'gabbai' && onManage ? <Button title={t('admin.enter')} onPress={onManage} /> : null}

      <Card>
        <Txt serif size="heading" accessibilityRole="header">{t('me.profile.title')}</Txt>
        {editing ? (
          <>
            <Field label={t('auth.firstNameLabel')} value={first} onChangeText={setFirst} maxCodePoints={NAME_MAX} autoComplete="given-name" editable={!busy} />
            <Field label={t('auth.lastNameLabel')} value={last} onChangeText={setLast} maxCodePoints={NAME_MAX} autoComplete="family-name" editable={!busy} />
            {error ? <Banner tone="error" text={error} /> : null}
            <Button title={t('me.profile.save')} onPress={() => void saveName()} busy={busy} disabled={!valid} />
            <Button kind="secondary" title={t('me.profile.cancel')} onPress={() => { setEditing(false); setError(null); }} disabled={busy} />
          </>
        ) : (
          <>
            <Txt bold size="heading">{`${profile.firstName} ${profile.lastName}`.trim()}</Txt>
            {kehila && kehila.tags.length > 0 ? (
              <View style={{ gap: 6 }}>
                <Txt size="small" color={k.muted}>{t('me.tags.label')}</Txt>
                <TagChips tags={kehila.tags} />
                <Txt size="caption" color={k.muted}>{t('me.tags.note')}</Txt>
              </View>
            ) : null}
            <Button kind="secondary" title={t('me.profile.edit')} onPress={() => { setFirst(profile.firstName); setLast(profile.lastName); setEditing(true); }} />
          </>
        )}
      </Card>

      {roleFeatures(role).phoneList && onPhoneList ? <PhoneCard onOpenList={onPhoneList} onToast={onToast} /> : null}

      {roleFeatures(role).family ? <FamilyCard onToast={onToast} onOpenTree={onTree} /> : null}

      <Card>
        <Txt serif size="heading" accessibilityRole="header">{t('me.lang.title')}</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label={t('lang.he')} selected={lang === 'he'} onPress={() => void chooseLang('he')} />
          <Chip label={t('lang.en')} selected={lang === 'en'} onPress={() => void chooseLang('en')} />
        </View>
      </Card>

      <MyGroups onManage={onGroup} onToast={onToast} />

      {canInvite && kehila ? (
        <>
          <Card>
            <Txt serif size="heading" accessibilityRole="header">{t('me.invite.title')}</Txt>
            <Txt size="small" color={k.muted}>{t('me.invite.body')}</Txt>
            {inviteError ? <Banner tone="error" text={inviteError} /> : null}
            {created ? <Banner tone="success" text={t('me.invite.ready')} /> : null}
            {created ? <LinkShare code={created} onToast={onToast} /> : <Button title={t('me.invite.create')} onPress={() => void invite()} busy={busy} />}
            {created ? <Button kind="secondary" title={t('me.invite.create')} onPress={() => void invite()} busy={busy} /> : null}
          </Card>
          <MyLinks kehilaId={kehila.kehilaId} version={version} onToast={onToast} />
        </>
      ) : null}

      {onPrefs ? <Button kind="secondary" title={t('me.prefs')} onPress={onPrefs} /> : null}
      {kehila ? (
        <>
          <View onLayout={e => { if (toPrivacy.current) { toPrivacy.current = false; scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 16), animated: false }); } }}><PrivacyCard onAbout={() => setAbout(true)} /></View>
          <KehilaInfo visible={about} onClose={() => setAbout(false)} />
          <Card>
            {asking ? (
              <>
                <Txt>{t(role === 'listener' ? 'me.leave.confirmListener' : 'me.leave.confirm', { kehila: kehila.name })}</Txt>
                {partner ? <Txt size="small">{t('me.leave.family', { name: partner })}</Txt> : null}
                <Txt size="small" color={k.muted}>{t('me.leave.posts')}</Txt>
                {leaveError ? <Banner tone="error" text={leaveError} /> : null}
                <Button kind="danger" title={t('me.leave.yes')} onPress={() => void leave()} busy={busy} />
                <Button kind="secondary" title={t('me.profile.cancel')} onPress={() => { setAsking(false); setLeaveError(null); }} disabled={busy} />
              </>
            ) : <Button kind="secondary" title={t('me.leave.action')} onPress={() => setAsking(true)} />}
          </Card>
        </>
      ) : null}

      <Button kind="secondary" title={t('me.signOut')} onPress={() => void signOut()} />
      <Button kind="danger" title={t('me.deleteAction')} onPress={() => setView('delete')} />
    </PadScroll>
  );
}
