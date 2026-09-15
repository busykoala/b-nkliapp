from __future__ import annotations

import math
import io

from PIL import Image, ImageDraw
import numpy as np

from benchly.panorama.cache import geometry_cache_key, render_cache_key
from benchly.panorama.models import (
    BuildingProjectionSample,
    BuildingGeometry,
    GeometryIdentity,
    PanoramaConfig,
    ProjectedBuilding,
    RenderIdentity,
    SemanticClass,
    TerrainRay,
    TerrainSample,
)
from benchly.panorama.visibility import build_panorama_geometry, curvature_drop
from benchly.panorama.watercolor import (
    _building_runs, _heal_water_wrap_cusp, _paint_buildings, _paint_measured_slope_volume,
    _paint_mountain_facets, _paint_water_details,
    _periodic_pigment, _soften_narrow_water_view, _surface_masks, render_lightmap_webp, render_panorama_webp,
)


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


def test_narrow_water_ray_is_a_wash_but_broad_lake_and_wrap_are_preserved():
    mask = Image.new("L", (200, 80))
    draw = ImageDraw.Draw(mask)
    draw.rectangle((30, 20, 34, 79), fill=255)
    draw.rectangle((100, 20, 170, 79), fill=255)
    draw.rectangle((198, 20, 199, 79), fill=255)
    draw.rectangle((0, 20, 2, 79), fill=255)
    softened = _soften_narrow_water_view(mask)
    assert 0 < softened.getpixel((32, 65)) < 255
    assert softened.getpixel((130, 65)) == 255
    assert 0 < softened.getpixel((0, 65)) < 255


def test_narrow_snow_chute_fades_into_connected_mountain_but_broad_snow_remains():
    rock = Image.new("L", (200, 80), 255)
    snow = Image.new("L", (200, 80))
    ImageDraw.Draw(rock).rectangle((30, 10, 34, 79), fill=0)
    ImageDraw.Draw(snow).rectangle((30, 10, 34, 79), fill=255)
    ImageDraw.Draw(snow).rectangle((110, 10, 170, 79), fill=255)
    surfaces = _surface_masks({(SemanticClass.ROCK, 0): rock, (SemanticClass.SNOW_OR_GLACIER, 0): snow})
    assert surfaces[SemanticClass.SNOW_OR_GLACIER].getpixel((32, 20)) > surfaces[SemanticClass.SNOW_OR_GLACIER].getpixel((32, 70))
    assert surfaces[SemanticClass.ROCK].getpixel((32, 60)) > 100
    assert surfaces[SemanticClass.SNOW_OR_GLACIER].getpixel((140, 60)) > 200


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


def test_inner_ridge_is_retained_below_the_outer_skyline_and_painted():
    north = [
        TerrainSample(distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),
        TerrainSample(distance_meters=1_000, elevation_meters=650, semantic=SemanticClass.FOREST, source="fixture"),
        TerrainSample(distance_meters=8_000, elevation_meters=2_000, semantic=SemanticClass.ROCK, source="fixture"),
    ]
    result = build_panorama_geometry(IDENTITY, rays({0: north}), config=CONFIG)
    edges = result.columns[0].terrain_edges
    assert [edge.kind for edge in edges] == ["inner-ridge", "inner-ridge", "skyline"]
    assert edges[-2].elevation_angle_degrees < edges[-1].elevation_angle_degrees

    # A four-column fixture makes the real inner edge long enough for the
    # renderer's noise-suppression threshold.
    circular = build_panorama_geometry(IDENTITY, rays({azimuth: north for azimuth in (0, 90, 180, 270)}), config=CONFIG)
    image = Image.open(io.BytesIO(render_panorama_webp(circular, 720, 240)))
    assert image.size == (720, 240)


def test_many_dem_increments_compact_to_stable_depth_edges():
    distances = [50 * 1.25 ** index for index in range(30)]
    north = [
        TerrainSample(
            distance_meters=distance,
            elevation_meters=IDENTITY.ground_elevation_meters + CONFIG.observer_height_meters
            + math.tan(math.radians(-.5 + index * .12)) * distance,
            semantic=SemanticClass.ROCK,
            source="fixture",
        )
        for index, distance in enumerate(distances)
    ]
    result = build_panorama_geometry(IDENTITY, rays({0: north}), config=CONFIG)
    edges = result.columns[0].terrain_edges
    inner_layers = [edge.depth_layer for edge in edges if edge.kind == "inner-ridge"]
    assert len(edges) <= 8
    assert len(inner_layers) == len(set(inner_layers))
    assert edges[-1].kind == "skyline"


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
    assert len(result.buildings) == 1
    assert result.buildings[0].object_id == "house-1"
    assert result.buildings[0].samples[0].lower_angle_degrees < result.buildings[0].samples[0].eaves_angle_degrees


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
    assert result.buildings == ()
    assert result.columns[0].terrain_edges[-1].distance_meters == 500


