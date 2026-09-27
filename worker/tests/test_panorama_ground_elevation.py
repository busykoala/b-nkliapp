"""A missing 2-m tile must not strand a bench with measured 10-m terrain."""

from __future__ import annotations

import math

from benchly.panorama.ground_elevation import resolve_ground_elevation, sample_ground_elevation


class Raster:
    def __init__(self, value):
        self.value = value
        self.calls = 0

    def sample(self, latitude, longitude):
        assert latitude == 46.94161723005851
        assert longitude == 7.436801365063985
        self.calls += 1
        return self.value


LAT = 46.94161723005851
LON = 7.436801365063985


def test_known_elevation_wins_without_loading_any_raster():
    high = Raster(519.6)
    assert sample_ground_elevation(520.0, LAT, LON, high) == 520.0
    assert high.calls == 0


def test_missing_high_resolution_tile_uses_existing_measured_pyramid():
    high, near, regional = Raster(None), Raster(520.2), Raster(521.4)
    assert sample_ground_elevation(None, LAT, LON, high, near, regional) == 520.2
    assert [high.calls, near.calls, regional.calls] == [1, 1, 0]


def test_non_finite_measurement_is_rejected_and_no_terrain_is_not_invented():
    high, near = Raster(math.nan), Raster(None)
    assert sample_ground_elevation(None, LAT, LON, high, near) is None
    assert sample_ground_elevation(math.inf, LAT, LON, high, near) is None


def test_ground_resolution_preserves_display_measurement_and_reports_dem_disagreement():
    result = resolve_ground_elevation(550.0, LAT, LON, Raster(500.0))
    assert result.display_elevation_meters == 550.0
    assert result.observer_ground_elevation_meters == 550.0
    assert result.terrain_elevation_meters == 500.0
    assert result.provenance == "stored-measurement"
    assert result.confidence == "conflicting"
    assert result.disagreement_meters == 50.0


def test_ground_resolution_uses_finest_dem_when_measurement_is_missing():
    result = resolve_ground_elevation(None, LAT, LON, Raster(None), Raster(520.2), Raster(521.4))
    assert result.display_elevation_meters == 520.2
    assert result.observer_ground_elevation_meters == 520.2
    assert result.terrain_elevation_meters == 520.2
    assert result.provenance == "terrain-sample"
    assert result.confidence == "measured"
