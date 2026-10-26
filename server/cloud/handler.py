"""Lambda entry point for API Gateway HTTP API (payload v2.0): routing and JSON responses."""
import base64
import binascii
import functools
import json
import logging
import os
import re
from dataclasses import dataclass

from . import routes_core, routes_invites, routes_me
from .errors import ApiError
from .identity import Caller, caller_from_event, resolve_user_id
from .repo import Repo

log = logging.getLogger(__name__)

ROUTES = [
    ('GET', re.compile(r'^/health$'), routes_core.health),
    ('GET', re.compile(r'^/v1/me$'), routes_core.me),
    ('PUT', re.compile(r'^/v1/me/profile$'), routes_me.put_profile),
    ('PUT', re.compile(r'^/v1/me/devices$'), routes_me.put_device),
    ('DELETE', re.compile(r'^/v1/me/devices/(?P<token>[^/]+)$'), routes_me.delete_device),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)$'), routes_core.kehila),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/invites$'), routes_invites.create),
    ('GET', re.compile(r'^/v1/invites/(?P<code>[^/]+)$'), routes_invites.preview),
    ('POST', re.compile(r'^/v1/invites/(?P<code>[^/]+)/accept$'), routes_invites.accept),
]
PUBLIC = {routes_core.health, routes_invites.preview}  # no caller: ctx.caller and ctx.user_id are None


@dataclass
class Ctx:
    repo: Repo
    caller: Caller
    user_id: str
    body: str | None  # raw text; inputs.body_object parses it


@functools.cache
def _repo():
    import boto3
    return Repo(boto3.resource('dynamodb').Table(os.environ['TABLE_NAME']))


def _response(status, body):
    return {'statusCode': status, 'headers': {'content-type': 'application/json; charset=utf-8'},
            'body': '' if status == 204 else json.dumps(body, ensure_ascii=False)}


def _match(method, path):
    path_matched = False
    for route_method, pattern, func in ROUTES:
        found = pattern.match(path)
        if found:
            path_matched = True
            if route_method == method:
                return func, found.groupdict()
    raise ApiError(405 if path_matched else 404, 'method_not_allowed' if path_matched else 'not_found')


def _body(event):
    body = event.get('body') or None
    if body and event.get('isBase64Encoded'):
        try:
            body = base64.b64decode(body, validate=True).decode('utf-8')
        except (binascii.Error, ValueError):
            raise ApiError(400, 'invalid_body')
    return body


def handler(event, context):
    try:
        func, params = _match(event['requestContext']['http']['method'], event['rawPath'])
        if func in PUBLIC:
            return _response(*func(Ctx(_repo(), None, None, None), params))
        repo = _repo()
        caller = caller_from_event(event)
        body = _body(event)
        status, payload = func(Ctx(repo, caller, resolve_user_id(repo, caller), body), params)
        return _response(status, payload)
    except ApiError as error:
        return _response(error.status, {'error': error.code})
    except Exception as error:  # never leak details to the client or the log
        log.error('unhandled %s request=%s', type(error).__name__, getattr(context, 'aws_request_id', '-'))
        return _response(500, {'error': 'internal'})
