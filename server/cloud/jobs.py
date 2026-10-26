"""Scheduled jobs Lambda. event = {"job": "<name>"}; an unknown job raises ValueError.

Logs carry counts only; device tokens never appear.
"""
import functools
import logging
import os

from . import expo

logging.getLogger().setLevel(logging.INFO)  # Lambda leaves the root logger at WARNING and drops log.info
log = logging.getLogger(__name__)

RECEIPT_CHUNK = 300


@functools.cache
def _repo():
    import boto3
    from .repo import Repo
    return Repo(boto3.resource('dynamodb').Table(os.environ['TABLE_NAME']))


def push_receipts(repo):
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


JOBS = {'push_receipts': push_receipts}


def handler(event, context):
    job = JOBS.get(event.get('job') if isinstance(event, dict) else None)
    if job is None:
        raise ValueError('unknown job')
    job(_repo())
    return {'ok': True}
