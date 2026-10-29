import React from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider.tsx';
import { useSession } from '../../../client/SessionProvider.tsx';
import { config } from '../../../config.ts';
import { FIXTURE_PICTURE, fixtureParams } from '../../../client/fixtures.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Sheet, Txt, useTokens } from '../../../kit/components.tsx';
import { Icon } from '../../../kit/Icon.tsx';
import { LogoTile } from '../../../kit/LogoTile.tsx';
import { TOUCH } from '../../../kit/theme.ts';
import { blobOf, pickImage } from '../../../media/device.ts';
import { encodeLogo, logoErrorKey, sourceError } from '../../../media/logo.ts';
import type { CropView, LogoErrorKey } from '../../../media/logo.ts';
import { logoDeps } from '../../../media/logoDevice.ts';
import { useLogoUri } from '../../SchedulePrint.tsx';
import { useShortDate } from '../shared.tsx';
import { LogoCropper } from './LogoCropper.tsx';

type Picked = { uri: string; width: number; height: number };

const sizeOf = (uri: string) => new Promise<{ width: number; height: number }>((ok, bad) => { Image.getSize(uri, (width, height) => ok({ width, height }), bad); });

/** Fixture screens: `logo-crop` opens the cropper on an invented picture, `logo-error` shows an error banner. */
const fixtureScreen = () => (config.fixtures ? fixtureParams().screen : null);

/** The state and the pieces of the logo window; the phone Sheet and the wide side panel lay them out. */
function useLogoPanel(onToast: (text: string) => void, onGone: () => void) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state, refreshKehila } = useSession();
  const date = useShortDate();
  const k = useTokens();
  const kehila = state.kehila!;
  const logo = useLogoUri();
  const letter = [...kehila.name.trim()][0] ?? '';
  const info = kehila.logoInfo ?? null;
  const has = !!kehila.logoVersion;

  const [picked, setPicked] = React.useState<Picked | null>(() => (fixtureScreen() === 'logo-crop' ? { uri: FIXTURE_PICTURE, width: 640, height: 400 } : null));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<LogoErrorKey | null>(() => (fixtureScreen() === 'logo-error' ? 'logo.err.big' : null));
  const [confirm, setConfirm] = React.useState(false);
  const [over, setOver] = React.useState(false);
  React.useEffect(() => {
    const u = picked?.uri;
    return () => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); };
  }, [picked?.uri]);
  const input = React.useRef<HTMLInputElement | null>(null);
  const web = Platform.OS === 'web';

  async function take(uri: string, type: string, bytes: number, allowUnknown: boolean) {
    const bad = sourceError(type, bytes, allowUnknown);
    if (bad) { setError(bad); return; }
    try {
      const size = await sizeOf(uri);
      setError(null); setConfirm(false);
      setPicked({ uri, ...size });
    } catch { setError('logo.err.format'); }
  }
  async function fromPhotos() {
    setError(null);
    try {
      const r = await pickImage('gallery');
      if (!r || r === 'denied') return;
      const blob = await blobOf(r.uri);
      await take(r.uri, blob.type, blob.size, true);
    } catch { setError('logo.err.format'); }
  }
  async function fromFile(file: File | null | undefined) {
    if (!file) return;
    await take(URL.createObjectURL(file), file.type, file.size, false);
  }
  async function save(view: CropView, frame: number) {
    if (!picked || busy) return;
    setBusy(true); setError(null);
    try {
      const out = await encodeLogo(picked.uri, view, picked, frame, logoDeps);
      await api.putLogo(kehila.kehilaId, out.base64);
      await refreshKehila();
      setPicked(null);
      onToast(t('logo.saved'));
    } catch (e) {
      setError(logoErrorKey(e)); // the previous logo stays; the crop stays so the person can retry
    } finally { setBusy(false); }
  }
  async function remove() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await api.deleteLogo(kehila.kehilaId); await refreshKehila(); setConfirm(false); onGone(); }
    catch (e) { setError(logoErrorKey(e)); setConfirm(false); } finally { setBusy(false); }
  }

  const label = t('logo.label', { kehila: kehila.name });
  const sideTxt = info ? `${info.side}×${info.side} · ${Math.max(1, Math.round(info.bytes / 1024))}KB` : null;
  const paper = '#FFFFFF';
  const where = (title: string, node: React.ReactNode) => (
    <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 120 }}><Txt size="small" color={k.muted}>{title}</Txt></View>
      <View style={{ flex: 1, alignItems: 'flex-start' }}>{node}</View>
    </View>
  );
  const strip = (bg: string, fg: string, size: number, text: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: k.line }}>
      <LogoTile uri={logo.uri} letter={letter} size={size} label={label} />
      <Txt size="small" bold color={fg}>{text}</Txt>
    </View>
  );

  const content = (
    <>
      {has ? (
        <View style={{ alignItems: 'center', gap: 4 }}>
          <LogoTile uri={logo.uri} letter={letter} size={112} label={label} />
          <Txt bold style={{ marginTop: 8 }}>{t('logo.current')}</Txt>
          {sideTxt ? <Txt size="small" color={k.muted}>{sideTxt}</Txt> : null}
          {info ? <Txt size="small" color={k.muted} style={{ textAlign: 'center' }}>{t('logo.meta', { name: info.name, date: date(info.at) })}</Txt> : null}
        </View>
      ) : (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <LogoTile uri={null} letter={letter} size={96} label={label} />
          <Txt bold>{t('logo.none')}</Txt>
        </View>
      )}
      {error && !picked ? <Banner tone="error" text={t(error)} /> : null}
      {has ? (
        <View style={{ gap: 10 }}>
          <Txt bold accessibilityRole="header">{t('logo.whereTitle')}</Txt>
          {where(t('logo.where.top'), (
            <View style={{ gap: 6 }}>
              {strip('#F6F7F2', '#151A33', 32, kehila.name)}
              {strip('#10132A', '#ECEEF7', 32, kehila.name)}
            </View>
          ))}
          {where(t('logo.where.sheet'), (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: paper, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: k.line }}>
              <LogoTile uri={logo.uri} letter={letter} size={66} label={label} />
              <Txt serif bold color="#151A33" style={{ flexShrink: 1 }}>{kehila.name}</Txt>
            </View>
          ))}
          {where(t('logo.where.menu'), strip(k.surface, k.ink, 44, kehila.name))}
          {where(t('logo.where.invite'), strip(k.surface, k.ink, 44, kehila.name))}
        </View>
      ) : null}
      <View style={{ backgroundColor: k.surface, borderRadius: 10, borderWidth: 1, borderColor: k.line, padding: 12 }}>
        <Txt size="small" color={k.muted}>{t('logo.rules')}</Txt>
      </View>
      {web ? (
        <DropZone over={over} setOver={setOver} onFile={f => void fromFile(f)} onOpen={() => input.current?.click()} text={t('logo.source.drop')} />
      ) : null}
      {web ? React.createElement('input', { type: 'file', accept: 'image/png,image/jpeg', ref: input, style: { display: 'none' }, 'aria-hidden': true, tabIndex: -1,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; void fromFile(f); } }) : null}
    </>
  );

  const footer = (
    <>
      {confirm ? (
        <View style={{ gap: 8 }}>
          <Banner tone="error" text={t('logo.removeConfirm', { letter })} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button kind="danger" title={t('logo.removeDo')} busy={busy} onPress={() => void remove()} /></View>
            <View style={{ flex: 1 }}><Button kind="secondary" title={t('common.cancel')} disabled={busy} onPress={() => setConfirm(false)} /></View>
          </View>
        </View>
      ) : (
        <>
          <Button title={has ? t('logo.replace') : t('logo.upload')} accessibilityLabel={web ? undefined : `${has ? t('logo.replace') : t('logo.upload')}, ${t('logo.source.photos')}`}
            onPress={() => { if (web) input.current?.click(); else void fromPhotos(); }} />
          {has ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('logo.remove')} onPress={() => setConfirm(true)} style={{ minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
              <Txt bold color={k.danger}>{t('logo.remove')}</Txt>
            </Pressable>
          ) : null}
        </>
      )}
    </>
  );

  const cropper = picked ? <LogoCropper uri={picked.uri} image={picked} busy={busy} error={error ? t(error) : null} onCancel={() => { if (!busy) setPicked(null); }} onSave={(v, f) => void save(v, f)} /> : null;
  return { content, footer, cropper, reset: () => { setPicked(null); setError(null); setConfirm(false); } };
}

