from pathlib import Path

from benchly.panorama.cache import PanoramaCache
from benchly.panorama.models import GeometryIdentity, PanoramaConfig, SemanticClass, TerrainRay, TerrainSample
from benchly.panorama.visibility import build_panorama_geometry


def test_geometry_and_render_cache_are_atomic_and_reusable(tmp_path: Path):
    identity = GeometryIdentity(latitude=47, longitude=8, ground_elevation_meters=400,
        terrain_version="terrain-v1", semantic_version="semantic-v1", building_version="buildings-v1",
        angular_resolution_degrees=180)
    config = PanoramaConfig(angular_resolution_degrees=180)
    rays = [TerrainRay(azimuth_degrees=value, samples=(TerrainSample(distance_meters=100,
        elevation_meters=400, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),)) for value in (0, 180)]
    geometry = build_panorama_geometry(identity, rays, config=config)
    cache = PanoramaCache(tmp_path)
    geometry_path = cache.put_geometry(geometry)
    assert geometry_path.exists()
    assert cache.get_geometry(geometry.identity_key) == geometry
    render_path = cache.put_render("a" * 64, "<svg/>")
    assert render_path.exists()
    assert cache.get_render("a" * 64) == "<svg/>"
    assert not list(tmp_path.rglob("*.part"))
