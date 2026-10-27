import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { config } from '../config.ts';
import { FIXTURE_PICTURE, fixtureParams } from '../client/fixtures.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { unreadCount } from '../client/messageView.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { pushDestination } from '../client/push.ts';
import { adminGuard, takeManageEntry } from '../client/membersView.ts';
import { firstWithPending } from '../client/channelsView.ts';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Toast, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { AdminContext } from './admin/shared.tsx';
import { Approvals } from './admin/Approvals.tsx';
import { Channels } from './admin/Channels.tsx';
import { GroupAdmin } from './admin/GroupAdmin.tsx';
import { Groups } from './admin/Groups.tsx';
import { InviteWithRole } from './admin/InviteWithRole.tsx';
import { Members } from './admin/Members.tsx';
import { Overview } from './admin/Overview.tsx';
import { Compose } from './Compose.tsx';
import type { ComposeInitial } from './Compose.tsx';
import { ChatView } from './ChatView.tsx';
import { Home } from './Home.tsx';
import { Me } from './Me.tsx';
import { NotifyPrefs } from './NotifyPrefs.tsx';
import { MessageDetail } from './MessageDetail.tsx';
import { Messages } from './Messages.tsx';
import { Search } from './Search.tsx';
import type { Filter } from './Messages.tsx';
import { TopBar } from './TopBar.tsx';

type Nav =
  | { tab: 'home' }
  | { tab: 'messages' }
  | { tab: 'search' }
  | { tab: 'detail'; id: string; from: 'home' | 'messages' | 'search' }
  | { tab: 'chat'; channelId: string }
  | { tab: 'compose' }
  | { tab: 'me' }
  | { tab: 'overview' }
  | { tab: 'approvals' }
  | { tab: 'members' }
  | { tab: 'invite'; member?: boolean }
  | { tab: 'groups' }
  | { tab: 'channels' }
  | { tab: 'group'; groupId: string; name: string; from: 'groups' | 'me' }
  | { tab: 'prefs'; from: 'home' | 'messages' | 'me' };

/** Fixture mode only: ?screen=messages | messages-all | m3 | m3b | m3target | chat | overview | approvals | members | invite-member | groups | channels | channel-sheet | group-admin opens that screen (the last four in management mode). */
function fixtureNav(state: ReturnType<typeof useSession>['state']): { nav: Nav; filter?: Filter; compose?: ComposeInitial; manage?: boolean } | null {
  if (!config.fixtures) return null;
  const s = fixtureParams().screen;
  const byType = (type: string) => state.feed.order.map(id => state.feed.messages[id]!).find(m => m.type === type && m.targetMemberId);
  if (s === 'messages') return { nav: { tab: 'messages' } };
  if (s === 'search' || s === 'search-loading') return { nav: { tab: 'search' } };
  if (s === 'messages-all') return { nav: { tab: 'messages' }, filter: 'all' };
  if (s === 'm3' || s === 'm3target') { const m = byType('celebration'); return m ? { nav: { tab: 'detail', id: m.messageId, from: 'messages' } } : null; }
  if (s === 'm3b') { const m = byType('condolence'); return m ? { nav: { tab: 'detail', id: m.messageId, from: 'messages' } } : null; }
  if (s === 'chat') { const c = state.channels.find(x => x.conversation); return c ? { nav: { tab: 'chat', channelId: c.channelId } } : null; }
  if (s === 'compose') return { nav: { tab: 'compose' } };
  if (s === 'me') return { nav: { tab: 'me' } };
  if (s === 'overview') return { nav: { tab: 'overview' }, manage: true };
  if (s === 'approvals') return { nav: { tab: 'approvals' }, manage: true };
  if (s === 'members') return { nav: { tab: 'members' }, manage: true };
  if (s === 'invite-member') return { nav: { tab: 'invite', member: true }, manage: true };
  if (s === 'groups') return { nav: { tab: 'groups' }, manage: true };
  if (s === 'channels' || s === 'channel-sheet') return { nav: { tab: 'channels' }, manage: true };
  if (s === 'group-admin') return { nav: { tab: 'group', groupId: '01FIXTUREGROUP00000000001', name: 'נוער', from: 'groups' }, manage: true };
  if (s === 'm5') return { nav: { tab: 'prefs', from: 'home' } };
  if (s === 'compose-target') return { nav: { tab: 'compose' }, compose: { type: 'celebration', targetId: '01FIXTUREUSER00000000002' } };
  if (s === 'compose-image') return { nav: { tab: 'compose' }, compose: { type: 'weekly', image: { uri: FIXTURE_PICTURE } } };
  return null;
}

