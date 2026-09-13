from pathlib import Path

from pyproj import Transformer

from benchly.context.contracts import StacPage
from benchly.panorama.terrain_download import newest_assets, required_terrain_cells


def test_required_cells_include_configured_radius(tmp_path: Path):
    index = tmp_path / "benches.tsv"
    index.write_text("hash\t1\tosm-node-1\t46.95\t7.44\n")
    easting, northing = Transformer.from_crs(4326, 2056, always_xy=True).transform(7.44, 46.95)
    center = int(easting // 1_000), int(northing // 1_000)

    cells = required_terrain_cells(index, 1)

    assert len(cells) == 9
    assert center in cells
    assert (center[0] + 1, center[1] - 1) in cells


def test_newest_assets_selects_one_latest_geotiff_per_required_cell():
    required = {(2600, 1200)}
    page = StacPage.model_validate({
        "features": [
            {
                "id": "old",
                "properties": {"datetime": "2021-01-01T00:00:00Z"},
                "assets": {"data": {
                    "href": "https://example.test/swissalti3d_2021_2600-1200_2_2056_5728.tif",
                    "type": "image/tiff; application=geotiff",
                }},
            },
            {
                "id": "new",
                "properties": {"datetime": "2025-01-01T00:00:00Z"},
                "assets": {"data": {
                    "href": "https://example.test/swissalti3d_2025_2600-1200_2_2056_5728.tif",
                    "type": "image/tiff; application=geotiff",
                }},
            },
            {
                "id": "irrelevant",
                "properties": {"datetime": "2026-01-01T00:00:00Z"},
                "assets": {"data": {
                    "href": "https://example.test/swissalti3d_2026_2601-1200_2_2056_5728.tif",
                    "type": "image/tiff; application=geotiff",
                }},
            },
        ],
    })
    selected = {}

    newest_assets(page, required, selected)

    assert set(selected) == required
    assert selected[(2600, 1200)].item_id == "new"
