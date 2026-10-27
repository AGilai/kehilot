import copy
import time
import unittest
from datetime import date, timedelta
from unittest import mock

from moto import mock_aws

from server.cloud import routes_schedule, schedule_rules
from server.tests.cloud import test_messages

FORMULA = {'anchor': 'sunset', 'day': 'shabbat', 'offset': {'minutes': 5, 'direction': 'before'},
           'rounding': {'mode': 'down', 'step': 5}, 'notEarlierThan': '16:00', 'notLaterThan': '19:30'}
SECTIONS = [
    {'id': 'shabbat', 'kind': 'shabbat', 'title': {'he': 'שבת', 'en': 'Shabbat'}, 'rows': [
        {'id': 'candles', 'label': {'he': 'הדלקת נרות'}, 'role': 'candles', 'day': 'friday',
         'time': {'kind': 'formula', 'formula': {**FORMULA, 'anchor': 'candleLighting', 'day': 'friday'}}},
        {'id': 'shacharit', 'label': {'he': 'שחרית', 'en': 'Shacharit'}, 'note': 'x', 'time': {'kind': 'fixed', 'at': '08:30'}},
        {'id': 'lessons', 'label': {'he': 'שיעורים'}, 'time': {'kind': 'none'}}]},
    {'id': 'week', 'kind': 'weekday', 'title': {'he': 'ימי חול'}, 'rows': [
        {'id': 'mincha', 'label': {'he': 'מנחה'},
         'time': {'kind': 'formula', 'formula': {'anchor': 'sunset', 'day': 'earliest', 'offset': {'minutes': 15, 'direction': 'before'},
                                                'rounding': {'mode': 'none'}}}}]},
]
LOCATION = {'latitude': 31.77, 'longitude': 35.21, 'elevation': 'ground', 'elevationMeters': 780, 'candleMinutes': 40}
CITY = {'name': {'he': 'ירושלים', 'en': 'Jerusalem'}, 'latitude': 31.77, 'longitude': 35.21, 'candleMinutes': 40}


def friday_ahead(weeks):
    today = date.today()
    return today + timedelta(days=(4 - today.weekday()) % 7) + timedelta(weeks=weeks)


