import json
from pathlib import Path

from benchly.context.models import EnvironmentFeature, OfficialContextSource
from benchly.context.regional_trees import BASEL_SOURCE, SOURCE, import_basel_trees, import_zurich_trees
from benchly.db import open_database


def test_zurich_tree_import_validates_and_replaces_one_source_generation(tmp_path: Path):
    path = tmp_path / "trees.geojson"
    path.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [8.54, 47.38]},
                "properties": {"objectid": 1, "baumnummer": "ZH-1", "baumnamedeu": "Linde", "kronendurchmesser": 12},
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [7.44, 46.95]},
                "properties": {"objectid": 2, "baumnummer": "outside"},
            },
        ],
    }), encoding="utf-8")
    database_path = tmp_path / "benchly.sqlite"
    with open_database(database_path) as database:
        database.create_tables((EnvironmentFeature, OfficialContextSource))
        assert import_zurich_trees(database, path, "fixture-v1") == 1
        row = database.execute("SELECT source,source_id,raw_tags,geometry_crs FROM environment_features").fetchone()
        assert (row["source"], row["source_id"], row["geometry_crs"]) == (SOURCE, "ZH-1", 4326)
        assert json.loads(row["raw_tags"])["crown_diameter_m"] == 12
        status = database.execute("SELECT version,stats FROM official_context_sources WHERE source=?", (SOURCE,)).fetchone()
        assert status["version"] == "fixture-v1"
        assert json.loads(status["stats"]) == {"trees": 1}


def test_basel_tree_import_has_explicit_scope_and_provenance(tmp_path: Path):
    path = tmp_path / "trees.geojson"
    path.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [7.59, 47.56]},
                "properties": {"gml_id": "BA_Baeume.1", "ba_baumnr": "BS-1", "baumart_deutsch": "Linde"},
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [8.54, 47.38]},
                "properties": {"gml_id": "outside"},
            },
        ],
    }), encoding="utf-8")
    with open_database(tmp_path / "benchly.sqlite") as database:
        database.create_tables((EnvironmentFeature, OfficialContextSource))
        assert import_basel_trees(database, path, "fixture-v1") == 1
        row = database.execute("SELECT source,source_id,raw_tags FROM environment_features").fetchone()
        assert (row["source"], row["source_id"]) == (BASEL_SOURCE, "BS-1")
        assert json.loads(row["raw_tags"])["name"] == "Linde"
