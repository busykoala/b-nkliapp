import unittest

from benchly.catalog import load_catalog


class DataCatalogTest(unittest.TestCase):
    def test_catalog_is_valid_and_includes_every_scheduled_pipeline(self):
        catalog = load_catalog()
        self.assertEqual(len(catalog.jobs), 14)
        self.assertIn("graphhopper", {source.id for source in catalog.sources})
        self.assertEqual(catalog.runtime.pipelineVersion, "4.4.0")


if __name__ == "__main__":
    unittest.main()
