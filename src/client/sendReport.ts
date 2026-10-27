import type { UploadGrant } from './types.ts';
import type { ReportContext } from './reportContext.ts';
import { attachAndPost } from '../media/upload.ts';

export type ReportApi = {
  requestReportUpload(o: { contentType: 'image/jpeg' | 'image/png'; bytes: number }): Promise<UploadGrant>;
  postReport(o: { text: string; context: ReportContext; imageUploadId?: string }): Promise<{ reportId: string }>;
  postAnonymousReport(o: { text: string; context: ReportContext }): Promise<{ reportId: string }>;
};

/**
 * Sends one report. Signed out: text only, through the public route. Signed in with a picture: re-encode,
 * grant, PUT to S3, then post with the upload ID (one retry on an expired grant, see `attachAndPost`).
 * `prepare` returns the re-encoded picture as a blob; it throws `image_too_large` when it cannot fit.
 */
export async function sendReport(o: {
  signedIn: boolean; text: string; context: ReportContext; api: ReportApi;
  image: { prepare: () => Promise<Blob>; put: (g: UploadGrant, b: Blob) => Promise<void> } | null;
}): Promise<void> {
  const text = o.text.trim();
  if (!o.signedIn) { await o.api.postAnonymousReport({ text, context: o.context }); return; }
  if (!o.image) { await o.api.postReport({ text, context: o.context }); return; }
  const blob = await o.image.prepare();
  const img = o.image;
  await attachAndPost({
    requestUpload: () => o.api.requestReportUpload({ contentType: 'image/jpeg', bytes: blob.size }),
    put: g => img.put(g, blob),
    post: id => o.api.postReport({ text, context: o.context, imageUploadId: id }),
  });
}
