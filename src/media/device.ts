import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { Manipulate, PrepareDeps } from './prepare.ts';

export type Picked = { uri: string };
export type PickResult = Picked | 'denied' | null;

/** The gallery or the camera, images only, no editing. `null` is a cancel. The URI is never logged. */
export async function pickImage(source: 'gallery' | 'camera'): Promise<PickResult> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: false };
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (r.canceled || !r.assets[0]) return null;
  return { uri: r.assets[0].uri };
}

const manipulate: Manipulate = async (uri, actions, o) => {
  const ctx = ImageManipulator.manipulate(uri);
  try {
    for (const a of actions) ctx.resize(a.resize);
    const ref = await ctx.renderAsync();
    try {
      const r = await ref.saveAsync({ compress: o.compress, format: SaveFormat.JPEG });
      return { uri: r.uri, width: r.width, height: r.height };
    } finally { ref.release(); }
  } finally { ctx.release(); }
};

export const blobOf = async (uri: string): Promise<Blob> => (await fetch(uri)).blob();

/** `expo-image-manipulator` and a size read, for `prepareImage`. */
export const prepareDeps: PrepareDeps = { manipulate, sizeOf: async uri => (await blobOf(uri)).size };
