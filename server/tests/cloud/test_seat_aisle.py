import itertools
import unittest

from server.cloud import seating_week as wk

S, A, B, K = 'seat', 'aisle', 'bimah', 'ark'


def hall(rows, bimah=(), bimah_row=None):
    """A hall from row patterns: S seat, A aisle, . empty. Row 0 is the ark. Blocks are the runs between aisle columns
    (a column that is A or . in every row). `bimah` columns of `bimah_row` (default the last row) become bimah cells."""
    cols = len(rows[0])
    cells = [[K] * cols] + [[{'S': S, 'A': A, '.': 'empty'}[ch] for ch in r] for r in rows]
    for c in bimah:
        cells[bimah_row if bimah_row is not None else len(cells) - 1][c] = B
    seat_cols = [c for c in range(cols) if any(r[c] in (S, B) for r in cells[1:])]
    blocks, start = [], None
    for c in range(cols + 1):
        if c < cols and c in seat_cols:
            start = c if start is None else start
        elif start is not None:
            blocks.append({'name': f'b{len(blocks)}', 'colStart': start, 'colEnd': c - 1})
            start = None
    seats = [{'id': f's{r}_{c}', 'row': r, 'col': c} for r in range(1, len(cells)) for c in range(cols) if cells[r][c] == S]
    return {'rows': len(cells), 'cols': cols, 'cells': cells, 'seats': seats, 'blocks': blocks,
            'rowLabels': [str(i) for i in range(len(cells))]}


# blocks 0-1, 3-7, 9-10; lanes at columns 2 and 8; five rows of seats
FIVE = ['SSASSSSSASS'] * 5
RIGHT = (9, 10)   # bimah at the right block, in the last row
LEFT = (0, 1)


def sid(r, c):
    return f's{r}_{c}'


