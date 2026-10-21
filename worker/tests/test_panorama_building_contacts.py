"""A DEM-anchored wall and terrain must use the same measured intersection."""
from __future__ import annotations

import io
import math

import numpy as np
import pytest
from PIL import Image

from benchly.panorama.binary import decode_geometry, encode_geometry
from benchly.panorama.datasets import WGS84, refine_building_contact_rays
from benchly.panorama.material import unpack_material_transport
from benchly.panorama.models import (
    BuildingGeometry, GeometryIdentity, PanoramaConfig, SemanticClass, TerrainRay, TerrainSample,
)
from benchly.panorama.visibility import _building_columns, _ray_polygon_distance, build_panorama_geometry
from benchly.panorama.watercolor import render_material_webp


def scene(*, marker="swissALTI3D-building-contact", anchors=True, distance_offset=0):
    config = PanoramaConfig(angular_resolution_degrees=1, maximum_distance_meters=1000)
    identity = GeometryIdentity(latitude=47, longitude=8, ground_elevation_meters=0,
        terrain_version="measured-test", semantic_version="test", building_version="test",
        angular_resolution_degrees=1, maximum_distance_meters=1000)
    building = BuildingGeometry(source_id="sloping-wall", footprint=((-4,20),(4,20),(4,25),(-4,25)),
        ground_elevation_meters=8, eaves_elevation_meters=20, roof_elevation_meters=20,
        footprint_ground_elevations=(8,8,8,8) if anchors else None,
        source="measured-building", confidence=1)
    rays = []
    for azimuth in range(360):
        samples = [TerrainSample(distance_meters=1, elevation_meters=0, semantic=SemanticClass.OPEN_GRASSLAND)]
        distance = _ray_polygon_distance(building.footprint, azimuth)
        if distance is not None:
            samples.append(TerrainSample(distance_meters=distance+distance_offset, elevation_meters=5,
                semantic=SemanticClass.OPEN_GRASSLAND, terrain_source=marker))
        rays.append(TerrainRay(azimuth_degrees=azimuth, samples=tuple(samples)))
    return identity, config, building, rays


def test_measured_contact_closes_coverage_gap_without_moving_roof_or_wall_extent():
    identity, config, building, rays = scene()
    old_profiles = {i: p for i, _s, p in _building_columns(building, config, config.observer_height_meters)}
    geometry = build_panorama_geometry(identity, rays, [building], config=config)
    profiles = geometry.buildings[0].samples
    assert {p.azimuth_degrees for p in profiles} == {float(i) for i in old_profiles}
    assert any(p.azimuth_degrees == 359 for p in profiles)  # same contact across north wrap
    for p in profiles:
        index = round(p.azimuth_degrees)
        spans = geometry.columns[index].spans
        terrain = next(s for s in spans if s.semantic == SemanticClass.OPEN_GRASSLAND
                       and abs(s.distance_meters-p.distance_meters) < 1e-8)
        assert p.lower_angle_degrees == terrain.upper_angle_degrees
        assert p.lower_angle_degrees < old_profiles[index].lower_angle_degrees
        assert p.upper_angle_degrees == old_profiles[index].upper_angle_degrees
        assert p.eaves_angle_degrees == old_profiles[index].eaves_angle_degrees
        assert p.distance_meters == old_profiles[index].distance_meters
    # The ordinary capsule and material paths preserve the corrected union,
    # rather than relying on a browser-only alpha patch.
    restored = decode_geometry(encode_geometry(geometry))
    mask = unpack_material_transport(np.array(Image.open(io.BytesIO(render_material_webp(restored,720,240)))))
    lower = next(p.lower_angle_degrees for p in profiles if p.azimuth_degrees == 0)
    angle = (lower+old_profiles[0].lower_angle_degrees)/2
    row = math.floor((config.maximum_elevation_angle-angle) /
                     (config.maximum_elevation_angle-config.minimum_elevation_angle)*240)
    assert mask[row,0,3] == 255


@pytest.mark.parametrize("kwargs", [
    {"marker":"ordinary-terrain"}, {"anchors":False}, {"distance_offset":.01},
])
def test_unmatched_or_source_only_bases_are_not_snapped_to_nearby_ground(kwargs):
    identity, config, building, rays = scene(**kwargs)
    original = {i:p for i,_s,p in _building_columns(building,config,config.observer_height_meters)}
    geometry = build_panorama_geometry(identity,rays,[building],config=config)
    for p in geometry.buildings[0].samples:
        assert p.lower_angle_degrees == original[round(p.azimuth_degrees)].lower_angle_degrees


def far_scene(*, anchors=True, north=700, maximum=1000):
    identity, config, building, _ = scene(anchors=anchors)
    config = config.model_copy(update={"maximum_distance_meters": maximum})
    identity = identity.model_copy(update={"maximum_distance_meters": maximum})
    building = building.model_copy(update={"footprint": (
        (-40, north), (40, north), (40, north + 50), (-40, north + 50))})
    rays = [TerrainRay(azimuth_degrees=bearing, samples=tuple(TerrainSample(
        distance_meters=distance, elevation_meters=0, semantic=SemanticClass.OPEN_GRASSLAND,
        terrain_source="coarse-distance-shell") for distance in (100, maximum)))
        for bearing in range(360)]
    return identity, config, building, rays


