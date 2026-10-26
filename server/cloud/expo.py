"""Expo push service client (stdlib only).

Access token: SSM SecureString at `/kehilot/<ENV_NAME>/expo-access-token`. Env ENV_NAME picks the
environment; env EXPO_TOKEN_PARAM, when set, overrides the whole parameter name. With neither set there
is no token. The SSM value "none" also means no Authorization header. Cached per container.
"""
import json
import logging
import os
import urllib.request

log = logging.getLogger(__name__)

SEND_URL = 'https://exp.host/--/api/v2/push/send'
RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'
TIMEOUT = 20
_cached = {}


def access_token():
    """The Expo access token, or None when none is configured (or the stored value is "none")."""
    if 'token' in _cached:
        return _cached['token']
    name = os.environ.get('EXPO_TOKEN_PARAM')
    if not name and os.environ.get('ENV_NAME'):
        name = f"/kehilot/{os.environ['ENV_NAME']}/expo-access-token"
    if not name:
        return None
    import boto3
    value = boto3.client('ssm').get_parameter(Name=name, WithDecryption=True)['Parameter']['Value']
    _cached['token'] = None if value == 'none' else value
    return _cached['token']


def _post(url, payload, token):
    headers = {'content-type': 'application/json', 'accept': 'application/json'}
    if token and token != 'none':
        headers['Authorization'] = f'Bearer {token}'
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read())['data']


def send(messages, token):
    """POST up to 100 messages; returns one ticket per message, in order. Raises on HTTP/network errors."""
    return _post(SEND_URL, messages, token)


def receipts(ids, token):
    """{ticketId: receipt} for the given ticket IDs."""
    return _post(RECEIPTS_URL, {'ids': list(ids)}, token)
