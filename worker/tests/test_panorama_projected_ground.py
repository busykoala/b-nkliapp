"""Ground pigment follows known planes while preserving coverage and old capsules."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image
import pytest

from benchly.panorama.models import PanoramaColumn, PanoramaConfig, PanoramaGeometry, SemanticClass, VisibleSpan
from benchly.panorama.watercolor import (
    _ground_pigment_noise, _ground_plane_range, _paint_ground_brushwork,
    _paint_land_brushwork, _projected_ground_coordinates,
)


def plane(*, normal=(0, 0, 1), distance=80, semantic=SemanticClass.OPEN_GRASSLAND):
    config = PanoramaConfig(angular_resolution_degrees=1)
    span = VisibleSpan(lower_angle_degrees=math.degrees(math.atan(-1.1 / 3)),
                       upper_angle_degrees=math.degrees(math.atan(-1.1 / 80)),
                       distance_meters=distance, semantic=semantic,
                       surface_normal=normal, source="analytic-plane", confidence=1)
    return PanoramaGeometry(identity_key="projected-pigment-fixture", latitude=47, longitude=8,
                            ground_elevation_meters=500, eye_elevation_meters=501.1,
                            config=config, columns=tuple(PanoramaColumn(azimuth_degrees=a,
                                skyline_angle_degrees=span.upper_angle_degrees, spans=(span,))
                                for a in range(360)), sources=(), complete=True)


@pytest.mark.parametrize("slope", [0, .12, -.2])
@pytest.mark.parametrize("azimuth", [0, math.pi / 2, 2 * math.pi])
def test_known_surface_points_reproject_to_their_distances(slope, azimuth):
    # Independent surveyed points on z = slope*r - 1.1, viewed at known angles.
    ranges = np.array([3, 10, 30, 80], dtype=float)
    angles = np.arctan(slope - 1.1 / ranges)
    normal = (-slope * math.sin(azimuth), -slope * math.cos(azimuth), 1)
    actual, derivative = _ground_plane_range(80, angles[-1], normal, azimuth, angles)
    np.testing.assert_allclose(actual, ranges, atol=1e-9)
    # A grazing ray covers a larger physical brush footprint than a downward ray.
    assert np.all(np.isfinite(derivative))
    assert abs(derivative[-1]) > abs(derivative[0]) * 100


def test_metres_based_pigment_is_continuous_across_north():
    radius = np.array([2, 10, 80], dtype=np.float32)
    first = _ground_pigment_noise(radius * math.sin(0), radius * math.cos(0), 19)
    last = _ground_pigment_noise(radius * math.sin(2 * math.pi), radius * math.cos(2 * math.pi), 19)
    np.testing.assert_allclose(first, last, atol=1e-6)


def test_plane_coordinates_and_pixel_footprints_are_finite():
    east, north, coverage, footprint = _projected_ground_coordinates(plane(), 720, 360)
    for value in (east, north, coverage, footprint):
        assert np.all(np.isfinite(value))
    assert np.any(coverage)
    radius = np.hypot(east, north)[coverage > 0]
    assert radius.min() >= 20  # local tangent limited to one quarter of its sample range
    assert radius.max() <= 320
    assert np.all(coverage[:220] == 0)  # no projected pigment above the measured land


def paint(geometry, masks=None):
    image = Image.new("RGB", (720, 360), (170, 170, 170))
    _paint_ground_brushwork(image, geometry,
                           masks if masks is not None else {
                               (SemanticClass.OPEN_GRASSLAND, 0): Image.new("L", image.size, 255)}, 91827)
    return np.asarray(image)


def test_projected_paint_is_deterministic_and_distant_unresolved_marks_stay_quiet():
    near = paint(plane())
    np.testing.assert_array_equal(near, paint(plane()))
    assert np.any(near != 170)
    assert np.all(paint(plane(distance=3000)) == 170)


def test_pigment_cannot_cross_actual_material_coverage():
    mask = Image.new("L", (720, 360)); mask.paste(255, (100, 240, 400, 330))
    pixels = paint(plane(), {(SemanticClass.OPEN_GRASSLAND, 0): mask})
    assert np.any(pixels[np.array(mask) > 0] != 170)
    assert np.all(pixels[np.array(mask) == 0] == 170)
    for semantic in (SemanticClass.WATER, SemanticClass.FOREST, SemanticClass.BUILDING, SemanticClass.ROCK):
        assert np.all(paint(plane(semantic=semantic), {(semantic, 0): Image.new("L", mask.size, 255)}) == 170)


def test_missing_normals_keep_the_previous_capsule_appearance_exactly():
    geometry = plane(normal=None)
    expected = Image.new("RGB", (720, 360), (170, 170, 170))
    masks = {(SemanticClass.OPEN_GRASSLAND, 0): Image.new("L", expected.size, 255)}
    _paint_land_brushwork(expected, geometry, masks, 91827)
    np.testing.assert_array_equal(paint(geometry, masks), np.asarray(expected))


def test_near_vertical_ground_and_invalid_tangent_intersections_add_no_marks():
    assert np.all(paint(plane(normal=(math.sqrt(.99), 0, .1))) == 170)
    _east, _north, coverage, footprint = _projected_ground_coordinates(plane(normal=(0, 0, 1)), 720, 360)
    assert np.all(coverage[:220] == 0)
    assert np.all(np.isfinite(footprint))
