import React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Txt } from '../../../kit/components.tsx';
import { Icon } from '../../../kit/Icon.tsx';
import { MAX_ZOOM, MIN_ZOOM, clampView, enterIsOwn, nudgeView, rotateView, targetSides, zoomView } from '../../../media/logo.ts';
import type { CropView } from '../../../media/logo.ts';

/** P45 phone 3: the frame size on a phone (it shrinks only on a screen narrower than 342). */
export const FRAME = 310;
const BACKDROP = '#0E1224';
const ON_DARK = '#FFFFFF';
const SOFT = 'rgba(255,255,255,0.72)';
const START: CropView = { scale: 1, x: 0, y: 0, rotation: 0 };
type Size = { width: number; height: number };

/** The picture as the frame shows it: cover fit of the (rotated) short side, zoomed, panned. Used by the frame and the previews. */
function CropLayer({ uri, image, view, frame, panFrame }: { uri: string; image: Size; view: CropView; frame: number; /** The frame the pan was measured in. */ panFrame: number }) {
  const short = Math.min(image.width, image.height);
  const display = (frame / short) * view.scale;
  const w = image.width * display;
  const h = image.height * display;
  const k = frame / panFrame;
  return (
    <Image source={{ uri }} contentFit="fill" accessible={false}
      style={{ position: 'absolute', width: w, height: h, left: (frame - w) / 2, top: (frame - h) / 2, transform: [{ translateX: view.x * k }, { translateY: view.y * k }, { rotate: `${view.rotation}deg` }] }} />
  );
}

/** A white tile (also in dark mode) showing what a size of the logo will look like. Hidden from assistive technology: it is the same image. */
function PreviewTile({ uri, image, view, size, label, panFrame }: { uri: string; image: Size; view: CropView; size: number; label: string; panFrame: number }) {
  const f = size - 4;
  return (
    <View style={{ alignItems: 'center', gap: 6 }} {...(Platform.OS === 'web' ? { 'aria-hidden': true } : { importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true })}>
      <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: '#FFFFFF', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: f, height: f, overflow: 'hidden' }}><CropLayer uri={uri} image={image} view={view} frame={f} panFrame={panFrame} /></View>
      </View>
      <Txt size="small" color={SOFT}>{label}</Txt>
    </View>
  );
}

const CELL = 20;
/** Transparency checkerboard: CSS on the web, a coarse grid of views on a phone. */
function Checker({ size }: { size: number }) {
  if (Platform.OS === 'web') {
    return <View style={{ position: 'absolute', width: size, height: size, backgroundColor: '#FFFFFF', backgroundImage: 'conic-gradient(#D5D7DE 25%, #FFFFFF 0 50%, #D5D7DE 0 75%, #FFFFFF 0)', backgroundSize: `${CELL * 2}px ${CELL * 2}px` } as never} />;
  }
  const n = Math.ceil(size / CELL);
  return (
    <View style={{ position: 'absolute', width: size, height: size, overflow: 'hidden' }}>
      {Array.from({ length: n }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', direction: 'ltr' }}>
          {Array.from({ length: n }, (_, c) => <View key={c} style={{ width: CELL, height: CELL, backgroundColor: (r + c) % 2 ? '#D5D7DE' : '#FFFFFF' }} />)}
        </View>
      ))}
    </View>
  );
}

