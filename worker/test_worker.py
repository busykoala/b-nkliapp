import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from benchly_worker import (
    context_kind,
    exclusive_worker_lock,
    expand_bounds,
    parse_bool,
    parse_direction,
    parse_height,
    score_view,
    spatial_cell_bounds,
)


class WorkerUnitTests(unittest.TestCase):
    def test_direction_normalization(self):
        self.assertEqual(parse_direction("SW"), 225)
        self.assertEqual(parse_direction("-45"), 315)
        self.assertIsNone(parse_direction("both"))

    def test_boolean_normalization(self):
        self.assertEqual(parse_bool("yes"), 1)
        self.assertEqual(parse_bool("no"), 0)
        self.assertIsNone(parse_bool("unknown"))

    def test_view_formula(self):
        self.assertEqual(score_view(1, 1, 1, 1, 1), 100)
        self.assertEqual(score_view(0, 0, 0, 0, 0), 0)
        self.assertEqual(score_view(1, 0, 0, 0, 0), 35)

    def test_context_classification_and_height(self):
        self.assertEqual(context_kind({"building": "yes"}), "building")
        self.assertEqual(context_kind({"natural": "water"}), "water")
        self.assertEqual(context_kind({"highway": "footway"}), "path")
        self.assertAlmostEqual(parse_height({"building:levels": "3"}), 9.3)

    def test_spatial_batch_bounds_are_stable_and_expand(self):
        bounds = spatial_cell_bounds(46.68654, 7.86468)
        for actual, expected in zip(bounds, (7.85, 46.65, 7.90, 46.70)):
            self.assertAlmostEqual(actual, expected)
        expanded = expand_bounds(bounds, 500)
        self.assertLess(expanded[0], bounds[0])
        self.assertLess(expanded[1], bounds[1])
        self.assertGreater(expanded[2], bounds[2])
        self.assertGreater(expanded[3], bounds[3])

    def test_worker_lock_rejects_a_second_writer(self):
        with TemporaryDirectory() as directory:
            database = Path(directory) / "benchly.sqlite"
            with exclusive_worker_lock(database) as first:
                self.assertTrue(first)
                with exclusive_worker_lock(database) as second:
                    self.assertFalse(second)


if __name__ == "__main__":
    unittest.main()
