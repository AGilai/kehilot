import React from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { ImageViewer } from '../views/ImageViewer.tsx';
import { Txt, useTokens } from './components.tsx';

/**
 * Thumbnail of a message image. The presigned URL is requested when the row mounts (lists are windowed, so
 * that is when it is near the screen), held in memory only, and the disk cache is keyed by message, not URL.
 * A tap opens the full-screen viewer (and calls `onPress`, if given).
 */
export function ImageThumb({ messageId, onPress }: { messageId: string; onPress?: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const { imageUrl, state } = useSession();
  const kehilaId = state.kehilaId ?? '';
  const [url, setUrl] = React.useState<string | null | undefined>(undefined);
  const [attempt, setAttempt] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    imageUrl(messageId, attempt > 0).then(u => { if (live) setUrl(u); }, () => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [messageId, imageUrl, attempt]);
  const box = { width: '100%', maxWidth: 360, aspectRatio: 1.6, borderRadius: 10, overflow: 'hidden', backgroundColor: k.line } as const;
  if (url === undefined) return <View accessibilityLabel={t('common.loading')} style={box} />;
  if (url === null) {
    return <View style={[box, { alignItems: 'center', justifyContent: 'center', padding: 8 }]}><Txt size="caption" color={k.muted}>{t('messages.imageLoadError')}</Txt></View>;
  }
  return (
    <>
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('messages.imageAlt')} onPress={() => { onPress?.(); setOpen(true); }} style={box}>
      <Image source={{ uri: url, cacheKey: `${kehilaId}:${messageId}` }} cachePolicy="disk" contentFit="cover"
        accessibilityLabel={t('messages.imageAlt')}
        onError={() => { if (attempt < 1) setAttempt(a => a + 1); else setUrl(null); }}
        style={{ width: '100%', height: '100%' }} />
    </Pressable>
    {open ? <ImageViewer messageId={messageId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
