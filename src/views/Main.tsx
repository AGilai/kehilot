import React from 'react';
import { useReportScreen } from '../client/reportUi.ts';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { config } from '../config.ts';
import { FIXTURE_PICTURE, fixtureParams } from '../client/fixtures.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { unreadCount } from '../client/messageView.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { pushDestination } from '../client/push.ts';
import { adminGuard, takeManageEntry } from '../client/membersView.ts';
import { firstWithPending } from '../client/channelsView.ts';
import { roleFeatures, scheduleEditorAllowed } from '../client/roleView.ts';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Button, Sheet, Toast, Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { TOUCH } from '../kit/theme.ts';
import { AdminContext } from './admin/shared.tsx';
import { Approvals } from './admin/Approvals.tsx';
import { Channels } from './admin/Channels.tsx';
import { GroupAdmin } from './admin/GroupAdmin.tsx';
import { Groups } from './admin/Groups.tsx';
import { InviteWithRole } from './admin/InviteWithRole.tsx';
import { Members } from './admin/Members.tsx';
import { Import } from './admin/Import.tsx';
import { PushTexts } from './admin/PushTexts.tsx';
import { Overview } from './admin/Overview.tsx';
import { SeatPrint } from './admin/SeatPrint.tsx';
import { SeatEditor } from './admin/SeatEditor.tsx';
import { SeatHolders } from './admin/SeatHolders.tsx';
import { SeatResponses } from './admin/SeatResponses.tsx';
import { SeatPage } from './SeatPage.tsx';
import { seatEditorAllowed, seatPrintRole, seatScreenFor } from '../seats/access.ts';
import { TermsGate } from './TermsGate.tsx';
import { PhoneList } from './PhoneList.tsx';
import { Compose } from './Compose.tsx';
import type { ComposeInitial } from './Compose.tsx';
import { ChatView } from './ChatView.tsx';
import { Home } from './Home.tsx';
import { Schedule } from './Schedule.tsx';
import { ScheduleEditor } from './admin/ScheduleEditor.tsx';
import { editorLeaveAsk } from '../schedule/editor.ts';
import { Me } from './Me.tsx';
import { Simchas } from './admin/Simchas.tsx';
import { TreeRoute } from './tree/TreeRoute.tsx';
import { NotifyPrefs } from './NotifyPrefs.tsx';
import { MessageDetail } from './MessageDetail.tsx';
import { Messages } from './Messages.tsx';
import type { Filter } from './Messages.tsx';
import { TopBar } from './TopBar.tsx';

type Nav =
  | { tab: 'home' }
  | { tab: 'messages' }
  | { tab: 'detail'; id: string; from: 'home' | 'messages' }
  | { tab: 'chat'; channelId: string }
  | { tab: 'compose' }
  | { tab: 'me' }
  | { tab: 'tree' }
  | { tab: 'adminTree'; familyId: string; name: string }
  | { tab: 'phoneList'; from: 'home' | 'me' }
  | { tab: 'overview' }
  | { tab: 'simchas' }
  | { tab: 'approvals' }
  | { tab: 'members' }
  | { tab: 'invite'; member?: boolean }
  | { tab: 'groups' }
  | { tab: 'channels' }
  | { tab: 'import' }
  | { tab: 'pushTexts' }
  | { tab: 'seats' }
  | { tab: 'schedule' }
  | { tab: 'scheduleEditor' }
  | { tab: 'seatPrint' }
  | { tab: 'seatEditor' }
  | { tab: 'seatResponses' }
  | { tab: 'seatHolders' }
  | { tab: 'group'; groupId: string; name: string; from: 'groups' | 'me' }
  | { tab: 'prefs'; from: 'home' | 'messages' | 'me' };

