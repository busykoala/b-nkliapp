from __future__ import annotations

import io
import json
import math
import struct

import numpy as np
from PIL import Image
import pytest

from benchly.panorama.binary import MAGIC, decode_geometry, encode_geometry
from benchly.panorama.datasets import WGS84, _terrain_surface_normals, sample_terrain_rays
from benchly.panorama.models import GeometryIdentity, PanoramaConfig, TerrainSample, VisibleSpan, SemanticClass
from benchly.panorama.visibility import build_panorama_geometry, _compose_spans
from benchly.panorama.watercolor import render_lightmap_webp, render_material_webp, render_panorama_webp
from benchly.panorama.material import unpack_material_transport


@pytest.mark.parametrize("count", [4, 8, 72, 360])
def test_tilted_plane_has_one_world_normal_at_every_radius_and_bearing(count):
    bearings = np.arange(count) * 360 / count
    radii = np.array([2, 10, 30, 1000.])
    east = np.sin(np.radians(bearings))[:, None] * radii
    north = np.cos(np.radians(bearings))[:, None] * radii
    heights = 500 + .3 * east - .2 * north
    expected = np.array([-.3, .2, 1]); expected /= np.linalg.norm(expected)
    normals = _terrain_surface_normals(heights, radii, bearings)
    np.testing.assert_allclose(normals, np.broadcast_to(expected, normals.shape), atol=1e-6)


def test_missing_neighbours_do_not_become_invented_terrain_orientation():
    angles = np.arange(8) * 45
    distances = np.arange(1, 6, dtype=float)
    heights = 500 + .3 * np.sin(np.radians(angles))[:, None] * distances
    heights[0] = np.nan
    heights[4, 1] = heights[4, 3] = np.nan
    normals = _terrain_surface_normals(heights, distances, angles)
    assert np.isnan(normals[0]).all()
    assert np.isnan(normals[4, 2]).all()  # Do not bridge missing radial cells.
    # A single missing angular neighbour still leaves two independent measured
    # directions, so a one-sided stencil recovers the same plane at the wrap.
    expected = np.array([-.3, 0, 1]); expected /= np.linalg.norm(expected)
    np.testing.assert_allclose(normals[7], np.broadcast_to(expected, normals[7].shape), atol=1e-6)
    assert np.isnan(_terrain_surface_normals([[500,500],[500,500]], [2,3], [0,180])).all()


def tilted_plane():
    latitude, longitude = 46.9, 8.2
    class Terrain:
        @staticmethod
        def sample_many(locations):
            bearing, _, distance = WGS84.inv(np.full(len(locations), longitude), np.full(len(locations), latitude),
                np.array([p[1] for p in locations]), np.array([p[0] for p in locations]))
            return (500 + .3 * distance * np.sin(np.radians(bearing)) - .2 * distance * np.cos(np.radians(bearing))).tolist()
    config = PanoramaConfig(angular_resolution_degrees=1, maximum_distance_meters=1000)
    rays = sample_terrain_rays(latitude, longitude, Terrain(), config, observer_ground_elevation_meters=500)
    identity = GeometryIdentity(latitude=latitude, longitude=longitude, ground_elevation_meters=500,
        terrain_version="analytic-plane", semantic_version="unknown", building_version="none", angular_resolution_degrees=1)
    return build_panorama_geometry(identity, rays, config=config)


def test_measured_plane_lighting_is_independent_of_viewing_ray_and_follows_sun():
    geometry = tilted_plane()
    assert all(span.surface_normal is not None for c in geometry.columns for span in c.spans)
    images = [np.asarray(Image.open(io.BytesIO(render_lightmap_webp(geometry,270,35,720,240,
        use_surface_normals=normals)))) for normals in (False,True)]
    # This near strip of the same analytic plane is visible around the full
    # circle, including north. The radial approximation wrongly changes its
    # lighting with viewing azimuth; the actual world normal cannot do so.
    assert images[0][235].std() > 5
    assert images[1][235].std() < .6
    east_sun = np.asarray(Image.open(io.BytesIO(render_lightmap_webp(geometry,90,35,720,240))))
    assert images[1][235].mean() - east_sun[235].mean() > 30


def test_normals_survive_visibility_and_capsule_roundtrip_with_legacy_fallback():
    geometry = tilted_plane(); encoded=encode_geometry(geometry); restored=decode_geometry(encoded)
    a=[s.surface_normal for c in geometry.columns for s in c.spans]
    b=[s.surface_normal for c in restored.columns for s in c.spans]
    np.testing.assert_allclose(a,b,atol=.0005)
    size, body_size=struct.unpack("<II",encoded[8:16]); header=json.loads(encoded[16:16+size])
    header["schema"]=8; header["arrays"].pop("span_normals")
    raw=json.dumps(header).encode();body=encoded[16+size:16+size+body_size]
    legacy=decode_geometry(MAGIC+struct.pack("<II",len(raw),len(body))+raw+body)
    assert all(s.surface_normal is None for c in legacy.columns for s in c.spans)
    assert render_lightmap_webp(legacy,270,35,720,240)==render_lightmap_webp(legacy,270,35,720,240,use_surface_normals=False)


def test_snow_slope_channel_is_constant_across_one_physical_plane():
    # Snow response consumes B as absolute steepness. The same tilted plane
    # must not accumulate different cover merely because the view turns.
    geometry=tilted_plane()
    material=unpack_material_transport(np.asarray(Image.open(io.BytesIO(render_material_webp(geometry,720,240))).convert("RGBA")))
    assert np.ptp(material[235,:,2]) <= 1
    assert material[235,:,3].min()==255


def test_orientation_metadata_cannot_change_geometric_span_composition():
    spans=[VisibleSpan(lower_angle_degrees=lower,upper_angle_degrees=upper,distance_meters=distance,
        semantic=SemanticClass.OPEN_GRASSLAND,source="same-terrain",confidence=1,surface_normal=normal)
        for lower,upper,distance,normal in [(-20,-10,10,(0,0,1)),(-10,0,10.005,None)]]
    before=_compose_spans([s.model_copy(update={"surface_normal":None}) for s in spans])
    after=_compose_spans(spans)
    assert len(before)==len(after)==1
    assert before[0].model_dump(exclude={"surface_normal"})==after[0].model_dump(exclude={"surface_normal"})


def test_cache_identity_changes_do_not_shuffle_a_places_pigment():
    geometry=tilted_plane()
    other=geometry.model_copy(update={"identity_key":"metadata-only-cache-revision","version":"new-normal-contract"})
    assert render_panorama_webp(geometry,720,240,"summer")==render_panorama_webp(other,720,240,"summer")
    assert render_panorama_webp(geometry,720,240,"summer")!=render_panorama_webp(geometry,720,240,"winter")


@pytest.mark.parametrize("normal", [(0,0,0),(0,0,-1),(float('nan'),0,1),(0,0,2)])
def test_invalid_surface_normals_cannot_enter_the_geometry_contract(normal):
    with pytest.raises(ValueError,match="upward unit vector"):
        TerrainSample(distance_meters=10,elevation_meters=500,surface_normal=normal)
