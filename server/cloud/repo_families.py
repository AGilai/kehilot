"""Family items (K#<k> / F#<familyId>): one per member or gabbai household."""
import time

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from .errors import ApiError
from .ids import new_id


class FamiliesRepo:
    def get_family(self, k, family_id):
        return self.table.get_item(Key=self._key(k, f'F#{family_id}'), ConsistentRead=True).get('Item')

    def list_kehila_ids(self):
        """Every Kehila ID (a scan for META items: operator tools only)."""
        ids, kwargs = [], {}
        while True:
            page = self.table.scan(FilterExpression=Attr('sk').eq('META'), ProjectionExpression='pk', **kwargs)
            ids += [item['pk'][len('K#'):] for item in page['Items']]
            if 'LastEvaluatedKey' not in page:
                return ids
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def _ensure_family(self, k, user_id):
        """(familyId or None, created). None: a listener or no membership."""
        membership = self.get_membership(k, user_id)
        if not membership or membership.get('role') not in ('member', 'gabbai'):
            return None, False
        if membership.get('familyId'):
            return membership['familyId'], False
        family_id = new_id()
        family = {'pk': f'K#{k}', 'sk': f'F#{family_id}', 'familyId': family_id, 'adults': [user_id],
                  'children': [], 'version': 1, 'createdAt': int(time.time())}
        try:
            self._txn([
                {'Put': {'TableName': self.table.name, 'Item': family,
                         'ConditionExpression': 'attribute_not_exists(sk)'}},
                {'Update': {'TableName': self.table.name, 'Key': self._key(k, f'M#{user_id}'),
                            'UpdateExpression': 'SET familyId = :f',
                            'ConditionExpression': 'attribute_exists(sk) AND attribute_not_exists(familyId) '
                                                   'AND #r IN (:member, :gabbai)',
                            'ExpressionAttributeNames': {'#r': 'role'},
                            'ExpressionAttributeValues': {':f': family_id, ':member': 'member',
                                                          ':gabbai': 'gabbai'}}},
            ])
        except ClientError as error:
            if error.response['Error']['Code'] != 'TransactionCanceledException':
                raise
            current = self.get_membership(k, user_id)  # lost a race, became a listener, or left
            return (current or {}).get('familyId'), False
        return family_id, True

    def ensure_family(self, k, user_id):
        """The familyId of a member or gabbai, creating a one-adult family when the membership has none.
        None for a listener or a missing membership. Idempotent."""
        return self._ensure_family(k, user_id)[0]

    def family_of(self, k, user_id):
        """The family item of the user's membership (never creates one), or None."""
        membership = self.get_membership(k, user_id)
        family_id = (membership or {}).get('familyId')
        return self.get_family(k, family_id) if family_id else None

    def update_children(self, k, family_id, change):
        """Read the family, apply change(children) -> children, write with a version check. A lost race re-reads
        and re-applies (3 tries, then 409 try_again). `change` may raise ApiError. Returns the new item."""
        for _ in range(3):
            family = self.get_family(k, family_id)
            if not family:
                raise ApiError(404, 'family_not_found')
            version = int(family['version'])
            children = change(list(family.get('children') or []))
            try:
                return self.table.update_item(
                    Key=self._key(k, f'F#{family_id}'), UpdateExpression='SET children = :c, version = :v1',
                    ConditionExpression='version = :v',
                    ExpressionAttributeValues={':c': children, ':v': version, ':v1': version + 1},
                    ReturnValues='ALL_NEW')['Attributes']
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
        raise ApiError(409, 'try_again')
