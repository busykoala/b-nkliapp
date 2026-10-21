"""Source orientation, rather than ray selection, should explain ground planes."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

from benchly.panorama.models import GeometryIdentity, PanoramaConfig, SemanticClass, TerrainRay, TerrainSample
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import _ground_orientation_brush, _paint_measured_slope_volume, _slope_pigment_field


def plane_geometry(normal):
    config=PanoramaConfig(angular_resolution_degrees=45)
    identity=GeometryIdentity(latitude=47,longitude=8,ground_elevation_meters=500,
        terrain_version="fixture",semantic_version="fixture",building_version="fixture",angular_resolution_degrees=45)
    # Deliberately inconsistent legacy radial edge slopes must not override the
    # same measured 3-D plane as it is seen from different azimuth rays.
    return build_panorama_geometry(identity,[TerrainRay(azimuth_degrees=a,samples=(
        TerrainSample(distance_meters=1000,elevation_meters=650,semantic=SemanticClass.OPEN_GRASSLAND,
                      slope_degrees=35 if a%90==0 else -35,surface_normal=normal),)) for a in range(0,360,45)],config=config)


def test_one_measured_plane_has_one_wash_around_the_circle_and_at_its_boundary():
    geometry=plane_geometry((-.3,.4,math.sqrt(.75)))
    field=_slope_pigment_field(geometry,360,180)
    # Inspect the entire projected terrain interior, plus its first row: sky
    # cannot pull that boundary towards a different apparent slope.
    scale=180/(geometry.config.maximum_elevation_angle-geometry.config.minimum_elevation_angle)
    top=round((geometry.config.maximum_elevation_angle-geometry.columns[0].skyline_angle_degrees)*scale)
    np.testing.assert_allclose(field[top+2:,:],field[top+2,0],atol=.001)
    assert np.ptp(field[top+2,:])<.001
    assert field[top+2,0]>140


def test_opposite_plane_orientations_reserve_opposite_warm_and_cool_washes():
    east=_slope_pigment_field(plane_geometry((.6,0,.8)),360,180)
    west=_slope_pigment_field(plane_geometry((-.6,0,.8)),360,180)
    assert east[-1].mean()<128<west[-1].mean()
    np.testing.assert_allclose(east[-1].mean(),96.41,atol=.001)
    np.testing.assert_allclose(west[-1].mean()-128,128-east[-1].mean(),atol=.001)


def test_orientation_glaze_preserves_water_canopy_and_sky_pixels():
    geometry=plane_geometry((.6,0,.8));base=Image.new("RGB",(360,180),(130,140,110));before=np.array(base)
    grass=Image.new("L",base.size);ImageDraw.Draw(grass).rectangle((0,100,99,179),fill=255)
    other=Image.new("L",base.size);ImageDraw.Draw(other).rectangle((100,100,359,179),fill=255)
    _paint_measured_slope_volume(base,geometry,{SemanticClass.OPEN_GRASSLAND:grass,SemanticClass.WATER:other,SemanticClass.FOREST:other})
    after=np.array(base)
    np.testing.assert_array_equal(after[:100],before[:100])
    np.testing.assert_array_equal(after[:,100:],before[:,100:])
    assert np.any(after[100:,:100]!=before[100:,:100])


def test_legacy_capsule_without_normals_still_has_a_finite_deterministic_wash():
    geometry=plane_geometry(None)
    first=_slope_pigment_field(geometry,360,180)
    second=_slope_pigment_field(geometry,360,180)
    assert np.isfinite(first).all()
    np.testing.assert_array_equal(first,second)


def test_range_and_missing_coverage_cannot_break_one_constant_measured_plane():
    coverage=np.ones((64,1024),dtype=np.float32)
    coverage[12:44,400:600]=0
    values=coverage*23
    distances=np.broadcast_to(np.where(np.arange(1024)%100<50,2,800),coverage.shape).astype(np.float32)
    result=_ground_orientation_brush(values,coverage,distances,120)
    # Changing range and the presence of a non-ground hole cannot insert
    # extra planes into a physically constant orientation.
    assert np.ptp(result[coverage==1])<.001
    assert np.isfinite(result).all()


def test_close_source_facets_are_quieter_than_the_same_angular_pattern_at_distance():
    coverage=np.ones((64,1024),dtype=np.float32)
    values=np.broadcast_to(35*np.sin(np.arange(1024)*2*math.pi/64),coverage.shape).astype(np.float32)
    near=_ground_orientation_brush(values,coverage,np.full_like(values,2),120)
    far=_ground_orientation_brush(values,coverage,np.full_like(values,800),120)
    assert near.std()<far.std()*.2
    assert far.std()>5  # keep readable planes instead of flattening all ground


def test_brush_scale_and_orientation_wrap_together_without_a_special_north_edge():
    coverage=np.ones((64,1024),dtype=np.float32)
    coverage[:,20:90]=0
    values=np.broadcast_to(30*np.cos(np.arange(1024)*2*math.pi/128),coverage.shape).astype(np.float32)*coverage
    distances=np.broadcast_to(np.where(np.arange(1024)<520,3,180),coverage.shape).astype(np.float32)
    original=_ground_orientation_brush(values,coverage,distances,120)
    shifted=_ground_orientation_brush(np.roll(values,217,axis=1),np.roll(coverage,217,axis=1),
                                     np.roll(distances,217,axis=1),120)
    np.testing.assert_allclose(shifted,np.roll(original,217,axis=1),atol=.0001)


def test_no_ground_coverage_produces_no_invented_orientation():
    empty=np.zeros((32,128),dtype=np.float32)
    result=_ground_orientation_brush(empty,empty,np.ones_like(empty),120)
    np.testing.assert_array_equal(result,np.full_like(empty,128))
