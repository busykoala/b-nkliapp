"""Measured lake heights must compose with land before visibility, not as paint."""
import numpy as np
from shapely.geometry import Polygon, MultiPolygon

from benchly.panorama.datasets import (SemanticIndex, WGS84_TO_LV95, WGS84,
    sample_terrain_rays, refine_building_contact_rays)
from benchly.panorama.models import PanoramaConfig, SemanticClass, BuildingGeometry

LAT, LON = 46.9, 8.2
E, N = WGS84_TO_LV95.transform(LON, LAT)


def rectangle(x0, y0, x1, y1, z=190):
    coords = [(E+x0,N+y0),(E+x1,N+y0),(E+x1,N+y1),(E+x0,N+y1)]
    return Polygon(coords if z is None else [(x,y,z) for x,y in coords])


def index(geometry, semantic=SemanticClass.WATER, source="swissTLM3D"):
    return SemanticIndex([(geometry, semantic, .98, source)])


def query(samples, dx=0, dy=0):
    # Invert LV95 only to produce test query coordinates. The query itself
    # still exercises the production geodetic transform and spatial tree.
    from pyproj import Transformer
    lon, lat = Transformer.from_crs(2056,4326,always_xy=True).transform(E+dx,N+dy)
    return samples.water_surface_heights(np.asarray([lon]), np.asarray([lat]))[0]


def test_only_source_bound_flat_still_water_provides_an_elevation():
    assert abs(query(index(rectangle(-20,-20,20,20)))-190)<1e-9
    sloped = Polygon([(E-20,N-20,190),(E+20,N-20,191),(E+20,N+20,191),(E-20,N+20,190)])
    missing = Polygon([(E-20,N-20,190),(E+20,N-20,np.nan),(E+20,N+20,190)])
    for candidate in [index(rectangle(-20,-20,20,20,z=None)), index(sloped), index(missing),
                      index(rectangle(-20,-20,20,20),source="OpenStreetMap"),
                      index(rectangle(-20,-20,20,20),semantic=SemanticClass.RIVER),
                      index(rectangle(-20,-20,20,20,z=9999))]:
        assert np.isnan(query(candidate))


def test_islands_and_outside_points_retain_the_terrain_measurement():
    outer = rectangle(-100,-100,100,100)
    island = rectangle(-10,-10,10,10)
    samples = index(Polygon(outer.exterior.coords,[island.exterior.coords]))
    assert np.isnan(query(samples))
    assert np.isnan(query(samples,dx=120))
    assert query(samples,dx=40)==190


def test_conflicting_overlapping_levels_are_not_chosen_by_record_order():
    records=[(rectangle(-20,-20,20,20,z=height),SemanticClass.WATER,.98,"swissTLM3D") for height in [190,192]]
    assert np.isnan(query(SemanticIndex(records)))
    assert np.isnan(query(SemanticIndex(records[::-1])))
    consistent=[(rectangle(-20,-20,20,20,z=height),SemanticClass.WATER,.98,"swissTLM3D") for height in [190,190.002]]
    assert abs(query(SemanticIndex(consistent))-190.001)<1e-9


def test_separate_polygon_parts_keep_their_own_lake_elevations():
    samples=index(MultiPolygon([rectangle(-50,-20,-10,20,z=190),rectangle(10,-20,50,20,z=250)]))
    assert query(samples,dx=-30)==190
    assert query(samples,dx=30)==250


class Terrain:
    @staticmethod
    def sample_many(locations):
        lat,lon=np.asarray(list(locations)).T
        distance=np.asarray(WGS84.inv(np.full(len(lon),LON),np.full(len(lat),LAT),lon,lat)[2])
        return np.where(distance<100,200-distance*.1,np.where(distance<600,180,205)).tolist()


def lake():
    return Polygon(rectangle(-600,-600,600,600).exterior.coords,
                   [rectangle(-100,-100,100,100).exterior.coords])


def rays(samples,terrain=None):
    return sample_terrain_rays(LAT,LON,terrain or Terrain(),
        PanoramaConfig(angular_resolution_degrees=90,maximum_distance_meters=1000),
        semantics=samples,observer_ground_elevation_meters=200)


def test_lake_is_reconciled_before_occlusion_with_horizontal_surface_normals():
    from shapely import force_2d
    control=rays(index(force_2d(lake())))
    candidate=rays(index(lake()))
    for before,after in zip(control,candidate,strict=True):
        old_water=[s for s in before.samples if s.semantic==SemanticClass.WATER]
        water=[s for s in after.samples if s.semantic==SemanticClass.WATER]
        assert min(s.distance_meters for s in water)<min(s.distance_meters for s in old_water)
        assert {s.elevation_meters for s in water}=={190}
        assert {s.terrain_source for s in water}=={"swissTLM3D-water-surface"}
        assert {s.surface_normal for s in water}=={(0,0,1)}
        assert all(s.elevation_meters!=190 for s in after.samples if s.semantic!=SemanticClass.WATER)


def test_lake_height_does_not_hide_missing_dem_coverage():
    class Missing:
        @staticmethod
        def sample_many(locations):return [None]*len(locations)
    assert all(not r.samples and not r.has_complete_coverage for r in rays(index(lake()),Missing()))


def test_near_wall_refinement_does_not_reintroduce_the_old_underwater_height():
    samples=index(lake());config=PanoramaConfig(angular_resolution_degrees=90,maximum_distance_meters=1000)
    building=BuildingGeometry(source_id="fixture-pier",footprint=((-10,200),(10,200),(10,220),(-10,220)),
        ground_elevation_meters=188,eaves_elevation_meters=198,roof_elevation_meters=198,source="fixture",confidence=1)
    before=rays(samples)
    after=refine_building_contact_rays(before,[building],LAT,LON,Terrain(),config,samples)
    extra=[s for s in after[0].samples if abs(s.distance_meters-200)<.01]
    assert len(extra)==1
    assert extra[0].elevation_meters==190
    assert extra[0].terrain_source=="swissTLM3D-water-surface"
    assert extra[0].surface_normal==(0,0,1)


def test_source_rounding_is_tolerated_without_flattening_a_sloped_face():
    rounded=Polygon([(E-20,N-20,190),(E+20,N-20,190.003),(E+20,N+20,190.002),(E-20,N+20,190.001)])
    assert abs(query(index(rounded))-190.001)<.0011
    slope=Polygon([(E-20,N-20,190),(E+20,N-20,190.03),(E+20,N+20,190.03),(E-20,N+20,190)])
    assert np.isnan(query(index(slope)))
