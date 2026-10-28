import React from 'react';
import { Pressable, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import type { LinkBanner, SpouseSlot } from '../../client/linking.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { ForwardIcon } from '../../kit/Icon.tsx';
import { PartnerPicker, useShortDate } from '../me/PartnerPicker.tsx';
import type { Linking } from './useLinking.ts';

/** Under the tree's title (P31): a request I received (confirm / decline), or mine that was not confirmed / expired (dismiss). */
export function LinkBannerView({ banner, linking, kehilaId, onToast }: { banner: LinkBanner; linking: Linking; kehilaId: string; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const k = useTokens();
  if (banner.kind === 'received') {
    return (
      <View testID="link-banner-received" style={{ gap: 8 }}>
        <Banner text={t('family.received', { name: banner.name })} />
        {linking.error ? <Banner tone="error" text={linking.error} /> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button title={t('family.confirm')} busy={linking.busy} onPress={() => void linking.run(() => api.confirmPartner(kehilaId, banner.fromUserId)).then(ok => { if (ok) onToast(t('family.linked')); })} /></View>
          <View style={{ flex: 1 }}><Button kind="secondary" title={t('family.decline')} disabled={linking.busy} onPress={() => void linking.run(() => api.declinePartner(kehilaId, banner.fromUserId))} /></View>
        </View>
        <Txt size="caption" color={k.muted}>{t('tree.link.bannerNote', { name: banner.name })}</Txt>
      </View>
    );
  }
  return (
    <View testID="link-banner-ended" style={{ gap: 8 }}>
      <Banner text={t(banner.kind === 'declined' ? 'family.notConfirmed' : 'family.expired', { name: banner.name })}
        action={{ title: t('family.dismiss'), onPress: () => void linking.run(() => api.withdrawPartnerRequest(kehilaId)) }} />
      {linking.error ? <Banner tone="error" text={linking.error} /> : null}
    </View>
  );
}

function Option({ title, sub, onPress, testID }: { title: string; sub: string; onPress: () => void; testID: string }) {
  const k = useTokens();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`} onPress={onPress}
      style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface }}>
      <View style={{ flex: 1, gap: 2 }}><Txt bold>{title}</Txt><Txt size="small" color={k.muted}>{sub}</Txt></View>
      <ForwardIcon color={k.tekhelet} />
    </Pressable>
  );
}

/**
 * The empty spouse place, tapped (P31): two ways in. "{partner} is a Kehila member" opens the member picker (P2) and sends a
 * request; "fill in details without an account" is the ordinary person sheet. With a request out it shows the P2 `sentBody` line
 * and "ביטול הבקשה".
 */
export function SpouseLinkSheet({ visible, gender, slot, kehilaId, kehilaName, linking, onManual, onClose, onToast }: {
  visible: boolean; gender: 'm' | 'f'; slot: SpouseSlot; kehilaId: string; kehilaName: string; linking: Linking; onManual: () => void; onClose: () => void; onToast: (text: string) => void;
}) {
  const { t } = useI18n();
  const { api } = useAuth();
  const shortDate = useShortDate();
  const [picking, setPicking] = React.useState(false);
  const role = t(gender === 'm' ? 'tree.role.spouseM' : 'tree.role.spouseF');
  if (slot.kind === 'pending') {
    return (
      <Sheet visible={visible} title={t('tree.link.pendingTitle', { name: slot.name })} onClose={onClose}>
        <View testID="spouse-pending-sheet" style={{ gap: 12 }}>
          <Txt>{t('family.sentBody', { name: slot.name, date: shortDate(slot.expiresAt) })}</Txt>
          {linking.error ? <Banner tone="error" text={linking.error} /> : null}
          <Button kind="secondary" title={t('family.withdraw')} busy={linking.busy} onPress={() => void linking.run(() => api.withdrawPartnerRequest(kehilaId)).then(ok => { if (ok) { onClose(); onToast(t('family.withdrawn')); } })} />
        </View>
      </Sheet>
    );
  }
  return (
    <>
      <Sheet visible={visible && !picking} title={t('tree.link.title', { role })} onClose={onClose}>
        <View testID="spouse-link-sheet" style={{ gap: 10 }}>
          <Option testID="spouse-member" title={t(gender === 'm' ? 'tree.link.memberM' : 'tree.link.memberF')} sub={t('tree.link.memberHint')} onPress={() => { linking.clearError(); setPicking(true); }} />
          <Option testID="spouse-manual" title={t('tree.link.manual')} sub={t('tree.link.manualHint')} onPress={onManual} />
        </View>
      </Sheet>
      <PartnerPicker visible={visible && picking} kehilaId={kehilaId} kehilaName={kehilaName} onClose={() => setPicking(false)}
        onSent={() => { setPicking(false); onClose(); onToast(t('family.pick.sent')); void linking.reload(); }} />
    </>
  );
}
