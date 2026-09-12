from __future__ import annotations

import numpy as np
from shapely.geometry import box

from benchly.panorama.datasets import SemanticIndex, WGS84_TO_LV95, distance_schedule
from benchly.panorama.models import SemanticClass


def test_distance_schedule_is_dense_nearby_and_reaches_the_far_limit():
    distances = distance_schedule(150_000)
    assert distances[0] == 2
    assert distances[-1] == 150_000
    assert np.count_nonzero(distances <= 1_000) >= 45
    assert len(distances) < 150


def test_semantic_index_uses_specific_water_over_broad_land_cover():
    longitude, latitude = 8.2, 46.9
    easting, northing = WGS84_TO_LV95.transform(longitude, latitude)
    broad = box(easting - 100, northing - 100, easting + 100, northing + 100)
    lake = box(easting - 10, northing - 10, easting + 10, northing + 10)
    index = SemanticIndex([
        (broad, SemanticClass.OPEN_GRASSLAND, .8, "land-cover"),
        (lake, SemanticClass.WATER, .98, "surface-water"),
    ])
    semantics, confidences, sources = index.classify(np.asarray([longitude]), np.asarray([latitude]))
    assert semantics.tolist() == [SemanticClass.WATER]
    assert confidences.tolist() == [.98]
    assert sources.tolist() == ["surface-water"]
