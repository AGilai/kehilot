"""All DynamoDB access for the cloud API. Every Kehila-scoped key starts with K#<kehila>."""
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import Binary
from botocore.exceptions import ClientError

from .errors import ApiError
from .ids import new_id
from .repo_families import FamiliesRepo
from .repo_members import AdminRepo, MembersRepo
from .repo_messages import MessagesRepo
from .repo_reports import ReportsRepo
from .repo_schedule import ScheduleRepo
from .repo_tags import TagsRepo

TABLE_SCHEMA = dict(
    KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
    AttributeDefinitions=[{'AttributeName': name, 'AttributeType': 'S'}
                          for name in ('pk', 'sk', 'gsi1pk', 'gsi1sk')],
    GlobalSecondaryIndexes=[{
        'IndexName': 'gsi1',
        'KeySchema': [{'AttributeName': 'gsi1pk', 'KeyType': 'HASH'},
                      {'AttributeName': 'gsi1sk', 'KeyType': 'RANGE'}],
        'Projection': {'ProjectionType': 'ALL'},
    }],
    BillingMode='PAY_PER_REQUEST',
)

class Repo(MembersRepo, AdminRepo, MessagesRepo, FamiliesRepo, TagsRepo, ReportsRepo, ScheduleRepo):
    def __init__(self, table):
        self.table = table

    def _get(self, pk, sk):
        return self.table.get_item(Key={'pk': pk, 'sk': sk}).get('Item')

    def get_sub(self, sub):
        """The U#<sub> mapping item: {userId} or the deletion tombstone {deleted: True}; None when unknown."""
        return self.table.get_item(Key={'pk': f'U#{sub}', 'sk': 'SUB'}, ConsistentRead=True).get('Item')

    def get_user_id(self, sub):
        item = self.get_sub(sub)
        return item.get('userId') if item else None

    def create_user_id(self, sub, user_id):
        # Email is not stored: it comes from the ID token on every request, so it never goes stale.
        try:
            self.table.put_item(Item={'pk': f'U#{sub}', 'sk': 'SUB', 'userId': user_id},
                                ConditionExpression='attribute_not_exists(pk)',
                                ReturnValuesOnConditionCheckFailure='ALL_OLD')
            return user_id
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            winner = error.response['Item']
            if 'userId' not in winner:  # a tombstone appeared between the read and the write
                raise ApiError(401, 'account_deleted')
            return winner['userId']['S']  # the winner of a concurrent first login

    def mark_imported_account(self, sub, user_id):
        """An account the list import created: flag it until its first API call, and keep sub for the gabbai's
        removal (`U#<user>/SUBREF`)."""
        self.table.update_item(Key={'pk': f'U#{sub}', 'sk': 'SUB'}, UpdateExpression='SET neverSignedIn = :t',
                               ConditionExpression='attribute_exists(userId)', ExpressionAttributeValues={':t': True})
        self.table.put_item(Item={'pk': f'U#{user_id}', 'sk': 'SUBREF', 'sub': sub})

    def clear_never_signed_in(self, sub):
        try:
            self.table.update_item(Key={'pk': f'U#{sub}', 'sk': 'SUB'}, UpdateExpression='REMOVE neverSignedIn',
                                   ConditionExpression='attribute_exists(userId)')
        except ClientError as error:  # a tombstone appeared meanwhile: nothing to clear
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

    def get_sub_ref(self, user_id):
        return (self._get(f'U#{user_id}', 'SUBREF') or {}).get('sub')

    def get_kehila(self, k):
        # META holds no logo bytes any more (they live in K#<k>/LOGO), so a plain get is already small
        return self.table.get_item(Key={'pk': f'K#{k}', 'sk': 'META'}).get('Item')

    def get_membership(self, k, user_id):
        return self._get(f'K#{k}', f'M#{user_id}')

    def list_memberships(self, user_id):
        items, kwargs = [], {}
        while True:
            page = self.table.query(IndexName='gsi1', KeyConditionExpression=Key('gsi1pk').eq(f'U#{user_id}'),
                                    **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def put_kehila(self, k, name):
        self.table.put_item(Item={'pk': f'K#{k}', 'sk': 'META', 'kehilaId': k, 'name': name})

    def set_logo(self, k, data):
        """Replace the logo item and META.logoVersion together; raises LookupError when the Kehila does not exist."""
        version = new_id()
        try:
            self.table.meta.client.transact_write_items(TransactItems=[
                {'Update': {'TableName': self.table.name, 'Key': {'pk': f'K#{k}', 'sk': 'META'},
                            'UpdateExpression': 'SET logoVersion = :v',
                            'ConditionExpression': 'attribute_exists(pk)',
                            'ExpressionAttributeValues': {':v': version}}},
                {'Put': {'TableName': self.table.name,
                         'Item': {'pk': f'K#{k}', 'sk': 'LOGO', 'logo': Binary(data), 'logoVersion': version}}},
            ])
        except ClientError as error:
            if error.response['Error']['Code'] != 'TransactionCanceledException':
                raise
            if any(r.get('Code') == 'ConditionalCheckFailed' for r in error.response.get('CancellationReasons', [])):
                raise LookupError(k)
            raise
        return version

    def get_logo(self, k):
        """(logoVersion, png bytes), or None when the Kehila has no logo."""
        item = self._get(f'K#{k}', 'LOGO')
        if not item:
            return None
        logo = item['logo']
        return item['logoVersion'], bytes(logo.value if isinstance(logo, Binary) else logo)

    def put_membership(self, k, user_id, role, classification=''):
        self.table.put_item(Item={'pk': f'K#{k}', 'sk': f'M#{user_id}', 'gsi1pk': f'U#{user_id}',
                                  'gsi1sk': f'K#{k}', 'kehilaId': k, 'userId': user_id, 'role': role,
                                  'classification': classification})
