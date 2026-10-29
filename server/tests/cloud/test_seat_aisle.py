import unittest

from server.cloud import seating_week as wk

S, A, B, K, E = 'seat', 'aisle', 'bimah', 'ark', 'empty'


def make(blocks=None, bimah=()):
    rows = [[K] * 9]
    for _ in range(3):
        rows.append([S, S, A, S, S, S, A, S, S])
    for c in bimah:
        rows[3][c] = B
    blocks = blocks or [(0, 1), (3, 5), (7, 8)]
    seats = [{'id': f's{r}{c}', 'row': r, 'col': c} for r in (1, 2, 3) for c in range(9) if rows[r][c] == S]
    return {'rows': 4, 'cols': 9, 'cells': rows, 'seats': seats,
            'blocks': [{'name': f'b{i}', 'colStart': a, 'colEnd': b} for i, (a, b) in enumerate(blocks)],
            'rowLabels': ['0', '1', '2', '3']}


class SeatAisleTest(unittest.TestCase):
    def test_lanes(self):
        lay = make()
        a, b, c = lay['blocks']
        self.assertEqual(wk.lanes(lay, a), ['right'])
        self.assertEqual(wk.lanes(lay, b), ['left', 'right'])
        self.assertEqual(wk.lanes(lay, c), ['left'])
        lay = make([(0, 1), (3, 6), (7, 8)])
        self.assertEqual(wk.lanes(lay, lay['blocks'][1]), ['left'])

    def test_head_side_is_the_lane_nearer_the_bimah(self):
        b = make(bimah=(7, 8))
        self.assertEqual(wk.head_side(b, b['blocks'][1]), 'right')
        b = make(bimah=(0, 1))
        self.assertEqual(wk.head_side(b, b['blocks'][1]), 'left')
        b = make()
        self.assertEqual(wk.head_side(b, b['blocks'][1]), 'right')
        self.assertEqual(wk.head_side(b, b['blocks'][0]), 'right')
        self.assertEqual(wk.head_side(b, b['blocks'][2]), 'left')
        b = make([(0, 8)])
        self.assertIsNone(wk.head_side(b, b['blocks'][0]))

    def test_free_order_far_side_first(self):
        lay = make(bimah=(7, 8))
        ordered = ['s15', 's14', 's13']
        self.assertEqual(wk.free_order(lay, ordered), ['s13', 's14', 's15'])

    def test_rear_row_first_and_no_lane_falls_back(self):
        lay = make(bimah=(7, 8))
        self.assertEqual(wk.free_order(lay, ['s25', 's35']), ['s35', 's25'])
        lay = make([(0, 8)])
        self.assertEqual(wk.free_order(lay, ['s13', 's14', 's15']), ['s15', 's14', 's13'])

    def test_to_release_takes_the_first(self):
        self.assertEqual(wk.to_release(['x', 'y', 'z'], 2), {'x', 'y'})
        self.assertEqual(wk.to_release(['x', 'y', 'z'], 0), set())
        self.assertEqual(wk.to_release(['x', 'y', 'z'], 9), {'x', 'y', 'z'})


if __name__ == '__main__':
    unittest.main()
