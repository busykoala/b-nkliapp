from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from benchly.panorama.binary import MAGIC, decode_geometry, encode_geometry
from benchly.panorama.builder import _recommended_pvc, _same_bench_position, _terminate_executor
from benchly.panorama.models import (
    BuildingProjectionSample,
    GeometryIdentity,
    PanoramaConfig,
    ProjectedBuilding,
    SemanticClass,
    TerrainRay,
    TerrainSample,
)
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import render_material_webp, render_panorama_webp


def fixture_geometry():
    identity = GeometryIdentity(
        latitude=46.69, longitude=7.67, ground_elevation_meters=628,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture",
        angular_resolution_degrees=90,
    )
    config = PanoramaConfig(angular_resolution_degrees=90)
    rays = [TerrainRay(azimuth_degrees=azimuth, samples=(
        TerrainSample(distance_meters=80, elevation_meters=625, semantic=SemanticClass.OPEN_GRASSLAND),
        TerrainSample(distance_meters=3_000, elevation_meters=1_240 + azimuth, semantic=SemanticClass.ROCK),
    )) for azimuth in (0, 90, 180, 270)]
    return build_panorama_geometry(identity, rays, config=config)


def test_view_capsule_is_deterministic_binary_and_roundtrips_quantized_geometry():
    geometry = fixture_geometry()
    first = encode_geometry(geometry)
    assert first == encode_geometry(geometry)
    assert first.startswith(MAGIC)
    assert b"manifest.npy" not in first
    restored = decode_geometry(first)
    assert restored.identity_key == geometry.identity_key
    assert len(restored.columns) == 4
    assert abs(restored.columns[0].skyline_angle_degrees - geometry.columns[0].skyline_angle_degrees) < .05
    with pytest.raises(ValueError, match="truncated"):
        decode_geometry(first[:-4])


def test_view_capsule_normalizes_float16_bearing_at_full_circle():
    geometry = fixture_geometry()
    sample = BuildingProjectionSample(
        azimuth_degrees=359.999, lower_angle_degrees=-2, eaves_angle_degrees=3,
        upper_angle_degrees=5, distance_meters=20,
    )
    building = ProjectedBuilding(
        object_id="building", source="fixture", confidence=1, samples=(sample,),
    )
    restored = decode_geometry(encode_geometry(geometry.model_copy(update={"buildings": (building,)})))
    assert restored.buildings[0].samples[0].azimuth_degrees == 0


def test_material_mask_and_paint_are_wrap_continuous():
    geometry = fixture_geometry()
    for payload in (render_material_webp(geometry, 720, 240), render_panorama_webp(geometry, 720, 240)):
        pixels = np.asarray(Image.open(io.BytesIO(payload)).convert("RGB"), dtype=np.int16)
        # Lossy WebP may move the final block by a few values even though the
        # pre-encode texture is identical at the boundary; this is visually
        # continuous and comfortably below an edge contrast.
        assert np.abs(pixels[:, 0] - pixels[:, -1]).max() <= 10


def test_storage_gate_keeps_80_gib_until_68_gib_peak_then_rounds_with_headroom():
    gib = 1024**3
    assert _recommended_pvc(68 * gib) == 80
    assert _recommended_pvc(69 * gib) == 96
    assert _recommended_pvc(81 * gib) == 112


def test_activation_allows_serialization_drift_but_rejects_moved_benches():
    expected = (270468, 46.5547639035754, 8.0058085268719)
    assert _same_bench_position((270468, 46.55476390357538, 8.005808526871903), expected)
    assert not _same_bench_position((270468, 46.554765, 8.005808526871903), expected)
    assert not _same_bench_position((270469, 46.55476390357538, 8.005808526871903), expected)
    assert not _same_bench_position(None, expected)


def test_interrupted_extraction_terminates_live_children():
    class Process:
        terminated = False

        def is_alive(self):
            return True

        def terminate(self):
            self.terminated = True

    class Executor:
        _processes = {1: Process(), 2: Process()}

    executor = Executor()
    _terminate_executor(executor)
    assert all(process.terminated for process in executor._processes.values())
