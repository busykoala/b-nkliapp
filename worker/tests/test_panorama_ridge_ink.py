"""Inner accents must explain actual overlap rather than the sampling grid."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image

from benchly.panorama.models import PanoramaColumn, PanoramaConfig, GeometryIdentity, SemanticClass, TerrainRay, TerrainSample, VisibleSpan
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import _paint_edges, _terrain_occlusion_ridges


def span(lower, upper, distance, normal=None, semantic=SemanticClass.ROCK):
    return VisibleSpan(lower_angle_degrees=lower, upper_angle_degrees=upper,
                       distance_meters=distance, semantic=semantic,
                       source="measured-fixture", confidence=1, surface_normal=normal)


def test_sparse_samples_of_one_plane_do_not_acquire_inner_ridge_ink():
    normal=(-.3, 0, math.sqrt(.91))
    column=PanoramaColumn(azimuth_degrees=0, skyline_angle_degrees=20,
                         spans=(span(-32,0,100,normal),span(0,10,1000,normal),span(10,20,10000,normal)))
    # Large sampling gaps and crossed distance bins do not turn a measured
    # unbroken plane into separate hilltops.
    assert _terrain_occlusion_ridges(column)=={}


def test_continuous_dense_hill_does_not_get_parallel_distance_band_contours():
    column=PanoramaColumn(azimuth_degrees=0, skyline_angle_degrees=20,
                         spans=tuple(span(-32+i*5.2,-32+(i+1)*5.2,300+i*10) for i in range(10)))
    assert _terrain_occlusion_ridges(column)=={}


def test_measured_near_far_overlap_keeps_a_selective_inner_accent():
    config=PanoramaConfig(angular_resolution_degrees=1)
    identity=GeometryIdentity(latitude=47,longitude=8,ground_elevation_meters=500,
        terrain_version="fixture",semantic_version="fixture",building_version="fixture",angular_resolution_degrees=1)
    geometry=build_panorama_geometry(identity,[TerrainRay(azimuth_degrees=a,samples=(
        TerrainSample(distance_meters=1000,elevation_meters=1200,semantic=SemanticClass.FOREST),))
        for a in range(360)],config=config)
    near=span(-32,0,1000,(0,0,1))
    far=span(0,35,8000,(-.5,0,math.sqrt(.75)),SemanticClass.FOREST)
    geometry=geometry.model_copy(update={"columns":tuple(c.model_copy(update={"spans":(near,far)}) for c in geometry.columns)})
    assert list(_terrain_occlusion_ridges(geometry.columns[0]).values())==[near]
    image=Image.new("RGB",(720,360),(130,140,110));before=np.array(image)
    _paint_edges(image,geometry,Image.new("L",image.size,255))
    changed=np.any(np.array(image)!=before,axis=2)
    # Forest at the outer skyline suppresses its graphite accent; the retained
    # change is the actual interior overlap at altitude zero.
    row=round(config.maximum_elevation_angle/(config.maximum_elevation_angle-config.minimum_elevation_angle)*image.height)
    assert changed[row-2:row+3].any()
    assert not changed[:row-10].any()


def test_water_and_building_range_jumps_do_not_become_terrain_ridge_strokes():
    for semantic in (SemanticClass.WATER,SemanticClass.BUILDING):
        column=PanoramaColumn(azimuth_degrees=0,skyline_angle_degrees=20,
                             spans=(span(-32,0,1000),span(0,20,8000,semantic=semantic)))
        assert _terrain_occlusion_ridges(column)=={}