def test_near_building_hides_inner_terrain_edge_at_the_same_angle():
    north = [
        TerrainSample(distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),
        TerrainSample(distance_meters=1_000, elevation_meters=650, semantic=SemanticClass.ROCK, source="fixture"),
        TerrainSample(distance_meters=10_000, elevation_meters=2_000, semantic=SemanticClass.ROCK, source="fixture"),
    ]
    house = BuildingGeometry(
        source_id="edge-blocker", footprint=((-20, 100), (20, 100), (20, 130), (-20, 130)),
        ground_elevation_meters=500, eaves_elevation_meters=525, roof_elevation_meters=525,
        source="fixture", confidence=1,
    )
    result = build_panorama_geometry(IDENTITY, rays({0: north}), [house], config=CONFIG)
    assert not any(edge.distance_meters == 1_000 for edge in result.columns[0].terrain_edges)


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


def test_building_below_mountain_skyline_remains_visible_when_line_of_sight_is_clear():
    north = [
        TerrainSample(distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),
        TerrainSample(distance_meters=5_000, elevation_meters=1_300, semantic=SemanticClass.ROCK, source="fixture"),
    ]
    house = BuildingGeometry(
        source_id="valley-house", footprint=((-12, 450), (12, 450), (12, 475), (-12, 475)),
        ground_elevation_meters=500, eaves_elevation_meters=512, roof_elevation_meters=512,
        source="fixture", confidence=1,
    )
    result = build_panorama_geometry(IDENTITY, rays({0: north}), [house], config=CONFIG)
    building = next(span for span in result.columns[0].spans if span.object_id == "valley-house")
    assert building.upper_angle_degrees < result.columns[0].skyline_angle_degrees
    assert result.buildings[0].object_id == "valley-house"


def test_curvature_and_refraction_are_explicit():
    geometric = curvature_drop(100_000, 0)
    refracted = curvature_drop(100_000, .13)
    assert 780 < geometric < 790
    assert refracted < geometric


def test_geometry_cache_excludes_direction_while_render_cache_tracks_crop_and_season():
    first = geometry_cache_key(IDENTITY)
    assert first == geometry_cache_key(IDENTITY.model_copy())
    assert first != geometry_cache_key(IDENTITY.model_copy(update={"building_radius_meters": 3_000}))
    assert first != geometry_cache_key(IDENTITY.model_copy(update={"semantic_radius_meters": 30_000}))
    assert first != geometry_cache_key(IDENTITY.model_copy(update={"regional_terrain_version": "regio-v2"}))
    assert first != geometry_cache_key(IDENTITY.model_copy(update={"border_terrain_version": "copernicus-v2"}))
    assert first != geometry_cache_key(IDENTITY.model_copy(update={"lod_schedule_version": "lod-v2"}))
    assert first != geometry_cache_key(IDENTITY.model_copy(update={"high_resolution_distance_meters": 10_000}))
    base = dict(geometry_key=first, horizontal_fov_degrees=100, width=1600, height=720,
                weather_bucket="clear", solar_lunar_bucket="day", bench_variant="wood-back", covered=False)
    north = render_cache_key(RenderIdentity(center_azimuth_degrees=0, **base))
    east = render_cache_key(RenderIdentity(center_azimuth_degrees=90, **base))
    autumn = render_cache_key(RenderIdentity(center_azimuth_degrees=0, **{**base, "season_bucket": "autumn"}))
    assert north != east
    assert north != autumn


def test_watercolor_renderer_is_deterministic_webp_with_real_painted_variation():
    geometry = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    first = render_panorama_webp(geometry, 720, 240, "autumn")
    assert first == render_panorama_webp(geometry, 720, 240, "autumn")
    assert first[:4] == b"RIFF"
    image = Image.open(io.BytesIO(first)).convert("RGB")
    assert image.size == (720, 240)
    assert len(image.getcolors(maxcolors=100_000) or []) > 100


