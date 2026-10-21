"""Loose architectural paint must share its edges with facts and lighting."""
import numpy as np

from benchly.panorama.models import (
    GeometryIdentity, PanoramaConfig, SemanticClass, TerrainRay, TerrainSample, VisibleSpan,
)
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import _architecture_registration, _register_architecture


def scene(*, distance=20, buildings=True):
    config = PanoramaConfig(angular_resolution_degrees=1,
                            minimum_elevation_angle=-20, maximum_elevation_angle=40)
    identity = GeometryIdentity(latitude=47, longitude=8, ground_elevation_meters=500,
                                terrain_version="fixture", semantic_version="fixture",
                                building_version="fixture", angular_resolution_degrees=1)
    rays = [TerrainRay(azimuth_degrees=bearing, samples=(TerrainSample(
        distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND,
        source="fixture"),)) for bearing in range(360)]
    geometry = build_panorama_geometry(identity, rays, config=config)
    if not buildings:
        return geometry
    wall = VisibleSpan(lower_angle_degrees=-10, upper_angle_degrees=30,
                       distance_meters=distance, semantic=SemanticClass.BUILDING,
                       source="fixture", confidence=1, object_id="north-wall")
    return geometry.model_copy(update={"columns": tuple(
        column.model_copy(update={"spans": (wall,), "skyline_angle_degrees": 30})
        if column.azimuth_degrees < 35 or column.azimuth_degrees > 325 else column
        for column in geometry.columns)})


def test_colour_coverage_and_light_share_edges_but_semantics_stay_categorical():
    geometry = scene()
    before = geometry.model_dump()
    height, width = 240, 1440
    coverage = np.zeros((height, width), dtype=np.uint8)
    coverage[40:200, :140] = 255
    coverage[40:200, -140:] = 255
    canonical = np.zeros((height, width, 4), dtype=np.uint8)
    canonical[..., 0] = coverage
    canonical[..., 1] = np.where(coverage, 8, 0)
    canonical[..., 2] = coverage
    canonical[..., 3] = coverage
    colour = np.repeat(coverage[..., None], 3, axis=2)
    painted = _register_architecture(colour, geometry)
    facts = _register_architecture(canonical, geometry, material=True)
    light = _register_architecture(coverage, geometry)
    np.testing.assert_array_equal(painted[..., 0], facts[..., 3])
    np.testing.assert_array_equal(light, facts[..., 3])
    assert set(np.unique(facts[..., 1])) == {0, 8}
    assert np.any((facts[..., 3] > 0) & (facts[..., 3] < 255))
    assert np.count_nonzero(painted[..., 0] != coverage) > 50
    # Categorical ownership uses the nearest measured sample. At a diagonal
    # corner both axes can round inside while their bilinear coverage product
    # is below one half; thresholding alpha is not the same ownership rule.
    dx, dy = _architecture_registration(geometry, width, height)
    sample_x = np.floor((np.arange(width)[None, :] + dx) % width + .5).astype(int) % width
    sample_y = np.clip(np.floor(np.arange(height)[:, None] + dy + .5).astype(int), 0, height - 1)
    expected_wall = ((sample_y >= 40) & (sample_y < 200)
                     & ((sample_x < 140) | (sample_x >= width - 140)))
    np.testing.assert_array_equal(facts[..., 1] == 8, expected_wall)
    assert geometry.model_dump() == before


def test_no_buildings_and_distant_buildings_leave_pixels_exact():
    pixels = np.random.default_rng(7).integers(0, 256, (120, 720, 3), dtype=np.uint8)
    for geometry in [scene(buildings=False), scene(distance=1500)]:
        np.testing.assert_array_equal(_register_architecture(pixels, geometry), pixels)


def test_registration_is_small_invertible_periodic_and_resolution_consistent():
    geometry = scene()
    dx, dy = _architecture_registration(geometry, 1440, 240)
    assert np.max(np.abs(dx)) <= 8 * 1440 / 4096
    assert np.max(np.abs(dy)) <= 8 * 240 / 60 * 360 / 4096
    # The circular boundary is adjacent brush paint, never a phase reset.
    assert np.max(np.abs(dx[:, 0] - dx[:, -1])) < .2
    assert np.max(np.abs(dy[:, 0] - dy[:, -1])) < .5
    assert np.max(np.abs(dy[:, 0] - dy[:, -1])) <= np.max(np.abs(np.diff(dy, axis=1))) + .001
    # Local mapping stays orientation-preserving: no folds, lost intervals or
    # reversed roof edges even at the strongest nearby broad-wall load.
    dx_y, dx_x = np.gradient(dx)
    dy_y, dy_x = np.gradient(dy)
    assert np.min((1 + dx_x) * (1 + dy_y) - dx_y * dy_x) > .5
    fine_x, fine_y = _architecture_registration(geometry, 2880, 480)
    # Interior support is constant; averaging the four finer pixel centres
    # checks the same angular location used by colour and lower-res fields.
    for coarse, fine in [(dx, fine_x), (dy, fine_y)]:
        reduced = fine.reshape(240, 2, 1440, 2).mean(axis=(1, 3)) / 2
        np.testing.assert_allclose(coarse[80:160, :60], reduced[80:160, :60], atol=.03)


def test_sub_ulp_negative_wrap_keeps_sampling_inside_the_image(monkeypatch):
    from benchly.panorama import watercolor
    width = 4096
    pixels = np.full((3, width, 3), 100, dtype=np.uint8)
    pixels[:, 0] = (25, 50, 75)
    dx = np.zeros((3, width), dtype=np.float32)
    dx[:, 0] = -1e-16
    monkeypatch.setattr(watercolor, "_architecture_registration", lambda *_: (dx, np.zeros_like(dx)))
    registered = watercolor._register_architecture(pixels, None)
    assert np.array_equal(registered, pixels)
    brush = np.arange(width * 3, dtype=np.float32).reshape(3, width)
    actual = watercolor._sample_periodic_brush(brush, np.array([float(width)]), np.array([3.0]))
    assert actual[0] == brush[0, 0]