/** Web only: a dashed zone that takes a dropped PNG or JPEG (or opens the file chooser). */
function DropZone({ over, setOver, onFile, onOpen, text }: { over: boolean; setOver: (b: boolean) => void; onFile: (f: File | null | undefined) => void; onOpen: () => void; text: string }) {
  const k = useTokens();
  return React.createElement('div', {
    style: { width: '100%', display: 'flex', flexDirection: 'column' },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); },
  }, (
    <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={onOpen}
      style={{ minHeight: 96, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: over ? k.tekhelet : k.line, backgroundColor: over ? k.surface : 'transparent', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 }}>
      <Icon name="image" size={28} color={k.tekhelet} />
      <Txt size="small" color={k.muted} style={{ textAlign: 'center' }}>{text}</Txt>
    </Pressable>
  ));
}

/** P45 phone 2: the logo window as a bottom Sheet. */
export function LogoSheet({ visible, onClose, onToast }: { visible: boolean; onClose: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const p = useLogoPanel(onToast, onClose);
  const { reset } = p;
  React.useEffect(() => { if (!visible) reset(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Sheet visible={visible && !p.cropper} title={t('logo.row')} onClose={onClose} footer={p.footer}>{p.content}</Sheet>
      {visible ? p.cropper : null}
    </>
  );
}

/** P45 frame 4: the same window as a side panel from 1024 (the crop opens full screen over it). */
export function LogoPanel({ onClose, onToast }: { onClose: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const p = useLogoPanel(onToast, onClose);
  return (
    <View style={{ width: 420, backgroundColor: k.stone, borderRadius: 12, borderWidth: 1, borderColor: k.line, padding: 16, gap: 12, alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt serif size="title" accessibilityRole="header" style={{ flex: 1 }}>{t('logo.row')}</Txt>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={22} color={k.ink} /></Pressable>
      </View>
      {p.content}
      <View style={{ gap: 8 }}>{p.footer}</View>
      {p.cropper}
    </View>
  );
}
