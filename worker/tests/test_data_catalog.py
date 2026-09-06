import unittest

from benchly.catalog import load_catalog


class DataCatalogTest(unittest.TestCase):
    def test_catalog_is_valid_and_includes_every_scheduled_pipeline(self):
        catalog = load_catalog()
        self.assertGreaterEqual(len(catalog.jobs), 18)
        self.assertIn("graphhopper", {source.id for source in catalog.sources})
        self.assertIn("sonbase", {source.id for source in catalog.sources})
        self.assertTrue(all(source.lifecycle in {"active", "experimental", "research-only"} for source in catalog.sources))
        self.assertTrue(all(source.access != "evaluation-only" for source in catalog.sources if source.lifecycle == "active"))
        source_by_id = {source.id: source for source in catalog.sources}
        self.assertTrue(all(
            source_by_id[source_id].access != "evaluation-only"
            for job in catalog.jobs if job.purpose == "production"
            for source_id in job.sourceIds
        ))
        self.assertEqual(catalog.runtime.pipelineVersion, "4.4.0")


if __name__ == "__main__":
    unittest.main()
