import time
import unittest

from server.cloud.ids import ID_RE, new_id


class IdsTest(unittest.TestCase):
    def test_shape(self):
        self.assertRegex(new_id(), ID_RE)

    def test_time_sortable(self):
        a = new_id()
        time.sleep(0.002)
        b = new_id()
        self.assertLess(a, b)

    def test_unique(self):
        self.assertEqual(len({new_id() for _ in range(1000)}), 1000)
