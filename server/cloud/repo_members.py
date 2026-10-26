"""Profiles and push devices: per-user data, not scoped to a Kehila."""
from datetime import datetime, timezone

from boto3.dynamodb.conditions import Key


class MembersRepo:
    def get_profile(self, user_id):
        item = self._get(f'U#{user_id}', 'PROFILE')
        return {'firstName': item['firstName'], 'lastName': item['lastName'], 'lang': item['lang']} if item else None

    def put_profile(self, user_id, first, last, lang):
        self.table.put_item(Item={'pk': f'U#{user_id}', 'sk': 'PROFILE',
                                  'firstName': first, 'lastName': last, 'lang': lang})

    def put_device(self, user_id, token, platform):
        # A device token belongs to one user: whoever registered it last owns it.
        page = self.table.query(IndexName='gsi1', KeyConditionExpression=Key('gsi1pk').eq(f'TOK#{token}'))
        for item in page['Items']:
            if item['pk'] != f'U#{user_id}':
                self.table.delete_item(Key={'pk': item['pk'], 'sk': item['sk']})
        self.table.put_item(Item={'pk': f'U#{user_id}', 'sk': f'D#{token}', 'gsi1pk': f'TOK#{token}',
                                  'gsi1sk': f'U#{user_id}', 'token': token, 'platform': platform,
                                  'lastSeen': datetime.now(timezone.utc).isoformat()})

    def delete_device(self, user_id, token):
        self.table.delete_item(Key={'pk': f'U#{user_id}', 'sk': f'D#{token}'})

    def list_devices(self, user_id):
        items, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'U#{user_id}') & Key('sk').begins_with('D#'),
                                    **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return [{'token': i['token'], 'platform': i['platform'], 'lastSeen': i['lastSeen']} for i in items]
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
