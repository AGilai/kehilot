"""Routes: the weekly sheet's items (messages that reached the sheet, plus free lines), per role."""
from datetime import datetime, timedelta, timezone

from . import inputs, sheet_rules, visibility
from . import authz
from .errors import ApiError
from .ids import ID_RE, new_id
from .routes_messages import _message_json, kehila_rules
from .schedule_rules import week_expiry, week_start

MAX_ITEMS = 40
MAX_AHEAD_DAYS = 63
TEXT_MAX, BOLD_MAX = 300, 60
FREE_TYPES = ('celebration', 'event', 'notice')
STATES = ('in', 'pending', 'removed')


def _now():
    return datetime.now(timezone.utc)


def _friday(params):
    friday = week_start(params['week'])
    if not friday:
        raise ApiError(400, 'invalid_week_start')
    return friday


def _text(value, code='invalid_text'):
    if not isinstance(value, str):
        raise ApiError(400, code)
    value = value.strip()
    if not 1 <= len(value) <= TEXT_MAX or value.count('\n') > 1:
        raise ApiError(400, code)
    return value


def _bold(value):
    if not isinstance(value, str) or len(value.strip()) > BOLD_MAX:
        raise ApiError(400, 'invalid_bold')
    return value.strip()


def _names(ctx, k, ids):
    found = ctx.repo.batch_get([(f'K#{k}', f'M#{i}') for i in ids if i])
    return {key[1][2:]: item.get('displayName', '') for key, item in found.items()}


def _items_json(ctx, k, membership, friday, now):
    """The week's items as this role sees them, sorted by (group, order)."""
    gabbai = authz.role_in(membership, authz.MANAGEMENT)
    stored = ctx.repo.list_sheet_items(k, friday.isoformat(), int(now.timestamp()))
    if not gabbai:
        stored = [i for i in stored if i['state'] == 'in']
    elif sheet_rules.pending_expired(friday, now):
        stored = [i for i in stored if i['state'] != 'pending']
    rules = kehila_rules(ctx, k)
    messages = ctx.repo.batch_get([(f'K#{k}', f'MSG#{i["messageId"]}') for i in stored if i['kind'] == 'message'])
    channels = {c['sk'][len('C#'):]: c for c in ctx.repo.list_channels(k)}
    out = []
    for item in stored:
        message = None
        if item['kind'] == 'message':
            message = messages.get((f'K#{k}', f'MSG#{item["messageId"]}'))
            if not message or message.get('removed'):
                continue
            if not gabbai and not visibility.message_visible(membership, channels.get(message['channelId']), message, rules):
                continue
        elif (authz.role_in(membership, authz.LISTENER_ONLY) and item['type'] == 'celebration'
              and not rules['celebration']['listeners']):
            continue
        out.append((item, message))
    names = _names(ctx, k, {i.get('approvedBy') for i, _ in out} | {m['authorId'] if m else i.get('authorId')
                                                                      for i, m in out}) if gabbai else {}
    return [_item_json(item, message, gabbai, names) for item, message in out]


def _item_json(item, message, gabbai, names):
    out = {'itemId': item['itemId'], 'week': item['week'], 'group': item['group'], 'kind': item['kind'],
           'type': item['type'], 'state': item['state'], 'source': item['source'], 'postedAt': int(item['createdAt'])}
    if item['source'] == 'byGabbai':
        out['byRole'] = item.get('byRole') or authz.LEGACY_STAFF_ROLE
    if item['kind'] == 'free':
        out['line'] = {'text': item['text'], 'bold': item.get('bold', '')}
    elif item.get('line'):
        out['line'] = {'text': item['line']['text'], 'bold': item['line'].get('bold', '')}
    if message:
        out['message'] = _message_json(message)
    if gabbai:
        author = message['authorId'] if message else item.get('authorId')
        out['wasPending'] = bool(item.get('wasPending'))
        out['postedBy'] = names.get(author) or (message.get('authorName', '') if message else '')
        out['approvedBy'] = names.get(item.get('approvedBy'), '') if item.get('approvedBy') else ''
    return out


def _week_body(ctx, params, membership, friday):
    return 200, {'week': friday.isoformat(), 'items': _items_json(ctx, params['k'], membership, friday, _now())}


def get_sheet(ctx, params):
    membership = authz.require(ctx.repo, ctx.user_id, params['k'], authz.ALL)
    return _week_body(ctx, params, membership, _friday(params))


