"""Measured observer elevation from existing terrain tiers, never interpolation by guess."""

from __future__ import annotations

import math
from typing import Protocol


class ElevationRaster(Protocol):
    def sample(self, latitude: float, longitude: float) -> float | None: ...


def sample_ground_elevation(elevation_meters: float | None, latitude: float, longitude: float,
                            *rasters: ElevationRaster | None) -> float | None:
    """Prefer the bench's measured height, then the finest available raster.

    The caller orders swissALTI3D, the 10-m and 90-m pyramids, and optional
    border terrain. Missing tiles do not strand a new bench when a coarser
    *measured* tier covers exactly its location.
    """
    if elevation_meters is not None and math.isfinite(float(elevation_meters)):
        return float(elevation_meters)
    for raster in rasters:
        if raster is None:
            continue
        value = raster.sample(latitude, longitude)
        if value is not None and math.isfinite(float(value)):
            return float(value)
    return None
