/** Logo crop maths and the PNG size loop (pure; the device work is injected, see `logoDevice.ts`). */
import { ApiCodeError } from '../client/errors.ts';

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_LOGO_BYTES = 65536;
export const MIN_SIDE = 64;

/** `scale` >= 1 (zoom over a cover fit); `x`, `y` are the pan in frame pixels (positive moves the image right/down). */
export type CropView = { scale: number; x: number; y: number; rotation: 0 | 90 | 180 | 270 };
export type Rect = { originX: number; originY: number; width: number; height: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The square, in source pixels of the already rotated image, that the frame shows. */
export function cropRect(view: CropView, image: { width: number; height: number }, frame: number): Rect {
  const swap = view.rotation === 90 || view.rotation === 270;
  const w = swap ? image.height : image.width;
  const h = swap ? image.width : image.height;
  const short = Math.min(w, h);
  const scale = Math.max(1, view.scale);
  const display = (frame / short) * scale; // frame pixels per source pixel
  const side = Math.max(1, Math.min(short, Math.round(short / scale)));
  const cx = w / 2 - view.x / display;
  const cy = h / 2 - view.y / display;
  return {
    originX: Math.round(clamp(cx - side / 2, 0, w - side)),
    originY: Math.round(clamp(cy - side / 2, 0, h - side)),
    width: side,
    height: side,
  };
}

/** True when a key press on this element (tag name, ARIA role) is that control's own, so the cropper's Enter shortcut must stay out. */
export const enterIsOwn = (tag: string, role: string | null): boolean => ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(tag.toUpperCase()) || role === 'button' || role === 'adjustable' || role === 'slider';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export type SourceError = 'logo.err.format';

/** The type and size checks before cropping. `type` is the MIME type; '' (unknown) passes only with `allowUnknown` (a phone file URI). */
export function sourceError(type: string, bytes: number, allowUnknown = false): SourceError | null {
  const ok = type === 'image/png' || type === 'image/jpeg' || (type === '' && allowUnknown);
  return ok && bytes <= MAX_INPUT_BYTES ? null : 'logo.err.format';
}

/** Keeps the zoom in range and the pan so the image always covers the frame. */
export function clampView(view: CropView, image: { width: number; height: number }, frame: number): CropView {
  const swap = view.rotation === 90 || view.rotation === 270;
  const w = swap ? image.height : image.width;
  const h = swap ? image.width : image.height;
  const scale = clamp(view.scale, MIN_ZOOM, MAX_ZOOM);
  const display = (frame / Math.min(w, h)) * scale;
  const mx = Math.max(0, (w * display - frame) / 2);
  const my = Math.max(0, (h * display - frame) / 2);
  return { ...view, scale, x: clamp(view.x, -mx, mx), y: clamp(view.y, -my, my) };
}

export const zoomView = (view: CropView, delta: number, image: { width: number; height: number }, frame: number): CropView => clampView({ ...view, scale: view.scale + delta }, image, frame);
export const nudgeView = (view: CropView, dx: number, dy: number, image: { width: number; height: number }, frame: number): CropView => clampView({ ...view, x: view.x + dx, y: view.y + dy }, image, frame);
export const rotateView = (view: CropView): CropView => ({ ...view, x: 0, y: 0, rotation: (((view.rotation + 90) % 360) as 0 | 90 | 180 | 270) });

/** Sides to try, largest first; never up-scales. */
export function targetSides(side: number): number[] {
  if (side < 256) return [side];
  return [512, 384, 256].filter(s => s <= side);
}

export type Encoded = { base64: string; bytes: number };
export type LogoDeps = {
  render(uri: string, rotation: 0 | 90 | 180 | 270, rect: Rect, side: number): Promise<Encoded>;
  posterize?: (base64: string) => Promise<Encoded>;
};

export class LogoEncodeError extends Error {
  kind: 'small' | 'big';
  constructor(kind: 'small' | 'big') { super(`logo_${kind}`); this.name = 'LogoEncodeError'; this.kind = kind; }
}

export async function encodeLogo(uri: string, view: CropView, image: { width: number; height: number }, frame: number, deps: LogoDeps): Promise<{ base64: string; side: number; bytes: number }> {
  const rect = cropRect(view, image, frame);
  if (rect.width < MIN_SIDE) throw new LogoEncodeError('small');
  let last: { r: Encoded; side: number } | null = null;
  for (const side of targetSides(rect.width)) {
    const r = await deps.render(uri, view.rotation, rect, side);
    if (r.bytes <= MAX_LOGO_BYTES) return { base64: r.base64, side, bytes: r.bytes };
    last = { r, side };
  }
  if (last && deps.posterize) {
    const p = await deps.posterize(last.r.base64);
    if (p.bytes <= MAX_LOGO_BYTES) return { base64: p.base64, side: last.side, bytes: p.bytes };
  }
  throw new LogoEncodeError('big');
}

export type LogoErrorKey = 'logo.err.format' | 'logo.err.small' | 'logo.err.big' | 'logo.err.save';

export function logoErrorKey(e: unknown): LogoErrorKey {
  if (e instanceof LogoEncodeError) return e.kind === 'small' ? 'logo.err.small' : 'logo.err.big';
  if (e instanceof ApiCodeError) {
    if (e.code === 'invalid_logo_format') return 'logo.err.format';
    if (e.code === 'logo_too_small') return 'logo.err.small';
    if (e.code === 'logo_too_large') return 'logo.err.big';
  }
  return 'logo.err.save';
}