def test_ridge_brushwork_never_fills_a_vertical_panorama_column():
    north = [
        TerrainSample(distance_meters=100, elevation_meters=500,
                      semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),
        TerrainSample(distance_meters=1_000, elevation_meters=650,
                      semantic=SemanticClass.FOREST, source="fixture"),
        TerrainSample(distance_meters=8_000, elevation_meters=2_500,
                      semantic=SemanticClass.ROCK, source="fixture"),
    ]
    geometry = build_panorama_geometry(IDENTITY, rays({0: north}), config=CONFIG)
    canvas = Image.new("RGB", (720, 240), (212, 216, 192))
    before = np.asarray(canvas).copy()
    _paint_mountain_facets(canvas, geometry, {(SemanticClass.ROCK, 0): Image.new("L", canvas.size, 255)},
                           Image.new("L", canvas.size, 255))
    changed = np.any(np.asarray(canvas) != before, axis=2)
    assert changed.any()
    # A true facet is finite: even a strong ridge may not paint a radial
    # curtain from skyline to the bottom of the panorama.
    assert max(np.count_nonzero(changed[:, x]) for x in range(720)) < 120


def test_measured_opposite_hillside_slopes_have_distinct_soft_volume():
    geometry = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    columns = tuple(column.model_copy(update={
        "terrain_edges": tuple(edge.model_copy(update={"slope_degrees": 45 if index % 2 == 0 else -45})
                               for edge in column.terrain_edges),
    }) for index, column in enumerate(geometry.columns))
    geometry = geometry.model_copy(update={"columns": columns})
    canvas = Image.new("RGB", (720, 240), (160, 160, 160))
    _paint_measured_slope_volume(canvas, geometry,
                                 {SemanticClass.OPEN_GRASSLAND: Image.new("L", canvas.size, 255)})
    pixels = np.asarray(canvas)
    assert pixels[200, 20, 0] > pixels[200, 220, 0] + 25
    assert pixels[200, 20, 0] > pixels[200, 20, 2]
    assert pixels[200, 220, 0] < pixels[200, 220, 2]


def test_lake_washes_do_not_add_long_vertical_reflection_posts():
    canvas = Image.new("RGB", (720, 240), (201, 213, 196))
    water = Image.new("L", canvas.size)
    ImageDraw.Draw(water).rectangle((0, 118, 719, 239), fill=255)
    _paint_water_details(canvas, water, 17, _periodic_pigment(720, 240, 19, (190, 91, 43)))
    pixels = np.asarray(canvas, dtype=np.float32)[145:230]
    column_edges = np.abs(np.diff(pixels, axis=1)).mean(axis=(0, 2))
    assert np.count_nonzero(column_edges > 8) <= 3


def test_water_wrap_heals_a_dark_cusp_without_changing_land():
    image = Image.new("RGB", (720, 240), (90, 130, 160))
    water = Image.new("L", image.size)
    ImageDraw.Draw(water).rectangle((0, 120, 719, 239), fill=255)
    ImageDraw.Draw(image).rectangle((0, 120, 8, 239), fill=(76, 116, 146))
    ImageDraw.Draw(image).rectangle((711, 120, 719, 239), fill=(76, 116, 146))
    corrected = np.asarray(_heal_water_wrap_cusp(image, water), dtype=np.int16)
    assert np.abs(corrected[180, 0] - corrected[180, 20]).mean() < 3
    assert tuple(corrected[30, 0]) == (90, 130, 160)


def test_narrow_canopy_gap_becomes_dappled_but_wide_clearing_stays_open():
    forest = Image.new("L", (360, 120), 255)
    grass = Image.new("L", forest.size)
    for left, right in ((90, 92), (200, 250)):
        ImageDraw.Draw(forest).rectangle((left, 40, right, 100), fill=0)
        ImageDraw.Draw(grass).rectangle((left, 40, right, 100), fill=255)
    result = _surface_masks({(SemanticClass.FOREST, 0): forest,
                             (SemanticClass.OPEN_GRASSLAND, 0): grass})
    assert result[SemanticClass.FOREST].getpixel((91, 70)) > 200
    assert result[SemanticClass.OPEN_GRASSLAND].getpixel((91, 70)) < 80
    assert result[SemanticClass.FOREST].getpixel((225, 70)) < 30
    assert result[SemanticClass.OPEN_GRASSLAND].getpixel((225, 70)) > 200


