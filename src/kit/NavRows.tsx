import React from 'react';
import { Pressable, View } from 'react-native';
import { Txt, useTokens } from './components.tsx';
import { ForwardIcon, Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

/** §18.5 ListGroup: an optional muted label above one Card (padding 0, radius 12) of rows separated by 1 px lines. */
export function ListGroup({ label, children, style }: { label?: string; children: React.ReactNode; style?: React.ComponentProps<typeof View>['style'] }) {
  const k = useTokens();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ gap: 8 }, style]}>
      {label ? <Txt size="small" bold color={k.muted} accessibilityRole="header" style={{ marginHorizontal: 4 }}>{label}</Txt> : null}
      <View style={{ backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, overflow: 'hidden' }}>
        {rows.map((r, i) => <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: k.line } : undefined}>{r}</View>)}
      </View>
    </View>
  );
}

/** A count badge (pomegranate pill), as on the tabs. */
export function CountBadge({ n }: { n: number }) {
  const k = useTokens();
  return <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: k.pomegranate, alignItems: 'center', justifyContent: 'center' }}><Txt bold color="#FFFFFF" style={{ fontSize: 12.5, lineHeight: 18, textAlign: 'center' }}>{n}</Txt></View>;
}

/**
 * §18.5 NavRow: min height 56 (72 `big`), icon 24 tekhelet, title bold, one status line, tone `warn` (gold dot) or
 * `attention` (pomegranate), an optional end value or custom end, and the forward arrow. `action`: 52 high, no arrow.
 * `band`: the Kehila menu's manage row (white on the band colour).
 */
export function NavRow({ title, status, icon, lead, tone, big, action, danger, band, badge, value, end, onPress, testID, label }: {
  title: string; status?: string; icon?: IconName; /** Replaces the icon (the logo tile). */ lead?: React.ReactNode; tone?: 'warn' | 'attention'; big?: boolean; action?: boolean; danger?: boolean; band?: boolean;
  badge?: number; value?: string; end?: React.ReactNode; onPress?: () => void; testID?: string; label?: string;
}) {
  const k = useTokens();
  const color = danger ? k.danger : band ? '#FFFFFF' : k.ink;
  const statusColor = band ? '#FFFFFF' : tone === 'warn' ? k.gold : tone === 'attention' ? k.pomegranate : k.muted;
  const inner = (
    <>
      {lead ?? (icon ? <Icon name={icon} size={24} color={danger ? k.danger : band ? '#FFFFFF' : k.tekhelet} /> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt bold={!action} color={color} style={action ? { fontWeight: '500' } : undefined}>{title}</Txt>
        {status ? <Txt size="small" bold={!!tone} color={statusColor} numberOfLines={1}>{status}</Txt> : null}
      </View>
      {tone && !badge ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor }} /> : null}
      {badge ? <CountBadge n={badge} /> : null}
      {value ? <Txt size="small" bold color={k.muted}>{value}</Txt> : null}
      {end}
      {onPress && !action ? <ForwardIcon color={band ? '#FFFFFF' : k.muted} /> : null}
    </>
  );
  const style = { minHeight: action ? 52 : big ? 72 : 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: band ? k.band : undefined } as const;
  if (!onPress) return <View testID={testID} accessible accessibilityLabel={label ?? (status ? `${title}. ${status}` : title)} style={style}>{inner}</View>;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label ?? (status ? `${title}. ${status}` : title)} onPress={onPress} style={style}>{inner}</Pressable>;
}
