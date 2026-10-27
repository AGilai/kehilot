"""Bug reports (RPT#): one partition `RPT` (fine at this volume), rate-limit counters in `RPTLIM`.
Reads are for the owner's tooling (deployer role) and the user's own export/deletion; no API route returns a report."""
import time

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from .errors import ApiError

REPORT_TTL = 180 * 86400
LIMIT_TTL = 86400
STATUSES = ('new', 'triaged', 'fixed', 'owner_decision', 'rejected', 'duplicate')
KINDS = ('bug', 'change_request', 'unclear')
PREFIX = 'RPT#'


def _failed(error, *codes):
    return error.response['Error']['Code'] in codes


class ReportsRepo:
    def count_report(self, name, limit):
        """Conditional ADD on counter `name` (TTL one day): the limit holds under concurrency. 429 rate_limited."""
        try:
            self.table.update_item(
                Key={'pk': 'RPTLIM', 'sk': name},
                UpdateExpression='ADD #c :one SET expiresAt = :e',
                ConditionExpression='attribute_not_exists(#c) OR #c < :limit',
                ExpressionAttributeNames={'#c': 'count'},
                ExpressionAttributeValues={':one': 1, ':limit': limit, ':e': int(time.time()) + LIMIT_TTL})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(429, 'rate_limited')

    def put_report(self, report_id, text, context, user_id=None, image=None, now=None):
        now = int(now if now is not None else time.time())
        item = {'pk': 'RPT', 'sk': f'{PREFIX}{report_id}', 'status': 'new', 'text': text, 'context': context,
                'createdAt': now, 'expiresAt': now + REPORT_TTL}
        if user_id:
            item['userId'] = user_id
        if image:
            item['image'] = image
        self.table.put_item(Item=item, ConditionExpression='attribute_not_exists(sk)')
        return item

    def get_report(self, report_id):
        return self._get('RPT', f'{PREFIX}{report_id}')

    def _reports(self, condition=None):
        items, kwargs = [], {'KeyConditionExpression': Key('pk').eq('RPT') & Key('sk').begins_with(PREFIX),
                             'ConsistentRead': True}
        if condition is not None:
            kwargs['FilterExpression'] = condition
        while True:
            page = self.table.query(**kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def list_reports(self, status=None):
        return self._reports(Attr('status').eq(status) if status else None)

    def list_user_reports(self, user_id):
        return self._reports(Attr('userId').eq(user_id))

    def mark_report(self, report_id, status, kind=None, note=None):
        if status not in STATUSES or (kind is not None and kind not in KINDS):
            raise ValueError('invalid status or kind')
        sets, values = ['#s = :s'], {':s': status}
        if kind is not None:
            sets.append('kind = :k')
            values[':k'] = kind
        if note is not None:
            sets.append('triage = :t')
            values[':t'] = note
        try:
            self.table.update_item(Key={'pk': 'RPT', 'sk': f'{PREFIX}{report_id}'}, UpdateExpression='SET ' + ', '.join(sets),
                                   ConditionExpression='attribute_exists(sk)', ExpressionAttributeNames={'#s': 'status'},
                                   ExpressionAttributeValues=values)
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(404, 'not_found')

    def delete_user_reports(self, reports):
        """Delete these report items (from `list_user_reports`); the caller deletes their images first."""
        with self.table.batch_writer() as batch:
            for item in reports:
                batch.delete_item(Key={'pk': item['pk'], 'sk': item['sk']})
