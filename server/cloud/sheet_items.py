"""Sheet items created and removed together with messages. The only module here that reads the clock."""
from datetime import datetime, timezone

from . import sheet_rules


def _now():
    return datetime.now(timezone.utc)


def on_post(repo, k, membership, settings, message, now):
    """Create the sheet item of a celebration, condolence or event just posted (itemId = messageId) and mark the
    message with its sheetWeek. Other types make no item."""
    type_ = message['type']
    if type_ not in sheet_rules.SHEET_TYPES:
        return None
    message_id = message['sk'][len('MSG#'):]
    fields = message.get('fields') if message.get('templateId') else None
    friday = sheet_rules.week_for_post(now, type_, fields).isoformat()
    state, source = sheet_rules.initial_state(membership['role'], sheet_rules.sheet_members(settings))
    item = repo.put_sheet_item(k, friday, {
        'itemId': message_id, 'week': friday, 'kind': 'message', 'type': type_, 'group': sheet_rules.GROUP_OF[type_],
        'state': state, 'source': source, 'wasPending': state == 'pending',
        'order': sheet_rules.default_order(type_, message_id, fields), 'messageId': message_id,
        'createdAt': int(now.timestamp())})
    repo.set_message_sheet_week(k, message_id, friday)
    return item


def on_remove(repo, k, message):
    """Delete the message's sheet item, when it has one. Safe to repeat."""
    friday = message.get('sheetWeek')
    if friday:
        repo.delete_sheet_item(k, friday, message['sk'][len('MSG#'):])


def on_update(repo, k, before, after, now):
    """The message was updated: its sheet line updates by itself (the gabbai's override goes), and an event whose
    week changed moves its item to the new week with the same state and source. Safe to repeat."""
    old_week = before.get('sheetWeek')
    if not old_week:
        return
    message_id = before['sk'][len('MSG#'):]
    item = repo.get_sheet_item(k, old_week, message_id)
    if not item:
        return
    if 'line' in item:
        repo.update_sheet_item(k, old_week, message_id, {}, ['line'])
    fields = after.get('fields') if after.get('templateId') else None
    if after['type'] != 'event' or not fields:
        return
    friday = sheet_rules.week_for_post(now, 'event', fields).isoformat()
    if friday == old_week:
        return
    moved = {key: item[key] for key in ('itemId', 'kind', 'type', 'group', 'state', 'source', 'wasPending',
                                        'messageId', 'createdAt', 'approvedBy') if key in item}
    repo.put_sheet_item(k, friday, {**moved, 'week': friday,
                                    'order': sheet_rules.default_order('event', message_id, fields)})
    repo.set_message_sheet_week(k, message_id, friday)
    repo.delete_sheet_item(k, old_week, message_id)
