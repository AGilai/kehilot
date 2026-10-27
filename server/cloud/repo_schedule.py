"""Prayer schedule items: K#<k>/SCHED (sections, updatedAt) and K#<k>/SCHEDWK#<friday> (one week's overrides, TTL)."""
import time

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from .errors import ApiError
from .schedule_rules import plain, stored


class ScheduleRepo:
    def get_schedule(self, k):
        item = self.table.get_item(Key={'pk': f'K#{k}', 'sk': 'SCHED'}, ConsistentRead=True).get('Item')
        return plain(item) if item else None

    def put_schedule(self, k, sections, if_updated_at, check):
        """Full replace. `check` = True when the caller sent ifUpdatedAt (None then means "expects no schedule yet").
        Optimistic: the write is conditional on the updatedAt that was read. -> the new updatedAt (ms, strictly rising)."""
        current = self.get_schedule(k)
        old = current['updatedAt'] if current else None
        if check and if_updated_at != old:
            raise ApiError(409, 'schedule_changed')
        new = max(int(time.time() * 1000), (old or 0) + 1)
        condition = 'attribute_not_exists(sk)' if old is None else 'updatedAt = :old'
        try:
            self.table.put_item(Item={'pk': f'K#{k}', 'sk': 'SCHED', 'sections': stored(sections), 'updatedAt': new},
                                ConditionExpression=condition,
                                **({} if old is None else {'ExpressionAttributeValues': {':old': old}}))
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(409, 'schedule_changed' if check else 'try_again')
        return new

    def put_week_overrides(self, k, friday, overrides, expires_at):
        self.table.put_item(Item={'pk': f'K#{k}', 'sk': f'SCHEDWK#{friday}', 'overrides': stored(overrides),
                                  'expiresAt': expires_at})

    def delete_week_overrides(self, k, friday):
        self.table.delete_item(Key={'pk': f'K#{k}', 'sk': f'SCHEDWK#{friday}'})

    def get_week_overrides(self, k, fridays, now):
        """{friday: overrides} for the given Fridays; expired items (TTL not yet swept) are left out."""
        found = {}
        for friday in fridays:
            item = self.table.get_item(Key={'pk': f'K#{k}', 'sk': f'SCHEDWK#{friday}'}, ConsistentRead=True).get('Item')
            if item and int(item['expiresAt']) > now:
                found[friday] = plain(item['overrides'])
        return found
