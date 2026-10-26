import React from 'react';
import { AppState, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { chatPrefRows, pushPermission, toggleId } from '../client/push.ts';
import type { MessageType, NotifyPrefs as Prefs } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Card, Toggle, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { useErrorText } from './auth/Frame.tsx';

const TYPES: Exclude<MessageType, 'chat'>[] = ['weekly', 'celebration', 'condolence', 'event'];

/**
 * M5: notification preferences. Every change is sent at once and shown at once; when the server refuses, the
 * store puts the old value back and a toast says so. Muting never changes what the lists show.
 */
export function NotifyPrefs({ onBack, onToast }: { onBack: () => void; onToast: (text: string) => void }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const { state, setNotify } = useSession();
  const { kehila, channels, feed } = state;
  const [perm, setPerm] = React.useState<'granted' | 'denied' | 'unsupported'>('granted');

  // The device permission is read on open and again when the app returns from the device settings.
  React.useEffect(() => {
    let live = true;
    const read = () => { void pushPermission().then(p => { if (live) setPerm(p); }, () => {}); };
    read();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') read(); });
    return () => { live = false; sub.remove(); };
  }, []);

  if (!kehila) return null;
  const n: Prefs = kehila.notify;

  function change(partial: Partial<Prefs>) {
    setNotify(partial).catch(e => onToast(errText(e)));
  }

  // Names of muted members come from the messages already loaded; the server keeps only the user ID.
  const names = new Map<string, string>();
  for (const id of feed.order) { const m = feed.messages[id]; if (m && m.authorKind === 'member') names.set(m.authorId, m.authorName); }

  const group = (title: string, children: React.ReactNode) => (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{title}</Txt>
      {children}
    </Card>
  );
  const listed = channels.filter(c => !c.conversation && c.inAudience);
  const chat = chatPrefRows(channels, n);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('prefs.back')} onPress={onBack} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <Txt bold color={k.tekhelet}>{dir === 'rtl' ? '›' : '‹'} {t('prefs.back')}</Txt>
      </Pressable>
      <Txt serif size="title" accessibilityRole="header">{t('prefs.title')}</Txt>
      <Banner text={t('prefs.banner')} />
      {perm === 'denied' ? <Banner tone="error" text={t('prefs.permOff')} action={{ title: t('prefs.openSettings'), onPress: () => { void Linking.openSettings(); } }} /> : null}

      {group(t('prefs.channels'), listed.length === 0 ? <Txt color={k.muted}>{t('prefs.noChannels')}</Txt> : listed.map(c => (
        <Toggle key={c.channelId} label={c.name} value={!n.mutedChannels.includes(c.channelId)} offNote={t('prefs.channelOff')}
          onChange={on => change({ mutedChannels: toggleId(n.mutedChannels, c.channelId, !on) })} />
      )))}

      {group(t('prefs.types'), TYPES.map(x => (
        <Toggle key={x} label={t(`compose.types.${x}`)} value={!n.mutedTypes.includes(x)} offNote={t('prefs.typeOff')}
          onChange={on => change({ mutedTypes: toggleId(n.mutedTypes, x, !on) })} />
      )))}

      {group(t('prefs.members'), (
        <>
          <Toggle label={t('prefs.membersLabel')} value={n.membersBroadcasts === 'all'} offNote={t('prefs.membersOff')}
            onChange={on => change({ membersBroadcasts: on ? 'all' : 'management_only' })} />
          <Txt bold size="small">{t('prefs.muted')}</Txt>
          {n.mutedMembers.length === 0 ? <Txt size="small" color={k.muted}>{t('prefs.mutedNone')}</Txt> : n.mutedMembers.map(id => {
            const name = names.get(id) ?? t('prefs.unknownMember');
            return (
              <View key={id} style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Txt style={{ flex: 1 }}>{name}</Txt>
                <Pressable accessibilityRole="button" accessibilityLabel={t('prefs.unmuteOf', { name })} onPress={() => change({ mutedMembers: toggleId(n.mutedMembers, id, false) })}
                  style={{ minHeight: TOUCH, justifyContent: 'center' }}>
                  <Txt bold color={k.tekhelet}>{t('prefs.unmute')}</Txt>
                </Pressable>
              </View>
            );
          })}
        </>
      ))}

      {group(t('prefs.chat'), chat.length === 0 ? <Txt color={k.muted}>{t('prefs.chatNone')}</Txt> : chat.map(r => (
        <Toggle key={r.channelId} label={r.name} value={r.on} offNote={t('prefs.chatOff')}
          onChange={on => change({ chatChannels: toggleId(n.chatChannels, r.channelId, on) })} />
      )))}

      <View style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Txt>🔒</Txt>
        <Txt style={{ flex: 1 }} color={k.muted}>{t('prefs.locked')}</Txt>
      </View>
    </ScrollView>
  );
}
