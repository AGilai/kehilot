import type { KeyValue } from '../auth/tokens.ts';
import { config } from '../config.ts';
import { ApiCodeError } from './errors.ts';
import type { Role } from './types.ts';

export type ParsedLink = { kind: 'join'; code: string } | { kind: 'authCallback' } | null;

/** Same as server `normalize_code`: trim, upper case, I and L read as 1, O as 0. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
}

/** Codes are 10 Crockford base32 characters (no I, L, O, U after normalising). */
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
export function validCode(code: string): boolean {
  return CODE_RE.test(code);
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export function inviteUrl(code: string, webUrl: string = config.webUrl): string {
  return `${trimSlash(webUrl)}/join/${code}`;
}

/**
 * Reads an incoming link or a typed code. Only the app's own web origin, localhost:8081 and the
 * `shul://` scheme are accepted; any other host gives null.
 */
export function parseLink(input: string, opts: { webUrl?: string } = {}): ParsedLink {
  const webUrl = trimSlash(opts.webUrl ?? config.webUrl);
  const s = input.trim();
  if (!s) return null;
  const bare = normalizeCode(s);
  if (validCode(bare)) return { kind: 'join', code: bare };
  const origins = ['http://localhost:8081', ...(webUrl ? [webUrl] : [])];
  let rest: string | null = null;
  let authish = false;
  const lower = s.toLowerCase();
  if (lower.startsWith('shul://')) {
    rest = s.slice('shul://'.length);
    authish = /^auth(?:[/?#]|$)/i.test(rest);
  } else {
    const origin = origins.find(o => lower.startsWith(`${o.toLowerCase()}/`) || lower === o.toLowerCase());
    if (origin) {
      rest = s.slice(origin.length).replace(/^\//, '');
      authish = /^auth\/callback(?:[/?#]|$)/i.test(rest);
    }
  }
  if (rest === null) return null;
  if (authish) return { kind: 'authCallback' };
  const m = /^join\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(rest);
  if (!m) return null;
  let raw = m[1]!;
  try { raw = decodeURIComponent(raw); } catch { return null; }
  const code = normalizeCode(raw);
  return validCode(code) ? { kind: 'join', code } : null;
}

export const PENDING_INVITE_KEY = 'kehilot.pendingInvite';
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AcceptOutcome =
  | { status: 'none' }
  | { status: 'joined'; kehilaId: string; role: Role }
  /** `removed`: the invite was dropped (a definitive answer); otherwise it stays for a later try. */
  | { status: 'error'; code: string; removed: boolean };

/** Errors that may go away on their own, or after the profile is saved: keep the invite. */
const KEEP = new Set(['try_again', 'profile_required']);

/**
 * The invite code waiting for sign-in or the profile step, `{code, at}` under one key.
 * It is accepted once and removed after every definitive outcome.
 */
export function createPendingInvite(storage: KeyValue, now: () => number = Date.now) {
  let inflight = false;
  async function clear(): Promise<void> {
    try { await storage.remove(PENDING_INVITE_KEY); } catch { /* ignore */ }
  }
  async function get(): Promise<string | null> {
    let raw: string | null = null;
    try { raw = await storage.get(PENDING_INVITE_KEY); } catch { return null; }
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as { code?: unknown; at?: unknown };
      if (typeof v.code === 'string' && typeof v.at === 'number' && validCode(v.code) && now() - v.at <= PENDING_TTL_MS) return v.code;
    } catch { /* fall through */ }
    await clear();
    return null;
  }
  async function set(code: string): Promise<void> {
    try { await storage.set(PENDING_INVITE_KEY, JSON.stringify({ code, at: now() })); } catch { /* the invite is only a convenience */ }
  }
  async function accept(run: (code: string) => Promise<{ kehilaId: string; role: Role }>): Promise<AcceptOutcome> {
    if (inflight) return { status: 'none' };
    inflight = true;
    try {
      const code = await get();
      if (!code) return { status: 'none' };
      try {
        const r = await run(code);
        await clear();
        return { status: 'joined', kehilaId: r.kehilaId, role: r.role };
      } catch (e) {
        const c = e instanceof ApiCodeError ? e.code : '';
        const keep = !(e instanceof ApiCodeError) || KEEP.has(c) || e.status >= 500;
        if (!keep) await clear();
        return { status: 'error', code: c || 'generic', removed: !keep };
      }
    } finally {
      inflight = false;
    }
  }
  return { get, set, clear, accept };
}

export type PendingInvite = ReturnType<typeof createPendingInvite>;
