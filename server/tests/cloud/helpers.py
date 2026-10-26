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
