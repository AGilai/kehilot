// Pure logic for the bug-report button and sheet (UX-DESIGN §13). No React, no React Native.

export const TEXT_MAX = 2000;
export const REPORT_PAD = 56;
export const WIDE = 1024;
const TAB_BAR = 65; // minHeight 64 + 1 border (Main)
const GAP = 16;

export type ReportContext = { appVersion: string; build: string; platform: string; os: string; screen: string; lang: string; kehilaId?: string };

const clip = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, 64) : 'unknown';
};

/** The fixed-shape context the server accepts. `kehilaId` is left out (not null, not empty) outside a Kehila. */
export function buildContext(i: { appVersion?: string; build?: number | string; platform: string; os: string | number; screen: string; lang: string; kehilaId?: string | null }): ReportContext {
  const c: ReportContext = {
    appVersion: clip(i.appVersion), build: clip(i.build ?? 0), platform: clip(i.platform), os: clip(i.os), screen: clip(i.screen), lang: clip(i.lang),
  };
  const k = typeof i.kehilaId === 'string' ? i.kehilaId.trim() : '';
  if (k) c.kehilaId = k.slice(0, 64);
  return c;
}

/** Native: the OS version. Web: only a coarse family from the user agent. */
export function osLabel(platform: string, version: string | number | undefined | null, userAgent: string): string {
  if (platform !== 'web') return version === undefined || version === null || version === '' ? platform : String(version);
  const ua = userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'web';
}

export function validateReportText(text: string): { ok: boolean; count: number } {
  const count = Array.from(text.trim()).length;
  return { ok: count >= 1 && count <= TEXT_MAX, count };
}

export type Placement = { show: false } | { show: true; corner: 'start' | 'end'; bottom: number };

export function placeButton(o: { width: number; hasTabs: boolean; keyboard: boolean; modalOpen: boolean; viewerOpen: boolean; screen: string; enabled: boolean; insetBottom: number }): Placement {
  if (!o.enabled || o.keyboard || o.modalOpen || o.viewerOpen || o.screen === 'chat') return { show: false };
  if (o.width >= WIDE) return { show: true, corner: 'end', bottom: GAP };
  return { show: true, corner: 'start', bottom: GAP + o.insetBottom + (o.hasTabs ? TAB_BAR : 0) };
}

export type ReportErrorKind = 'limitUser' | 'limitAnon' | 'tooBig' | 'generic';

export function errorKindOf(e: unknown, signedIn: boolean): ReportErrorKind {
  const x = e as { status?: number; code?: string } | null;
  if (x?.code === 'rate_limited' || x?.status === 429) return signedIn ? 'limitUser' : 'limitAnon';
  if (x?.code === 'invalid_upload' || x?.code === 'image_too_large') return 'tooBig';
  return 'generic';
}
