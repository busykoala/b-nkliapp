"""Paving extents follow surveyed crossings, not the radial LOD cell size."""
import math

import numpy as np
import pytest
from shapely.geometry import Polygon

from benchly.panorama.datasets import SemanticIndex, WGS84, WGS84_TO_LV95, sample_terrain_rays
from benchly.panorama.models import PanoramaConfig, SemanticClass, TerrainRay, TerrainSample
from benchly.panorama.paving import refine_paved_ground_rays
from benchly.panorama.visibility import curvature_drop, visible_terrain_spans


LATITUDE, LONGITUDE = 46.9, 10.4  # True/grid north differ appreciably here.
CONFIG = PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=1000)


def coordinates(vertices):
    result = []
    for east, north in vertices:
        lon, lat, _ = WGS84.fwd(LONGITUDE, LATITUDE, math.degrees(math.atan2(east, north)), math.hypot(east, north))
        result.append(WGS84_TO_LV95.transform(lon, lat))
    return result


def strip(near=50, far=56, east=-10, west=10):
    return Polygon(coordinates([(east, near), (west, near), (west, far), (east, far)]))


def index(*polygons):
    return SemanticIndex([(p, SemanticClass.PAVED_GROUND, .9, 'SITG-paved-ground') for p in polygons])


class Plane:
    def sample_many(self, locations):
        bearings, _, distances = WGS84.inv(np.full(len(locations), LONGITUDE), np.full(len(locations), LATITUDE),
            np.array([p[1] for p in locations]), np.array([p[0] for p in locations]))
        return (500 + .3 * distances * np.sin(np.radians(bearings))
                - .2 * distances * np.cos(np.radians(bearings))).tolist()


class Flat:
    def sample_many(self, locations):
        return [0.] * len(locations)


def original(azimuth=0, complete=True):
    samples = tuple(TerrainSample(distance_meters=d, elevation_meters=0,
        semantic=SemanticClass.UNKNOWN_TERRAIN) for d in [2, 47, 62, 100])
    return TerrainRay(azimuth_degrees=azimuth, samples=samples,
                      expected_sample_count=len(samples) + int(not complete))


def angle(distance):
    return math.degrees(math.atan2(-1.1 - curvature_drop(distance), distance))


@pytest.mark.parametrize('near,far', [(50, 56), (57, 61), (50, 50.05)])
def test_thin_strip_has_source_bounded_angular_extent_even_between_lod_samples(near, far):
    rays = sample_terrain_rays(LATITUDE, LONGITUDE, Flat(), CONFIG, index(strip(near, far)),
                              observer_ground_elevation_meters=0)
    spans = [s for s in visible_terrain_spans(rays[0], 1.1, CONFIG)
             if s.semantic == SemanticClass.PAVED_GROUND]
    assert spans  # The ordinary grid entirely missed the 57..61 m strip.
    assert abs(min(s.lower_angle_degrees for s in spans) - angle(near)) < abs(angle(near - .11) - angle(near))
    assert abs(max(s.upper_angle_degrees for s in spans) - angle(far)) < abs(angle(far + .11) - angle(far))
    assert rays[0].has_complete_coverage


def test_hole_and_disconnected_paving_remain_separate_in_projection():
    outer = strip(40, 80)
    hole = strip(50, 60, -5, 5)
    polygon = Polygon(outer.exterior.coords, [hole.exterior.coords])
    ray = sample_terrain_rays(LATITUDE, LONGITUDE, Flat(), CONFIG,
                              index(polygon, strip(90, 95)), observer_ground_elevation_meters=0)[0]
    spans = visible_terrain_spans(ray, 1.1, CONFIG)
    for distance in [45, 65, 92]:
        assert next(s for s in spans if s.lower_angle_degrees < angle(distance) < s.upper_angle_degrees).semantic == SemanticClass.PAVED_GROUND
    for distance in [35, 55, 85, 97]:
        assert next(s for s in spans if s.lower_angle_degrees < angle(distance) < s.upper_angle_degrees).semantic != SemanticClass.PAVED_GROUND


@pytest.mark.parametrize('azimuth,polygon', [(0, strip()), (90, Polygon(coordinates([(50,-10),(56,-10),(56,10),(50,10)]))),
                                           (270, Polygon(coordinates([(-56,-10),(-50,-10),(-50,10),(-56,10)])))])
def test_added_points_keep_old_samples_and_recover_true_world_plane_normals(azimuth, polygon):
    before = original(azimuth)
    after = refine_paved_ground_rays([before], LATITUDE, LONGITUDE, Plane(), CONFIG, index(polygon))[0]
    assert all(sample in after.samples for sample in before.samples)
    added = [sample for sample in after.samples if sample not in before.samples]
    assert added
    expected = np.array([-.3, .2, 1.]); expected /= np.linalg.norm(expected)
    np.testing.assert_allclose([s.surface_normal for s in added], np.broadcast_to(expected, (len(added), 3)), atol=2e-5)
    assert len({s.distance_meters for s in after.samples}) == len(after.samples)
    assert all(2 <= s.distance_meters <= CONFIG.maximum_distance_meters for s in added)


