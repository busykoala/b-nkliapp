from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from benchly.sources.artifacts import is_lv95_crs, validate_sonbase_raster


def test_sonbase_contract_accepts_single_band_lv95_with_nodata(tmp_path: Path):
    path = tmp_path / "noise.tif"
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="float64",
        crs="EPSG:2056",
        transform=from_origin(2_600_000, 1_200_000, 10, 10),
        nodata=-9999,
    ) as target:
        target.write(np.full((1, 2, 2), 55.0))
    validate_sonbase_raster(path)


def test_sonbase_contract_rejects_wrong_crs(tmp_path: Path):
    path = tmp_path / "noise.tif"
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=1,
        height=1,
        count=1,
        dtype="float64",
        crs="EPSG:4326",
        transform=from_origin(7.6, 46.7, .01, .01),
        nodata=-9999,
    ) as target:
        target.write(np.full((1, 1, 1), 55.0))
    try:
        validate_sonbase_raster(path)
        raise AssertionError("wrong CRS was accepted")
    except ValueError as error:
        assert "EPSG:2056" in str(error)


def test_official_rail_day_wkt_is_accepted_but_shifted_coordinates_are_not(tmp_path: Path):
    # Header of BAFU's laerm-bahnlaerm_tag_2056.tif, verified against LV95 control points.
    wkt = (Path(__file__).parent / "fixtures" / "rail-day-lv95.wkt").read_text()
    crs = rasterio.crs.CRS.from_wkt(wkt)
    assert is_lv95_crs(crs)
    assert not is_lv95_crs(rasterio.crs.CRS.from_wkt(wkt.replace('2600000', '2601000')))
    path = tmp_path / "rail-day.tif"
    with rasterio.open(path, 'w', driver='GTiff', width=1, height=1, count=1, dtype='float64',
        crs=crs, transform=from_origin(2_600_000, 1_200_000, 10, 10), nodata=-9999) as target:
        target.write(np.full((1, 1, 1), 55.0))
    validate_sonbase_raster(path)