class SeatAisleTest(unittest.TestCase):
    def free(self, layout, *ids):
        return wk.free_order(layout, list(ids))

    def test_lanes(self):
        lay = hall(['SSASSSASS'] * 3)
        a, b, c = lay['blocks']
        self.assertEqual(wk.lanes(lay, a), ['right'])
        self.assertEqual(wk.lanes(lay, b), ['left', 'right'])
        self.assertEqual(wk.lanes(lay, c), ['left'])
        lay = hall(['SSASSSSSS'] * 3)
        self.assertEqual(wk.lanes(lay, lay['blocks'][1]), ['left'])

    def test_to_release_takes_the_first(self):
        self.assertEqual(wk.to_release(['x', 'y', 'z'], 2), {'x', 'y'})
        self.assertEqual(wk.to_release(['x', 'y', 'z'], 0), set())
        self.assertEqual(wk.to_release(['x', 'y', 'z'], 9), {'x', 'y', 'z'})

    # one rule decides each pair; the first listed seat is the worse one and is freed first
    def test_rule1_the_row_nearer_the_aron_is_better(self):
        lay = hall(FIVE, RIGHT)
        self.assertEqual(self.free(lay, sid(1, 4), sid(4, 4)), [sid(4, 4), sid(1, 4)])
        self.assertEqual(self.free(lay, sid(4, 4), sid(1, 4)), [sid(4, 4), sid(1, 4)])
        self.assertEqual(self.free(lay, sid(1, 3), sid(4, 3)), [sid(4, 3), sid(1, 3)])

    def test_rule2_next_to_an_aisle_beats_nearer_the_bimah(self):
        lay = hall(FIVE, RIGHT)
        # col 4 is nearer the bimah than col 3, but col 3 touches the aisle
        self.assertEqual(self.free(lay, sid(2, 3), sid(2, 4)), [sid(2, 4), sid(2, 3)])
        lay = hall(FIVE, LEFT)
        self.assertEqual(self.free(lay, sid(2, 7), sid(2, 6)), [sid(2, 6), sid(2, 7)])

    def test_rule3_fewer_seats_to_an_aisle_beats_nearer_the_bimah(self):
        # col 4: one seat from the left aisle, col 5: two. Col 5 is nearer the bimah, but col 4 is kept.
        lay = hall(FIVE, RIGHT)
        self.assertEqual(self.free(lay, sid(2, 4), sid(2, 5)), [sid(2, 5), sid(2, 4)])
        self.assertEqual(self.free(lay, sid(2, 5), sid(2, 6)), [sid(2, 5), sid(2, 6)])

    def test_rule4_nearer_the_bimah_is_better(self):
        # both touch an aisle
        lay = hall(FIVE, RIGHT)
        self.assertEqual(self.free(lay, sid(2, 7), sid(2, 3)), [sid(2, 3), sid(2, 7)])
        lay = hall(FIVE, LEFT)
        self.assertEqual(self.free(lay, sid(2, 7), sid(2, 3)), [sid(2, 7), sid(2, 3)])
        # cols 4 and 6 are one seat from an aisle each
        self.assertEqual(self.free(hall(FIVE, RIGHT), sid(2, 6), sid(2, 4)), [sid(2, 4), sid(2, 6)])
        self.assertEqual(self.free(hall(FIVE, LEFT), sid(2, 6), sid(2, 4)), [sid(2, 6), sid(2, 4)])

    def test_walls_are_aisles_and_a_wall_seat_is_the_head(self):
        lay = hall(FIVE)
        # col 10 is at the right wall (no seat between), col 5 is two seats from any aisle
        self.assertEqual(self.free(lay, sid(2, 5), sid(2, 10)), [sid(2, 5), sid(2, 10)])
        self.assertEqual(self.free(lay, sid(2, 10), sid(2, 9), sid(2, 5)), [sid(2, 5), sid(2, 9), sid(2, 10)])
        self.assertEqual(wk.keep_chain(lay, [sid(2, 0), sid(2, 5)])[0], sid(2, 0))
        # a hall whose only block touches both walls
        self.assertEqual(wk.keep_chain(hall(['SSSS']), [sid(1, 0), sid(1, 3)])[0], sid(1, 3))

    def test_the_head_takes_an_aisle_seat_over_a_nearer_row(self):
        lay = hall(FIVE)
        # a middle seat in the front row and an aisle seat in the back row
        self.assertEqual(wk.keep_chain(lay, [sid(1, 5), sid(4, 3)]), [sid(4, 3), sid(1, 5)])
        self.assertEqual(self.free(lay, sid(1, 5), sid(4, 3)), [sid(1, 5), sid(4, 3)])

    def test_rule5_last_tie_the_right_seat_facing_the_aron(self):
        lay = hall(FIVE)  # no bimah
        for a, b in ((4, 6), (3, 7)):  # equally far from the aisles, no bimah
            self.assertEqual(self.free(lay, sid(2, b), sid(2, a)), [sid(2, a), sid(2, b)])
        # one block, no lanes at all: right is kept
        lay = hall(['SSSS'] * 2)
        self.assertEqual(self.free(lay, sid(1, 3), sid(1, 2), sid(1, 1)), [sid(1, 1), sid(1, 2), sid(1, 3)])

    def test_owner_example_whole_row(self):
        lay = hall(FIVE, RIGHT)
        row = [sid(3, c) for c in (7, 6, 5, 4, 3)]  # family order: right to left
        # the head is col 7 (aisle seat nearer the bimah); freeing starts at the other end and walks towards it
        self.assertEqual(self.free(lay, *row), [sid(3, c) for c in (3, 4, 5, 6, 7)])
        self.assertEqual(wk.to_release(self.free(lay, *row), 4), {sid(3, c) for c in (3, 4, 5, 6)})
        lay = hall(FIVE, LEFT)
        self.assertEqual(self.free(lay, *row), [sid(3, c) for c in (7, 6, 5, 4, 3)])

    def test_family_split_across_two_rows_front_row_stays(self):
        lay = hall(FIVE, RIGHT)
        mine = [sid(1, 4), sid(1, 5), sid(4, 3), sid(4, 7)]
        # the head is the rear row's aisle seat (4,7); the row 1 group follows, the other aisle seat is freed first
        self.assertEqual(wk.keep_chain(lay, mine), [sid(4, 7), sid(1, 4), sid(1, 5), sid(4, 3)])
        self.assertEqual(self.free(lay, *mine), [sid(4, 3), sid(1, 5), sid(1, 4), sid(4, 7)])
        mine = [sid(1, 4), sid(1, 5), sid(4, 4), sid(4, 5)]  # no aisle seat: the front row stays
        out = self.free(lay, *mine)
        self.assertEqual(set(out[:2]), {sid(4, 4), sid(4, 5)})

    def test_family_across_two_adjacent_rows_keeps_the_group_around_the_head(self):
        lay = hall(FIVE, RIGHT)
        mine = [sid(1, 4), sid(1, 5), sid(2, 4), sid(2, 5)]
        # head (1,4), one seat from the aisle; then its row, then the row behind
        self.assertEqual(wk.keep_chain(lay, mine), [sid(1, 4), sid(1, 5), sid(2, 4), sid(2, 5)])
        self.assertEqual(self.free(lay, *mine), [sid(2, 5), sid(2, 4), sid(1, 5), sid(1, 4)])

    def test_two_separate_groups_the_non_touching_group_goes_first(self):
        lay = hall(FIVE, RIGHT)
        mine = [sid(1, 6), sid(1, 5), sid(4, 4), sid(4, 5)]
        self.assertEqual(self.free(lay, *mine), [sid(4, 5), sid(4, 4), sid(1, 5), sid(1, 6)])
        mine = [sid(1, 6), sid(1, 5), sid(4, 3), sid(4, 4)]  # the rear pair touches the aisle: it holds the head
        self.assertEqual(self.free(lay, *mine), [sid(1, 5), sid(1, 6), sid(4, 4), sid(4, 3)])

    def test_kept_seats_stay_one_group_after_freeing_any_number(self):
        import random
        rng = random.Random(7)
        for bimah in ((), RIGHT, LEFT):
            lay = hall(FIVE, bimah)
            pos = {s['id']: s for s in lay['seats']}
            for _ in range(40):
                group = {rng.choice(list(pos))}
                for _ in range(rng.randint(1, 8)):
                    near = [i for i in pos if i not in group and any(wk._touch(pos[i], pos[g]) for g in group)]
                    if near:
                        group.add(rng.choice(near))
                out = wk.free_order(lay, sorted(group))
                self.assertEqual(sorted(out), sorted(group))
                for k in range(len(out)):
                    kept = out[k:]
                    seen, todo = {kept[0]}, [kept[0]]
                    while todo:
                        cur = todo.pop()
                        for i in kept:
                            if i not in seen and wk._touch(pos[i], pos[cur]):
                                seen.add(i)
                                todo.append(i)
                    self.assertEqual(len(seen), len(kept), (bimah, sorted(group), k))

    def test_family_next_to_the_far_aisle_of_the_middle_block_keeps_it(self):
        lay = hall(FIVE, RIGHT)
        # the bimah is on the right; the family sits at the left aisle and one seat in. The aisle seat stays.
        self.assertEqual(self.free(lay, sid(2, 4), sid(2, 3)), [sid(2, 4), sid(2, 3)])
        self.assertEqual(wk.to_release(self.free(lay, sid(2, 4), sid(2, 3)), 1), {sid(2, 4)})

    def test_indented_row_counts_only_seats(self):
        lay = hall(['SSASSSSSASS', 'SSASSS..ASS'] + ['SSASSSSSASS'] * 2, RIGHT)
        # row 2 has cols 6 and 7 empty, so col 5 is next to the aisle there (nothing but empty cells between)
        self.assertEqual(wk.free_order(lay, [sid(2, 5), sid(2, 4)]), [sid(2, 4), sid(2, 5)])

    def test_family_split_across_two_blocks_in_one_row(self):
        lay = hall(FIVE)
        a, b = sid(2, 7), sid(2, 9)  # both touch an aisle; no bimah; rule 5: the right one stays
        self.assertEqual(self.free(lay, a, b), [a, b])

    def test_bimah_tie_between_both_aisles_falls_to_the_right_seat(self):
        lay = hall(['SSASSSASS'] * 3)  # no bimah at all
        row = [sid(2, 5), sid(2, 4), sid(2, 3)]
        self.assertEqual(self.free(lay, *row), [sid(2, 3), sid(2, 4), sid(2, 5)])

    def test_the_total_order_has_no_ties(self):
        for bimah in ((), RIGHT, LEFT, (4, 5)):
            lay = hall(FIVE, bimah)
            ids = [s['id'] for s in lay['seats']]
            expect = wk.free_order(lay, ids)
            self.assertEqual(sorted(expect), sorted(ids))
            for perm in (ids[::-1], ids[1::2] + ids[::2], sorted(ids, key=lambda i: (i[-1], i))):
                self.assertEqual(wk.free_order(lay, perm), expect, bimah)
            for a, b in itertools.combinations(ids[:12], 2):
                self.assertEqual(wk.free_order(lay, [a, b]), wk.free_order(lay, [b, a]))

    def test_no_aron_or_bimah_in_the_layout(self):
        lay = hall(FIVE)
        lay['cells'][0] = ['empty'] * len(lay['cells'][0])
        self.assertEqual(self.free(lay, sid(1, 5), sid(3, 5)), [sid(3, 5), sid(1, 5)])


if __name__ == '__main__':
    unittest.main()
