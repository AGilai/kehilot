"""Role tags (spec item 9): Kehila-level `TAG#<id>` items with a `name`; a membership holds `tagIds` (string set).
Labels only: nothing in visibility or posting reads them."""
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from .errors import ApiError
from .ids import new_id


class TagsRepo:
    def list_tags(self, k):
        return self._query_prefix(k, 'TAG#')

    def put_tag(self, k, name):
        item = {**self._key(k, f'TAG#{new_id()}'), 'name': name}
        self.table.put_item(Item=item)
        return item

    def rename_tag(self, k, tag_id, name):
        try:
            self.table.update_item(Key=self._key(k, f'TAG#{tag_id}'), UpdateExpression='SET #n = :n',
                                   ConditionExpression='attribute_exists(sk)',
                                   ExpressionAttributeNames={'#n': 'name'}, ExpressionAttributeValues={':n': name})
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(404, 'tag_not_found')

    def delete_tag(self, k, tag_id):
        """Delete the tag, then remove its ID from every membership holding it. If the sweep is cut short the
        stale IDs are harmless: every read filters on the Kehila's existing tags."""
        try:
            self.table.delete_item(Key=self._key(k, f'TAG#{tag_id}'), ConditionExpression='attribute_exists(sk)')
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(404, 'tag_not_found')
        for member in self._query_prefix(k, 'M#', Attr('tagIds').contains(tag_id)):
            try:
                self.table.update_item(Key={'pk': member['pk'], 'sk': member['sk']},
                                       UpdateExpression='DELETE tagIds :t', ConditionExpression='attribute_exists(sk)',
                                       ExpressionAttributeValues={':t': {tag_id}})
            except ClientError as error:  # the member left meanwhile
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise

    def set_member_tags(self, k, user_id, tag_ids):
        """Replace the member's tags; 404 member_not_found when the membership has gone."""
        if tag_ids:
            self._update_member_item(k, user_id, 'SET tagIds = :t', {':t': set(tag_ids)})
        else:
            self._update_member_item(k, user_id, 'REMOVE tagIds', None)
