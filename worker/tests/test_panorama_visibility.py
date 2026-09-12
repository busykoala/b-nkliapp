from __future__ import annotations

from benchly.panorama.cache import geometry_cache_key, render_cache_key
from benchly.panorama.models import (
    BuildingGeometry,
    GeometryIdentity,
    PanoramaConfig,
    RenderIdentity,
    SemanticClass,
    TerrainRay,
    TerrainSample,
)
from benchly.panorama.visibility import build_panorama_geometry, curvature_drop
from benchly.panorama.watercolor import render_panorama_svg


CONFIG = PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=150_000)
IDENTITY = GeometryIdentity(
    latitude=46.9,
    longitude=8.2,
    ground_elevation_meters=500,
    terrain_version="alti-test",
    semantic_version="tlm-test",
    building_version="buildings-test",
    angular_resolution_degrees=90,
)


def rays(samples_by_direction=None):
    samples_by_direction = samples_by_direction or {}
    return [TerrainRay(azimuth_degrees=azimuth, samples=tuple(samples_by_direction.get(azimuth, [
        TerrainSample(distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),
    ]))) for azimuth in (0, 90, 180, 270)]


def test_flat_terrain_forms_a_complete_circular_surface():
    result = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    assert result.complete
    assert len(result.columns) == 4
    assert all(column.spans[0].semantic == SemanticClass.OPEN_GRASSLAND for column in result.columns)


def test_near_ridge_hides_a_lower_distant_ridge_but_retains_visible_layers():
    north = [
        TerrainSample(distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),
        TerrainSample(distance_meters=1_000, elevation_meters=700, semantic=SemanticClass.FOREST, source="fixture"),
        TerrainSample(distance_meters=8_000, elevation_meters=900, semantic=SemanticClass.ROCK, source="fixture"),
        TerrainSample(distance_meters=20_000, elevation_meters=5_500, semantic=SemanticClass.SNOW_OR_GLACIER, source="fixture"),
    ]
    result = build_panorama_geometry(IDENTITY, rays({0: north}), config=CONFIG)
    semantics = [span.semantic for span in result.columns[0].spans]
    assert SemanticClass.OPEN_GRASSLAND in semantics
    assert SemanticClass.FOREST in semantics
    assert SemanticClass.ROCK not in semantics
    assert SemanticClass.SNOW_OR_GLACIER in semantics


def test_near_building_occludes_mountain_and_crosses_skyline():
    north = [
        TerrainSample(distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),
        TerrainSample(distance_meters=5_000, elevation_meters=1_300, semantic=SemanticClass.ROCK, source="fixture"),
    ]
    house = BuildingGeometry(
        source_id="house-1",
        footprint=((-12, 50), (12, 50), (12, 70), (-12, 70)),
        ground_elevation_meters=500,
        eaves_elevation_meters=516,
        roof_elevation_meters=522,
        roof_kind="known-pitched",
        source="swissBUILDINGS3D",
        confidence=1,
    )
    result = build_panorama_geometry(IDENTITY, rays({0: north}), [house], config=CONFIG)
    north_spans = result.columns[0].spans
    building = [span for span in north_spans if span.semantic == SemanticClass.BUILDING]
    assert building
    assert building[0].object_id == "house-1"
    assert building[0].upper_angle_degrees == result.columns[0].skyline_angle_degrees
    assert not any(span.semantic == SemanticClass.ROCK and span.lower_angle_degrees < building[0].upper_angle_degrees <= span.upper_angle_degrees for span in north_spans)


def test_building_behind_near_ridge_is_depth_hidden():
    north = [
        TerrainSample(distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),
        TerrainSample(distance_meters=500, elevation_meters=650, semantic=SemanticClass.FOREST, source="fixture"),
    ]
    house = BuildingGeometry(
        source_id="hidden-house",
        footprint=((-20, 1_000), (20, 1_000), (20, 1_030), (-20, 1_030)),
        ground_elevation_meters=500,
        eaves_elevation_meters=530,
        roof_elevation_meters=530,
        source="OpenStreetMap",
        confidence=.6,
    )
    result = build_panorama_geometry(IDENTITY, rays({0: north}), [house], config=CONFIG)
    assert not any(span.object_id == "hidden-house" for span in result.columns[0].spans)


def test_two_buildings_use_nearest_depth_in_overlap():
    near = BuildingGeometry(source_id="near", footprint=((-10, 40), (10, 40), (10, 55), (-10, 55)),
        ground_elevation_meters=500, eaves_elevation_meters=512, roof_elevation_meters=512,
        source="fixture", confidence=1)
    far = BuildingGeometry(source_id="far", footprint=((-20, 80), (20, 80), (20, 105), (-20, 105)),
        ground_elevation_meters=500, eaves_elevation_meters=518, roof_elevation_meters=518,
        source="fixture", confidence=1)
    result = build_panorama_geometry(IDENTITY, rays(), [far, near], config=CONFIG)
    buildings = [span for span in result.columns[0].spans if span.semantic == SemanticClass.BUILDING]
    assert buildings
    assert buildings[0].object_id == "near"


def test_curvature_and_refraction_are_explicit():
    geometric = curvature_drop(100_000, 0)
    refracted = curvature_drop(100_000, .13)
    assert 780 < geometric < 790
    assert refracted < geometric


def test_geometry_cache_excludes_direction_while_render_cache_includes_it():
    first = geometry_cache_key(IDENTITY)
    assert first == geometry_cache_key(IDENTITY.model_copy())
    assert first != geometry_cache_key(IDENTITY.model_copy(update={"building_radius_meters": 3_000}))
    assert first != geometry_cache_key(IDENTITY.model_copy(update={"semantic_radius_meters": 30_000}))
    base = dict(geometry_key=first, horizontal_fov_degrees=100, width=1600, height=720,
                weather_bucket="clear", solar_lunar_bucket="day", bench_variant="wood-back", covered=False)
    north = render_cache_key(RenderIdentity(center_azimuth_degrees=0, **base))
    east = render_cache_key(RenderIdentity(center_azimuth_degrees=90, **base))
    rainy = render_cache_key(RenderIdentity(center_azimuth_degrees=0, **{**base, "weather_bucket": "rain"}))
    assert north != east
    assert north != rainy


def test_watercolor_renderer_is_deterministic_and_contains_no_location_text():
    geometry = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    first = render_panorama_svg(geometry, 720, 240)
    assert first == render_panorama_svg(geometry, 720, 240)
    assert "Calculated 360 degree landscape panorama" in first
    assert "Bern" not in first
    assert "fractalNoise" in first


def test_missing_ray_is_partial_not_fabricated():
    result = build_panorama_geometry(IDENTITY, rays()[:-1], config=CONFIG)
    assert not result.complete
    assert result.columns[-1].spans == ()
    assert result.warnings == ("terrain coverage 3/4 columns",)


def test_missing_samples_inside_a_ray_are_partial_not_fabricated():
    fixture = rays()
    fixture[0] = fixture[0].model_copy(update={"expected_sample_count": 2})
    result = build_panorama_geometry(IDENTITY, fixture, config=CONFIG)
    assert not result.complete
    assert result.warnings == ("partial terrain coverage in 1/4 columns",)


def test_render_identity_supports_full_circle_artifacts():
    identity = RenderIdentity(
        geometry_key="a" * 64, center_azimuth_degrees=0, horizontal_fov_degrees=360,
        width=3600, height=900, weather_bucket="neutral", solar_lunar_bucket="neutral",
        bench_variant="wood-back", covered=False,
    )
    assert identity.horizontal_fov_degrees == 360
