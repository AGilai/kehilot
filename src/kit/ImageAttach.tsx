import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { pickImage } from '../media/device.ts';
import type { Picked } from '../media/device.ts';
import { Button, Sheet, Txt, useTokens } from './components.tsx';
import { TOUCH } from './theme.ts';

/** The attach button: opens a sheet with the gallery and (off web) the camera. A pick goes to `onPicked`. */
export function AttachButton({ onPicked, onDenied, disabled, label }: { onPicked: (p: Picked) => void; onDenied: () => void; disabled?: boolean; label?: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  const [open, setOpen] = React.useState(false);
  async function choose(source: 'gallery' | 'camera') {
    setOpen(false);
    try {
      const r = await pickImage(source);
      if (r === 'denied') onDenied();
      else if (r) onPicked(r);
    } catch { /* the picker failed to open: nothing was chosen */ }
  }
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('composer.attach')} disabled={disabled} onPress={() => setOpen(true)}
        style={{ minWidth: TOUCH, height: TOUCH, paddingHorizontal: label ? 14 : 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: k.line, backgroundColor: k.surface, opacity: disabled ? 0.5 : 1, flexDirection: 'row', gap: 6 }}>
        <Txt size="heading">📎</Txt>
        {label ? <Txt size="small" bold color={k.tekhelet}>{t('composer.attach')}</Txt> : null}
      </Pressable>
      <Sheet visible={open} title={t('composer.attachTitle')} onClose={() => setOpen(false)}>
        <Button kind="secondary" title={t('composer.gallery')} onPress={() => void choose('gallery')} />
        {Platform.OS !== 'web' ? <Button kind="secondary" title={t('composer.camera')} onPress={() => void choose('camera')} /> : null}
      </Sheet>
    </View>
  );
}

/** The chosen image with a remove button. It is a local file; nothing has been sent yet. */
export function AttachPreview({ image, onRemove, disabled }: { image: Picked; onRemove: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 96, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: k.line }}>
        <Image source={{ uri: image.uri }} contentFit="cover" accessibilityLabel={t('composer.preview')} style={{ width: '100%', height: '100%' }} />
      </View>
      <View style={{ flex: 1 }}>
        <Button kind="secondary" title={t('composer.remove')} onPress={onRemove} disabled={disabled} />
      </View>
    </View>
  );
}
