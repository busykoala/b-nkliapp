import json
from pathlib import Path


def test_art_review_catalog_covers_diverse_landscapes_with_stable_bench_ids():
    catalog = json.loads(Path("config/panorama-art-scenes.json").read_text(encoding="utf-8"))
    scenes = catalog["scenes"]
    assert len(scenes) == 5
    assert {scene["kind"] for scene in scenes} >= {"city", "mountains", "forest", "lake-hills"}
    assert len({scene["benchId"] for scene in scenes}) == len(scenes)
    assert all(scene["benchId"].startswith(("osm-", "community-")) for scene in scenes)
    assert all(len(scene["sourceKey"]) == 64 for scene in scenes)
    assert all(len(scene["checks"]) >= 3 for scene in scenes)
