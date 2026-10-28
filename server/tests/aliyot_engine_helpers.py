"""Plain-input fixture builder replacing the upstream sqlite/store setup in the aliyot engine tests.

`person()` mirrors upstream's `save_roster_person` helper (camelCase fields, returns the id); `calls()` mirrors
`save_aliyah_service`. State lives in `self.people` / `self.services`; `self.custom` is the community's yahrzeit custom.
"""
from datetime import date
import re
import unittest

from server.cloud.aliyot.engine import recommendations


def snake(name):
    return re.sub(r'([A-Z])', lambda match: '_' + match.group(1).lower(), name)


class EngineCase(unittest.TestCase):
    def setUp(self):
        self.people, self.services, self.custom, self.serial = [], [], None, 0

    def person(self, identifier, tribe='yisrael', classification='א', **changes):
        fields = dict(firstName=identifier, lastName='בדיקה', tribe=tribe, classification=classification)
        fields.update(changes)
        row = {snake(key): value for key, value in fields.items()}
        row.update(id=identifier, display_name=(row['first_name'] + ' ' + row['last_name']).strip(), active=True)
        self.people.append(row)
        return identifier

    def update(self, identifier, **changes):
        next(row for row in self.people if row['id'] == identifier).update({snake(key): value for key, value in changes.items()})

    def bulk(self, identifier, tribe, classification):
        self.people.append(dict(id=identifier, first_name=identifier, last_name='בדיקה', display_name=identifier,
                                tribe=tribe, classification=classification, active=True))

    def service(self, day, calls, reading='בדיקה', service='shacharit', minyan=1, cancelled=False):
        self.serial += 1
        record = dict(id=f'service-{self.serial:04}', date=day, service=service, minyan=minyan, reading=reading,
                      cancelled=cancelled, calls=calls)
        self.services.append(record)
        return record

    def calls(self, day, people, cancelled=False):
        return self.service(day, [dict(position=f'ישראל {index+1}', personId=person) for index, person in enumerate(people)],
                            cancelled=cancelled)

    def report(self, day='2026-10-31', prayer='shacharit'):
        return recommendations(self.people, self.services, selected=date.fromisoformat(day), prayer=prayer,
                               yahrzeit_custom=self.custom)

    def section(self, identifier, day='2026-10-31'):
        return next(section['people'] for section in self.report(day)['sections'] if section['id'] == identifier)