@mock_aws
class ScheduleTest(test_messages.MessagesTest):
    def url(self, tail=''):
        return f'{self.base()}/admin/schedule{tail}'

    def put(self, sections=SECTIONS, sub='gabbai-sub', **extra):
        return self.call('PUT', self.url(), sub=sub, body={'sections': sections, **extra})

    def get(self, sub='gabbai-sub'):
        return self.call('GET', f'{self.base()}/schedule', sub=sub)

    def mutated(self, fn):
        sections = copy.deepcopy(SECTIONS)
        fn(sections)
        return sections

    def test_empty_get_has_defaults_for_everyone(self):
        for sub in ('gabbai-sub', 'member-sub', 'listener-sub'):
            status, body = self.get(sub)
            self.assertEqual(status, 200)
            self.assertEqual(body, {'version': 1, 'sections': [], 'weekOverrides': {}, 'sheet': {'candleCities': []},
                                    'location': {'latitude': 32.0878, 'longitude': 34.8878, 'elevation': 'sea',
                                                 'candleMinutes': 40}, 'updatedAt': None})

    def test_default_location_is_the_one_constant(self):
        self.assertEqual(schedule_rules.DEFAULT_LOCATION['candleMinutes'], 40)

    def test_put_then_get_round_trip(self):
        status, body = self.put()
        self.assertEqual((status, body['warnings']), (200, []))
        got = self.get('listener-sub')[1]
        self.assertEqual((got['sections'], got['updatedAt']), (SECTIONS, body['updatedAt']))

    def test_roles_and_outsiders(self):
        for sub in ('member-sub', 'listener-sub'):
            self.assertEqual(self.put(sub=sub)[0], 403)
            self.assertEqual(self.call('PUT', self.url('/weeks/2030-01-04'), sub=sub, body={})[0], 403)
            self.assertEqual(self.call('DELETE', self.url('/weeks/2030-01-04'), sub=sub)[0], 403)
        self.assertEqual(self.call('GET', f'{self.base()}/schedule', sub='stranger-sub')[0], 404)

    def test_invalid_shapes_name_the_field(self):
        def row(fn):
            return self.mutated(lambda s: fn(s[0]['rows'][0]))

        def formula(fn):
            return row(lambda r: fn(r['time']['formula']))
        cases = {
            'sections[0].extra': self.mutated(lambda s: s[0].update(extra=1)),
            'sections[0].kind': self.mutated(lambda s: s[0].update(kind='holiday')),
            'sections[0].rows[0].time.formula.anchor': formula(lambda f: f.update(anchor='noon')),
            'sections[0].rows[0].time.formula.day': formula(lambda f: f.update(day='earliest')),
            'sections[0].rows[0].time.formula.offset.minutes': formula(lambda f: f['offset'].update(minutes=721)),
            'sections[0].rows[0].time.formula.offset.direction': formula(lambda f: f['offset'].update(direction='x')),
            'sections[0].rows[0].time.formula.rounding.step': formula(lambda f: f['rounding'].update(step=7)),
            'sections[0].rows[0].time.formula.notLaterThan': formula(lambda f: f.update(notLaterThan='24:00')),
            'sections[0].rows[0].time.formula.bogus': formula(lambda f: f.update(bogus=1)),
            'sections[0].rows[0].day': row(lambda r: r.update(day='sunday')),
            'sections[0].rows[0].role': row(lambda r: r.update(role='other')),
            'sections[0].rows[0].label.he': row(lambda r: r.update(label={'he': ' '})),
            'sections[0].rows[0].label.fr': row(lambda r: r.update(label={'he': 'a', 'fr': 'b'})),
            'sections[0].rows[0].note': row(lambda r: r.update(note='n' * 201)),
            'sections[0].rows[0].time.at': row(lambda r: r.update(time={'kind': 'fixed', 'at': '8:30'})),
            'sections[0].rows[1].id': self.mutated(lambda s: s[0]['rows'][1].update(id='candles')),
            'sections[1].id': self.mutated(lambda s: s[1].update(id='shabbat')),
            'sections[1].rows[0].time.formula.day': self.mutated(lambda s: s[1]['rows'][0]['time']['formula'].update(day='shabbat')),
            'sections[1].rows[0].day': self.mutated(lambda s: s[1]['rows'][0].update(day='friday')),
            'sections[0].rows[0].time.formula.rounding.step#': formula(lambda f: f.update(rounding={'mode': 'none', 'step': 5})),
        }
        for field, sections in cases.items():
            self.assertEqual(self.put(sections), (400, {'error': 'invalid_schedule', 'field': field.rstrip('#')}), field)
        self.assertEqual(self.get()[1]['sections'], [])
        for body in ({}, {'sections': {}}, {'sections': [], 'weekOverrides': {}}, {'sections': [], 'version': 2},
                     {'sections': [], 'ifUpdatedAt': 'x'}):
            self.assertEqual(self.call('PUT', self.url(), body=body)[1]['error'], 'invalid_schedule', body)

    def test_size_limits(self):
        def rows(n):
            return [{'id': f'r{i}', 'label': {'he': 'א'}, 'time': {'kind': 'none'}} for i in range(n)]
        ok = [{'id': f's{i}', 'kind': 'weekday', 'title': {'he': 'א'}, 'rows': rows(40) if i == 0 else []} for i in range(12)]
        self.assertEqual(self.put(ok)[0], 200)
        self.assertEqual(self.put(ok + [{'id': 's99', 'kind': 'weekday', 'title': {'he': 'א'}, 'rows': []}])[1]['field'], 'sections')
        self.assertEqual(self.put([{'id': 's', 'kind': 'weekday', 'title': {'he': 'א'}, 'rows': rows(41)}])[1]['field'], 'sections[0].rows')
        long = [{'id': 's', 'kind': 'weekday', 'title': {'he': 'א' * 61}, 'rows': []}]
        self.assertEqual(self.put(long)[1]['field'], 'sections[0].title.he')
        edge = [{'id': 's', 'kind': 'weekday', 'title': {'he': 'א' * 60, 'en': 'b' * 60}, 'rows': []}]
        self.assertEqual(self.put(edge)[0], 200)

    def test_crossing_bounds_are_a_warning_not_an_error(self):
        sections = self.mutated(lambda s: s[0]['rows'][0]['time']['formula'].update(notEarlierThan='19:00', notLaterThan='17:00'))
        status, body = self.put(sections)
        self.assertEqual((status, body['warnings']), (200, [{'rowId': 'candles', 'code': 'bounds_cross'}]))

    def test_if_updated_at_detects_a_stale_editor(self):
        first = self.put(ifUpdatedAt=None)[1]['updatedAt']
        self.assertEqual(self.put(ifUpdatedAt=None), (409, {'error': 'schedule_changed'}))
        second = self.put(ifUpdatedAt=first)[1]['updatedAt']
        self.assertGreater(second, first)
        self.assertEqual(self.put(ifUpdatedAt=first), (409, {'error': 'schedule_changed'}))
        self.assertEqual(self.put()[0], 200)  # no guard: last write wins
        self.assertEqual(self.get()[1]['sections'], SECTIONS)

    def test_overrides_put_get_delete_and_only_current_and_next_week_are_returned(self):
        this_week = routes_schedule._friday_of(date.today())
        body = {'rows': {'shacharit': {'kind': 'time', 'at': '09:00', 'note': 'n'}, 'lessons': {'kind': 'hide'}},
                'extra': [{'id': 'x1', 'sectionId': 'shabbat', 'afterRowId': None, 'label': {'he': 'א'},
                           'time': {'kind': 'fixed', 'at': '10:00'}}]}
        for weeks in (0, 1, 2):
            self.assertEqual(self.call('PUT', self.url(f'/weeks/{this_week + timedelta(weeks=weeks)}'), body=body), (200, {}))
        got = self.get('member-sub')[1]['weekOverrides']
        self.assertEqual(sorted(got), [str(this_week), str(this_week + timedelta(weeks=1))])
        self.assertEqual(got[str(this_week)], body)
        self.assertEqual(self.call('DELETE', self.url(f'/weeks/{this_week}')), (204, None))
        self.assertEqual(sorted(self.get()[1]['weekOverrides']), [str(this_week + timedelta(weeks=1))])
        self.assertEqual(self.call('DELETE', self.url(f'/weeks/{this_week}'))[0], 204)  # idempotent

    def test_override_validation(self):
        week = self.url(f'/weeks/{friday_ahead(1)}')
        bad = [{'rows': {'a': {'kind': 'time'}}}, {'rows': {'a': {'kind': 'hide', 'at': '09:00'}}}, {'rows': {'a': {'kind': 'x'}}},
               {'rows': {'a b': {'kind': 'hide'}}}, {'rows': {'a': {'kind': 'time', 'at': '9:00'}}}, {'bogus': 1},
               {'extra': [{'id': 'x', 'sectionId': 's', 'label': {'he': 'א'}}]},
               {'extra': [{'id': 'x', 'sectionId': 's', 'label': {'he': 'א'}, 'time': {'kind': 'none'}}] * 2},
               {'rows': {f'r{i}': {'kind': 'hide'} for i in range(201)}}]
        for body in bad:
            self.assertEqual(self.call('PUT', week, body=body)[1]['error'], 'invalid_overrides', body)
        self.assertEqual(self.call('PUT', week, body=[])[1]['error'], 'invalid_body')
        self.assertEqual(self.get()[1]['weekOverrides'], {})

    def test_week_start_must_be_a_friday_and_not_already_expired(self):
        for week in ('2030-01-05', '2030-13-01', 'abc', '2030-1-4'):
            self.assertEqual(self.call('PUT', self.url(f'/weeks/{week}'), body={}), (400, {'error': 'invalid_week_start'}), week)
        self.assertEqual(self.call('DELETE', self.url('/weeks/2030-01-05'))[0], 400)
        self.assertEqual(self.call('PUT', self.url(f'/weeks/{friday_ahead(-4)}'), body={})[0], 400)
        self.assertEqual(self.call('PUT', self.url(f'/weeks/{friday_ahead(60)}'), body={})[0], 400)

    def test_override_ttl_is_a_week_after_the_week_ends(self):
        friday = friday_ahead(1)
        self.call('PUT', self.url(f'/weeks/{friday}'), body={})
        item = self.repo.table.get_item(Key={'pk': f'K#{self.k}', 'sk': f'SCHEDWK#{friday}'})['Item']
        # Thursday is friday + 6; a week after the week ends = the midnight (UTC) that starts friday + 14
        self.assertEqual(int(item['expiresAt']), int((friday + timedelta(days=14) - date(1970, 1, 1)).total_seconds()))

    def test_expired_overrides_are_not_returned_before_dynamodb_sweeps_them(self):
        this_week = routes_schedule._friday_of(date.today())
        self.call('PUT', self.url(f'/weeks/{this_week}'), body={'rows': {'a': {'kind': 'hide'}}})
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'SCHEDWK#{this_week}'}, UpdateExpression='SET expiresAt = :e',
                                    ExpressionAttributeValues={':e': int(time.time()) - 1})
        self.assertEqual(self.get()[1]['weekOverrides'], {})

    def test_friday_belongs_to_the_new_week(self):
        friday = date(2026, 10, 30)
        for today, expected in ((friday, friday), (friday + timedelta(days=6), friday), (friday + timedelta(days=7), friday + timedelta(days=7))):
            with mock.patch.object(routes_schedule, '_today', return_value=today):
                self.assertEqual(routes_schedule._friday_of(today), expected)

    # --- location and sheet settings
    def settings(self, body, sub='gabbai-sub'):
        return self.call('PUT', f'{self.base()}/admin/settings', sub=sub, body=body)

    def test_location_and_sheet_settings_partial_and_shown(self):
        self.settings({'maxListeners': 9})
        self.assertEqual(self.settings({'location': LOCATION, 'sheet': {'candleCities': [CITY, {**CITY, 'name': {'he': 'תל אביב'}, 'candleMinutes': 20}]}}), (200, {}))
        kehila = self.call('GET', self.base())[1]
        self.assertEqual((kehila['location'], len(kehila['sheet']['candleCities']), kehila['settings']['maxListeners']), (LOCATION, 2, 9))
        self.assertNotIn('location', self.call('GET', self.base(), sub='member-sub')[1])
        self.settings({'typeRules': {'celebration': {'post': 'management', 'listeners': True}}})
        self.assertEqual(self.call('GET', self.base())[1]['location'], LOCATION)  # other settings keep it
        got = self.get('listener-sub')[1]
        self.assertEqual((got['location'], got['sheet']['candleCities'][0]), (LOCATION, CITY))
        self.assertEqual(self.settings({'location': {**schedule_rules.DEFAULT_LOCATION}})[0], 200)
        self.assertEqual(self.get()[1]['location']['elevation'], 'sea')
        self.assertEqual(self.get()[1]['sheet']['candleCities'][0], CITY)  # sheet kept

    def test_invalid_location_and_sheet(self):
        loc = lambda **kw: {'location': {**LOCATION, **kw}}
        for body, code in [(loc(latitude=91), 'invalid_location'), (loc(longitude='x'), 'invalid_location'),
                           (loc(latitude=True), 'invalid_location'), (loc(elevation='roof'), 'invalid_location'),
                           (loc(elevationMeters=-1), 'invalid_location'), (loc(candleMinutes=91), 'invalid_location'),
                           (loc(extra=1), 'invalid_location'), ({'location': {**schedule_rules.DEFAULT_LOCATION, 'elevationMeters': 5}}, 'invalid_location'),
                           ({'location': {**LOCATION, 'elevationMeters': None}}, 'invalid_location'),
                           ({'location': {'latitude': 1}}, 'invalid_location'), ({'location': []}, 'invalid_location'),
                           ({'sheet': {'candleCities': [CITY] * 3}}, 'invalid_sheet'),
                           ({'sheet': {'candleCities': [{**CITY, 'candleMinutes': 'x'}]}}, 'invalid_sheet'),
                           ({'sheet': {'candleCities': [{**CITY, 'name': {'he': ''}}]}}, 'invalid_sheet'),
                           ({'sheet': {'candleCities': [], 'x': 1}}, 'invalid_sheet'), ({'sheet': {}}, 'invalid_sheet')]:
            status, got = self.settings(body)
            self.assertEqual((status, got['error']), (400, code), body)
            self.assertIn('field', got)
        self.assertEqual(self.get()[1]['location'], {**schedule_rules.DEFAULT_LOCATION})

    def test_settings_roles(self):
        self.assertEqual(self.settings({'location': LOCATION}, sub='member-sub')[0], 403)

    def test_stored_garbage_location_reads_as_default(self):
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': 'META'}, UpdateExpression='SET settings.kehilaLocation = :r, settings.sheet = :r',
                                    ExpressionAttributeValues={':r': 'junk'})
        got = self.get()[1]
        self.assertEqual((got['location'], got['sheet']), (schedule_rules.DEFAULT_LOCATION, {'candleCities': []}))
