// Owner-only Android test channel: the latest GitHub release tells the installed test build whether a newer one exists.
const TAG = /^android-test-(\d+)$/;

/** `android-test-<digits>` -> the CI run number, anything else -> null. */
export function parseBuildNumber(tag: string): number | null {
  const m = TAG.exec(tag);
  return m ? Number(m[1]) : null;
}

export function isNewer(latestTag: string, installed: number): boolean {
  const n = parseBuildNumber(latestTag);
  return n !== null && n > installed;
}

export const CHECK_INTERVAL_MS = 6 * 3600_000;

export function shouldCheck(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= CHECK_INTERVAL_MS;
}

/** The newer build and its APK link, or null (up to date, offline, no APK, any failure). Never throws; sends nothing about the user. */
export async function checkForUpdate(fetchFn: typeof fetch, repo: string, installed: number): Promise<{ build: number; url: string } | null> {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status !== 200) return null;
    const body = await res.json() as { tag_name?: unknown; assets?: unknown };
    const tag = typeof body.tag_name === 'string' ? body.tag_name : '';
    if (!isNewer(tag, installed)) return null;
    const assets = Array.isArray(body.assets) ? body.assets as { name?: unknown; browser_download_url?: unknown }[] : [];
    const apk = assets.find(a => typeof a?.name === 'string' && a.name.endsWith('.apk') && typeof a.browser_download_url === 'string');
    return apk ? { build: parseBuildNumber(tag)!, url: apk.browser_download_url as string } : null;
  } catch {
    return null;
  }
}
