from pathlib import Path
import pytest
from benchly.context.raster_cache import RasterCache
from benchly.context.rasters import RasterCollection
from benchly.context.geometry import WGS84_TO_LV95
from benchly.terrain import horizon_profile
from benchly.knowledge.approaches import analyze_approach
from shapely.geometry import LineString


def test_horizon_records_missing_samples_instead_of_flat_complete_rays():
    class Raster:
        datasets = [True]
        def __init__(self, value):
            self.value = value
        def sample(self, *_):
            return self.value
    coverage = {}
    profile = horizon_profile(46.68, 7.68, 501.1, Raster(None), Raster(500), [], coverage)
    assert profile[0] == [None]*72
    assert all(value is not None for value in profile[1])
    assert coverage["terrain_samples"] == coverage["terrain_expected"]
    assert coverage["surface_samples"] == 0
    partial = horizon_profile(46.68, 7.68, 501.1, Raster(500), Raster(None), [], {})
    assert partial[0] == [None]*72
    assert partial[1] == [None]*72


@pytest.mark.parametrize("structure", ["bridge", "tunnel"])
def test_bare_terrain_does_not_establish_bridge_or_tunnel_gradient(structure):
    import json
    x, y = WGS84_TO_LV95.transform(7.68, 46.68)
    context = [{"kind": "path", "source_id": "way-1", "raw_tags": json.dumps({"highway": "footway", structure: "yes"}),
                "geometry_wkb": LineString([(x,y),(x+200,y)]).wkb}]
    result = analyze_approach({"row_id": 1, "latitude": 46.68, "longitude": 7.68}, context, lambda *_: 500)
    assert result["maximum_slope_percent"] is None
    assert json.loads(result["evidence_json"])["terrain_ambiguity"] == "bridge_or_tunnel"


def test_cache_evicts_old_unpinned_tiles_and_preserves_download_cap(tmp_path):
    cache = RasterCache(tmp_path, max_bytes=15)
    first, second = tmp_path / "a.tif", tmp_path / "b.tif"
    first.write_bytes(b"a"*10)
    second.write_bytes(b"b"*10)
    cache.pin(second)
    assert cache.trim() == 10
    assert not first.exists() and second.exists()
    with pytest.raises(RuntimeError, match="pinned"):
        cache.trim(reserve=10)
    assert second.exists()


def test_raster_index_reuses_footprints_and_bounds_open_handles(tmp_path):
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    x, y = WGS84_TO_LV95.transform(7.68, 46.68)
    for index in range(4):
        with rasterio.open(tmp_path / f"{index}.tif", "w", driver="GTiff", width=1, height=1, count=1,
            dtype="float32", crs="EPSG:2056", transform=from_origin(x+index*100-5, y+5, 10, 10), nodata=-9999) as target:
            target.write(np.array([[[500+index]]], dtype="float32"))
    from pyproj import Transformer
    transform = Transformer.from_crs(2056, 4326, always_xy=True)
    for _ in range(2):
        collection = RasterCollection(tmp_path, max_open=2)
        try:
            assert len(collection.datasets) == 4
            for index in range(4):
                lon, lat = transform.transform(x+index*100, y)
                assert collection.sample(lat, lon) == 500+index
                assert len(collection.handles) <= 2
            locations = []
            for index in range(4):
                lon, lat = transform.transform(x+index*100, y)
                locations.append((lat, lon))
            assert collection.sample_many(locations) == [500, 501, 502, 503]
            assert collection.sample(46, 8) is None
        finally:
            collection.close()
