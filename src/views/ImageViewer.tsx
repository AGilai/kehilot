import React from 'react';
import { ActivityIndicator, Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Txt } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { canShareImage, printImage, saveToPhone, shareImage } from '../media/saveShare.ts';
import { clampPan, clampScale, doubleTapScale, shouldDismiss } from '../media/viewerMath.ts';

type Action = 'save' | 'share' | 'print';

/**
 * Full-screen brochure viewer: pinch, pan, double-tap, swipe down to close; close, save, share and print.
 * The presigned URL is requested from `imageUrl` (in-memory reuse) and renewed once if the load fails
 * (an expired URL answers 403, which expo-image reports only as an error).
 */
export function ImageViewer({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const { t, dir } = useI18n();
  const { imageUrl, state } = useSession();
  const kehilaId = state.kehilaId ?? '';
  const [url, setUrl] = React.useState<string | null | undefined>(undefined);
  const [attempt, setAttempt] = React.useState(0);
  const [box, setBox] = React.useState({ width: 0, height: 0 });
  const [natural, setNatural] = React.useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = React.useState<Action | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const showShare = React.useMemo(() => canShareImage(), []);

  React.useEffect(() => {
    let live = true;
    imageUrl(messageId, attempt > 0).then(u => { if (live) setUrl(u); }, () => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [messageId, imageUrl, attempt]);

  // Display size at scale 1 (contain-fitted into the box).
  const fitted = React.useMemo(() => {
    if (!natural || !box.width || !box.height) return box;
    const r = Math.min(box.width / natural.width, box.height / natural.height);
    return { width: natural.width * r, height: natural.height * r };
  }, [natural, box]);

  const scale = React.useRef(new Animated.Value(1)).current;
  const tx = React.useRef(new Animated.Value(0)).current;
  const ty = React.useRef(new Animated.Value(0)).current;
  const fade = React.useRef(new Animated.Value(1)).current;
  const cur = React.useRef({ s: 1, x: 0, y: 0 });
  const start = React.useRef({ s: 1, x: 0, y: 0 });
  const fittedRef = React.useRef(fitted); fittedRef.current = fitted;
  const boxRef = React.useRef(box); boxRef.current = box;

  const apply = (s: number, x: number, y: number) => {
    cur.current = { s, x, y };
    scale.setValue(s); tx.setValue(x); ty.setValue(y);
  };
  const settle = (s: number, x: number, y: number) => {
    cur.current = { s, x, y };
    Animated.parallel([scale, tx, ty].map((v, i) => Animated.spring(v, { toValue: [s, x, y][i]!, useNativeDriver: true, bounciness: 0 }))).start();
  };

  const pinch = Gesture.Pinch().runOnJS(true)
    .onStart(() => { start.current = { ...cur.current }; })
    .onUpdate(e => {
      const s = clampScale(start.current.s * e.scale);
      const p = clampPan({ x: cur.current.x, y: cur.current.y }, s, boxRef.current, fittedRef.current);
      apply(s, p.x, p.y);
    })
    .onEnd(() => {
      const p = clampPan({ x: cur.current.x, y: cur.current.y }, cur.current.s, boxRef.current, fittedRef.current);
      settle(cur.current.s, p.x, p.y);
    });

  const pan = Gesture.Pan().runOnJS(true).maxPointers(2)
    .onStart(() => { start.current = { ...cur.current }; })
    .onUpdate(e => {
      if (cur.current.s > 1.01) {
        const p = clampPan({ x: start.current.x + e.translationX, y: start.current.y + e.translationY }, cur.current.s, boxRef.current, fittedRef.current);
        apply(cur.current.s, p.x, p.y);
      } else {
        const dy = Math.max(0, e.translationY);
        ty.setValue(dy); fade.setValue(Math.max(0.2, 1 - dy / 400));
      }
    })
    .onEnd(e => {
      if (shouldDismiss({ dy: e.translationY, vy: e.velocityY, scale: cur.current.s })) {
        Animated.parallel([
          Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }),
          Animated.timing(ty, { toValue: boxRef.current.height / 3, duration: 160, useNativeDriver: true }),
        ]).start(onClose);
      } else if (cur.current.s <= 1.01) {
        Animated.parallel([Animated.spring(ty, { toValue: 0, useNativeDriver: true }), Animated.spring(fade, { toValue: 1, useNativeDriver: true })]).start();
      }
    });

  const doubleTap = Gesture.Tap().runOnJS(true).numberOfTaps(2)
    .onEnd((_e, ok) => {
      if (!ok) return;
      const s = doubleTapScale(cur.current.s);
      settle(s, 0, 0);
    });

  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));

  async function run(a: Action) {
    if (busy || !url) return;
    setBusy(a); setNote(null);
    try {
      if (a === 'save') setNote((await saveToPhone(url, messageId)) ? t('viewer.saved') : t('viewer.denied'));
      else if (a === 'share') await shareImage(url, messageId);
      else await printImage(url, messageId);
    } catch (e) {
      // A cancelled share sheet is not an error.
      if ((e as { name?: string } | null)?.name !== 'AbortError') setNote(t('viewer.failed'));
    } finally { setBusy(null); }
  }

  const circle = { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' } as const;
  const btn = (a: Action | 'close', label: string, glyph: string, onPress: () => void, disabled = false) => (
    <Pressable key={a} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy: busy === a }} disabled={disabled} onPress={onPress}
      style={[circle, disabled ? { opacity: 0.5 } : null]}>
      <Txt color="#FFFFFF" size="heading">{glyph}</Txt>
    </Pressable>
  );
  const rootDir = Platform.OS === 'web' ? null : { direction: dir } as const;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <GestureHandlerRootView style={[{ flex: 1, backgroundColor: '#000000' }, rootDir]}>
        <Animated.View style={{ flex: 1, opacity: fade }} onLayout={e => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
          {url === undefined ? <View style={styles.center}><ActivityIndicator color="#FFFFFF" /></View> : null}
          {url === null ? <View style={styles.center}><Txt color="#FFFFFF">{t('viewer.loadError')}</Txt></View> : null}
          {url ? (
            <GestureDetector gesture={gesture}>
              <Animated.View accessibilityLabel={t('viewer.image')} style={[styles.center, { transform: [{ translateX: tx }, { translateY: ty }, { scale }] }]}>
                <Image source={{ uri: url, cacheKey: `${kehilaId}:${messageId}` }} cachePolicy="disk" contentFit="contain"
                  accessibilityLabel={t('messages.imageAlt')}
                  onLoad={e => setNatural({ width: e.source.width, height: e.source.height })}
                  onError={() => { if (attempt < 1) setAttempt(a => a + 1); else setUrl(null); }}
                  style={{ width: '100%', height: '100%' }} />
              </Animated.View>
            </GestureDetector>
          ) : null}
          <View style={styles.bar} pointerEvents="box-none">
            {btn('close', t('viewer.close'), '✕', onClose)}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {btn('save', t('viewer.save'), '⬇', () => void run('save'), !url || !!busy)}
              {showShare ? btn('share', t('viewer.share'), '⤴', () => void run('share'), !url || !!busy) : null}
              {btn('print', t('viewer.print'), '⎙', () => void run('print'), !url || !!busy)}
            </View>
          </View>
          {note ? <View style={styles.note} pointerEvents="none"><Txt color="#FFFFFF" size="small" style={{ textAlign: "center" }}>{note}</Txt></View> : null}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', top: 0, start: 0, end: 0, paddingTop: 40, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between' },
  note: { position: 'absolute', bottom: 32, start: 16, end: 16, padding: 12, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.7)' },
});
