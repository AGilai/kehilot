import { ApiCodeError } from '../client/errors.ts';
import type { UploadGrant } from '../client/types.ts';

/**
 * Direct PUT to S3: a plain `fetch` with exactly the grant's headers (never `Authorization`, never through
 * the API client). The URL is a 300 s secret; it is not logged and does not appear in errors.
 */
export async function putToS3(grant: Pick<UploadGrant, 'url' | 'headers'>, blob: Blob, doFetch: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await doFetch(grant.url, { method: 'PUT', headers: { ...grant.headers }, body: blob, credentials: 'omit' });
  } catch {
    throw new ApiCodeError(0, 'upload_failed'); // the fetch error text can carry the URL
  }
  if (res.ok) return;
  throw new ApiCodeError(res.status, res.status === 403 ? 'upload_expired' : 'upload_failed');
}

const retryable = (e: unknown) => e instanceof ApiCodeError && (e.code === 'upload_expired' || e.code === 'image_not_found');

/**
 * Grant, PUT, then publish with the upload ID. An expired grant (S3 403) or an unknown upload at publish
 * (`image_not_found`) runs the whole sequence again, once. Anything else, `rate_limited` included, is not retried.
 */
export async function attachAndPost<T>(d: {
  requestUpload: () => Promise<UploadGrant>;
  put: (grant: UploadGrant) => Promise<void>;
  post: (uploadId: string) => Promise<T>;
}): Promise<T> {
  const once = async () => {
    const grant = await d.requestUpload();
    await d.put(grant);
    return d.post(grant.uploadId);
  };
  try { return await once(); } catch (e) {
    if (!retryable(e)) throw e;
    return once();
  }
}
