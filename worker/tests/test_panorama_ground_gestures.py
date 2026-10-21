"""Ground marks must explain a plane without crossing other factual materials."""
from __future__ import annotations

import numpy as np
from PIL import Image
import pytest

from benchly.panorama.models import PanoramaColumn, PanoramaConfig, PanoramaGeometry, SemanticClass, VisibleSpan
from benchly.panorama.watercolor import _paint_land_brushwork


def ground(normal=(0, 0, 1), distance=100):
    config = PanoramaConfig(angular_resolution_degrees=90)
    span = VisibleSpan(lower_angle_degrees=-32, upper_angle_degrees=58,
                       semantic=SemanticClass.OPEN_GRASSLAND, distance_meters=distance,
                       surface_normal=normal, source="synthetic-plane", confidence=1)
    return PanoramaGeometry(identity_key="ground-mark-fixture", latitude=47, longitude=8,
                            ground_elevation_meters=500, eye_elevation_meters=501.1,
                            config=config, columns=tuple(PanoramaColumn(azimuth_degrees=a,
                                skyline_angle_degrees=58, spans=(span,)) for a in range(0, 360, 90)),
                            sources=(), complete=True)


def painted(geometry, mask=None):
    image = Image.new("RGB", (720, 360), (170, 170, 170))
    _paint_land_brushwork(image, geometry,
                         {(SemanticClass.OPEN_GRASSLAND, 0): mask or Image.new("L", image.size, 255)}, 91827)
    return np.array(image)


def test_opposite_measured_slopes_give_opposite_mark_directions():
    # Inspect the north-facing quarter of a synthetic plane. Opposite east
    # normals must tilt the gestures in opposite directions, at the same seed.
    mask = Image.new("L", (720, 360)); mask.paste(255, (0, 0, 180, 360))
    alignments = []
    for east in (-.6, .6):
        pixels = painted(ground((east, 0, .8)), mask)[8:-8, 8:170, 0].astype(float)
        dy, dx = np.gradient(pixels)
        alignments.append(float(np.sum(dx * dy)))
    assert alignments[0] > 0 > alignments[1]


def test_marks_recede_with_actual_distance_instead_of_screen_height():
    near = np.abs(painted(ground(distance=100)).astype(int) - 170).sum()
    far = np.abs(painted(ground(distance=3500)).astype(int) - 170).sum()
    assert near > far * 2 > 0
    assert np.all(painted(ground(distance=5000)) == 170)


def test_marks_do_not_touch_uncovered_sky_water_buildings_or_canopy():
    mask = Image.new("L", (720, 360)); mask.paste(255, (100, 100, 400, 300))
    first = painted(ground(), mask)
    np.testing.assert_array_equal(first, painted(ground(), mask))
    assert np.any(first[100:300, 100:400] != 170)
    assert np.all(first[np.array(mask) == 0] == 170)
    image = Image.new("RGB", (720, 360), (170, 170, 170))
    other = { (semantic, 0): Image.new("L", image.size, 255) for semantic in
              (SemanticClass.WATER, SemanticClass.BUILDING, SemanticClass.FOREST) }
    _paint_land_brushwork(image, ground(), other, 1)
    assert np.all(np.array(image) == 170)


def test_a_stroke_crossing_north_keeps_its_shape_on_both_sides(monkeypatch):
    class CrossingStroke:
        def uniform(self, low, high):
            if high == 720:
                return 715
            if high == 360:
                return 180
            if (low, high) == (.004, .022):
                return .02
            if (low, high) == (16, 48):
                return 48
            return 0

    monkeypatch.setattr("benchly.panorama.watercolor.np.random.default_rng", lambda seed: CrossingStroke())
    pixels = painted(ground(None))
    # No truncated line or separately regenerated bend at the wrap. The two
    # adjacent boundary samples carry the same load on this horizontal fixture.
    assert pixels[180, 0, 0] < 170
    np.testing.assert_allclose(pixels[180, 0].astype(int), pixels[180, -1].astype(int), atol=1)


@pytest.mark.parametrize("normal", [None, (0, 0, 1)])
def test_legacy_and_flat_ground_are_deterministic(normal):
    first = painted(ground(normal))
    np.testing.assert_array_equal(first, painted(ground(normal)))
    assert np.any(first != 170)
