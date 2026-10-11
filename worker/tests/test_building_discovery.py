from email.message import Message
from io import BytesIO
import json
import sqlite3
from types import SimpleNamespace
import urllib.parse
from unittest.mock import patch

import pytest

from benchly.context.jobs import _import_building_cells
from benchly.context.sources import discover_swissbuildings_assets


def stac_item(year, tile=None, crs="2056_5728"):
    identity = f"swissbuildings3d_3_0_{year}" + (f"_{tile}" if tile else "")
    return {"id": identity, "properties": {"datetime": f"{year}-01-01T00:00:00Z"},
            "assets": {"gdb": {"href": f"https://data.example/{identity}_{crs}.gdb.zip"}}}


def test_progressive_discovery_uses_newest_tiles_across_pages_and_excludes_national_archives():
    pages = [
        {"features": [stac_item(2016, "1091-23"), stac_item(2026), stac_item(2019, "1091-14")],
         "links": [{"rel": "next", "href": "https://stac.example/next"}]},
        {"features": [stac_item(2019, "1091-23"), stac_item(2026, "1091-23", "2056_5773")], "links": []},
    ]
    with patch("benchly.context.sources.urllib.request.urlopen", side_effect=[BytesIO(json.dumps(page).encode()) for page in pages]) as open_url:
        assets = discover_swissbuildings_assets((8.5, 47.35, 8.55, 47.4))
        assert {asset["id"] for asset in assets} == {"swissbuildings3d_3_0_2019_1091-14", "swissbuildings3d_3_0_2019_1091-23"}
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(open_url.call_args_list[0].args[0].full_url).query)
        assert query["bbox"] == ["8.500000,47.350000,8.550000,47.400000"]


def test_national_only_results_are_not_imported_as_a_regional_tile():
    page = {"features": [stac_item(2025), stac_item(2026)], "links": []}
    with patch("benchly.context.sources.urllib.request.urlopen", return_value=BytesIO(json.dumps(page).encode())):
        assert discover_swissbuildings_assets((8.5, 47.35, 8.55, 47.4)) == []


def test_progressive_import_enforces_the_download_budget_before_extraction(tmp_path):
    database = sqlite3.connect(":memory:")
    database.execute("CREATE TABLE building_source_assets(asset_id TEXT,source_version TEXT)")
    asset = {"id": "tile", "version": "current", "url": "https://data.example/tile.gdb.zip"}
    response = BytesIO(b"oversized archive")
    response.headers = Message()
    args = SimpleNamespace(cell_degrees=.05, max_cells=3, force=False)
    try:
        with patch("benchly.context.jobs._pending_building_cells", return_value=[("cell", (8.5, 47.35, 8.55, 47.4))]), \
                patch("benchly.context.jobs.discover_swissbuildings_assets", return_value=[asset]), \
                patch("benchly.context.jobs.MAX_BUILDING_TILE_BYTES", 4), \
                patch("benchly.context.sources.urllib.request.urlopen", return_value=response):
            with pytest.raises(RuntimeError, match="Download byte limit exceeded"):
                _import_building_cells(database, args, tmp_path)
        assert not list(tmp_path.rglob("*.part"))
        assert database.execute("SELECT COUNT(*) FROM building_source_assets").fetchone()[0] == 0
    finally:
        database.close()
