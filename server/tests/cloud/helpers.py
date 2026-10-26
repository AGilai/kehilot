import os

import boto3

from server.cloud.repo import TABLE_SCHEMA

os.environ.setdefault('AWS_DEFAULT_REGION', 'il-central-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')


def make_table(name='kehilot-test'):
    """Create the app table in moto. Call inside an active mock_aws context."""
    dynamodb = boto3.resource('dynamodb', region_name='il-central-1')
    return dynamodb.create_table(TableName=name, **TABLE_SCHEMA)


MEDIA_BUCKET = 'kehilot-test-media'


def make_bucket(name=MEDIA_BUCKET):
    """Create the media bucket in moto and point MEDIA_BUCKET at it. Call inside an active mock_aws context;
    the caller removes the env var (mock.patch.dict) and clears media.s3_client's cache."""
    os.environ['MEDIA_BUCKET'] = name
    client = boto3.client('s3', region_name='il-central-1')
    client.create_bucket(Bucket=name, CreateBucketConfiguration={'LocationConstraint': 'il-central-1'})
    return client
