"""Lambda entry point for API Gateway HTTP API (payload v2.0): routing and JSON responses."""
import base64
import binascii
import functools
import json
import logging
import os
import re
from dataclasses import dataclass, field

from . import routes_admin, routes_changes, routes_core, routes_groups, routes_invites, routes_me, routes_media, routes_messages
from .errors import ApiError
from .identity import Caller, caller_from_event, resolve_user_id
from .repo import Repo

logging.getLogger().setLevel(logging.INFO)  # Lambda leaves the root logger at WARNING and drops log.info
log = logging.getLogger(__name__)

ROUTES = [
    ('GET', re.compile(r'^/health$'), routes_core.health),
    ('GET', re.compile(r'^/v1/me$'), routes_core.me),
    ('DELETE', re.compile(r'^/v1/me$'), routes_me.delete_account),
    ('PUT', re.compile(r'^/v1/me/profile$'), routes_me.put_profile),
    ('PUT', re.compile(r'^/v1/me/devices$'), routes_me.put_device),
    ('DELETE', re.compile(r'^/v1/me/devices/(?P<token>[^/]+)$'), routes_me.delete_device),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)$'), routes_core.kehila),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/logo$'), routes_core.logo),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/invites$'), routes_invites.create),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/invites$'), routes_invites.list_invites),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/invites/(?P<code>[^/]+)$'), routes_invites.revoke),
    ('GET', re.compile(r'^/v1/invites/(?P<code>[^/]+)$'), routes_invites.preview),
    ('POST', re.compile(r'^/v1/invites/(?P<code>[^/]+)/accept$'), routes_invites.accept),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/membership-request$'), routes_admin.request_membership),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/membership$'), routes_admin.leave),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/requests$'), routes_admin.list_requests),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/requests/(?P<userId>[^/]+)/approve$'), routes_admin.approve),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/requests/(?P<userId>[^/]+)/reject$'), routes_admin.reject),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/members$'), routes_admin.list_members),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/members/(?P<userId>[^/]+)$'), routes_admin.update_member),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/members/(?P<userId>[^/]+)$'), routes_admin.remove_member),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/import$'), routes_admin.import_list),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/settings$'), routes_admin.set_settings),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/push-texts$'), routes_admin.get_push_texts),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/push-texts$'), routes_admin.put_push_text),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/broadcast$'), routes_admin.set_broadcast),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/channels$'), routes_admin.create_channel),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/channels/(?P<c>[^/]+)$'), routes_admin.update_channel),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/groups$'), routes_groups.list_groups),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/groups$'), routes_groups.create_group),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/groups/(?P<g>[^/]+)$'), routes_groups.rename_group),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/groups/(?P<g>[^/]+)$'), routes_groups.delete_group),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/groups/(?P<g>[^/]+)/admins/(?P<u>[^/]+)$'), routes_groups.appoint_admin),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/admin/groups/(?P<g>[^/]+)/admins/(?P<u>[^/]+)$'),
     routes_groups.unappoint_admin),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups$'), routes_groups.my_groups),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups/(?P<g>[^/]+)/requests$'), routes_groups.request_join),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups/(?P<g>[^/]+)/requests$'), routes_groups.list_requests),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups/(?P<g>[^/]+)/requests/me$'), routes_groups.withdraw_request),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups/(?P<g>[^/]+)/requests/(?P<u>[^/]+)/approve$'),
     routes_groups.approve_request),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups/(?P<g>[^/]+)/requests/(?P<u>[^/]+)$'),
     routes_groups.reject_request),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups/(?P<g>[^/]+)/members$'), routes_groups.list_group_members),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups/(?P<g>[^/]+)/members/me$'), routes_groups.leave_group),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/groups/(?P<g>[^/]+)/members/(?P<u>[^/]+)$'),
     routes_groups.remove_group_member),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/channels$'), routes_messages.list_channels),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/channels/(?P<c>[^/]+)/chat-settings$'),
     routes_messages.set_chat_settings),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/members$'), routes_messages.list_directory),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages$'), routes_messages.post_message),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages$'), routes_messages.list_messages),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages/(?P<m>[^/]+)$'), routes_messages.get_message),
    ('DELETE', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages/(?P<m>[^/]+)$'), routes_messages.remove_message),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages/(?P<m>[^/]+)/join$'), routes_messages.join),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages/(?P<m>[^/]+)/read$'), routes_messages.read),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages/(?P<m>[^/]+)/replies$'), routes_messages.post_reply),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages/(?P<m>[^/]+)/replies$'), routes_messages.list_replies),
    ('POST', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/uploads$'), routes_media.create_upload),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/messages/(?P<m>[^/]+)/image$'), routes_media.image_url),
    ('GET', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/changes$'), routes_changes.changes),
    ('PUT', re.compile(r'^/v1/kehilot/(?P<k>[^/]+)/me/notify$'), routes_changes.put_notify),
]
PUBLIC = {routes_core.health, routes_invites.preview}  # no caller: ctx.caller and ctx.user_id are None


@dataclass
class Ctx:
    repo: Repo
    caller: Caller
    user_id: str
    body: str | None  # raw text; inputs.body_object parses it
    query: dict = field(default_factory=dict)  # query string parameters (strings)
    context: object = None  # the Lambda context (time left)


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
        if event['requestContext']['http']['method'] == 'OPTIONS':
            # CORS preflight (unauthenticated route): API Gateway adds the CORS headers to this response
            return _response(204, None)
        func, params = _match(event['requestContext']['http']['method'], event['rawPath'])
        if func in PUBLIC:
            return _response(*func(Ctx(_repo(), None, None, None), params))
        repo = _repo()
        caller = caller_from_event(event)
        body = _body(event)
        try:
            user_id = resolve_user_id(repo, caller)
        except ApiError as error:
            if error.code == 'account_deleted' and func is routes_me.delete_account:
                return _response(*routes_me.finish_deleted_account(caller))  # idempotent retry
            raise
        status, payload = func(Ctx(repo, caller, user_id, body, event.get('queryStringParameters') or {}, context), params)
        return _response(status, payload)
    except ApiError as error:
        return _response(error.status, {'error': error.code})
    except Exception as error:  # never leak details to the client or the log
        # an AWS error's code and operation name carry no user data and name the failing call
        detail = ''
        if hasattr(error, 'operation_name') and isinstance(getattr(error, 'response', None), dict):
            detail = f" {error.response.get('Error', {}).get('Code', '?')} {error.operation_name}"
        log.error('unhandled %s%s request=%s', type(error).__name__, detail, getattr(context, 'aws_request_id', '-'))
        return _response(500, {'error': 'internal'})
