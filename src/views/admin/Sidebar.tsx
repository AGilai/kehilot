import React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AREA_IDS } from '../../client/adminAreas.ts';
import type { AreaId } from '../../client/adminAreas.ts';
import { loadSidebarCollapsed, saveSidebarCollapsed, sidebarWidth } from '../../client/sidebarPref.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { BackIcon, ForwardIcon, Icon } from '../../kit/Icon.tsx';
import type { IconName } from '../../kit/Icon.tsx';
import { CountBadge } from '../../kit/NavRows.tsx';
import { AREA_ICON } from './Overview.tsx';

export type SidebarKey = 'overview' | 'approvals' | 'messages' | 'members' | AreaId;

/** Web hover tooltip: react-native-web drops `title`, so it is set on the DOM node through the ref. */
function hoverTitle(text: string | null) {
  if (Platform.OS !== 'web') return {};
  return { ref: (node: unknown) => {
    const el = node as { setAttribute?: (k: string, v: string) => void; removeAttribute?: (k: string) => void } | null;
    if (!el?.setAttribute) return;
    if (text) el.setAttribute('title', text); else el.removeAttribute?.('title');
  } };
}

function Item({ icon, label, badge, selected, collapsed, onPress }: { icon: IconName; label: string; badge?: number; selected: boolean; collapsed?: boolean; onPress: () => void }) {
  const k = useTokens();
  const c = selected ? k.tekhelet : k.ink;
  // Collapsed: icon only, the name is the accessibility label and (web) the hover tooltip; the badge stays on the icon.
  const tip = hoverTitle(collapsed ? label : null);
  return (
    <Pressable {...tip} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={badge ? `${label} (${badge})` : label} onPress={onPress}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: collapsed ? 'center' : undefined, gap: 12, paddingHorizontal: collapsed ? 0 : 12, borderRadius: 10, backgroundColor: selected ? k.surface : undefined, borderWidth: selected ? 1 : 0, borderColor: k.line }}>
      <View>
        <Icon name={icon} size={24} color={selected ? k.tekhelet : k.muted} />
        {collapsed && badge ? <View style={{ position: 'absolute', top: -10, end: -17 }}><CountBadge n={badge} /></View> : null}
      </View>
      {collapsed ? null : <Txt bold={selected} color={c} style={{ flex: 1 }}>{label}</Txt>}
      {!collapsed && badge ? <CountBadge n={badge} /> : null}
    </Pressable>
  );
}

/** §18.3 wide (>= 1024): the tab row becomes a 272 start-side sidebar: the four tabs, a divider, the six groups, and the exit. */
export function AdminSidebar({ active, pending, unread, sheetPending, onTab, onArea, onExit }: { active: SidebarKey | null; pending: number; unread: number; /** Sheet items waiting for approval: the badge of the prayers group, whose sheet row they belong to. */ sheetPending: number; onTab: (key: 'overview' | 'approvals' | 'messages' | 'members') => void; onArea: (id: AreaId) => void; onExit: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    void loadSidebarCollapsed({ get: key => AsyncStorage.getItem(key), set: (key, v) => AsyncStorage.setItem(key, v) }).then(v => { if (live) setCollapsed(v); });
    return () => { live = false; };
  }, []);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    void saveSidebarCollapsed({ get: key => AsyncStorage.getItem(key), set: (key, v) => AsyncStorage.setItem(key, v) }, next);
  }
  const toggleLabel = t(collapsed ? 'admin.sidebar.expand' : 'admin.sidebar.collapse');
  const Chevron = collapsed ? ForwardIcon : BackIcon;
  return (
    <ScrollView accessibilityLabel={t('admin.sidebar.label')} style={{ width: sidebarWidth(collapsed), flexGrow: 0, borderEndWidth: 1, borderEndColor: k.line, backgroundColor: k.stone }} contentContainerStyle={{ padding: collapsed ? 8 : 12, gap: 4 }}>
      <Pressable {...hoverTitle(collapsed ? toggleLabel : null)} accessibilityRole="button" accessibilityLabel={toggleLabel} accessibilityState={{ expanded: !collapsed }} onPress={toggle}
        style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: collapsed ? 'center' : undefined, gap: 12, paddingHorizontal: collapsed ? 0 : 12 }}>
        <Chevron size={24} color={k.muted} />
        {collapsed ? null : <Txt color={k.muted} style={{ flex: 1 }}>{toggleLabel}</Txt>}
      </Pressable>
      <Item collapsed={collapsed} icon="grid" label={t('admin.tabs.overview')} selected={active === 'overview'} onPress={() => onTab('overview')} />
      <Item collapsed={collapsed} icon="check" label={t('admin.tabs.approvals')} badge={pending} selected={active === 'approvals'} onPress={() => onTab('approvals')} />
      <Item collapsed={collapsed} icon="msg" label={t('admin.tabs.messages')} badge={unread} selected={active === 'messages'} onPress={() => onTab('messages')} />
      <Item collapsed={collapsed} icon="users" label={t('admin.tabs.members')} selected={active === 'members'} onPress={() => onTab('members')} />
      <View style={{ height: 1, backgroundColor: k.line, marginVertical: 8 }} />
      {collapsed ? null : <Txt size="small" bold color={k.muted} accessibilityRole="header" style={{ marginHorizontal: 12, marginBottom: 4 }}>{t('admin.area.label')}</Txt>}
      {AREA_IDS.map(id => <Item key={id} collapsed={collapsed} icon={AREA_ICON[id]} label={t(`admin.area.${id}`)} badge={id === 'prayers' ? sheetPending : undefined} selected={active === id} onPress={() => onArea(id)} />)}
      <View style={{ height: 1, backgroundColor: k.line, marginVertical: 8 }} />
      <Item collapsed={collapsed} icon="out" label={t('admin.exit')} selected={false} onPress={onExit} />
    </ScrollView>
  );
}
