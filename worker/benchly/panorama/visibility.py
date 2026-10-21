"""Circular terrain/building visibility with one shared depth composition.

The intermediate representation stores angular spans rather than image pixels.
That keeps it reusable for arbitrary crops, FOVs, and output dimensions.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence

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
    terrain_depth_layer,
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
        spans.append(VisibleSpan.model_construct(
            lower_angle_degrees=top,
            upper_angle_degrees=angle,
            distance_meters=sample.distance_meters,
            semantic=sample.semantic,
            source=sample.source,
            terrain_source=sample.terrain_source,
            confidence=sample.confidence,
            surface_normal=sample.surface_normal,
        ))
        top = angle
    return spans


def _cross(first: tuple[float, float], second: tuple[float, float]) -> float:
    return first[0] * second[1] - first[1] * second[0]


def _ray_polygon_hit(footprint: Sequence[tuple[float, float]], azimuth_degrees: float) -> tuple[float, int, float] | None:
    """Nearest measured footprint face, intersection distance and edge fraction."""
    radians = math.radians(azimuth_degrees)
    direction = (math.sin(radians), math.cos(radians))
    intersections: list[tuple[float, int, float]] = []
    points = [*footprint, footprint[0]]
    for index, (first, second) in enumerate(zip(points, points[1:])):
        segment = (second[0] - first[0], second[1] - first[1])
        denominator = _cross(direction, segment)
        if abs(denominator) < 1e-10:
            continue
        distance = _cross(first, segment) / denominator
        fraction = _cross(first, direction) / denominator
        if distance > .05 and -_EPSILON <= fraction <= 1 + _EPSILON:
            intersections.append((distance, index, max(0, min(1, fraction))))
    return min(intersections, default=None)


def _ray_polygon_distance(footprint: Sequence[tuple[float, float]], azimuth_degrees: float) -> float | None:
    hit = _ray_polygon_hit(footprint, azimuth_degrees)
    return hit[0] if hit else None


def _bearing(east: float, north: float) -> float:
    return (math.degrees(math.atan2(east, north)) + 360) % 360


def _measured_roof_angle(building: BuildingGeometry, azimuth: float, eye_elevation: float,
                         config: PanoramaConfig) -> float | None:
    profile = _measured_roof_profile(building, azimuth, eye_elevation, config)
    return profile[0] if profile is not None else None


def _measured_roof_profile(building: BuildingGeometry, azimuth: float, eye_elevation: float,
                           config: PanoramaConfig) -> tuple[float, float] | None:
    measured = _measured_roof_projection(building, azimuth, eye_elevation, config)
    return measured[:2] if measured is not None else None


def _measured_roof_projection(building: BuildingGeometry, azimuth: float, eye_elevation: float,
                              config: PanoramaConfig) -> tuple[float, float, tuple[tuple[float, float], ...]] | None:
    """Project actual triangle intersections, including the ridge's distance.

    The roof need not be symmetric, centred, or pitched towards the observer.
    Its maximum along a horizontal ray lies on a triangle boundary; use both
    near and far intersections rather than lifting the front wall to the ridge.
    """
    direction = (math.sin(math.radians(azimuth)), math.cos(math.radians(azimuth)))
    intersections = []
    sections = []
    for face in building.roof_faces:
        face_hits = []
        for first, second in zip(face, (*face[1:], face[0])):
            segment = (second[0] - first[0], second[1] - first[1])
            denominator = _cross(direction, segment)
            if abs(denominator) < 1e-10:
                continue
            distance = _cross(first, segment) / denominator
            fraction = _cross(first, direction) / denominator
            if distance <= .05 or not -_EPSILON <= fraction <= 1 + _EPSILON:
                continue
            height = first[2] + max(0, min(1, fraction)) * (second[2] - first[2])
            angle = math.degrees(math.atan2(height - curvature_drop(distance, config.refraction_coefficient) - eye_elevation, distance))
            intersections.append((distance, angle))
            face_hits.append((distance, height))
        if len(face_hits) > 1:
            near, far = min(face_hits), max(face_hits)
            if far[0] - near[0] > .001:
                sections.append((*near, *far))
    if not intersections:
        return None
    nearest = min(distance for distance, _angle in intersections)
    # A complex solid can contain lower annexes on another side. Its global
    # DACH_MIN is not this facade's eave. At the front roof boundary, retain
    # the highest coincident intersection: a measured front gable is wall,
    # while a roof rising behind that edge remains the visible roof plane.
    front = max(angle for distance, angle in intersections if distance <= nearest + .05)
    # Roof triangles can belong to distinct front/rear wings. Their projected
    # union need not fill the whole eave-to-ridge envelope. Retain real gaps;
    # painting them red turned setback walls into fictitious steep roofs.
    visible = []
    envelope = front
    boundaries = sorted({distance for start, _z0, end, _z1 in sections for distance in (start, end)})
    def height(section, distance):
        start, first, end, last = section
        return first + (last - first) * (distance - start) / (end - start)
    def angle(distance, elevation):
        return math.degrees(math.atan2(elevation - curvature_drop(distance, config.refraction_coefficient) - eye_elevation, distance))
    for start, end in zip(boundaries, boundaries[1:]):
        if end - start <= .001:
            continue
        midpoint = (start + end) / 2
        active = [section for section in sections if section[0] <= midpoint <= section[2]]
        if not active:
            continue
        section = max(active, key=lambda candidate: height(candidate, midpoint))
        near_angle, far_angle = angle(start, height(section, start)), angle(end, height(section, end))
        # Each new front edge is an opaque wall below its eave. A flat or
        # receding roof behind it is hidden, not a visible roofing rectangle.
        # Splitting at every section endpoint also handles dormers/overhangs
        # without painting a farther lower roof through a nearer wall.
        envelope = max(envelope, near_angle)
        if far_angle > envelope + _EPSILON:
            if visible and envelope <= visible[-1][1] + _EPSILON:
                visible[-1] = (visible[-1][0], far_angle)
            else:
                visible.append((envelope, far_angle))
            envelope = far_angle
    return max(angle for _distance, angle in intersections), front, tuple(visible)


def _clipped_roof_intervals(intervals, lower, upper):
    if intervals is None:
        return None
    return tuple((max(lower, start), min(upper, end)) for start, end in intervals
                 if min(upper, end) > max(lower, start) + _EPSILON)


def _building_columns(building: BuildingGeometry, config: PanoramaConfig, eye_elevation: float,
                      terrain_contacts: Mapping[int, Mapping[float, float]] | None = None):
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
        # Use the same canonical bearing as terrain contact extraction. With
        # fractional spacing, multiplying an unwrapped index before modulo can
        # differ by a few ULPs. Its ray/face distance then misses the exact
        # measured-contact key and produces alternating interpolated wall bases.
        index = raw_index % config.column_count
        azimuth = index * config.angular_resolution_degrees
        hit = _ray_polygon_hit(building.footprint, azimuth)
        if hit is None or hit[0] > config.maximum_distance_meters:
            continue
        distance, facade_index, fraction = hit
        part_hits = []
        for part_index, part in enumerate(building.facade_parts):
            part_hit = _ray_polygon_hit(part.footprint, azimuth)
            # Sources can differ by a gutter/registration margin. A unit
            # well behind the official front face cannot describe that face.
            if part_hit is not None and abs(part_hit[0] - distance) <= 1.5:
                part_hits.append((abs(part_hit[0] - distance), part.source_id, part_index))
        facade_part_index = min(part_hits)[2] if part_hits else None
        ground = building.ground_elevation_meters
        if building.footprint_ground_elevations is not None:
            heights = building.footprint_ground_elevations
            ground = heights[facade_index] * (1 - fraction) + heights[(facade_index + 1) % len(heights)] * fraction
            # These anchors are DEM samples at footprint vertices. Linear
            # interpolation between them can float above a curved hillside.
            # The refinement pass sampled this exact ray/face intersection;
            # use the same measured ground as the terrain composition. Never
            # borrow a nearby sample or replace a source-only raised base.
            if terrain_contacts is not None:
                ground = terrain_contacts.get(index, {}).get(distance, ground)
        drop = curvature_drop(distance, config.refraction_coefficient)
        base = math.degrees(math.atan2(ground - drop - eye_elevation, distance))
        eaves = math.degrees(math.atan2(building.eaves_elevation_meters - drop - eye_elevation, distance))
        top_height = building.eaves_elevation_meters
        if not building.roof_faces and building.roof_kind == "known-pitched" and building.roof_elevation_meters > building.eaves_elevation_meters:
            center = (lower + upper) / 2
            half = max(_EPSILON, (upper - lower) / 2)
            local = anchor + ((azimuth - anchor + 540) % 360 - 180)
            roof_fraction = max(0, 1 - abs(local - center) / half)
            top_height += (building.roof_elevation_meters - building.eaves_elevation_meters) * roof_fraction
        elif building.roof_elevation_meters == building.eaves_elevation_meters:
            top_height = building.roof_elevation_meters
        top = math.degrees(math.atan2(top_height - drop - eye_elevation, distance))
        roof_intervals = None
        if building.roof_faces:
            measured = _measured_roof_projection(building, azimuth, eye_elevation, config)
            if measured is not None:
                top, eaves, roof_intervals = measured
                eaves = max(base, min(top, eaves))
            else:
                top = eaves
                roof_intervals = ()
        if top <= max(config.minimum_elevation_angle, base) or base >= config.maximum_elevation_angle:
            continue
        first = building.footprint[facade_index]
        second = building.footprint[(facade_index + 1) % len(building.footprint)]
        normal = (second[1] - first[1], first[0] - second[0])
        point = (first[0] * (1 - fraction) + second[0] * fraction, first[1] * (1 - fraction) + second[1] * fraction)
        if normal[0] * point[0] + normal[1] * point[1] > 0:
            normal = (-normal[0], -normal[1])
        span = VisibleSpan.model_construct(
            lower_angle_degrees=max(config.minimum_elevation_angle, base),
            upper_angle_degrees=min(config.maximum_elevation_angle, max(eaves, top)),
            distance_meters=distance,
            semantic=SemanticClass.BUILDING,
            source=building.source,
            confidence=building.confidence,
            object_id=building.source_id,
        )
        output.append((index, span, BuildingProjectionSample.model_construct(
            azimuth_degrees=azimuth,
            lower_angle_degrees=span.lower_angle_degrees,
            eaves_angle_degrees=min(span.upper_angle_degrees, max(span.lower_angle_degrees, eaves)),
            upper_angle_degrees=span.upper_angle_degrees,
            distance_meters=distance,
            facade_index=facade_index,
            facade_normal_degrees=_bearing(*normal),
            roof_intervals=_clipped_roof_intervals(roof_intervals, span.lower_angle_degrees, span.upper_angle_degrees),
            facade_part_index=facade_part_index,
        )))
    return output


def _compose_spans(spans: Sequence[VisibleSpan]) -> tuple[VisibleSpan, ...]:
    if not spans:
        return ()
    boundaries = sorted({value for span in spans for value in (span.lower_angle_degrees, span.upper_angle_degrees)})
    visible: list[VisibleSpan] = []
    for lower, upper in zip(boundaries, boundaries[1:]):
        # The capsule stores angles as float32. Intersections can create
        # thinner slices than one float32 step in the supported -89..89°
        # range; those collapse to zero height on decoding. Their maximum
        # extent is <0.00012 px at 4096 px/circle, so omit them before both
        # terrain and building profiles are serialized.
        if upper - lower < 1e-5:
            continue
        midpoint = (lower + upper) / 2
        candidates = [span for span in spans if span.lower_angle_degrees <= midpoint < span.upper_angle_degrees]
        if not candidates:
            continue
        winner = min(candidates, key=lambda span: (span.distance_meters, span.object_id or ""))
        if visible and abs(visible[-1].upper_angle_degrees - lower) < 1e-5 and all((
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


def _compact_terrain_edges(terrain: Sequence[VisibleSpan]) -> list[tuple[VisibleSpan, str]]:
    """Keep one meaningful below-skyline edge per stable distance layer.

    The raw visibility envelope may rise at nearly every DEM sample. Those
    tiny increments are useful for filling terrain but are not distinct visual
    ridges and would multiply cache size. Semantic boundaries win inside a
    layer; otherwise the highest visible edge represents that depth shell.
    """
    if not terrain:
        return []
    selected: dict[int, tuple[tuple[int, float], VisibleSpan]] = {}
    for index, span in enumerate(terrain[:-1]):
        following = terrain[index + 1]
        semantic_boundary = int(span.semantic != following.semantic)
        score = (semantic_boundary, span.upper_angle_degrees)
        layer = terrain_depth_layer(span.distance_meters)
        current = selected.get(layer)
        if current is None or score > current[0]:
            selected[layer] = (score, span)
    edges = [(span, "inner-ridge") for _score, span in selected.values()]
    edges.append((terrain[-1], "skyline"))
    return sorted(edges, key=lambda item: item[0].distance_meters)


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
    terrain_contacts = {
        index: {sample.distance_meters: sample.elevation_meters for sample in ray.samples
                if sample.terrain_source == "swissALTI3D-building-contact"}
        for index, ray in by_index.items()
    }
    for building in buildings:
        for index, span, profile in _building_columns(building, config, eye_elevation, terrain_contacts):
            building_spans[index].append(span)
            building_profiles[(index, building.source_id)] = profile

    columns: list[PanoramaColumn] = []
    visible_building_profiles: dict[str, list[BuildingProjectionSample]] = defaultdict(list)
    for index in range(expected):
        azimuth = index * config.angular_resolution_degrees
        ray = by_index.get(index, TerrainRay(azimuth_degrees=azimuth, samples=()))
        terrain = visible_terrain_spans(ray, eye_elevation, config)
        samples_by_distance = {sample.distance_meters: sample for sample in ray.samples}
        spans = _compose_spans([*terrain, *building_spans.get(index, ())])
        skyline = max((span.upper_angle_degrees for span in spans), default=config.minimum_elevation_angle)
        terrain_edges: list[TerrainEdge] = []
        for span, edge_kind in _compact_terrain_edges(terrain):
            edge_angle = span.upper_angle_degrees
            # A near building can hide an otherwise valid terrain ridge. Keep
            # the edge only when the final depth composition still exposes it.
            hidden = any(
                candidate.semantic == SemanticClass.BUILDING
                and candidate.distance_meters < span.distance_meters
                and candidate.lower_angle_degrees - _EPSILON <= edge_angle <= candidate.upper_angle_degrees + _EPSILON
                for candidate in spans
            )
            sample = samples_by_distance.get(span.distance_meters)
            if hidden or sample is None:
                continue
            terrain_edges.append(TerrainEdge.model_construct(
                elevation_angle_degrees=edge_angle,
                distance_meters=span.distance_meters,
                depth_layer=terrain_depth_layer(span.distance_meters),
                terrain_elevation_meters=sample.elevation_meters,
                semantic=span.semantic,
                kind=edge_kind,
                source=span.source,
                terrain_source=sample.terrain_source,
                confidence=span.confidence,
                slope_degrees=sample.slope_degrees,
                relief_meters=sample.relief_meters,
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
                "roof_intervals": _clipped_roof_intervals(profile.roof_intervals, span.lower_angle_degrees, span.upper_angle_degrees),
            }))
        columns.append(PanoramaColumn.model_construct(
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
            roof_kind=building_metadata[object_id].roof_kind,
            levels=building_metadata[object_id].levels,
            levels_source=building_metadata[object_id].levels_source,
            registered_storeys=building_metadata[object_id].registered_storeys,
            registered_storeys_source=building_metadata[object_id].registered_storeys_source,
            facade_parts=building_metadata[object_id].facade_parts,
            facade_references=building_metadata[object_id].facade_references,
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
        display_elevation_meters=identity.display_elevation_meters,
        terrain_ground_elevation_meters=identity.terrain_ground_elevation_meters,
        ground_elevation_provenance=identity.ground_elevation_provenance,
        ground_elevation_confidence=identity.ground_elevation_confidence,
        ground_elevation_disagreement_meters=identity.ground_elevation_disagreement_meters,
        config=config,
        columns=tuple(columns),
        buildings=projected_buildings,
        sources=tuple(sources),
        complete=len(by_index) == expected and incomplete_rays == 0,
        warnings=tuple(warnings),
    )
