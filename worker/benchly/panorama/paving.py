"""Measure terrain at surveyed ground-cover edges instead of widening LOD cells."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from typing import TYPE_CHECKING

import numpy as np
from shapely.geometry import LineString
from shapely.strtree import STRtree

from benchly.panorama.datasets import LV95_TO_WGS84, WGS84, WGS84_TO_LV95
from benchly.panorama.models import PanoramaConfig, SemanticClass, TerrainRay, TerrainSample

if TYPE_CHECKING:
    from benchly.context.rasters import RasterCollection
    from benchly.panorama.datasets import SemanticIndex


def _intersection_points(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == "Point":
        yield geometry
    elif geometry.geom_type in ("LineString", "LinearRing"):
        # A ray can follow a boundary. Its endpoints still need measuring,
        # but classification never turns the boundary itself into paving.
        from shapely.geometry import Point
        yield Point(geometry.coords[0])
        yield Point(geometry.coords[-1])
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from _intersection_points(part)


def paving_boundary_distances(
    rays: Sequence[TerrainRay], latitude: float, longitude: float,
    semantics: SemanticIndex, maximum_distance_meters: float,
) -> dict[int, list[float]]:
    """Bracket real polygon crossings to within 10 cm along each true ray.

    A geodesic is projected as chords no longer than 50 m, only as far as the
    surveyed polygons. Grid north is never substituted for true bearing.
    Both sides of every crossing are measured; holes and small strips cannot
    disappear simply because the ordinary radial LOD misses their interior.
    """
    polygons = [geometry for geometry, semantic, source in zip(
        semantics.geometries, semantics.semantics, semantics.sources, strict=True)
        if ((semantic == SemanticClass.PAVED_GROUND and source == "SITG-paved-ground")
            or (semantic == SemanticClass.SURFACED_GROUND and source == "BE-MOPUBE-ground-cover"))
        and geometry.is_valid and not geometry.is_empty]
    if not polygons:
        return {}
    tree = STRtree(polygons)
    corners = np.array([(x, y) for polygon in polygons
                        for x in (polygon.bounds[0], polygon.bounds[2])
                        for y in (polygon.bounds[1], polygon.bounds[3])])
    lons, lats = LV95_TO_WGS84.transform(corners[:, 0], corners[:, 1])
    _, _, ranges = WGS84.inv(np.full(len(lons), longitude), np.full(len(lons), latitude), lons, lats)
    limit = min(maximum_distance_meters, float(np.max(ranges)) + 50)
    if limit <= 2:
        return {}
    distances = np.linspace(0, limit, math.ceil(limit / 50) + 1)
    result = {}
    for ray_index, ray in enumerate(rays):
        lons, lats, _ = WGS84.fwd(np.full(len(distances), longitude), np.full(len(distances), latitude),
                                np.full(len(distances), ray.azimuth_degrees), distances)
        east, north = WGS84_TO_LV95.transform(lons, lats)
        path = LineString(np.column_stack((east, north)))
        crossings = []
        for index in tree.query(path, predicate="intersects"):
            for point in _intersection_points(polygons[int(index)].boundary.intersection(path)):
                lon, lat = LV95_TO_WGS84.transform(point.x, point.y)
                _, _, distance = WGS84.inv(longitude, latitude, lon, lat)
                if 2 < distance < maximum_distance_meters:
                    crossings.append(float(distance))
        # Micrometre rounding joins shared source vertices without changing
        # the surveyed extent at its stated centimetre/metre precision.
        crossings = sorted(set(round(d, 6) for d in crossings))
        extra = set()
        for i, distance in enumerate(crossings):
            previous = crossings[i - 1] if i else 2
            following = crossings[i + 1] if i + 1 < len(crossings) else maximum_distance_meters
            epsilon = min(.1, (distance - previous) / 4, (following - distance) / 4)
            if epsilon > 0:
                extra.update((distance - epsilon, distance + epsilon))
        existing = np.asarray([s.distance_meters for s in ray.samples])
        extra = sorted(d for d in extra if not np.any(np.abs(existing - d) < 1e-6))
        if extra:
            result[ray_index] = extra
    return result


def refine_paved_ground_rays(
    rays: Sequence[TerrainRay], latitude: float, longitude: float,
    terrain: RasterCollection, config: PanoramaConfig, semantics: SemanticIndex | None,
    regional_terrain: RasterCollection | None = None,
    border_terrain: RasterCollection | None = None,
    high_resolution_distance_meters: float = 20_000,
    local_terrain: RasterCollection | None = None,
    local_terrain_distance_meters: float | None = None,
) -> list[TerrainRay]:
    """Retain original samples and add measured paving/road/path edge terrain.

    Four neighbouring DEM measurements recover true east/north/up normals.
    Missing centre data remains missing coverage; missing neighbours leave
    orientation unknown. Qualified source lake levels follow the same rule as
    the ordinary sampling path and never conceal missing raster coverage.
    """
    if semantics is None:
        return list(rays)
    extra = paving_boundary_distances(rays, latitude, longitude, semantics, config.maximum_distance_meters)
    if not extra:
        return list(rays)
    keys = [(index, distance) for index, distances in extra.items() for distance in distances]
    bearings = np.asarray([rays[index].azimuth_degrees for index, _ in keys])
    distances = np.asarray([distance for _, distance in keys])
    lons, lats, _ = WGS84.fwd(np.full(len(keys), longitude), np.full(len(keys), latitude), bearings, distances)
    # Interleaved centre/east/west/north/south stencils, all in true bearings.
    all_lons, all_lats = np.repeat(lons, 5), np.repeat(lats, 5)
    offsets = np.tile([0., 90., 270., 0., 180.], len(keys))
    steps = np.tile([0., 2., 2., 2., 2.], len(keys))
    all_lons, all_lats, _ = WGS84.fwd(all_lons, all_lats, offsets, steps)
    locations = list(zip(all_lats.tolist(), all_lons.tolist()))
    _, _, all_distances = WGS84.inv(np.full(len(locations), longitude), np.full(len(locations), latitude),
                                   all_lons, all_lats)
    elevations = np.full(len(locations), np.nan)
    terrain_sources = np.full(len(locations), "unavailable", dtype=object)

    def sample(indices, collection, source):
        if collection is None or not getattr(collection, "datasets", True):
            return
        missing = [int(i) for i in indices if not math.isfinite(elevations[int(i)])]
        if not missing:
            return
        values = collection.sample_many([locations[i] for i in missing])
        for i, value in zip(missing, values, strict=True):
            if value is not None and math.isfinite(float(value)):
                elevations[i], terrain_sources[i] = float(value), source

    local_limit = config.local_terrain_distance_meters if local_terrain_distance_meters is None else local_terrain_distance_meters
    sample(np.flatnonzero(all_distances <= local_limit), local_terrain, "swissALTI3D-local")
    near = ((all_distances <= high_resolution_distance_meters)
            & ((all_distances > local_limit) if local_terrain is not None else True))
    sample(np.flatnonzero(near), terrain, "swissALTI3D")
    far = np.flatnonzero(all_distances > high_resolution_distance_meters)
    sample(far, regional_terrain, "regional-terrain")
    sample(far, terrain, "swissALTI3D")
    sample(np.arange(len(locations)), border_terrain, "cross-border-terrain")
    water_levels = semantics.water_surface_heights(all_lons, all_lats)
    water = np.isfinite(elevations) & np.isfinite(water_levels)
    elevations[water], terrain_sources[water] = water_levels[water], "swissTLM3D-water-surface"
    classes, confidences, sources = semantics.classify(lons, lats)
    added, missing = defaultdict(list), defaultdict(int)
    for position, (index, distance) in enumerate(keys):
        stencil = elevations[position * 5:position * 5 + 5]
        if not np.isfinite(stencil[0]):
            missing[index] += 1
            continue
        normal, slope, relief = None, None, None
        if np.isfinite(stencil).all():
            east, north = (stencil[1] - stencil[2]) / 4, (stencil[3] - stencil[4]) / 4
            length = math.sqrt(east * east + north * north + 1)
            normal = (-east / length, -north / length, 1 / length)
            angle = math.radians(rays[index].azimuth_degrees)
            slope = math.degrees(math.atan(east * math.sin(angle) + north * math.cos(angle)))
            relief = float(np.ptp(stencil))
        if water[position * 5]:
            normal, slope = (0, 0, 1), 0.
        added[index].append(TerrainSample.model_construct(
            distance_meters=distance, elevation_meters=float(stencil[0]),
            semantic=classes[position], confidence=float(confidences[position]), source=str(sources[position]),
            terrain_source=str(terrain_sources[position * 5]), surface_normal=normal,
            slope_degrees=slope, relief_meters=relief,
        ))
    result = []
    for index, ray in enumerate(rays):
        samples = tuple(sorted((*ray.samples, *added[index]), key=lambda sample: sample.distance_meters))
        result.append(ray.model_copy(update={"samples": samples,
            "expected_sample_count": len(samples) + missing[index] + int(not ray.has_complete_coverage)}))
    return result
