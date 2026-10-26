/**
 * Save, share and print a message image. The file name is `kehilot-<messageId>.jpg|png` (never a person's
 * name); a share or print carries the image only (no text, no URL). Temp files live in `Paths.cache/share/`
 * (wiped on sign-out) and are deleted in `finally`. URLs are never logged.
 */
export type TempFile = { uri: string; base64(): Promise<string>; delete(): void };
export type NativeDeps = {
  download(url: string, name: string): Promise<TempFile>;
  share(uri: string, mimeType: string): Promise<void>;
  /** Asks for the add-only photos permission, saves, and returns false when it was denied. */
  saveToLibrary(uri: string): Promise<boolean>;
  print(html: string): Promise<void>;
};

export const mimeOf = (url: string): string => {
  let path = url;
  try { path = new URL(url).pathname; } catch { /* not absolute */ }
  return /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
};
export const imageFileName = (messageId: string, mime: string): string => `kehilot-${messageId}.${mime === 'image/png' ? 'png' : 'jpg'}`;

/** The print page: the image alone, fitted to the page. */
export const printHtml = (dataUri: string): string =>
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>html,body{margin:0;padding:0;height:100%}body{display:flex;align-items:center;justify-content:center}'
  + 'img{max-width:100%;max-height:100vh;object-fit:contain}</style></head>'
  + `<body><img src="${dataUri}"></body></html>`;

async function withTemp<T>(deps: NativeDeps, url: string, messageId: string, fn: (f: TempFile, mime: string) => Promise<T>): Promise<T> {
  const mime = mimeOf(url);
  const f = await deps.download(url, imageFileName(messageId, mime));
  try { return await fn(f, mime); }
  finally { try { f.delete(); } catch { /* already gone */ } }
}

const isWeb = () => typeof document !== 'undefined' && typeof navigator !== 'undefined' && typeof window !== 'undefined' && !isNativeRuntime();
function isNativeRuntime(): boolean {
  return (globalThis as { navigator?: { product?: string } }).navigator?.product === 'ReactNative';
}

function nativeDeps(): NativeDeps {
  const { File, Paths, Directory } = require('expo-file-system') as typeof import('expo-file-system');
  return {
    async download(url, name) {
      const dir = new Directory(Paths.cache, 'share');
      if (!dir.exists) dir.create({ idempotent: true });
      const f = await File.downloadFileAsync(url, new File(dir, name), { idempotent: true });
      return { uri: f.uri, base64: () => f.base64(), delete: () => { if (f.exists) f.delete(); } };
    },
    async share(uri, mimeType) {
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      await Sharing.shareAsync(uri, { mimeType });
    },
    async saveToLibrary(uri) {
      const ML = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
      const p = await ML.requestPermissionsAsync(true);
      if (!p.granted) return false;
      await ML.saveToLibraryAsync(uri);
      return true;
    },
    async print(html) {
      const Print = require('expo-print') as typeof import('expo-print');
      await Print.printAsync({ html });
    },
  };
}

async function fetchBlob(url: string): Promise<Blob> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download_failed');
  return r.blob();
}

/** Returns false when the photos permission was denied (native). */
export async function saveToPhone(url: string, messageId: string, deps?: NativeDeps): Promise<boolean> {
  if (!deps && isWeb()) {
    const blob = await fetchBlob(url);
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    try {
      a.href = href; a.download = imageFileName(messageId, blob.type || mimeOf(url));
      document.body.appendChild(a); a.click(); a.remove();
    } finally { setTimeout(() => URL.revokeObjectURL(href), 10_000); }
    return true;
  }
  const d = deps ?? nativeDeps();
  return withTemp(d, url, messageId, f => d.saveToLibrary(f.uri));
}

/** Native always can; on the web only when the browser can share files. */
export function canShareImage(): boolean {
  if (!isWeb()) return true;
  try {
    const f = new File([new Uint8Array(1)], 'kehilot.jpg', { type: 'image/jpeg' });
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });
  } catch { return false; }
}

export async function shareImage(url: string, messageId: string, deps?: NativeDeps): Promise<void> {
  if (!deps && isWeb()) {
    const blob = await fetchBlob(url);
    const type = blob.type || mimeOf(url);
    // Files only: no title, text or url.
    await navigator.share({ files: [new File([blob], imageFileName(messageId, type), { type })] });
    return;
  }
  const d = deps ?? nativeDeps();
  await withTemp(d, url, messageId, (f, mime) => d.share(f.uri, mime));
}

export async function printImage(url: string, messageId: string, deps?: NativeDeps): Promise<void> {
  if (!deps && isWeb()) {
    const blob = await fetchBlob(url);
    const href = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    const cleanup = () => { frame.remove(); URL.revokeObjectURL(href); };
    try {
      await new Promise<void>((resolve, reject) => {
        frame.onload = () => {
          const w = frame.contentWindow; const img = frame.contentDocument?.querySelector('img');
          if (!w || !img) { reject(new Error('print_failed')); return; }
          const go = () => { w.addEventListener('afterprint', () => { cleanup(); resolve(); }); w.focus(); w.print(); setTimeout(() => { cleanup(); resolve(); }, 120_000); };
          if (img.complete) go(); else { img.onload = go; img.onerror = () => reject(new Error('print_failed')); }
        };
        frame.srcdoc = printHtml(href);
        document.body.appendChild(frame);
      });
    } finally { cleanup(); }
    return;
  }
  const d = deps ?? nativeDeps();
  await withTemp(d, url, messageId, async (f, mime) => d.print(printHtml(`data:${mime};base64,${await f.base64()}`)));
}
