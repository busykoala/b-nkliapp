"""Wall pigment follows real planes without fabricating facade structure."""
import math

import numpy as np
from PIL import Image

from benchly.panorama.binary import encode_geometry
from benchly.panorama.models import (
    BuildingGeometry, GeometryIdentity, PanoramaConfig, TerrainRay, TerrainSample,
)
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import _paint_architecture_planes


def scene():
    config = PanoramaConfig(angular_resolution_degrees=1, maximum_distance_meters=1000,
                            minimum_elevation_angle=-20, maximum_elevation_angle=40)
    identity = GeometryIdentity(latitude=47, longitude=8, ground_elevation_meters=500,
                                terrain_version="fixture", semantic_version="fixture",
                                building_version="fixture", angular_resolution_degrees=1)
    rays = [TerrainRay(azimuth_degrees=a, samples=tuple(
        TerrainSample(distance_meters=d, elevation_meters=500) for d in (2, 20, 100)
    )) for a in range(360)]
    house = BuildingGeometry(source_id="measured-house", source="fixture", confidence=1,
        footprint=((-10, 20), (10, 20), (10, 25), (-10, 25)),
        ground_elevation_meters=500, eaves_elevation_meters=508, roof_elevation_meters=508)
    return build_panorama_geometry(identity, rays, [house], config=config)


def paint(base, geometry):
    field = Image.new("L", base.size, 128)
    _paint_architecture_planes(base, geometry, field, field)
    return np.asarray(base)


def test_glaze_stays_on_the_analytic_wall_and_wraps_without_changing_geometry():
    geometry = scene()
    original_geometry = encode_geometry(geometry)
    width, height = 1440, 240
    before = np.full((height, width, 3), (186, 148, 113), dtype=np.uint8)
    after = paint(Image.fromarray(before), geometry)
    changed = np.any(after != before, axis=-1)
    assert changed[:, 0].any() and changed[:, -1].any()
    # Independent ray/plane intersection for the front wall y=20, x=±10,
    # z=500…508. Two raster pixels allow the painter's inclusive polygon rim.
    azimuth = (np.arange(width) + .5) / width * 360
    signed = (azimuth + 180) % 360 - 180
    distance = 20 / np.maximum(.01, np.cos(np.radians(signed)))
    altitude = 40 - (np.arange(height)[:, None] + .5) / height * 60
    observer = 500 + geometry.config.observer_height_meters
    z = observer + distance[None, :] * np.tan(np.radians(altitude))
    tolerance = distance[None, :] * math.tan(math.radians(2 * 60 / height))
    allowed = ((np.abs(signed)[None, :] <= math.degrees(math.atan(.5)) + 2 * 360 / width)
               & (z >= 500 - tolerance) & (z <= 508 + tolerance))
    assert not np.any(changed & ~allowed)
    assert np.max(np.abs(after[:, 0].astype(int) - after[:, -1].astype(int))) <= 1
    assert np.all(after[changed, 0] > after[changed, 1])
    assert encode_geometry(geometry) == original_geometry


def test_collinear_polygon_splits_do_not_restart_or_double_the_wash():
    geometry = scene()
    split = geometry.model_copy(update={"buildings": tuple(building.model_copy(update={
        "samples": tuple(sample.model_copy(update={"facade_index": int(sample.azimuth_degrees // 4)})
                         for sample in building.samples)
    }) for building in geometry.buildings)})
    base = Image.new("RGB", (1440, 240), (186, 148, 113))
    expected = paint(base.copy(), geometry)
    actual = paint(base.copy(), split)
    assert np.any(actual != np.asarray(base))
    np.testing.assert_array_equal(actual, expected)


def test_existing_opening_retains_support_and_contrast_under_the_translucent_glaze():
    geometry = scene()
    plain = Image.new("RGB", (1440, 240), (205, 175, 140))
    marked = plain.copy()
    # A synthetic mark within the measured front wall; no real feature inferred.
    marked.paste((85, 80, 75), (5, 120, 25, 135))
    before = np.asarray(plain).astype(float) - np.asarray(marked)
    after = paint(plain.copy(), geometry).astype(float) - paint(marked.copy(), geometry)
    support = np.any(before != 0, axis=-1)
    np.testing.assert_array_equal(np.any(after != 0, axis=-1), support)
    assert after[support].mean() > before[support].mean() * .6


def test_empty_distant_and_small_silhouettes_remain_exact():
    geometry = scene()
    variants = [geometry.model_copy(update={"buildings": ()})]
    for kind in ("distant", "small"):
        variants.append(geometry.model_copy(update={"buildings": tuple(building.model_copy(update={
            "samples": tuple(sample.model_copy(update={"distance_meters": 1500} if kind == "distant" else {
                "upper_angle_degrees": sample.lower_angle_degrees + 1,
                "eaves_angle_degrees": sample.lower_angle_degrees + 1,
            }) for sample in building.samples)
        }) for building in geometry.buildings)}))
    pixels = np.random.default_rng(8).integers(0, 256, (240, 1440, 3), dtype=np.uint8)
    for variant in variants:
        np.testing.assert_array_equal(paint(Image.fromarray(pixels), variant), pixels)
