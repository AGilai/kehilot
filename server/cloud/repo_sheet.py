"""Weekly sheet items: K#<k>/SHI#<friday>#<itemId>, one item per line on one week's sheet (TTL via expiresAt)."""
from datetime import date

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from .errors import ApiError
from .schedule_rules import plain, week_expiry

SHI = 'SHI#'


def _failed(error, code):
    return error.response['Error']['Code'] == code


class SheetRepo:
    def _shi_key(self, k, friday, item_id):
        return {'pk': f'K#{k}', 'sk': f'{SHI}{friday}#{item_id}'}

    def put_sheet_item(self, k, friday, item):
        """Create the item; a second put of the same itemId (a retried post) changes nothing and returns the first."""
        full = {**self._shi_key(k, friday, item['itemId']), **item,
                'expiresAt': week_expiry(date.fromisoformat(friday))}
        try:
            self.table.put_item(Item=full, ConditionExpression='attribute_not_exists(sk)')
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            return self.get_sheet_item(k, friday, item['itemId'])
        return plain(full)

    def get_sheet_item(self, k, friday, item_id):
        found = self.table.get_item(Key=self._shi_key(k, friday, item_id), ConsistentRead=True).get('Item')
        return plain(found) if found else None

    def list_sheet_items(self, k, friday, now):
        items, kwargs = [], {'KeyConditionExpression': Key('pk').eq(f'K#{k}') & Key('sk').begins_with(f'{SHI}{friday}#'),
                             'ConsistentRead': True}
        while True:
            page = self.table.query(**kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                break
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
        live = [plain(i) for i in items if int(i['expiresAt']) > now]
        return sorted(live, key=lambda i: (i['group'], i['order']))

    def update_sheet_item(self, k, friday, item_id, sets, removes=()):
        names, values = {}, {}
        parts = []
        for n, (name, value) in enumerate(sets.items()):
            names[f'#s{n}'], values[f':s{n}'] = name, value
            parts.append(f'#s{n} = :s{n}')
        expression = 'SET ' + ', '.join(parts) if parts else ''
        if removes:
            for n, name in enumerate(removes):
                names[f'#r{n}'] = name
            expression += ' REMOVE ' + ', '.join(f'#r{n}' for n in range(len(removes)))
        try:
            out = self.table.update_item(Key=self._shi_key(k, friday, item_id), UpdateExpression=expression.strip(),
                                         ConditionExpression='attribute_exists(sk)', ExpressionAttributeNames=names,
                                         **({'ExpressionAttributeValues': values} if values else {}),
                                         ReturnValues='ALL_NEW')
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(404, 'item_not_found')
        return plain(out['Attributes'])

    def swap_sheet_order(self, k, friday, a, b):
        """Exchange the two items' order keys in one transaction; either changed since it was read -> 409 try_again."""
        def move(item, new):
            return {'Update': {'TableName': self.table.name, 'Key': self._shi_key(k, friday, item['itemId']),
                               'UpdateExpression': 'SET #o = :new', 'ConditionExpression': '#o = :old',
                               'ExpressionAttributeNames': {'#o': 'order'},
                               'ExpressionAttributeValues': {':new': new['order'], ':old': item['order']}}}
        try:
            self.table.meta.client.transact_write_items(TransactItems=[move(a, b), move(b, a)])
        except ClientError as error:
            if not _failed(error, 'TransactionCanceledException'):
                raise
            raise ApiError(409, 'try_again')

    def delete_sheet_item(self, k, friday, item_id):
        self.table.delete_item(Key=self._shi_key(k, friday, item_id))

    def set_message_sheet_week(self, k, message_id, friday):
        expression, values = ('SET sheetWeek = :w', {':w': friday}) if friday else ('REMOVE sheetWeek', None)
        self.table.update_item(Key={'pk': f'K#{k}', 'sk': f'MSG#{message_id}'}, UpdateExpression=expression,
                               ConditionExpression='attribute_exists(sk)',
                               **({'ExpressionAttributeValues': values} if values else {}))
