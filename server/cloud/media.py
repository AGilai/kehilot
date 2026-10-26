"""Brochure images in S3 (spec 3c): presigned PUT into `up/`, a checked copy to `m/`, short-lived GET URLs.
Presigned URLs and keys are secrets of a sort: never log them, never put them in JSON lists or the feed."""
import functools
import logging
import os

from .errors import ApiError

log = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 1048576
IMAGE_TYPES = {'image/jpeg': b'\xff\xd8\xff', 'image/png': b'\x89PNG\r\n\x1a\n'}
EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png'}
URL_SECONDS = 300
UPLOAD_HOURLY_LIMIT = 20
MISSING = ('404', '403', 'NoSuchKey', 'NotFound', 'AccessDenied')  # no s3:ListBucket: a missing key answers 403


def _region():
    return os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION') or 'il-central-1'


@functools.cache
def s3_client():
    import boto3
    from botocore.config import Config
    region = _region()
    return boto3.client('s3', region_name=region, endpoint_url=f'https://s3.{region}.amazonaws.com',
                        config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'}))


def bucket():
    name = os.environ.get('MEDIA_BUCKET')
    if not name:
        raise RuntimeError('MEDIA_BUCKET is not set')
    return name


def upload_key(k, user_id, upload_id):
    return f'up/{k}/{user_id}/{upload_id}'


def image_key(k, message_id):
    return f'm/{k}/{message_id}'


def _codes(error):
    response = getattr(error, 'response', None) or {}
    return {str(response.get('Error', {}).get('Code')), str(response.get('ResponseMetadata', {}).get('HTTPStatusCode'))}


def _try_again(error):
    """503 try_again; the log gets the AWS error code and operation only (no key, no URL, no message)."""
    code = (getattr(error, 'response', None) or {}).get('Error', {}).get('Code', '?')
    log.warning('s3 error %s %s', code, getattr(error, 'operation_name', '?'))
    return ApiError(503, 'try_again')


def presign_put(key, content_type, size):
    return s3_client().generate_presigned_url(
        'put_object', Params={'Bucket': bucket(), 'Key': key, 'ContentType': content_type, 'ContentLength': size},
        ExpiresIn=URL_SECONDS)


def _discard(key):
    try:
        s3_client().delete_object(Bucket=bucket(), Key=key)
    except Exception as error:  # best effort: the upload would otherwise only wait for a lifecycle rule
        code = (getattr(error, 'response', None) or {}).get('Error', {}).get('Code', type(error).__name__)
        log.warning('s3 discard failed %s', code)


def claim_upload(k, user_id, upload_id, message_id):
    """Check the caller's upload and move it to the message's key. Returns {contentType, bytes}."""
    from botocore.exceptions import ClientError
    client, name, source = s3_client(), bucket(), upload_key(k, user_id, upload_id)
    try:
        head = client.head_object(Bucket=name, Key=source)
    except ClientError as error:
        if _codes(error) & set(MISSING):
            raise ApiError(400, 'image_not_found')
        raise _try_again(error)
    content_type, size = head.get('ContentType'), int(head['ContentLength'])
    if size > MAX_IMAGE_BYTES or content_type not in IMAGE_TYPES:
        _discard(source)
        raise ApiError(400, 'invalid_image')
    try:
        first = client.get_object(Bucket=name, Key=source, Range='bytes=0-7')['Body'].read()
    except ClientError as error:
        if _codes(error) & set(MISSING):
            raise ApiError(400, 'image_not_found')
        raise _try_again(error)
    if not first.startswith(IMAGE_TYPES[content_type]):
        _discard(source)
        raise ApiError(400, 'invalid_image')
    try:
        client.copy_object(Bucket=name, Key=image_key(k, message_id), CopySource={'Bucket': name, 'Key': source},
                           MetadataDirective='REPLACE', ContentType=content_type,
                           CacheControl=f'private, max-age={URL_SECONDS}')
        client.delete_object(Bucket=name, Key=source)
    except ClientError as error:
        raise _try_again(error)
    return {'contentType': content_type, 'bytes': size}


def presign_get(k, message_id, content_type):
    ext = EXTENSIONS.get(content_type, 'jpg')
    return s3_client().generate_presigned_url(
        'get_object', Params={'Bucket': bucket(), 'Key': image_key(k, message_id), 'ResponseContentType': content_type,
                              'ResponseContentDisposition': f'inline; filename="{message_id}.{ext}"'},
        ExpiresIn=URL_SECONDS)


def delete_image(k, message_id):
    """Idempotent (S3 answers 204 for a missing key). An S3 error is 503 try_again."""
    from botocore.exceptions import ClientError
    try:
        s3_client().delete_object(Bucket=bucket(), Key=image_key(k, message_id))
    except ClientError as error:
        raise _try_again(error)
