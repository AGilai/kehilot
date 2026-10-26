"""All DynamoDB access for the cloud API. Every Kehila-scoped key starts with K#<kehila>."""
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from .repo_members import AdminRepo, MembersRepo

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


class Repo(MembersRepo, AdminRepo):
    def __init__(self, table):
        self.table = table

    def _get(self, pk, sk):
        return self.table.get_item(Key={'pk': pk, 'sk': sk}).get('Item')

    def get_user_id(self, sub):
        item = self.table.get_item(Key={'pk': f'U#{sub}', 'sk': 'SUB'}, ConsistentRead=True).get('Item')
        return item['userId'] if item else None

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
            return error.response['Item']['userId']['S']  # the winner of a concurrent first login

    def get_kehila(self, k):
        return self._get(f'K#{k}', 'META')

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

    def put_membership(self, k, user_id, role, classification=''):
        self.table.put_item(Item={'pk': f'K#{k}', 'sk': f'M#{user_id}', 'gsi1pk': f'U#{user_id}',
                                  'gsi1sk': f'K#{k}', 'kehilaId': k, 'userId': user_id, 'role': role,
                                  'classification': classification})
