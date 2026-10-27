import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { config } from '../config.ts';
import { FIXTURE_PICTURE, fixtureParams } from '../client/fixtures.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { unreadCount } from '../client/messageView.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Toast, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
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
  | { tab: 'prefs'; from: 'home' | 'messages' | 'me' };

/** Fixture mode only: ?screen=messages | messages-all | m3 | m3b | m3target | chat opens that screen. */
function fixtureNav(state: ReturnType<typeof useSession>['state']): { nav: Nav; filter?: Filter; compose?: ComposeInitial } | null {
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
  if (s === 'm5') return { nav: { tab: 'prefs', from: 'home' } };
  if (s === 'compose-target') return { nav: { tab: 'compose' }, compose: { type: 'celebration', targetId: '01FIXTUREUSER00000000002' } };
  if (s === 'compose-image') return { nav: { tab: 'compose' }, compose: { type: 'weekly', image: { uri: FIXTURE_PICTURE } } };
  return null;
}

/** The signed-in app for members and gabbaim: top bar, the open screen, and the bottom tabs. */
export function Main({ onOpenSwitcher, banner, pushSignal, takePush }: { onOpenSwitcher: () => void; banner?: React.ReactNode; /** Changes when a push is tapped; `takePush` then returns the target once (a remount gets null). */ pushSignal?: number; takePush?: () => { messageId?: string } | null }) {
  const { t } = useI18n();
  const k = useTokens();
  const { state } = useSession();
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
  // A tapped push opens the message, or Home when there is none (the approvals screens come later).
  React.useEffect(() => {
    const target = takePush?.();
    if (!target) return;
    setNav(target.messageId ? { tab: 'detail', id: target.messageId, from: 'messages' } : { tab: 'home' });
  }, [pushSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const jumped = React.useRef(false);
  const [searchQ, setSearchQ] = React.useState(() => (config.fixtures && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('q') ?? '' : ''));

  // Fixtures: jump to the requested screen once the messages have loaded.
  React.useEffect(() => {
    if (jumped.current || !state.feed.loaded) return;
    const j = fixtureNav(state);
    jumped.current = true;
    if (j) { setNav(j.nav); setFilter(j.filter); setComposeInitial(j.compose); }
  }, [state]);

  const kehila = state.kehila;
  const unread = kehila ? unreadCount(state.feed, kehila.notify, state.channels) : 0;
  const active: 'home' | 'messages' | 'me' = nav.tab === 'me' || (nav.tab === 'prefs' && nav.from === 'me') ? 'me'
    : nav.tab === 'home' || ((nav.tab === 'detail' || nav.tab === 'prefs') && nav.from === 'home') ? 'home' : 'messages';
  const tabs = [
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
    case 'me':
      body = <Me onPrefs={() => setNav({ tab: 'prefs', from: 'me' })} onToast={showToast} onLeft={() => setNav({ tab: 'home' })} />;
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
        <TopBar onOpenSwitcher={onOpenSwitcher} onBell={() => setNav({ tab: 'prefs', from: active })} />
        {banner}
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>{body}</KeyboardAvoidingView>
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
