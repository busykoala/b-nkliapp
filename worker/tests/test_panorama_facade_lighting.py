"""Analytical wall orientation and conservative source binding in light maps."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image
import pytest

from benchly.panorama.binary import decode_geometry, encode_geometry
from benchly.panorama.models import (
    BuildingGeometry, GeometryIdentity, PanoramaConfig, SemanticClass, TerrainRay, TerrainSample,
)
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import render_lightmap_webp


def box_geometry(*, roof=False, serialized=True):
    config = PanoramaConfig(angular_resolution_degrees=1, maximum_distance_meters=1000)
    identity = GeometryIdentity(latitude=46.9, longitude=8.2, ground_elevation_meters=500,
        terrain_version="analytical-flat", semantic_version="grass", building_version="analytical-box",
        angular_resolution_degrees=1)
    rays = [TerrainRay(azimuth_degrees=x, samples=(TerrainSample(distance_meters=200,
        elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND, source="fixture"),)) for x in range(360)]
    front_left, front_right = (-20, 40, 515), (20, 40, 515)
    ridge_left, ridge_right = (-20, 55, 535), (20, 55, 535)
    back_left, back_right = (-20, 70, 515), (20, 70, 515)
    building = BuildingGeometry(source_id="analytical-box", footprint=((-20,40),(20,40),(20,70),(-20,70)),
        ground_elevation_meters=500, eaves_elevation_meters=515 if roof else 520,
        roof_elevation_meters=535 if roof else 520, source="analytical", confidence=1,
        roof_kind="known-pitched" if roof else "flat-or-unknown",
        roof_faces=((front_left, front_right, ridge_right), (front_left, ridge_right, ridge_left),
                    (ridge_left, ridge_right, back_right), (ridge_left, back_right, back_left)) if roof else ())
    geometry = build_panorama_geometry(identity, rays, [building], config=config)
    return decode_geometry(encode_geometry(geometry)) if serialized else geometry


def pixels(geometry, sun=0, altitude=35, *, legacy=False):
    return np.asarray(Image.open(io.BytesIO(render_lightmap_webp(geometry, sun, altitude, 720, 240,
        use_surface_normals=not legacy))).convert("L"), dtype=np.int16)


def north_profile(geometry):
    return next(s for b in geometry.buildings for s in b.samples if s.azimuth_degrees == 0)


def angle_row(geometry, angle):
    config = geometry.config
    return round((config.maximum_elevation_angle - angle) /
        (config.maximum_elevation_angle - config.minimum_elevation_angle) * 240)


def without_aspects(geometry):
    return geometry.model_copy(update={"buildings": tuple(b.model_copy(update={"samples": tuple(
        s.model_copy(update={"facade_normal_degrees": None}) for s in b.samples)}) for b in geometry.buildings)})


@pytest.mark.parametrize("serialized", [False, True])
def test_wall_follows_measured_orientation_instead_of_view_direction(serialized):
    geometry = box_geometry(serialized=serialized)
    profile = north_profile(geometry)
    # Looking north at this box shows its south-facing wall. The old ray
    # approximation reversed the sunlight: northern sun lit its back face.
    assert profile.facade_normal_degrees == 180
    y = angle_row(geometry, (profile.lower_angle_degrees + profile.eaves_angle_degrees) / 2)
    values = [int(pixels(geometry, sun)[y, 0]) for sun in (0, 90, 180, 270)]
    assert values[2] > values[0] + 80
    assert abs(values[1] - values[3]) <= 1
    assert pixels(geometry, 0, legacy=True)[y, 0] > pixels(geometry, 180, legacy=True)[y, 0] + 50


@pytest.mark.parametrize("mutation", ["missing-aspect", "wrong-owner", "wrong-range", "wrong-height"])
def test_unbound_source_preserves_fallback(mutation):
    geometry = box_geometry(serialized=mutation != "wrong-owner")
    if mutation == "missing-aspect":
        geometry = without_aspects(geometry)
    elif mutation == "wrong-owner":
        geometry = geometry.model_copy(update={"buildings": tuple(
            b.model_copy(update={"object_id": "unrelated-source"}) for b in geometry.buildings)})
    else:
        update = (lambda s: {"distance_meters": s.distance_meters + 5}) if mutation == "wrong-range" else (
            lambda s: {"lower_angle_degrees": 45, "eaves_angle_degrees": 50, "upper_angle_degrees": 55})
        geometry = geometry.model_copy(update={"buildings": tuple(b.model_copy(update={"samples": tuple(
            s.model_copy(update=update(s)) for s in b.samples)}) for b in geometry.buildings)})
    np.testing.assert_array_equal(pixels(geometry, 180), pixels(without_aspects(geometry), 180))


@pytest.mark.parametrize("normal", [0, None])
def test_ambiguous_legacy_profiles_never_borrow_a_normal(normal):
    geometry = box_geometry()
    assert all(s.object_id is None for c in geometry.columns for s in c.spans)
    duplicate = geometry.buildings[0].model_copy(update={"object_id": "coincident-other", "samples": tuple(
        s.model_copy(update={"facade_normal_degrees": normal}) for s in geometry.buildings[0].samples)})
    ambiguous = geometry.model_copy(update={"buildings": (*geometry.buildings, duplicate)})
    np.testing.assert_array_equal(pixels(ambiguous, 180), pixels(without_aspects(ambiguous), 180))


def test_explicit_span_owner_disambiguates_a_coincident_profile():
    geometry = box_geometry(serialized=False)
    duplicate = geometry.buildings[0].model_copy(update={"object_id": "coincident-other", "samples": tuple(
        s.model_copy(update={"facade_normal_degrees": 0}) for s in geometry.buildings[0].samples)})
    duplicate_geometry = geometry.model_copy(update={"buildings": (*geometry.buildings, duplicate)})
    np.testing.assert_array_equal(pixels(geometry, 180), pixels(duplicate_geometry, 180))


def test_legacy_mode_and_night_do_not_change_when_aspects_are_present():
    geometry = box_geometry()
    fallback = without_aspects(geometry)
    for sun in (0, 90, 180, 270):
        np.testing.assert_array_equal(pixels(geometry, sun, legacy=True), pixels(fallback, sun, legacy=True))
    for altitude in (-3, -12):
        np.testing.assert_array_equal(pixels(geometry, 180, altitude), pixels(fallback, 180, altitude))


def test_wall_aspect_does_not_light_roof_terrain_or_unknown_setback():
    geometry = box_geometry(roof=True)
    profile = north_profile(geometry)
    before, after = pixels(without_aspects(geometry)), pixels(geometry)
    roof_lower, roof_upper = profile.roof_intervals[0]
    y = angle_row(geometry, (roof_lower + roof_upper) / 2)
    assert before[y, 0] == after[y, 0]
    wall_y = angle_row(geometry, (profile.lower_angle_degrees + profile.eaves_angle_degrees) / 2)
    assert before[wall_y, 0] > after[wall_y, 0] + 80
    np.testing.assert_array_equal(before[:, 180:540], after[:, 180:540])

    # A taller rear wall is visible above the front eave, but its normal is
    # unknown. Extending the silhouette cannot transfer the front aspect.
    setback = geometry.model_copy(update={
        "columns": tuple(c.model_copy(update={"spans": tuple(s.model_copy(update={"upper_angle_degrees": 40})
            if s.semantic == SemanticClass.BUILDING else s for s in c.spans)}) for c in geometry.columns),
        "buildings": tuple(b.model_copy(update={"samples": tuple(s.model_copy(update={
            "upper_angle_degrees": 40, "roof_intervals": ()}) for s in b.samples)}) for b in geometry.buildings),
    })
    y = angle_row(setback, 35)
    assert pixels(setback)[y, 0] == pixels(without_aspects(setback))[y, 0]