/** The signed-in app for members and gabbaim: top bar, the open screen, and the bottom tabs. */
export function Main({ onOpenSwitcher, banner, pushSignal, takePush, manageSignal, takeManage }: { onOpenSwitcher: () => void; banner?: React.ReactNode; /** Changes when a push is tapped; `takePush` then returns the target once (a remount gets null). */ pushSignal?: number; takePush?: () => { messageId?: string; screen?: string } | null; /** Changes when the switcher asks for management mode. */ manageSignal?: number; /** Returns the pending request once. */ takeManage?: () => number | null }) {
  const { t } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const { api } = useAuth();
  const [manage, setManage] = React.useState(false);
  const [pending, setPending] = React.useState(0);
  const [nav, setNav] = React.useState<Nav>({ tab: 'home' });
  const [filter, setFilter] = React.useState<Filter | undefined>(undefined);
  const [composeInitial, setComposeInitial] = React.useState<ComposeInitial | undefined>(undefined);
  const [toast, setToast] = React.useState<string | null>(null);
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
    const dest = pushDestination(target, state.kehila?.role);
    if (dest === 'approvals') { setManage(true); setNav({ tab: 'approvals' }); }
    else if (dest === 'group_requests') {
      if (state.kehila?.role === 'gabbai') { setManage(true); setNav({ tab: 'groups' }); }
      else openGroupRequests();
    }
    else setNav(dest === 'message' && target.messageId ? { tab: 'detail', id: target.messageId, from: 'messages' } : { tab: 'home' });
  }, [pushSignal]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const [searchQ, setSearchQ] = React.useState(() => (config.fixtures && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('q') ?? '' : ''));

  // Fixtures: jump to the requested screen once the messages have loaded.
  React.useEffect(() => {
    if (jumped.current || !state.feed.loaded) return;
    const j = fixtureNav(state);
    jumped.current = true;
    if (j?.manage) setManage(true);
    if (j) { setNav(j.nav); setFilter(j.filter); setComposeInitial(j.compose); }
  }, [state]);

  const kehila = state.kehila;
  const unread = kehila ? unreadCount(state.feed, kehila.notify, state.channels) : 0;
  const adminTab = nav.tab === 'overview' || nav.tab === 'approvals' || nav.tab === 'members' || nav.tab === 'invite' || nav.tab === 'groups' || nav.tab === 'channels' || (nav.tab === 'group' && nav.from === 'groups');
  const active: 'home' | 'messages' | 'me' | 'overview' | 'approvals' | 'members' = manage && adminTab ? (nav.tab === 'approvals' || nav.tab === 'members' ? nav.tab : 'overview') : nav.tab === 'me' || (nav.tab === 'prefs' && nav.from === 'me') || (nav.tab === 'group' && nav.from === 'me') ? 'me'
    : nav.tab === 'home' || ((nav.tab === 'detail' || nav.tab === 'prefs') && nav.from === 'home') ? 'home' : 'messages';
  const tabs = manage ? [
    { key: 'overview' as const, label: t('admin.tabs.overview'), icon: '▦', badge: 0 },
    { key: 'approvals' as const, label: t('admin.tabs.approvals'), icon: '✓', badge: pending },
    { key: 'messages' as const, label: t('admin.tabs.messages'), icon: '✉', badge: unread },
    { key: 'members' as const, label: t('admin.tabs.members'), icon: '☷', badge: 0 },
  ] : [
    { key: 'home' as const, label: t('tabs.home'), icon: '⌂', badge: 0 },
    { key: 'messages' as const, label: t('tabs.messages'), icon: '✉', badge: unread },
    { key: 'me' as const, label: t('me.tab'), icon: '☺', badge: 0 },
  ];

  let body: React.ReactNode;
  switch (nav.tab) {
    case 'home':
      body = <Home onOpen={id => setNav({ tab: 'detail', id, from: 'home' })} onMessages={() => setNav({ tab: 'messages' })} />;
      break;
    case 'messages':
      body = <Messages initialFilter={filter} onSearch={() => setNav({ tab: 'search' })} onOpen={id => setNav({ tab: 'detail', id, from: 'messages' })} onChat={channelId => setNav({ tab: 'chat', channelId })} onNew={() => { setComposeInitial(undefined); setNav({ tab: 'compose' }); }} />;
      break;
    case 'search':
      body = <Search initialQuery={searchQ} onQuery={setSearchQ} onBack={() => setNav({ tab: 'messages' })} onOpen={id => setNav({ tab: 'detail', id, from: 'search' })} />;
      break;
    case 'detail':
      body = <MessageDetail key={nav.id} messageId={nav.id} onBack={() => setNav({ tab: nav.from })} />;
      break;
    case 'prefs':
      body = <NotifyPrefs onBack={() => setNav({ tab: nav.from })} onToast={showToast} />;
      break;
    case 'overview':
      body = <Overview onApprovals={() => setNav({ tab: 'approvals' })} onInvite={() => setNav({ tab: 'invite' })} onGroups={() => setNav({ tab: 'groups' })} onChannels={() => setNav({ tab: 'channels' })} onCount={setPending} onToast={showToast} />;
      break;
    case 'approvals':
      body = <Approvals onCount={setPending} onToast={showToast} />;
      break;
    case 'members':
      body = <Members onToast={showToast} />;
      break;
    case 'groups':
      body = <Groups onBack={() => setNav({ tab: 'overview' })} onOpen={g => setNav({ tab: 'group', groupId: g.groupId, name: g.name, from: 'groups' })} onToast={showToast} />;
      break;
    case 'channels':
      body = <Channels onBack={() => setNav({ tab: 'overview' })} onToast={showToast} />;
      break;
    case 'group':
      body = <GroupAdmin key={nav.groupId} group={nav} onBack={() => setNav({ tab: nav.from })} onGone={() => { setManage(false); setNav({ tab: 'me' }); }} onToast={showToast} />;
      break;
    case 'invite':
      body = <InviteWithRole initialRole={nav.member ? 'member' : 'listener'} onBack={() => setNav({ tab: 'overview' })} onToast={showToast} />;
      break;
    case 'me':
      body = <Me onGroup={g => setNav({ tab: 'group', ...g, from: 'me' })} onManage={() => { setManage(true); setNav({ tab: 'overview' }); }} onPrefs={() => setNav({ tab: 'prefs', from: 'me' })} onToast={showToast} onLeft={() => setNav({ tab: 'home' })} />;
      break;
    case 'compose':
      body = <Compose initial={composeInitial} onBack={() => setNav({ tab: 'messages' })}
        onPublished={id => {
          setNav({ tab: 'detail', id, from: 'messages' });
          showToast(t('compose.published'));
        }} />;
      break;
    case 'chat':
      body = <ChatView channelId={nav.channelId} onBack={() => setNav({ tab: 'messages' })} />;
      break;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: k.stone }}>
      <View style={{ paddingHorizontal: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        <TopBar onOpenSwitcher={onOpenSwitcher} onBell={() => setNav({ tab: 'prefs', from: active === 'home' || active === 'me' ? active : 'messages' })} />
        {banner}
      </View>
      {manage ? (
        <View style={{ backgroundColor: k.band, paddingVertical: 8, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
            <Txt bold color="#FFFFFF">{t('admin.band')}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={t('admin.exit')} onPress={() => { setManage(false); setNav({ tab: 'home' }); }} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
              <Txt size="small" bold color="#FFFFFF">{t('admin.exit')}</Txt>
            </Pressable>
          </View>
        </View>
      ) : null}
      <AdminContext.Provider value={{ onForbidden: leaveManage }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>{body}</KeyboardAvoidingView></AdminContext.Provider>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.surface }}>
        {tabs.map(tab => (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: active === tab.key }}
            accessibilityLabel={tab.badge ? `${tab.label} (${tab.badge})` : tab.label} onPress={() => setNav({ tab: tab.key })}
            style={{ flex: 1, minHeight: TOUCH + 8, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt size="heading" color={active === tab.key ? k.tekhelet : k.muted}>{tab.icon}</Txt>
              <Txt size="small" bold color={active === tab.key ? k.tekhelet : k.muted}>{tab.label}</Txt>
              {tab.badge ? <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: k.pomegranate, alignItems: 'center', justifyContent: 'center' }}><Txt size="caption" bold color="#FFFFFF" style={{ textAlign: 'center', lineHeight: 18 }}>{tab.badge}</Txt></View> : null}
            </View>
          </Pressable>
        ))}
      </View>
      <Toast text={toast ?? ''} visible={toast !== null} />
    </SafeAreaView>
  );
}
