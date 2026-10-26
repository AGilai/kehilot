import { ApiCodeError } from '../client/errors.ts';

export const MAX_EDGE = 2000;
export const TARGET_BYTES = 512000;
export const MAX_BYTES = 1048576;
export const QUALITY_STEPS = [0.8, 0.65, 0.5, 0.4];
const FALLBACK_EDGE = 1600;
const FALLBACK_QUALITY = 0.6;

/** `expo-image-manipulator`'s shape, injected so the logic is testable without a native module. */
export type Manipulate = (
  uri: string,
  actions: Array<{ resize: { width: number; height: number } }>,
  options: { compress: number; format: 'jpeg' },
) => Promise<{ uri: string; width: number; height: number }>;

export type PrepareDeps = { manipulate: Manipulate; sizeOf: (uri: string) => Promise<number> };
export type Prepared = { uri: string; bytes: number; contentType: 'image/jpeg' };

/** The size to scale to so the long edge is at most `cap` (aspect kept), or null when it already fits. */
export function resizePlan(width: number, height: number, cap: number = MAX_EDGE): { width: number; height: number } | null {
  const long = Math.max(width, height);
  if (!(long > cap)) return null;
  const f = cap / long;
  return { width: Math.round(width * f), height: Math.round(height * f) };
}

/**
 * Always re-encodes to JPEG (that drops EXIF and location). Steps the quality down until the file is at most
 * 0.5 MB; still over at 0.4 it shrinks to 1600 px and encodes at 0.6. Over 1 MiB after that is `image_too_large`.
 */
export async function prepareImage(uri: string, { manipulate, sizeOf }: PrepareDeps): Promise<Prepared> {
  let plan: { width: number; height: number } | null = null;
  let dims: { width: number; height: number } | null = null;
  const encode = async (compress: number, resize: typeof plan) => {
    const r = await manipulate(uri, resize ? [{ resize }] : [], { compress, format: 'jpeg' });
    return { r, bytes: await sizeOf(r.uri) };
  };
  let last: { uri: string; bytes: number } | null = null;
  for (const q of QUALITY_STEPS) {
    let out = await encode(q, plan);
    if (dims === null) {
      dims = { width: out.r.width, height: out.r.height };
      plan = resizePlan(dims.width, dims.height);
      if (plan) out = await encode(q, plan); // the first pass only measured the source
    }
    last = { uri: out.r.uri, bytes: out.bytes };
    if (out.bytes <= TARGET_BYTES) return { ...last, contentType: 'image/jpeg' };
  }
  const small = resizePlan(dims!.width, dims!.height, FALLBACK_EDGE); // from the source, not the 2000 px copy
  if (small) {
    const out = await encode(FALLBACK_QUALITY, small);
    last = { uri: out.r.uri, bytes: out.bytes };
  }
  if (last!.bytes > MAX_BYTES) throw new ApiCodeError(0, 'image_too_large');
  return { ...last!, contentType: 'image/jpeg' };
}