class CurvedContactTerrain:
    def __init__(self, *, missing=False):
        self.locations = []
        self.missing = missing

    def sample_many(self, locations):
        self.locations.extend(locations)
        if self.missing:
            return [None] * len(locations)
        elevations = []
        for latitude, longitude in locations:
            bearing, _, distance = WGS84.inv(8, 47, longitude, latitude)
            east = distance * math.sin(math.radians(bearing))
            # Sparse 8m footprint corners do not describe this shallow dip
            # between them. The exact wall intersection has measured support.
            elevations.append(5 + 3 * (east / 40) ** 2)
        return elevations


def test_qualified_far_wall_uses_measured_contact_without_moving_roof():
    identity, config, building, rays = far_scene()
    terrain = CurvedContactTerrain()
    refined = refine_building_contact_rays(rays, [building], 47, 8, terrain, config)
    assert terrain.locations
    assert all(ray.has_complete_coverage for ray in refined)
    original = {i: p for i, _s, p in _building_columns(building, config, config.observer_height_meters)}
    geometry = build_panorama_geometry(identity, refined, [building], config=config)
    profiles = geometry.buildings[0].samples
    assert any(profile.azimuth_degrees == 359 for profile in profiles)
    for profile in profiles:
        index = round(profile.azimuth_degrees)
        contact = next(sample for sample in refined[index].samples
                       if sample.terrain_source == "swissALTI3D-building-contact")
        assert contact.distance_meters == profile.distance_meters
        measured_terrain = next(span for span in geometry.columns[index].spans
                                if span.semantic == SemanticClass.UNKNOWN_TERRAIN
                                and span.distance_meters == contact.distance_meters)
        assert profile.lower_angle_degrees == measured_terrain.upper_angle_degrees
        assert profile.lower_angle_degrees < original[index].lower_angle_degrees
        assert profile.upper_angle_degrees == original[index].upper_angle_degrees
        assert profile.eaves_angle_degrees == original[index].eaves_angle_degrees
        assert profile.distance_meters == original[index].distance_meters
        # Original coarse samples remain independently visible and ordered.
        assert all(sample in refined[index].samples for sample in rays[index].samples)


@pytest.mark.parametrize("kwargs", [{"anchors": False}, {"maximum": 600}])
def test_unqualified_far_building_or_contact_outside_range_is_not_sampled(kwargs):
    _, config, building, rays = far_scene(**kwargs)
    terrain = CurvedContactTerrain()
    assert refine_building_contact_rays(rays, [building], 47, 8, terrain, config) == rays
    assert not terrain.locations


def test_missing_qualified_far_dem_is_incomplete_instead_of_zero_height_support():
    _, config, building, rays = far_scene()
    refined = refine_building_contact_rays(rays, [building], 47, 8,
                                            CurvedContactTerrain(missing=True), config)
    assert not refined[0].has_complete_coverage
    assert refined[0].samples == rays[0].samples
    assert refined[0].expected_sample_count == len(rays[0].samples) + 1
    assert refined[90].has_complete_coverage


def test_qualified_retained_footprint_has_no_arbitrary_two_kilometre_contact_limit():
    _, config, building, rays = far_scene(north=2100, maximum=3000)
    terrain = CurvedContactTerrain()
    refined = refine_building_contact_rays(rays, [building], 47, 8, terrain, config)
    assert terrain.locations
    assert any(sample.terrain_source == "swissALTI3D-building-contact"
               and sample.distance_meters > 2000 for sample in refined[0].samples)


@pytest.mark.parametrize("resolution", [.1, .25])
def test_fractional_north_crossing_uses_every_exact_contact_without_base_teeth(resolution):
    identity, config, building, _ = scene()
    config = config.model_copy(update={"angular_resolution_degrees": resolution})
    identity = identity.model_copy(update={"angular_resolution_degrees": resolution})
    rays = [TerrainRay(azimuth_degrees=index * resolution, samples=(TerrainSample(
        distance_meters=1, elevation_meters=0, semantic=SemanticClass.OPEN_GRASSLAND),))
        for index in range(config.column_count)]
    refined = refine_building_contact_rays(rays, [building], 47, 8,
                                          CurvedContactTerrain(), config)
    geometry = build_panorama_geometry(identity, refined, [building], config=config)
    profiles = geometry.buildings[0].samples
    assert any(0 < p.azimuth_degrees < 10 for p in profiles)
    assert any(350 < p.azimuth_degrees < 360 for p in profiles)
    for profile in profiles:
        index = round(profile.azimuth_degrees / resolution)
        contact = next(sample for sample in refined[index].samples
                       if sample.terrain_source == "swissALTI3D-building-contact")
        # The same column must use the same measured ray, including after a
        # wrap. A tiny floating-point distance mismatch must not fall back to
        # the higher interpolated footprint base on scattered headings.
        assert profile.distance_meters == contact.distance_meters
        terrain = next(span for span in geometry.columns[index].spans
                       if span.distance_meters == contact.distance_meters
                       and span.semantic == SemanticClass.UNKNOWN_TERRAIN)
        assert profile.lower_angle_degrees == terrain.upper_angle_degrees