/** A slider as a plain track: `accessibilityRole="adjustable"`, tap or drag to set, the buttons beside it step it. */
function Zoom({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [w, setW] = React.useState(0);
  const frac = (value - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
  const at = (x: number) => w > 0 && onChange(MIN_ZOOM + Math.min(1, Math.max(0, x / w)) * (MAX_ZOOM - MIN_ZOOM));
  const pan = Gesture.Pan().runOnJS(true).minDistance(0).onBegin(e => at(e.x)).onUpdate(e => at(e.x));
  return (
    <GestureDetector gesture={pan}>
      <View accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: MIN_ZOOM * 100, max: MAX_ZOOM * 100, now: Math.round(value * 100), text: `${Math.round(value * 100)}%` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => onChange(value + (e.nativeEvent.actionName === 'increment' ? 0.25 : -0.25))}
        onLayout={e => setW(e.nativeEvent.layout.width)} style={{ flex: 1, height: 44, justifyContent: 'center', direction: 'ltr' }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' }} />
        <View style={{ position: 'absolute', left: 0, width: frac * w, height: 4, borderRadius: 2, backgroundColor: ON_DARK }} />
        <View style={{ position: 'absolute', left: Math.max(0, frac * w - 11), width: 22, height: 22, borderRadius: 11, backgroundColor: ON_DARK }} />
      </View>
    </GestureDetector>
  );
}

/** The two bottom buttons, drawn for the dark backdrop (the kit buttons assume a light page). */
function DarkButton({ title, onPress, primary, busy, disabled }: { title: string; onPress: () => void; primary?: boolean; busy?: boolean; disabled?: boolean }) {
  const off = !!(busy || disabled);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
      style={{ minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? ON_DARK : 'transparent', borderWidth: primary ? 0 : 1.5, borderColor: ON_DARK, opacity: off ? 0.7 : 1 }}>
      {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color={BACKDROP} /><Txt bold color={BACKDROP}>{title}</Txt></View> : <Txt bold color={primary ? BACKDROP : ON_DARK}>{title}</Txt>}
    </Pressable>
  );
}

const round = (b: React.ReactNode, label: string, onPress: () => void, disabled = false) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', opacity: disabled ? 0.4 : 1 }}>{b}</Pressable>
);

/**
 * P45 phone 3: crop to a square. Full screen on a dark backdrop; a thirds grid over a checkerboard; drag to move, pinch or the slider
 * to zoom, rotate 90 degrees; live previews at 32, 44 and 66; "ביטול" / "שמירה". On the web: arrows move 1 px (Shift 10),
 * + and - zoom, R rotates, Enter saves, Esc cancels.
 */
