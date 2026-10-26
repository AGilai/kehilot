import type { Message, UploadGrant } from '../client/types.ts';
import { blobOf, prepareDeps } from './device.ts';
import type { Picked } from './device.ts';
import { prepareImage } from './prepare.ts';
import { attachAndPost, putToS3 } from './upload.ts';

export type Stage = 'preparing' | 'uploading' | 'publishing';

/**
 * Posts a message, with its image when there is one: re-encode, grant, PUT straight to S3, then post with the
 * upload ID (see `attachAndPost` for the single retry). `bytes` in the grant request is the real blob size,
 * because S3 signs the Content-Length.
 */
export async function sendMessage(o: {
  image: Picked | null;
  channelId: string;
  requestUpload: (o: { channelId: string; contentType: 'image/jpeg'; bytes: number }) => Promise<UploadGrant>;
  post: (imageUploadId: string | undefined) => Promise<Message>;
  onStage: (s: Stage) => void;
}): Promise<Message> {
  if (!o.image) { o.onStage('publishing'); return o.post(undefined); }
  o.onStage('preparing');
  const prepared = await prepareImage(o.image.uri, prepareDeps);
  const blob = await blobOf(prepared.uri);
  return attachAndPost({
    requestUpload: () => { o.onStage('uploading'); return o.requestUpload({ channelId: o.channelId, contentType: 'image/jpeg', bytes: blob.size }); },
    put: g => putToS3(g, blob),
    post: id => { o.onStage('publishing'); return o.post(id); },
  });
}