def test_subpixel_building_runs_do_not_become_vertical_fence_posts():
    geometry = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    sample = BuildingProjectionSample(
        azimuth_degrees=90,
        lower_angle_degrees=-8,
        eaves_angle_degrees=8,
        upper_angle_degrees=10,
        distance_meters=120,
    )
    geometry = geometry.model_copy(update={
        "buildings": (ProjectedBuilding(
            object_id="degenerate",
            source="fixture",
            confidence=1,
            samples=(sample, sample),
        ),),
    })
    canvas = Image.new("RGB", (720, 240), (243, 235, 216))
    before = np.asarray(canvas).copy()
    _paint_buildings(canvas, geometry, 7, Image.new("L", canvas.size, 128))
    assert np.array_equal(np.asarray(canvas), before)


def test_quarter_degree_building_samples_form_one_coherent_facade():
    geometry = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    sample = BuildingProjectionSample(
        azimuth_degrees=12, lower_angle_degrees=-5, eaves_angle_degrees=6,
        upper_angle_degrees=9, distance_meters=120,
    )
    geometry = geometry.model_copy(update={
        "config": geometry.config.model_copy(update={"angular_resolution_degrees": .1}),
        "buildings": (ProjectedBuilding(
            object_id="sampled-facade", source="fixture", confidence=1,
            samples=tuple(sample.model_copy(update={"azimuth_degrees": 12 + delta})
                          for delta in (0, .25, .5, .75, 1.0)),
        ),),
    })
    runs = list(_building_runs(geometry, 720, 240))
    assert len(runs) == 1
    assert len(runs[0][1]) == 5


def test_water_remains_water_at_the_bottom_without_an_invented_sand_band():
    water = [
        TerrainSample(distance_meters=100, elevation_meters=500,
                      semantic=SemanticClass.WATER, source="fixture"),
    ]
    geometry = build_panorama_geometry(
        IDENTITY, rays({azimuth: water for azimuth in (0, 90, 180, 270)}), config=CONFIG,
    )
    image = np.asarray(Image.open(io.BytesIO(render_panorama_webp(geometry, 720, 240))).convert("RGB"))
    bottom = image[210:235]
    assert float(bottom[..., 2].mean()) > float(bottom[..., 0].mean()) + 12


def test_uniform_geography_has_a_visually_seamless_watercolor_wrap():
    geometry = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    image = np.asarray(Image.open(io.BytesIO(render_panorama_webp(geometry, 720, 240))).convert("RGB"), dtype=np.int16)
    seam_error = np.abs(image[:, 0] - image[:, -1]).mean()
    assert seam_error < 8


def test_forest_is_tonally_layered_and_distinct_from_open_land():
    forest_sample = [TerrainSample(distance_meters=100, elevation_meters=500,
                                   semantic=SemanticClass.FOREST, source="fixture")]
    forest = build_panorama_geometry(
        IDENTITY, rays({azimuth: forest_sample for azimuth in (0, 90, 180, 270)}), config=CONFIG,
    )
    meadow = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    forest_pixels = np.asarray(Image.open(io.BytesIO(render_panorama_webp(forest, 720, 240))).convert("RGB"))
    meadow_pixels = np.asarray(Image.open(io.BytesIO(render_panorama_webp(meadow, 720, 240))).convert("RGB"))
    forest_land = forest_pixels[150:225]
    meadow_land = meadow_pixels[150:225]
    assert float(forest_land[..., 1].mean() - forest_land[..., 0].mean()) > 7
    assert float(forest_land.std()) > 10
    assert float(np.abs(forest_land.astype(np.int16) - meadow_land.astype(np.int16)).mean()) > 4


def test_lightmap_follows_sun_height_and_is_soft():
    geometry = build_panorama_geometry(IDENTITY, rays(), config=CONFIG)
    low = Image.open(io.BytesIO(render_lightmap_webp(geometry, 180, 5, 720, 180))).convert("L")
    high = Image.open(io.BytesIO(render_lightmap_webp(geometry, 180, 55, 720, 180))).convert("L")
    assert low.size == high.size == (720, 180)
    assert np.asarray(high).mean() > np.asarray(low).mean()


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
