import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { AREA_IDS } from '../../client/adminAreas.ts';
import type { AreaId } from '../../client/adminAreas.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import type { IconName } from '../../kit/Icon.tsx';
import { CountBadge } from '../../kit/NavRows.tsx';
import { AREA_ICON } from './Overview.tsx';

export type SidebarKey = 'overview' | 'approvals' | 'messages' | 'members' | AreaId;

function Item({ icon, label, badge, selected, onPress }: { icon: IconName; label: string; badge?: number; selected: boolean; onPress: () => void }) {
  const k = useTokens();
  const c = selected ? k.tekhelet : k.ink;
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={badge ? `${label} (${badge})` : label} onPress={onPress}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: selected ? k.surface : undefined, borderWidth: selected ? 1 : 0, borderColor: k.line }}>
      <Icon name={icon} size={24} color={selected ? k.tekhelet : k.muted} />
      <Txt bold={selected} color={c} style={{ flex: 1 }}>{label}</Txt>
      {badge ? <CountBadge n={badge} /> : null}
    </Pressable>
  );
}

/** §18.3 wide (>= 1024): the tab row becomes a 272 start-side sidebar: the four tabs, a divider, the six groups, and the exit. */
export function AdminSidebar({ active, pending, unread, onTab, onArea, onExit }: { active: SidebarKey | null; pending: number; unread: number; onTab: (key: 'overview' | 'approvals' | 'messages' | 'members') => void; onArea: (id: AreaId) => void; onExit: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <ScrollView accessibilityLabel={t('admin.sidebar.label')} style={{ width: 272, flexGrow: 0, borderEndWidth: 1, borderEndColor: k.line, backgroundColor: k.stone }} contentContainerStyle={{ padding: 12, gap: 4 }}>
      <Item icon="grid" label={t('admin.tabs.overview')} selected={active === 'overview'} onPress={() => onTab('overview')} />
      <Item icon="check" label={t('admin.tabs.approvals')} badge={pending} selected={active === 'approvals'} onPress={() => onTab('approvals')} />
      <Item icon="msg" label={t('admin.tabs.messages')} badge={unread} selected={active === 'messages'} onPress={() => onTab('messages')} />
      <Item icon="users" label={t('admin.tabs.members')} selected={active === 'members'} onPress={() => onTab('members')} />
      <View style={{ height: 1, backgroundColor: k.line, marginVertical: 8 }} />
      <Txt size="small" bold color={k.muted} accessibilityRole="header" style={{ marginHorizontal: 12, marginBottom: 4 }}>{t('admin.area.label')}</Txt>
      {AREA_IDS.map(id => <Item key={id} icon={AREA_ICON[id]} label={t(`admin.area.${id}`)} selected={active === id} onPress={() => onArea(id)} />)}
      <View style={{ height: 1, backgroundColor: k.line, marginVertical: 8 }} />
      <Item icon="out" label={t('admin.exit')} selected={false} onPress={onExit} />
    </ScrollView>
  );
}