/** Fixture mode only: ?screen=messages | messages-all | m3 | m3b | m3target | chat | overview | approvals | members | invite-member | groups | channels | channel-sheet | group-admin opens that screen (the last four in management mode). */
function fixtureNav(state: ReturnType<typeof useSession>['state']): { nav: Nav; filter?: Filter; compose?: ComposeInitial; manage?: boolean } | null {
  if (!config.fixtures) return null;
  const s = fixtureParams().screen;
  const byType = (type: string) => state.feed.order.map(id => state.feed.messages[id]!).find(m => m.type === type && m.targetMemberId);
  if (s === 'messages') return { nav: { tab: 'messages' } };
  if (s === 'search-loading') return { nav: { tab: 'messages' } };
  if (s === 'messages-all') return { nav: { tab: 'messages' }, filter: 'all' };
  if (s === 'm3' || s === 'm3target') { const m = byType('celebration'); return m ? { nav: { tab: 'detail', id: m.messageId, from: 'messages' } } : null; }
  if (s === 'm3b') { const m = byType('condolence'); return m ? { nav: { tab: 'detail', id: m.messageId, from: 'messages' } } : null; }
  if (s === 'chat') { const c = state.channels.find(x => x.conversation); return c ? { nav: { tab: 'chat', channelId: c.channelId } } : null; }
  if (s === 'compose') return { nav: { tab: 'compose' } };
  if (s === 'me' || s === 'me-family' || s === 'me-request' || s === 'me-linked' || s === 'partner-picker' || s === 'child-sheet' || s === 'privacy' || s === 'privacy-ready' || s === 'kehila-info' || s === 'leave-listener' || s === 'delete' || s === 'delete-ticked') return { nav: { tab: 'me' } };
  if (s === 'tree' || s === 'tree-married' || s === 'tree-solo' || s === 'tree-empty') return { nav: { tab: 'tree' } };
  if (s === 'tree-admin') return { nav: { tab: 'adminTree', familyId: '01FIXTUREFAMILY0000000003', name: 'בדיוני' }, manage: true };
  if (s === 'phone-list' || s === 'phone-list-empty') return { nav: { tab: 'phoneList', from: 'home' } };
  if (s === 'overview' || s === 'overview-privacy' || s === 'terms' || s === 'simchas-card' || s === 'simchas-card-empty') return { nav: { tab: 'overview' }, manage: true };
  if (s === 'simchas' || s === 'simchas-empty') return { nav: { tab: 'simchas' }, manage: true };
  if (s === 'approvals' || s === 'seat-approval') return seatEditorAllowed(state.kehila?.role) || s === 'approvals' ? { nav: { tab: 'approvals' }, manage: true } : null;
  if (s === 'members' || s === 'admin-families' || s === 'admin-link' || s === 'tags-manage' || s === 'tags-assign' || s === 'tags-empty') return { nav: { tab: 'members' }, manage: true };
  if (s === 'invite-member') return { nav: { tab: 'invite', member: true }, manage: true };
  if (s === 'groups') return { nav: { tab: 'groups' }, manage: true };
  if (s === 'channels' || s === 'channel-sheet') return { nav: { tab: 'channels' }, manage: true };
  if (s === 'import') return { nav: { tab: 'import' }, manage: true };
  if (s === 'group-admin') return { nav: { tab: 'group', groupId: '01FIXTUREGROUP00000000001', name: 'נוער', from: 'groups' }, manage: true };
  const seat = seatScreenFor(s, state.kehila?.role, config.seatsPreview);
  if (seat === 'seats') return { nav: { tab: 'seats' } };
  if (seat === 'seatPrint') return { nav: { tab: 'seatPrint' }, manage: true };
  if (s?.startsWith('seat-editor') || s === 'seat-map') return seatEditorAllowed(state.kehila?.role) ? { nav: { tab: 'seatEditor' }, manage: true } : null;
  if (s?.startsWith('seat-upload')) return seatEditorAllowed(state.kehila?.role) ? { nav: { tab: 'seatResponses' }, manage: true } : null;
  if (s === 'seat-holders' || s === 'seat-link') return seatEditorAllowed(state.kehila?.role) ? { nav: { tab: 'seatHolders' }, manage: true } : null;
  if (s === 'schedule') return { nav: { tab: 'schedule' } };
  if (s === 'schedule-editor' || s === 'schedule-editor-none') return scheduleEditorAllowed(state.kehila?.role) ? { nav: { tab: 'scheduleEditor' }, manage: true } : null;
  if (s === 'm5') return { nav: { tab: 'prefs', from: 'home' } };
  if (s === 'compose-target') return { nav: { tab: 'compose' }, compose: { type: 'celebration', targetFamilyId: '01FIXTUREFAMILY0000000003' } };
  if (s === 'compose-family') return { nav: { tab: 'compose' }, compose: { type: 'celebration', targetFamilyId: '01FIXTUREFAMILY0000000003', query: 'ב' } };
  if (s === 'compose-image') return { nav: { tab: 'compose' }, compose: { type: 'weekly', image: { uri: FIXTURE_PICTURE } } };
  return null;
}