def test_missing_centre_and_existing_missing_coverage_are_never_concealed():
    class Missing(Flat):
        def sample_many(self, locations):
            return [None] * len(locations)
    for complete in [True, False]:
        before = original(complete=complete)
        after = refine_paved_ground_rays([before], LATITUDE, LONGITUDE, Missing(), CONFIG, index(strip()))[0]
        assert after.samples == before.samples
        assert not after.has_complete_coverage


def test_missing_neighbour_leaves_normal_unknown_without_making_centre_missing():
    class MissingNeighbours(Flat):
        def sample_many(self, locations):
            return [0. if i % 5 == 0 else None for i in range(len(locations))]
    before = original()
    after = refine_paved_ground_rays([before], LATITUDE, LONGITUDE, MissingNeighbours(), CONFIG, index(strip()))[0]
    added = [sample for sample in after.samples if sample not in before.samples]
    assert added and all(s.surface_normal is None for s in added)
    assert after.has_complete_coverage


def test_original_incomplete_flag_survives_successful_boundary_samples():
    after = refine_paved_ground_rays([original(complete=False)], LATITUDE, LONGITUDE, Flat(), CONFIG, index(strip()))[0]
    assert len(after.samples) > 4 and not after.has_complete_coverage


def test_source_lake_level_and_water_priority_survive_boundary_refinement():
    p = strip(30, 90, -30, 30)
    lake = Polygon([(x, y, 2.) for x, y in p.exterior.coords])
    semantics = SemanticIndex([(strip(), SemanticClass.PAVED_GROUND, .9, 'SITG-paved-ground'),
                              (lake, SemanticClass.WATER, .98, 'swissTLM3D')])
    before = original()
    after = refine_paved_ground_rays([before], LATITUDE, LONGITUDE, Flat(), CONFIG, semantics)[0]
    added = [sample for sample in after.samples if sample not in before.samples]
    assert added and all(s.semantic == SemanticClass.WATER and s.elevation_meters == 2
                         and s.surface_normal == (0, 0, 1) and s.terrain_source == 'swissTLM3D-water-surface' for s in added)


def test_same_local_regional_and_border_fallback_rules_as_original_sampler():
    class Missing(Flat):
        def sample_many(self, locations):
            return [None] * len(locations)
    before = original()
    # The local collection is authoritative inside its radius. If unavailable,
    # original sampling only falls back to the explicitly supplied border DEM.
    after = refine_paved_ground_rays([before], LATITUDE, LONGITUDE, Plane(), CONFIG, index(strip()),
                                    local_terrain=Missing(), border_terrain=Flat())[0]
    added = [s for s in after.samples if s not in before.samples]
    assert added and all(s.elevation_meters == 0 and s.terrain_source == 'cross-border-terrain' for s in added)
    after = refine_paved_ground_rays([before], LATITUDE, LONGITUDE, Flat(), CONFIG, index(strip()),
                                    regional_terrain=Missing(), high_resolution_distance_meters=20)[0]
    added = [s for s in after.samples if s not in before.samples]
    assert added and all(s.terrain_source == 'swissALTI3D' for s in added)


def test_no_qualified_paving_leaves_existing_rays_unchanged():
    before = original()
    for semantics in [None, SemanticIndex([]), SemanticIndex([(strip(), SemanticClass.PAVED_GROUND, .3, 'unverified')]),
                      SemanticIndex([(strip(), SemanticClass.FOREST, .9, 'swissTLM3D')])]:
        assert refine_paved_ground_rays([before], LATITUDE, LONGITUDE, Flat(), CONFIG, semantics) == [before]


def test_tangent_contact_does_not_create_a_paved_angular_interval():
    # A triangle touches the north ray only at a single surveyed vertex.
    polygon = Polygon(coordinates([(0, 50), (10, 40), (10, 60)]))
    ray = sample_terrain_rays(LATITUDE, LONGITUDE, Flat(), CONFIG, index(polygon),
                              observer_ground_elevation_meters=0)[0]
    assert not any(s.semantic == SemanticClass.PAVED_GROUND for s in visible_terrain_spans(ray, 1.1, CONFIG))


def test_paving_hidden_by_near_terrain_does_not_bleed_over_the_ridge():
    class Ridge(Flat):
        def sample_many(self, locations):
            _, _, distances = WGS84.inv(np.full(len(locations), LONGITUDE), np.full(len(locations), LATITUDE),
                np.array([p[1] for p in locations]), np.array([p[0] for p in locations]))
            return [10. if d < 35 else 0. for d in distances]
    ray = sample_terrain_rays(LATITUDE, LONGITUDE, Ridge(), CONFIG, index(strip()),
                              observer_ground_elevation_meters=0)[0]
    assert not any(s.semantic == SemanticClass.PAVED_GROUND for s in visible_terrain_spans(ray, 1.1, CONFIG))


def test_ray_entirely_inside_a_large_polygon_needs_no_boundary_samples():
    polygon = strip(-2000, 2000, -2000, 2000)
    rays = sample_terrain_rays(LATITUDE, LONGITUDE, Flat(), CONFIG, index(polygon),
                               observer_ground_elevation_meters=0)
    assert all(s.semantic == SemanticClass.PAVED_GROUND for ray in rays for s in ray.samples)
    assert all(ray.has_complete_coverage for ray in rays)
