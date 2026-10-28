"""Scheduled jobs Lambda. event = {"job": "<name>", ...}; each job gets (repo, event). An unknown job raises ValueError.

Logs carry counts only; device tokens never appear.
"""
import functools
import logging
import os
from datetime import datetime

from . import expo, seat_reminders, seating_week

logging.getLogger().setLevel(logging.INFO)  # Lambda leaves the root logger at WARNING and drops log.info
log = logging.getLogger(__name__)

RECEIPT_CHUNK = 300


@functools.cache
def _repo():
    import boto3
    from .repo import Repo
    return Repo(boto3.resource('dynamodb').Table(os.environ['TABLE_NAME']))


def push_receipts(repo, event=None):
    """Fetch receipts for stored push tickets. DeviceNotRegistered drops the device; every ticket that has a
    receipt is deleted. Tickets without a receipt yet stay until the next run (or their TTL)."""
    tickets = repo.list_push_tickets()
    token = expo.access_token() if tickets else None
    pruned = done = 0
    for start in range(0, len(tickets), RECEIPT_CHUNK):
        chunk = tickets[start:start + RECEIPT_CHUNK]
        found = expo.receipts([t['sk'][len('T#'):] for t in chunk], token)
        for ticket in chunk:
            receipt = found.get(ticket['sk'][len('T#'):])
            if not receipt:
                continue
            if (receipt.get('details') or {}).get('error') == 'DeviceNotRegistered':
                repo.delete_device(ticket['userId'], ticket['token'])
                pruned += 1
            repo.delete_push_ticket(ticket['sk'])
            done += 1
    log.info('push_receipts tickets=%d receipts=%d devices_pruned=%d', len(tickets), done, pruned)


def _now():
    return datetime.now(seating_week.TZ)


def seat_reminders_job(repo, event):
    """Queue the due seat-form reminders. event {"dryRun": true, "now": "YYYY-MM-DDTHH:MM" (Israel wall clock)}
    reports what is due without claiming, sending or writing; `now` needs `dryRun: true` and `dryRun` must be the
    boolean true, else ValueError and nothing runs."""
    if 'dryRun' in event or 'now' in event:  # anything but a real dry run is refused, never run for real
        if event.get('dryRun') is not True:
            raise ValueError('dryRun must be true when dryRun or now is given')
    dry = event.get('dryRun') is True
    now = _now()
    if dry and 'now' in event:
        if not isinstance(event['now'], str):
            raise ValueError('now must be YYYY-MM-DDTHH:MM')
        now = datetime.strptime(event['now'], '%Y-%m-%dT%H:%M').replace(tzinfo=seating_week.TZ)
    return {'ok': True, **seat_reminders.run(repo, now, dry_run=dry)}


JOBS = {'push_receipts': push_receipts, 'seat_reminders': seat_reminders_job}


def handler(event, context):
    job = JOBS.get(event.get('job') if isinstance(event, dict) else None)
    if job is None:
        raise ValueError('unknown job')
    result = job(_repo(), event)
    return result if isinstance(result, dict) else {'ok': True}