def add_item(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    friday = _friday(params)
    now = _now()
    if (friday - now.astimezone(sheet_rules.JERUSALEM).date() > timedelta(days=MAX_AHEAD_DAYS)
            or week_expiry(friday) <= int(now.timestamp())):
        raise ApiError(400, 'invalid_week_start')
    d = inputs.body_object(ctx)
    if set(d) - {'type', 'text', 'bold', 'source'}:
        raise ApiError(400, 'invalid_body')
    type_ = inputs.choice(d, 'type', FREE_TYPES)
    text = _text(d.get('text'))
    bold = None
    if 'bold' in d:
        if type_ != 'celebration':
            raise ApiError(400, 'invalid_bold')
        bold = _bold(d['bold'])
    source = inputs.choice(d, 'source', ('free', 'byGabbai')) if 'source' in d else 'free'
    if len(ctx.repo.list_sheet_items(k, friday.isoformat(), int(now.timestamp()))) >= MAX_ITEMS:
        raise ApiError(409, 'too_many_items')
    item_id = new_id()
    item = {'itemId': item_id, 'week': friday.isoformat(), 'kind': 'free', 'type': type_,
            'group': sheet_rules.GROUP_OF[type_], 'state': 'in', 'source': source, 'wasPending': False,
            'order': sheet_rules.appended_order(), 'text': text, 'authorId': ctx.user_id,
            'createdAt': int(now.timestamp()), **({'bold': bold} if bold else {}),
            **({'byRole': membership['role']} if source == 'byGabbai' else {})}
    stored = ctx.repo.put_sheet_item(k, friday.isoformat(), item)
    names = {ctx.user_id: membership.get('displayName', '')}
    return 201, _item_json(stored, None, True, names)


def _find(ctx, k, friday, item_id):
    item = ctx.repo.get_sheet_item(k, friday.isoformat(), item_id) if ID_RE.fullmatch(item_id) else None
    if not item:
        raise ApiError(404, 'item_not_found')
    return item


def _line(value, item):
    if not isinstance(value, dict) or set(value) - {'text', 'bold'} or 'text' not in value:
        raise ApiError(400, 'invalid_line')
    try:
        text = _text(value['text'], 'invalid_line')
        bold = value.get('bold', '')
        if not isinstance(bold, str) or len(bold.strip()) > BOLD_MAX or (bold.strip() and item['type'] != 'celebration'):
            raise ApiError(400, 'invalid_line')
    except ApiError:
        raise ApiError(400, 'invalid_line')
    return {'text': text, 'bold': bold.strip()}


def set_item(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    friday = _friday(params)
    d = inputs.body_object(ctx)
    if not d or set(d) - {'state', 'line'}:
        raise ApiError(400, 'invalid_body')
    item = _find(ctx, k, friday, params['itemId'])
    sets, removes = {}, []
    if 'state' in d:
        state = inputs.choice(d, 'state', STATES)
        if state == 'pending' and not item.get('wasPending'):
            raise ApiError(400, 'invalid_state')
        sets['state'] = state
        if state == 'in' and item['source'] == 'member':
            sets.update({'source': 'approved', 'approvedBy': ctx.user_id, 'order': sheet_rules.appended_order()})
        elif state == 'pending' and item['source'] == 'approved':
            sets['source'] = 'member'
            removes.append('approvedBy')
    if 'line' in d:
        if d['line'] is None:
            if item['kind'] == 'free':
                raise ApiError(400, 'invalid_line')
            if 'line' in item:
                removes.append('line')
        else:
            line = _line(d['line'], item)
            if item['kind'] == 'free':  # the line of a free item is its own text and bold
                sets['text'] = line['text']
                if line['bold']:
                    sets['bold'] = line['bold']
                elif 'bold' in item:
                    removes.append('bold')
            else:
                sets['line'] = line
    updated = ctx.repo.update_sheet_item(k, friday.isoformat(), item['itemId'], sets, removes) if sets or removes else item
    message = None
    if updated['kind'] == 'message':
        message = ctx.repo.get_message(k, updated['messageId'])
    names = _names(ctx, k, {updated.get('approvedBy'), message['authorId'] if message else updated.get('authorId')})
    return 200, _item_json(updated, message, True, names)


def move_item(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    friday = _friday(params)
    d = inputs.body_object(ctx)
    if set(d) - {'direction'}:
        raise ApiError(400, 'invalid_body')
    direction = inputs.choice(d, 'direction', ('up', 'down'))
    item = _find(ctx, k, friday, params['itemId'])
    now = _now()
    group = [i for i in ctx.repo.list_sheet_items(k, friday.isoformat(), int(now.timestamp()))
             if i['group'] == item['group'] and i['state'] != 'removed'
             and not (i['state'] == 'pending' and sheet_rules.pending_expired(friday, now))]
    ids = [i['itemId'] for i in group]
    if item['itemId'] not in ids:
        raise ApiError(409, 'cannot_move')
    at = ids.index(item['itemId']) + (-1 if direction == 'up' else 1)
    if not 0 <= at < len(group):
        raise ApiError(409, 'cannot_move')
    ctx.repo.swap_sheet_order(k, friday.isoformat(), item, group[at])
    return _week_body(ctx, params, membership, friday)