/** The signed-in app for every role (listeners get the reading parts, see roleView.ts): top bar, the open screen, and the bottom tabs. */
export function Main({ onOpenSwitcher, banner, pushSignal, takePush, manageSignal, takeManage }: { onOpenSwitcher: () => void; banner?: React.ReactNode; /** Changes when a push is tapped; `takePush` then returns the target once (a remount gets null). */ pushSignal?: number; takePush?: () => { messageId?: string; screen?: string } | null; /** Changes when the switcher asks for management mode. */ manageSignal?: number; /** Returns the pending request once. */ takeManage?: () => number | null }) {
  const { t } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const { api } = useAuth();
  const [manage, setManage] = React.useState(false);
  const [pending, setPending] = React.useState(0);
  const [nav, setNav] = React.useState<Nav>({ tab: 'home' });
  useReportScreen({ screen: nav.tab, hasTabs: true, kehilaId: state.kehilaId, kehilaName: state.kehila?.name ?? null });
  const [filter, setFilter] = React.useState<Filter | undefined>(undefined);
  const [composeInitial, setComposeInitial] = React.useState<ComposeInitial | undefined>(undefined);
  const [toast, setToast] = React.useState<string | null>(null);
  // The schedule editor reports unsaved changes; leaving its screen by a tap asks first (forced exits, like a lost role, do not).
  const editorDirty = React.useRef(false);
  const [leaveAsk, setLeaveAsk] = React.useState<(() => void) | null>(null);
  const guard = (go: () => void) => { if (editorLeaveAsk(nav.tab, editorDirty.current)) setLeaveAsk(() => go); else go(); };
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const showToast = React.useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  // A member who administers groups: the first of them with pending requests (else Me).
  function openGroupRequests() {
    const kid = state.kehilaId;
    if (!kid) { setNav({ tab: 'me' }); return; }
    void (async () => {
      let found: { groupId: string; name: string } | null = null;
      try {
        const mine = (await api.myGroups(kid)).filter(g => g.isAdmin);
        const id = await firstWithPending(mine.map(g => g.groupId), async g => (await api.groupRequests(kid, g)).length);
        const g = mine.find(x => x.groupId === id);
        if (g) found = { groupId: g.groupId, name: g.name };
      } catch { /* open Me */ }
      setNav(found ? { tab: 'group', ...found, from: 'me' } : { tab: 'me' });
    })();
  }
  // A tapped push opens the message, Approvals (requests, gabbai only), or Home.
  React.useEffect(() => {
    const target = takePush?.();
    if (!target) return;
    guard(() => {
      const dest = pushDestination(target, state.kehila?.role);
      if (dest === 'seats') setNav({ tab: 'seats' });
      else if (dest === 'approvals') { setManage(true); setNav({ tab: 'approvals' }); }
      else if (dest === 'group_requests') {
        if (state.kehila?.role === 'gabbai') { setManage(true); setNav({ tab: 'groups' }); }
        else openGroupRequests();
      }
      else setNav(dest === 'message' && target.messageId ? { tab: 'detail', id: target.messageId, from: 'messages' } : { tab: 'home' });
    });
  }, [pushSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  // Android's back button leaves the schedule editor through the same unsaved-changes question.
  React.useEffect(() => {
    if (Platform.OS !== 'android' || nav.tab !== 'scheduleEditor') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { guard(() => setNav({ tab: 'overview' })); return true; });
    return () => sub.remove();
  }, [nav.tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const isGabbai = state.kehila?.role === 'gabbai';
  // Management mode is for gabbaim only, and ends when the role or the Kehila changes.
  const role = state.kehila?.role;
  // Left management (role taken away, or an admin call answered 403): back to Home with a toast.
  const leaveManage = React.useCallback(() => {
    const g = adminGuard(undefined, { tab: 'home' });
    setManage(false); setNav(g.nav as Nav); showToast(t('admin.left'));
  }, [showToast, t]);
  React.useEffect(() => {
    if (!manage || role === 'gabbai') return;
    const g = adminGuard(role, nav);
    setManage(g.manage); setNav(g.nav as Nav); if (g.left) showToast(t('admin.left'));
  }, [role, manage]); // eslint-disable-line react-hooks/exhaustive-deps
  const manageHolder = React.useRef<number | null>(null);
  React.useEffect(() => {
    manageHolder.current = takeManage?.() ?? null;
    if (takeManageEntry(manageHolder, role)) { setManage(true); setNav({ tab: 'overview' }); }
  }, [manageSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!manage || !isGabbai || !state.kehilaId) return;
    let live = true;
    api.requests(state.kehilaId).then(r => { if (live) setPending(r.length); }, () => {});
    return () => { live = false; };
  }, [manage, isGabbai, state.kehilaId, api]); // eslint-disable-line react-hooks/exhaustive-deps
  const jumped = React.useRef(false);
  const fixtureQuery = React.useMemo(() => (config.fixtures && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('q') ?? '' : ''), []);

  // Fixtures: jump to the requested screen once the messages have loaded.
  React.useEffect(() => {
    if (jumped.current || !state.feed.loaded) return;
    const j = fixtureNav(state);
    jumped.current = true;
    if (j?.manage) setManage(true);
    if (j) { setNav(j.nav); setFilter(j.filter); setComposeInitial(j.compose); }
  }, [state]);

  const kehila = state.kehila;
  const feats = roleFeatures(kehila?.role);
  const unread = kehila ? unreadCount(state.feed, kehila.notify, state.channels) : 0;
  const adminTab = nav.tab === 'overview' || nav.tab === 'simchas' || nav.tab === 'approvals' || nav.tab === 'members' || nav.tab === 'invite' || nav.tab === 'groups' || nav.tab === 'channels' || nav.tab === 'import' || nav.tab === 'pushTexts' || nav.tab === 'seatPrint' || nav.tab === 'seatEditor' || nav.tab === 'seatResponses' || nav.tab === 'seatHolders' || nav.tab === 'scheduleEditor' || nav.tab === 'adminTree' || (nav.tab === 'group' && nav.from === 'groups');
  const active: 'home' | 'messages' | 'me' | 'overview' | 'approvals' | 'members' = manage && adminTab ? (nav.tab === 'approvals' || nav.tab === 'members' ? nav.tab : nav.tab === 'adminTree' ? 'members' : 'overview') : nav.tab === 'me' || nav.tab === 'tree' || (nav.tab === 'phoneList' && nav.from === 'me') || (nav.tab === 'prefs' && nav.from === 'me') || (nav.tab === 'group' && nav.from === 'me') ? 'me'
    : nav.tab === 'home' || nav.tab === 'seats' || nav.tab === 'schedule' || (nav.tab === 'phoneList' && nav.from === 'home') || ((nav.tab === 'detail' || nav.tab === 'prefs') && nav.from === 'home') ? 'home' : 'messages';
  const tabs = manage ? [
    { key: 'overview' as const, label: t('admin.tabs.overview'), icon: 'grid' as const, badge: 0 },
    { key: 'approvals' as const, label: t('admin.tabs.approvals'), icon: 'check' as const, badge: pending },
    { key: 'messages' as const, label: t('admin.tabs.messages'), icon: 'msg' as const, badge: unread },
    { key: 'members' as const, label: t('admin.tabs.members'), icon: 'users' as const, badge: 0 },
  ] : feats.tabs.map(key => ({
    key,
    label: key === 'home' ? t('tabs.home') : key === 'messages' ? t('tabs.messages') : t('me.tab'),
    icon: (key === 'home' ? 'home' : key === 'messages' ? 'msg' : 'user') as 'home' | 'msg' | 'user',
    badge: key === 'messages' ? unread : 0,
  }));

  let body: React.ReactNode;
  switch (nav.tab) {
    case 'home':
      body = <Home onOpen={id => setNav({ tab: 'detail', id, from: 'home' })} onMessages={() => setNav({ tab: 'messages' })} onPhoneList={feats.phoneList ? () => setNav({ tab: 'phoneList', from: 'home' }) : undefined}
        onTerms={() => { setManage(true); setNav({ tab: 'overview' }); }} onToast={showToast} onSeats={feats.tabs.includes('home') && (kehila?.role === 'member' || kehila?.role === 'gabbai') ? () => setNav({ tab: 'seats' }) : undefined} onSchedule={() => setNav({ tab: 'schedule' })} />;
      break;
    case 'schedule':
      body = <Schedule onBack={() => setNav({ tab: 'home' })} onToast={showToast} />;
      break;
    case 'scheduleEditor':
      body = scheduleEditorAllowed(kehila?.role) ? <ScheduleEditor onBack={() => guard(() => setNav({ tab: 'overview' }))} onDirty={dirty => { editorDirty.current = dirty; }} onToast={showToast} /> : null;
      break;
    case 'seats':
      body = kehila?.role === 'member' || kehila?.role === 'gabbai' ? <SeatPage onBack={() => setNav({ tab: 'home' })} onToast={showToast} /> : null;
      break;
    case 'seatEditor':
      body = seatEditorAllowed(kehila?.role) ? <SeatEditor onBack={() => guard(() => setNav({ tab: 'overview' }))} onDirty={dirty => { editorDirty.current = dirty; }} onToast={showToast} /> : null;
      break;
    case 'seatResponses':
      body = seatEditorAllowed(kehila?.role) ? <SeatResponses onBack={() => setNav({ tab: 'overview' })} onEditor={() => setNav({ tab: 'seatEditor' })} onToast={showToast} /> : null;
      break;
    case 'seatHolders':
      body = seatEditorAllowed(kehila?.role) ? <SeatHolders onBack={() => setNav({ tab: 'overview' })} onToast={showToast} /> : null;
      break;
    case 'seatPrint':
      body = seatPrintRole(kehila?.role) ? <SeatPrint onBack={() => setNav({ tab: 'overview' })} onEditor={() => setNav({ tab: 'seatEditor' })} onToast={showToast} /> : null;
      break;
    case 'phoneList':
      body = feats.phoneList ? <PhoneList onBack={() => setNav({ tab: nav.from })} onMine={() => setNav({ tab: 'me' })} /> : null;
      break;
    case 'messages':
      body = <Messages initialFilter={filter} initialQuery={fixtureQuery} onOpen={id => setNav({ tab: 'detail', id, from: 'messages' })} onChat={channelId => setNav({ tab: 'chat', channelId })} onNew={feats.compose ? () => { setComposeInitial(undefined); setNav({ tab: 'compose' }); } : undefined} />;
      break;
    case 'detail':
      body = <MessageDetail key={nav.id} messageId={nav.id} onBack={() => setNav({ tab: nav.from })} />;
      break;
    case 'prefs':
      body = <NotifyPrefs onBack={() => setNav({ tab: nav.from })} onToast={showToast} />;
      break;
    case 'overview':
      body = <Overview onApprovals={() => setNav({ tab: 'approvals' })} onInvite={() => setNav({ tab: 'invite' })} onGroups={() => setNav({ tab: 'groups' })} onChannels={() => setNav({ tab: 'channels' })} onImport={() => setNav({ tab: 'import' })} onPushTexts={() => setNav({ tab: 'pushTexts' })} onSeatPrint={seatPrintRole(state.kehila?.role) ? () => setNav({ tab: 'seatPrint' }) : undefined} onSchedule={() => setNav({ tab: 'scheduleEditor' })} onSeatEditor={seatEditorAllowed(state.kehila?.role) ? () => setNav({ tab: 'seatEditor' }) : undefined} onSeatResponses={seatEditorAllowed(state.kehila?.role) ? () => setNav({ tab: 'seatResponses' }) : undefined} onSeatHolders={seatEditorAllowed(state.kehila?.role) ? () => setNav({ tab: 'seatHolders' }) : undefined} onSimchas={kehila?.role === 'gabbai' ? () => setNav({ tab: 'simchas' }) : undefined} onCount={setPending} onToast={showToast} />;
      break;
    case 'simchas':
      body = kehila?.role !== 'gabbai' ? <Me onToast={showToast} /> : <Simchas onBack={() => setNav({ tab: 'overview' })} onMazalTov={draft => { setComposeInitial({ type: 'celebration', ...draft }); setNav({ tab: 'compose' }); }} />;
      break;
    case 'approvals':
      body = <Approvals onCount={setPending} onToast={showToast} onHolders={seatEditorAllowed(state.kehila?.role) ? () => setNav({ tab: 'seatHolders' }) : undefined} />;
      break;
    case 'members':
      body = <Members onToast={showToast} onTree={(familyId, name) => setNav({ tab: 'adminTree', familyId, name })} />;
      break;
    case 'groups':
      body = <Groups onBack={() => setNav({ tab: 'overview' })} onOpen={g => setNav({ tab: 'group', groupId: g.groupId, name: g.name, from: 'groups' })} onToast={showToast} />;
      break;
    case 'channels':
      body = <Channels onBack={() => setNav({ tab: 'overview' })} onToast={showToast} />;
      break;
    case 'pushTexts':
      body = <PushTexts onBack={() => setNav({ tab: 'overview' })} onToast={showToast} />;
      break;
    case 'import':
      body = <Import onBack={() => setNav({ tab: 'overview' })} />;
      break;
    case 'group':
      body = <GroupAdmin key={nav.groupId} group={nav} onBack={() => setNav({ tab: nav.from })} onGone={() => { setManage(false); setNav({ tab: 'me' }); }} onToast={showToast} />;
      break;
    case 'invite':
      body = <InviteWithRole initialRole={nav.member ? 'member' : 'listener'} onBack={() => setNav({ tab: 'overview' })} onToast={showToast} />;
      break;
    case 'tree':
      body = <TreeRoute onBack={() => setNav({ tab: 'me' })} onOpenMe={() => setNav({ tab: 'me' })} />;
      break;
    case 'adminTree':
      // Gabbai only (the server enforces it too): anyone else gets the plain Me screen.
      body = kehila?.role !== 'gabbai' ? <Me onToast={showToast} /> : <TreeRoute key={nav.familyId} readOnly familyId={nav.familyId} familyName={nav.name} onBack={() => setNav({ tab: 'members' })} />;
      break;
    case 'me':
      body = <Me onTree={() => setNav({ tab: 'tree' })} onGroup={g => setNav({ tab: 'group', ...g, from: 'me' })} onManage={() => { setManage(true); setNav({ tab: 'overview' }); }} onPrefs={() => setNav({ tab: 'prefs', from: 'me' })} onPhoneList={feats.phoneList ? () => setNav({ tab: 'phoneList', from: 'me' }) : undefined} onToast={showToast} onLeft={() => setNav({ tab: 'home' })} />;
      break;
    case 'compose':
      body = !feats.compose ? <Home onOpen={id => setNav({ tab: 'detail', id, from: 'home' })} onMessages={() => setNav({ tab: 'messages' })} /> : <Compose initial={composeInitial} onBack={() => setNav({ tab: 'messages' })}
        onPublished={id => {
          setNav({ tab: 'detail', id, from: 'messages' });
          showToast(t('compose.published'));
        }} />;
      break;
    case 'chat':
      body = <ChatView channelId={nav.channelId} onBack={() => setNav({ tab: 'messages' })} />;
      break;
  }

  // The Kehila terms are not accepted yet: every management screen of this Kehila shows the gate; the rest of the app works.
  if (manage && adminTab && kehila?.cards.terms) body = <TermsGate onToast={showToast} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: k.stone }}>
      <View style={{ paddingHorizontal: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        <TopBar onOpenSwitcher={() => guard(onOpenSwitcher)} onBell={() => guard(() => setNav({ tab: 'prefs', from: active === 'home' || active === 'me' ? active : 'messages' }))} />
        {banner}
      </View>
      {manage ? (
        <View style={{ backgroundColor: k.band, paddingVertical: 8, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
            <Txt bold color="#FFFFFF">{t('admin.band')}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={t('admin.exit')} onPress={() => guard(() => { setManage(false); setNav({ tab: 'home' }); })} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
              <Txt size="small" bold color="#FFFFFF">{t('admin.exit')}</Txt>
            </Pressable>
          </View>
        </View>
      ) : null}
      <AdminContext.Provider value={{ onForbidden: leaveManage }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>{body}</KeyboardAvoidingView></AdminContext.Provider>
      <View style={{ borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.surface }}>
        <View style={{ flexDirection: 'row', width: '100%', maxWidth: 680, alignSelf: 'center' }}>
          {tabs.map(tab => {
            const on = active === tab.key;
            const c = on ? k.tekhelet : k.muted;
            return (
              <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={tab.badge ? `${tab.label} (${tab.badge})` : tab.label} onPress={() => guard(() => setNav({ tab: tab.key }))}
                style={{ flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                {on ? <View style={{ position: 'absolute', top: 0, width: 36, height: 3, backgroundColor: k.tekhelet, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 }} /> : null}
                <View>
                  <Icon name={tab.icon} size={24} color={c} />
                  {tab.badge ? <View style={{ position: 'absolute', top: -6, start: 12, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: k.pomegranate, alignItems: 'center', justifyContent: 'center' }}><Txt bold color="#FFFFFF" style={{ fontSize: 11, lineHeight: 16, textAlign: 'center' }}>{tab.badge}</Txt></View> : null}
                </View>
                <Txt size="caption" bold color={c} style={{ textAlign: 'center' }}>{tab.label}</Txt>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Sheet visible={leaveAsk !== null} title={t('editor.leaveTitle')} onClose={() => setLeaveAsk(null)} closeLabel={t('editor.leaveStay')}
        footer={<Button kind="danger" title={t('editor.leaveDiscard')} onPress={() => { const go = leaveAsk; setLeaveAsk(null); editorDirty.current = false; go?.(); }} />}>
        <Txt>{t('editor.leaveBody')}</Txt>
      </Sheet>
      <Toast text={toast ?? ''} visible={toast !== null} />
    </SafeAreaView>
  );
}
