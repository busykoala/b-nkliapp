"""Circular terrain/building visibility with one shared depth composition.

The intermediate representation stores angular spans rather than image pixels.
That keeps it reusable for arbitrary crops, FOVs, and output dimensions.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence

from benchly.panorama.cache import geometry_cache_key
from benchly.panorama.models import (
    EARTH_RADIUS_METERS,
    BuildingGeometry,
    BuildingProjectionSample,
    GeometryIdentity,
    PanoramaColumn,
    PanoramaConfig,
    PanoramaGeometry,
    ProjectedBuilding,
    SemanticClass,
    SourceEvidence,
    TerrainRay,
    TerrainEdge,
    TerrainSample,
    VisibleSpan,
)


_EPSILON = 1e-7


def curvature_drop(distance_meters: float, refraction_coefficient: float = .13) -> float:
    """Effective spherical-earth drop with a documented standard refraction factor."""
    return distance_meters * distance_meters / (2 * EARTH_RADIUS_METERS) * (1 - refraction_coefficient)


def elevation_angle(sample: TerrainSample, eye_elevation_meters: float, config: PanoramaConfig) -> float:
    corrected = sample.elevation_meters - curvature_drop(sample.distance_meters, config.refraction_coefficient)
    return math.degrees(math.atan2(corrected - eye_elevation_meters, sample.distance_meters))


def visible_terrain_spans(ray: TerrainRay, eye_elevation_meters: float, config: PanoramaConfig) -> list[VisibleSpan]:
    """Return near-to-far portions of terrain that lift the visibility envelope.

    A nearer sample owns everything below its projected elevation. A farther
    sample becomes visible only above that envelope. The spans therefore retain
    visible surface below the outer skyline, not just one maximum angle.
    """
    top = config.minimum_elevation_angle
    spans: list[VisibleSpan] = []
    for sample in ray.samples:
        angle = min(config.maximum_elevation_angle, elevation_angle(sample, eye_elevation_meters, config))
        if angle <= top + _EPSILON:
            continue
        spans.append(VisibleSpan(
            lower_angle_degrees=top,
            upper_angle_degrees=angle,
            distance_meters=sample.distance_meters,
            semantic=sample.semantic,
            source=sample.source,
            terrain_source=sample.terrain_source,
            confidence=sample.confidence,
            terrain_elevation_meters=sample.elevation_meters,
            slope_degrees=sample.slope_degrees,
            relief_meters=sample.relief_meters,
        ))
        top = angle
    return spans


def _cross(first: tuple[float, float], second: tuple[float, float]) -> float:
    return first[0] * second[1] - first[1] * second[0]


def _ray_polygon_distance(footprint: Sequence[tuple[float, float]], azimuth_degrees: float) -> float | None:
    """Distance to the first footprint edge along an east/north bearing ray."""
    radians = math.radians(azimuth_degrees)
    direction = (math.sin(radians), math.cos(radians))
    intersections: list[float] = []
    points = [*footprint, footprint[0]]
    for first, second in zip(points, points[1:]):
        segment = (second[0] - first[0], second[1] - first[1])
        denominator = _cross(direction, segment)
        if abs(denominator) < 1e-10:
            continue
        distance = _cross(first, segment) / denominator
        fraction = _cross(first, direction) / denominator
        if distance > .05 and -_EPSILON <= fraction <= 1 + _EPSILON:
            intersections.append(distance)
    return min(intersections, default=None)


def _bearing(east: float, north: float) -> float:
    return (math.degrees(math.atan2(east, north)) + 360) % 360


def _building_columns(building: BuildingGeometry, config: PanoramaConfig, eye_elevation: float):
    bearings = [_bearing(east, north) for east, north in building.footprint]
    anchor = bearings[0]
    unwrapped = [anchor + ((bearing - anchor + 540) % 360 - 180) for bearing in bearings]
    lower, upper = min(unwrapped), max(unwrapped)
    # A footprint containing the observer is invalid for a bench panorama.
    if upper - lower >= 180:
        return []
    start = math.floor(lower / config.angular_resolution_degrees)
    end = math.ceil(upper / config.angular_resolution_degrees)
    output = []
    for raw_index in range(start, end + 1):
        azimuth = (raw_index * config.angular_resolution_degrees) % 360
        distance = _ray_polygon_distance(building.footprint, azimuth)
        if distance is None or distance > config.maximum_distance_meters:
            continue
        drop = curvature_drop(distance, config.refraction_coefficient)
        base = math.degrees(math.atan2(building.ground_elevation_meters - drop - eye_elevation, distance))
        eaves = math.degrees(math.atan2(building.eaves_elevation_meters - drop - eye_elevation, distance))
        top_height = building.eaves_elevation_meters
        if building.roof_kind == "known-pitched" and building.roof_elevation_meters > building.eaves_elevation_meters:
            center = (lower + upper) / 2
            half = max(_EPSILON, (upper - lower) / 2)
            local = anchor + ((azimuth - anchor + 540) % 360 - 180)
            roof_fraction = max(0, 1 - abs(local - center) / half)
            top_height += (building.roof_elevation_meters - building.eaves_elevation_meters) * roof_fraction
        elif building.roof_elevation_meters == building.eaves_elevation_meters:
            top_height = building.roof_elevation_meters
        top = math.degrees(math.atan2(top_height - drop - eye_elevation, distance))
        if top <= config.minimum_elevation_angle or base >= config.maximum_elevation_angle:
            continue
        span = VisibleSpan(
            lower_angle_degrees=max(config.minimum_elevation_angle, base),
            upper_angle_degrees=min(config.maximum_elevation_angle, max(eaves, top)),
            distance_meters=distance,
            semantic=SemanticClass.BUILDING,
            source=building.source,
            confidence=building.confidence,
            object_id=building.source_id,
        )
        output.append((raw_index % config.column_count, span, BuildingProjectionSample(
            azimuth_degrees=azimuth,
            lower_angle_degrees=span.lower_angle_degrees,
            eaves_angle_degrees=min(span.upper_angle_degrees, max(span.lower_angle_degrees, eaves)),
            upper_angle_degrees=span.upper_angle_degrees,
            distance_meters=distance,
        )))
    return output


def _compose_spans(spans: Sequence[VisibleSpan]) -> tuple[VisibleSpan, ...]:
    if not spans:
        return ()
    boundaries = sorted({value for span in spans for value in (span.lower_angle_degrees, span.upper_angle_degrees)})
    visible: list[VisibleSpan] = []
    for lower, upper in zip(boundaries, boundaries[1:]):
        midpoint = (lower + upper) / 2
        candidates = [span for span in spans if span.lower_angle_degrees <= midpoint < span.upper_angle_degrees]
        if not candidates:
            continue
        winner = min(candidates, key=lambda span: (span.distance_meters, span.object_id or ""))
        if visible and visible[-1].upper_angle_degrees == lower and all((
            visible[-1].semantic == winner.semantic,
            visible[-1].source == winner.source,
            visible[-1].object_id == winner.object_id,
            abs(visible[-1].distance_meters - winner.distance_meters) < .01,
            abs(visible[-1].confidence - winner.confidence) < .001,
        )):
            visible[-1] = winner.model_copy(update={"lower_angle_degrees": visible[-1].lower_angle_degrees, "upper_angle_degrees": upper})
        else:
            visible.append(winner.model_copy(update={"lower_angle_degrees": lower, "upper_angle_degrees": upper}))
    return tuple(visible)


def build_panorama_geometry(
    identity: GeometryIdentity,
    rays: Sequence[TerrainRay],
    buildings: Sequence[BuildingGeometry] = (),
    sources: Sequence[SourceEvidence] = (),
    config: PanoramaConfig | None = None,
) -> PanoramaGeometry:
    config = config or PanoramaConfig(
        angular_resolution_degrees=identity.angular_resolution_degrees,
        observer_height_meters=identity.observer_height_meters,
        maximum_distance_meters=identity.maximum_distance_meters,
    )
    expected = config.column_count
    by_index: dict[int, TerrainRay] = {}
    warnings: list[str] = []
    for ray in rays:
        index = round(ray.azimuth_degrees / config.angular_resolution_degrees) % expected
        if index in by_index:
            raise ValueError(f"duplicate terrain ray for panorama column {index}")
        by_index[index] = ray
    if len(by_index) != expected:
        warnings.append(f"terrain coverage {len(by_index)}/{expected} columns")

    eye_elevation = identity.ground_elevation_meters + config.observer_height_meters
    building_spans: dict[int, list[VisibleSpan]] = defaultdict(list)
    building_profiles: dict[tuple[int, str], BuildingProjectionSample] = {}
    building_metadata = {building.source_id: building for building in buildings}
    for building in buildings:
        for index, span, profile in _building_columns(building, config, eye_elevation):
            building_spans[index].append(span)
            building_profiles[(index, building.source_id)] = profile

    columns: list[PanoramaColumn] = []
    visible_building_profiles: dict[str, list[BuildingProjectionSample]] = defaultdict(list)
    for index in range(expected):
        azimuth = index * config.angular_resolution_degrees
        ray = by_index.get(index, TerrainRay(azimuth_degrees=azimuth, samples=()))
        terrain = visible_terrain_spans(ray, eye_elevation, config)
        spans = _compose_spans([*terrain, *building_spans.get(index, ())])
        skyline = max((span.upper_angle_degrees for span in spans), default=config.minimum_elevation_angle)
        terrain_edges: list[TerrainEdge] = []
        for terrain_index, span in enumerate(terrain):
            edge_angle = span.upper_angle_degrees
            # A near building can hide an otherwise valid terrain ridge. Keep
            # the edge only when the final depth composition still exposes it.
            hidden = any(
                candidate.semantic == SemanticClass.BUILDING
                and candidate.distance_meters < span.distance_meters
                and candidate.lower_angle_degrees - _EPSILON <= edge_angle <= candidate.upper_angle_degrees + _EPSILON
                for candidate in spans
            )
            if hidden or span.terrain_elevation_meters is None:
                continue
            terrain_edges.append(TerrainEdge(
                elevation_angle_degrees=edge_angle,
                distance_meters=span.distance_meters,
                terrain_elevation_meters=span.terrain_elevation_meters,
                semantic=span.semantic,
                kind="skyline" if terrain_index == len(terrain) - 1 else "inner-ridge",
                source=span.source,
                confidence=span.confidence,
            ))
        for span in spans:
            if not span.object_id:
                continue
            profile = building_profiles.get((index, span.object_id))
            if profile is None:
                continue
            visible_building_profiles[span.object_id].append(profile.model_copy(update={
                "lower_angle_degrees": span.lower_angle_degrees,
                "eaves_angle_degrees": min(span.upper_angle_degrees, max(span.lower_angle_degrees, profile.eaves_angle_degrees)),
                "upper_angle_degrees": span.upper_angle_degrees,
            }))
        columns.append(PanoramaColumn(
            azimuth_degrees=azimuth,
            skyline_angle_degrees=skyline,
            spans=spans,
            terrain_edges=tuple(terrain_edges),
        ))

    incomplete_rays = sum(not ray.has_complete_coverage for ray in by_index.values())
    if incomplete_rays:
        warnings.append(f"partial terrain coverage in {incomplete_rays}/{expected} columns")

    projected_buildings = tuple(
        ProjectedBuilding(
            object_id=object_id,
            source=building_metadata[object_id].source,
            source_version=building_metadata[object_id].source_version,
            confidence=building_metadata[object_id].confidence,
            orientation_degrees=building_metadata[object_id].orientation_degrees,
            samples=tuple(sorted(profiles, key=lambda sample: sample.azimuth_degrees)),
        )
        for object_id, profiles in sorted(visible_building_profiles.items())
        if object_id in building_metadata and profiles
    )

    return PanoramaGeometry(
        identity_key=geometry_cache_key(identity),
        latitude=identity.latitude,
        longitude=identity.longitude,
        ground_elevation_meters=identity.ground_elevation_meters,
        eye_elevation_meters=eye_elevation,
        config=config,
        columns=tuple(columns),
        buildings=projected_buildings,
        sources=tuple(sources),
        complete=len(by_index) == expected and incomplete_rays == 0,
        warnings=tuple(warnings),
    )