export function LogoCropper({ uri, image, busy, error, onCancel, onSave }: { uri: string; image: Size; busy: boolean; error?: string | null; onCancel: () => void; onSave: (view: CropView, frame: number) => void }) {
  const { t, dir } = useI18n();
  const { width } = useWindowDimensions();
  const frame = Math.min(FRAME, Math.max(200, width - 32));
  const [view, setViewRaw] = React.useState<CropView>(START);
  const viewRef = React.useRef(view);
  const setView = (v: CropView) => { const c = clampView(v, image, frame); viewRef.current = c; setViewRaw(c); };
  const base = React.useRef(START);
  const side = Math.min(image.width, image.height);
  const pan = Gesture.Pan().runOnJS(true).onStart(() => { base.current = viewRef.current; })
    .onUpdate(e => setView({ ...base.current, x: base.current.x + e.translationX, y: base.current.y + e.translationY }));
  const pinch = Gesture.Pinch().runOnJS(true).onStart(() => { base.current = viewRef.current; })
    .onUpdate(e => setView({ ...base.current, scale: base.current.scale * e.scale }));
  const gesture = Gesture.Simultaneous(pan, pinch);
  const save = () => { if (!busy) onSave(viewRef.current, frame); };
  const saveRef = React.useRef(save); saveRef.current = save;
  const cancelRef = React.useRef(onCancel); cancelRef.current = onCancel;

  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === 'Enter' && el && enterIsOwn(el.tagName ?? '', el.getAttribute?.('role') ?? null)) return;
      const step = e.shiftKey ? 10 : 1;
      const v = viewRef.current;
      if (e.key === 'ArrowLeft') setView(nudgeView(v, -step, 0, image, frame));
      else if (e.key === 'ArrowRight') setView(nudgeView(v, step, 0, image, frame));
      else if (e.key === 'ArrowUp') setView(nudgeView(v, 0, -step, image, frame));
      else if (e.key === 'ArrowDown') setView(nudgeView(v, 0, step, image, frame));
      else if (e.key === '+' || e.key === '=') setView(zoomView(v, 0.25, image, frame));
      else if (e.key === '-' || e.key === '_') setView(zoomView(v, -0.25, image, frame));
      else if (e.key === 'r' || e.key === 'R') setView(rotateView(v));
      else if (e.key === 'Enter') saveRef.current();
      else if (e.key === 'Escape') cancelRef.current();
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [image.width, image.height, frame]); // eslint-disable-line react-hooks/exhaustive-deps

  // The saved side: the cropped square in source pixels, capped at 512 (never scaled up).
  const cropSide = targetSides(Math.max(1, Math.round(side / view.scale)))[0]!;
  const grid = { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.7)' } as const;
  const rootDir = Platform.OS === 'web' ? null : { direction: dir } as const;
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onCancel} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <GestureHandlerRootView style={[{ flex: 1, backgroundColor: BACKDROP }, rootDir]}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 16 }}>
          <Txt serif size="title" color={ON_DARK} accessibilityRole="header">{t('logo.crop.title')}</Txt>
          <GestureDetector gesture={gesture}>
            <View accessible accessibilityLabel={t('logo.crop.area')} style={{ width: frame, height: frame, overflow: 'hidden', backgroundColor: '#FFFFFF', borderRadius: 4, direction: 'ltr' }}>
              <Checker size={frame} />
              <CropLayer uri={uri} image={image} view={view} frame={frame} panFrame={frame} />
              <View pointerEvents="none" style={{ position: 'absolute', width: frame, height: frame, borderWidth: 2, borderColor: ON_DARK }}>
                <View style={{ ...grid, left: frame / 3, top: 0, bottom: 0, width: 1 }} /><View style={{ ...grid, left: (frame * 2) / 3, top: 0, bottom: 0, width: 1 }} />
                <View style={{ ...grid, top: frame / 3, left: 0, right: 0, height: 1 }} /><View style={{ ...grid, top: (frame * 2) / 3, left: 0, right: 0, height: 1 }} />
              </View>
            </View>
          </GestureDetector>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: frame, direction: 'ltr' }}>
            {round(<Icon name="zoomout" size={22} color={ON_DARK} />, `${t('logo.crop.zoom')} −`, () => setView(zoomView(view, -0.25, image, frame)), view.scale <= MIN_ZOOM)}
            <Zoom value={view.scale} onChange={v => setView({ ...view, scale: v })} label={t('logo.crop.zoom')} />
            {round(<Icon name="zoomin" size={22} color={ON_DARK} />, `${t('logo.crop.zoom')} +`, () => setView(zoomView(view, 0.25, image, frame)), view.scale >= MAX_ZOOM)}
            {round(<Icon name="rotate" size={22} color={ON_DARK} />, t('logo.crop.rotate'), () => setView(rotateView(view)))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 20 }}>
            <PreviewTile uri={uri} image={image} view={view} size={32} label="32" panFrame={frame} />
            <PreviewTile uri={uri} image={image} view={view} size={44} label="44" panFrame={frame} />
            <PreviewTile uri={uri} image={image} view={view} size={66} label="66" panFrame={frame} />
          </View>
          <Txt size="small" color={SOFT} style={{ textAlign: 'center', maxWidth: frame }}>{t('logo.crop.note', { size: cropSide })}</Txt>
          {error ? <Txt size="small" bold color="#F2A6C0" accessibilityRole="alert" style={{ textAlign: 'center', maxWidth: frame }}>{error}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: 12, width: frame }}>
            <View style={{ flex: 1 }}><DarkButton title={t('common.cancel')} onPress={onCancel} disabled={busy} /></View>
            <View style={{ flex: 1 }}><DarkButton primary title={busy ? t('logo.saving') : t('common.save')} onPress={save} busy={busy} /></View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
