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

/** The newer build and its APK link; `replied` is false when no usable answer came (offline, non-200, bad JSON). Never throws; sends nothing about the user. */
export async function checkLatest(fetchFn: typeof fetch, repo: string, installed: number): Promise<{ replied: boolean; update: { build: number; url: string } | null }> {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status !== 200) return { replied: false, update: null };
    const body = await res.json() as { tag_name?: unknown; assets?: unknown };
    const tag = typeof body.tag_name === 'string' ? body.tag_name : '';
    if (!isNewer(tag, installed)) return { replied: true, update: null };
    const assets = Array.isArray(body.assets) ? body.assets as { name?: unknown; browser_download_url?: unknown }[] : [];
    const apk = assets.find(a => typeof a?.name === 'string' && a.name.endsWith('.apk') && typeof a.browser_download_url === 'string');
    return { replied: true, update: apk ? { build: parseBuildNumber(tag)!, url: apk.browser_download_url as string } : null };
  } catch {
    return { replied: false, update: null };
  }
}

/** The newer build and its APK link, or null (up to date, offline, no APK, any failure). */
export async function checkForUpdate(fetchFn: typeof fetch, repo: string, installed: number): Promise<{ build: number; url: string } | null> {
  return (await checkLatest(fetchFn, repo, installed)).update;
}

/** What the card shows: nothing until the dismissed build is known (`dismissed` null), then only a build newer than both the installed and the dismissed one. */
export function visibleUpdate(found: { build: number; url: string } | null, dismissed: number | null, installed: number) {
  return found && dismissed !== null && found.build > dismissed && found.build > installed ? found : null;
}
