"""Measured observer elevation from existing terrain tiers, never interpolation by guess."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal
from typing import Protocol


class ElevationRaster(Protocol):
    def sample(self, latitude: float, longitude: float) -> float | None: ...


@dataclass(frozen=True)
class GroundElevationResolution:
    """Keep the public elevation and the renderer's physical origin explicit.

    A finite stored measurement remains authoritative; the finest available
    terrain sample is a cross-check, not a silent replacement.  The renderer
    and UI can therefore make different future choices without losing either
    value or concealing disagreement.
    """

    display_elevation_meters: float | None
    observer_ground_elevation_meters: float | None
    terrain_elevation_meters: float | None
    provenance: Literal["stored-measurement", "terrain-sample", "unavailable"]
    confidence: Literal["measured", "qualified", "conflicting", "unavailable"]
    disagreement_meters: float | None


def _finite(value: float | None) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    return float(value)


def resolve_ground_elevation(elevation_meters: float | None, latitude: float, longitude: float,
                             *rasters: ElevationRaster | None) -> GroundElevationResolution:
    """Resolve display and observer elevations while retaining the DEM check.

    Differences up to two metres are ordinary interpolation/measurement
    variation.  Differences up to eight metres remain usable but qualified;
    larger differences are explicit conflicts that diagnostics and operators
    must inspect (for example a bridge, building, datum issue or stale value).
    """
    stored = _finite(elevation_meters)
    terrain = None
    for raster in rasters:
        if raster is None:
            continue
        terrain = _finite(raster.sample(latitude, longitude))
        if terrain is not None:
            break
    if stored is not None:
        disagreement = abs(stored - terrain) if terrain is not None else None
        confidence = (
            "measured" if disagreement is None or disagreement <= 2
            else "qualified" if disagreement <= 8 else "conflicting"
        )
        return GroundElevationResolution(
            display_elevation_meters=stored,
            observer_ground_elevation_meters=stored,
            terrain_elevation_meters=terrain,
            provenance="stored-measurement",
            confidence=confidence,
            disagreement_meters=disagreement,
        )
    if terrain is not None:
        return GroundElevationResolution(
            display_elevation_meters=terrain,
            observer_ground_elevation_meters=terrain,
            terrain_elevation_meters=terrain,
            provenance="terrain-sample",
            confidence="measured",
            disagreement_meters=0,
        )
    return GroundElevationResolution(None, None, None, "unavailable", "unavailable", None)


def sample_ground_elevation(elevation_meters: float | None, latitude: float, longitude: float,
                            *rasters: ElevationRaster | None) -> float | None:
    """Prefer the bench's measured height, then the finest available raster.

    The caller orders swissALTI3D, the 10-m and 90-m pyramids, and optional
    border terrain. Missing tiles do not strand a new bench when a coarser
    *measured* tier covers exactly its location.
    """
    stored = _finite(elevation_meters)
    if stored is not None:
        return stored
    for raster in rasters:
        if raster is None:
            continue
        value = _finite(raster.sample(latitude, longitude))
        if value is not None:
            return value
    return None
