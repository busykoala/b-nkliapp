from argparse import Namespace

from benchly.benches.models import Bench, BenchEnrichment
from benchly.benches.repository import upsert_enrichment, upsert_inventory_benches
from benchly.db import open_database
from benchly.enrichment import jobs
from benchly.runs.models import PipelineRun
from benchly.knowledge.models import KnowledgeGeneration, KnowledgeRevision
from benchly.knowledge.repository import upsert


def test_profile_job_revisits_null_version_and_preserves_current_raster_result(tmp_path, monkeypatch):
    path = tmp_path / "resume.sqlite"
    database = open_database(path)
    database.create_tables([Bench, BenchEnrichment, PipelineRun, KnowledgeGeneration, KnowledgeRevision])
    upsert(database, KnowledgeGeneration, {"id": 1, "revision": 1}, ["id"])
    for row_id, version in [(1, None), (2, jobs.PIPELINE_VERSION)]:
        upsert_inventory_benches(database, [{"id": f"bench-{row_id}", "osm_type": "node", "osm_id": row_id,
            "latitude": 46.68 + row_id / 100, "longitude": 7.68,
            "source_updated_at": "now", "imported_at": "now"}], False)
        upsert_enrichment(database, {"bench_row_id": row_id, "pipeline_version": version,
                                       "terrain_horizon_profile": "[" + "0," * 71 + "0]"})
    database.commit()
    database.close()
    fetched = []

    def fetch(latitude, _longitude):
        fetched.append(latitude)
        return "fresh terrain"

    monkeypatch.setattr(jobs, "fetch_terrain_horizon", fetch)
    monkeypatch.setattr(jobs, "_profile_values", lambda _db, row, _terrain: {
        "bench_row_id": row["row_id"], "pipeline_version": jobs.PROFILE_PIPELINE_VERSION,
    })
    jobs.enrich_profile_batch_job(Namespace(database=path, limit=10, max_runtime_minutes=1, requests_per_second=10000))
    assert len(fetched) == 1
    database = open_database(path)
    assert [row[0] for row in database.execute("SELECT pipeline_version FROM bench_enrichments ORDER BY bench_row_id")] == [
        jobs.PROFILE_PIPELINE_VERSION, jobs.PIPELINE_VERSION,
    ]
    database.close()
