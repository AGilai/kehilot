"""Lambda entry point for API Gateway HTTP API (payload v2.0): routing and JSON responses."""
import functools
import json
import logging
import os
import re
from dataclasses import dataclass

from ..validation import APIError
from . import routes_core
from .identity import Caller, caller_from_event, resolve_user_id
from .repo import Repo

log = logging.getLogger(__name__)

ROUTES = [
    ('GET', re.compile(r'^/health$'), routes_core.health),
    ('GET', re.compile(r'^/v1/me$'), routes_core.me),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)$'), routes_core.kehila),
]
PUBLIC = {routes_core.health}


@dataclass
class Ctx:
    repo: Repo
    caller: Caller
    user_id: str
    body: dict


@functools.cache
def _repo():
    import boto3
    return Repo(boto3.resource('dynamodb').Table(os.environ['TABLE_NAME']))


def _response(status, body):
    return {'statusCode': status, 'headers': {'content-type': 'application/json; charset=utf-8'},
            'body': json.dumps(body, ensure_ascii=False)}


def _match(method, path):
    path_matched = False
    for route_method, pattern, func in ROUTES:
        found = pattern.match(path)
        if found:
            path_matched = True
            if route_method == method:
                return func, found.groupdict()
    raise APIError(405 if path_matched else 404, 'method_not_allowed' if path_matched else 'not_found')


def handler(event, context):
    try:
        func, params = _match(event['requestContext']['http']['method'], event['rawPath'])
        if func in PUBLIC:
            return _response(*func(None, params))
        repo = _repo()
        caller = caller_from_event(event)
        try:
            body = json.loads(event['body']) if event.get('body') else None
        except ValueError:
            raise APIError(400, 'גוף הבקשה אינו JSON תקין.')
        status, payload = func(Ctx(repo, caller, resolve_user_id(repo, caller), body), params)
        return _response(status, payload)
    except APIError as error:
        return _response(error.status, {'error': error.message})
    except Exception as error:  # never leak details to the client or the log
        log.error('unhandled %s request=%s', type(error).__name__, getattr(context, 'aws_request_id', '-'))
        return _response(500, {'error': 'internal'})
