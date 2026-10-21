"""Visibility and circular run boundaries cannot change a building's palette."""
from __future__ import annotations

import numpy as np
from PIL import Image

from benchly.panorama.models import (
    BuildingProjectionSample, GeometryIdentity, PanoramaConfig, ProjectedBuilding,
    SemanticClass, TerrainRay, TerrainSample,
)
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import _paint_buildings


def house(identity, angles):
    return ProjectedBuilding(object_id=identity, source="measured", confidence=1,
        samples=tuple(BuildingProjectionSample(azimuth_degrees=angle,
            lower_angle_degrees=-5, eaves_angle_degrees=20, upper_angle_degrees=20,
            distance_meters=100, facade_index=0, facade_normal_degrees=225)
            for angle in angles))


def paint(buildings):
    config = PanoramaConfig(angular_resolution_degrees=1)
    identity = GeometryIdentity(latitude=47, longitude=8, ground_elevation_meters=0,
        terrain_version="test", semantic_version="test", building_version="test",
        angular_resolution_degrees=1)
    geometry = build_panorama_geometry(identity,
        [TerrainRay(azimuth_degrees=a, samples=(TerrainSample(distance_meters=100,
            elevation_meters=0, semantic=SemanticClass.OPEN_GRASSLAND),)) for a in range(360)],
        config=config).model_copy(update={"buildings":tuple(buildings)})
    image = Image.new("RGB", (720,240), (180,190,170))
    _paint_buildings(image,geometry,123,Image.new("L",image.size,128))
    return np.array(image)


def test_hiding_an_unrelated_house_does_not_recolour_the_principal_building():
    target = house("principal",range(40,61))
    before = paint([house("unrelated",range(20,31)),target])
    after = paint([target])
    np.testing.assert_array_equal(before[150:175,85:115],after[150:175,85:115])
    assert np.any(before != after)  # the unrelated building really was removed


def test_two_runs_of_one_building_at_north_have_the_same_plane_colour(monkeypatch):
    # Isolate source palette identity from the deliberately asymmetric brush
    # passage. Its continuity/fragment invariance is tested in plane_washes.
    monkeypatch.setattr("benchly.panorama.watercolor._paint_architecture_planes", lambda *args: None)
    image = paint([house("north-house",[*range(11),*range(350,360)])])
    np.testing.assert_array_equal(image[160,8],image[160,712])
    assert tuple(image[160,8]) != (180,190,170)
