import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { LogoDeps } from './logo.ts';

/** Decoded size of a base64 string. */
const byteLength = (b64: string) => Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

const render: LogoDeps['render'] = async (uri, rotation, rect, side) => {
  const ctx = ImageManipulator.manipulate(uri);
  try {
    if (rotation) ctx.rotate(rotation);
    ctx.crop(rect);
    ctx.resize({ width: side, height: side });
    const ref = await ctx.renderAsync();
    try {
      const r = await ref.saveAsync({ format: SaveFormat.PNG, base64: true });
      const base64 = r.base64 ?? '';
      return { base64, bytes: byteLength(base64) };
    } finally { ref.release(); }
  } finally { ctx.release(); }
};

/** Web only: round each colour channel to 32 levels so the PNG compresses better, re-encoded as PNG. */
const posterize: NonNullable<LogoDeps['posterize']> = async base64 => {
  const img = new window.Image();
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('decode')); img.src = `data:image/png;base64,${base64}`; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const step = 256 / 32;
  for (let i = 0; i < d.data.length; i += 4) {
    for (let j = 0; j < 3; j++) d.data[i + j] = Math.min(255, Math.round(Math.round(d.data[i + j]! / step) * step));
  }
  g.putImageData(d, 0, 0);
  const out = c.toDataURL('image/png').split(',')[1] ?? '';
  return { base64: out, bytes: byteLength(out) };
};

export const logoDeps: LogoDeps = Platform.OS === 'web' ? { render, posterize } : { render };
