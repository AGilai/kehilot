import React from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import type { MessageType } from '../client/types.ts';
import { rowDisabled, showLabel } from '../client/msgFilter.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Card, SelectButton, Sheet, Toggle, Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { TOUCH } from '../kit/theme.ts';

export type TypeRowData = { type: MessageType; label: string; count: number; color: string };

type Props = {
  /** Control texts. */
  label: string; summary?: string; badge: number; a11y: string;
  rows: TypeRowData[]; total: number; selected: readonly MessageType[];
  onToggle: (x: MessageType) => void; onAll: () => void;
  /** Number of messages the current filter shows (the footer). */
  shown: number;
  showMuted: boolean; onShowMuted: (on: boolean) => void; mutedN: number; mutedAny: boolean;
  /** Set while the archive is still loading: "{n} messages so far". */
  loadingN: number | null;
  wide: boolean;
};

function CheckRow({ label, count, checked, disabled, dot, first, a11y, onPress, refFirst }: { label: string; count: number; checked: boolean; disabled: boolean; dot?: string; first?: boolean; a11y: string; onPress: () => void; refFirst?: React.Ref<View> }) {
  const k = useTokens();
  const { dir } = useI18n();
  return (
    <Pressable ref={refFirst} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} accessibilityLabel={a11y} disabled={disabled} onPress={onPress}
      style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: first ? 0 : 1, borderTopColor: k.line, opacity: disabled ? 0.6 : 1 }}>
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: checked ? k.tekhelet : k.muted, backgroundColor: checked ? k.tekhelet : k.surface, alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <Icon name="check" size={16} color={k.onAction} /> : null}
      </View>
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <Txt bold={checked} style={{ flex: 1 }}>{label}</Txt>
      <Txt size="small" bold color={k.muted} style={{ minWidth: 28, textAlign: dir === 'rtl' ? 'left' : 'right', fontVariant: ['tabular-nums'] }}>{count}</Txt>
    </Pressable>
  );
}

function List({ p, showHint, firstRef }: { p: Props; showHint: boolean; firstRef?: React.Ref<View> }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <>
      {showHint ? <Txt size="small" color={k.muted}>{t('messages.type.hint')}</Txt> : null}
      <Card style={{ paddingVertical: 0, paddingHorizontal: 16, gap: 0 }}>
        <View role="group" accessibilityLabel={t('messages.type.control')}>
          <CheckRow first refFirst={firstRef} label={t('messages.type.allRow')} count={p.total} checked={p.selected.length === 0} disabled={false}
            a11y={t('messages.type.rowA11y', { type: t('messages.type.allRow'), n: p.total })} onPress={p.onAll} />
          {p.rows.map(r => {
            const on = p.selected.includes(r.type);
            return <CheckRow key={r.type} label={r.label} count={r.count} checked={on} disabled={rowDisabled(r.count, on)} dot={r.color}
              a11y={t('messages.type.rowA11y', { type: r.label, n: r.count })} onPress={() => p.onToggle(r.type)} />;
          })}
        </View>
      </Card>
      {p.loadingN !== null ? <Txt size="small" color={k.muted} accessibilityRole="alert">{t('messages.archiveLoading', { n: p.loadingN })}</Txt> : null}
      {p.mutedAny ? (
        <View style={{ borderTopWidth: 1, borderTopColor: k.line, paddingTop: 4, gap: 2 }}>
          <Toggle label={t('messages.mutedToggle')} value={p.showMuted} onChange={p.onShowMuted} />
          <Txt size="caption" color={k.muted}>{t('messages.mutedNote', { n: p.mutedN })}</Txt>
        </View>
      ) : null}
    </>
  );
}

/** The "סוג הודעה" control and its list: a Sheet on phones, a popover under the control on wide web (UX §12.8). */
export function TypeFilter(p: Props) {
  const { t, dir } = useI18n();
  const k = useTokens();
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState({ x: 0, y: 0, w: 0, h: 0 });
  const wrap = React.useRef<View>(null);
  const first = React.useRef<View>(null);
  const close = React.useCallback(() => {
    setOpen(false);
    if (Platform.OS === 'web') (wrap.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>('[role="button"]')?.focus();
  }, []);
  const popover = p.wide && Platform.OS === 'web';
  React.useEffect(() => {
    if (!open || !popover) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const timer = setTimeout(() => (first.current as unknown as HTMLElement | null)?.focus?.(), 0);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [open, popover, close]);

  const control = <SelectButton label={p.label} summary={p.summary} count={p.badge} active={p.badge > 0} open={open} onPress={() => { if (open) { close(); return; } wrap.current?.measureInWindow((x, y, w, h) => { setAnchor({ x, y, w, h }); setOpen(true); }); if (!popover) setOpen(true); }}
    accessibilityLabel={p.a11y} accessibilityHint={t('messages.type.a11yHint')} />;
  const closeLabel = showLabel(p.shown) === 'common.close' ? undefined : t(showLabel(p.shown), { n: p.shown });
  return (
    <View ref={wrap}>
      {control}
      {popover ? (
        // A Modal is the one way to sit above the list's own cells on web; it is placed from the control's position.
        <Modal visible={open} transparent animationType="none" onRequestClose={close}>
          <Pressable accessibilityLabel={t('common.close')} onPress={close} style={{ flex: 1, direction: dir }}>
            <Pressable role="dialog" accessibilityLabel={t('messages.type.control')} onPress={() => {}}
              style={{ position: 'absolute', top: anchor.y + anchor.h + 4, left: Math.max(8, dir === 'rtl' ? anchor.x : anchor.x + anchor.w - 340), width: 340, padding: 12, gap: 12, borderRadius: 12, backgroundColor: k.stone, borderWidth: 1, borderColor: k.line, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}>
              <List p={p} showHint={false} firstRef={first} />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
      {!popover ? (
        <Sheet visible={open} title={t('messages.type.control')} onClose={close} closeLabel={closeLabel}>
          <List p={p} showHint />
        </Sheet>
      ) : null}
    </View>
  );
}
