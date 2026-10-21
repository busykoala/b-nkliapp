"""Batch-oriented adapters from Benchly's national indices to panorama inputs."""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from collections.abc import Sequence

import numpy as np
from pyproj import Geod, Transformer
from shapely import from_wkb, get_parts, points
from shapely.geometry import Point, box
from shapely.strtree import STRtree

from benchly.context.evidence import nearby_context
from benchly.context.geometry import feature_is_surface_water
from benchly.context.rasters import RasterCollection
from benchly.panorama.models import (
    LOD_SCHEDULE_IMPLEMENTATION,
    BuildingGeometry,
    BuildingFacadePart,
    FacadeReference,
    PanoramaConfig,
    SemanticClass,
    TerrainRay,
    TerrainSample,
)


WGS84 = Geod(ellps="WGS84")
WGS84_TO_LV95 = Transformer.from_crs(4326, 2056, always_xy=True)
LV95_TO_WGS84 = Transformer.from_crs(2056, 4326, always_xy=True)
LOD_SCHEDULE_KEY = LOD_SCHEDULE_IMPLEMENTATION


def _terrain_surface_normals(elevations, distances, azimuths) -> np.ndarray:
    """Upward normals in true east/north/up from the polar DEM sample grid.

    Angular differences follow the chord between equal-radius neighbours.
    This is exact for a tilted plane even in coarse test grids. Missing data
    stays unavailable; we never interpolate across a missing radial sample.
    """
    heights = np.asarray(elevations, dtype=np.float64).reshape(len(azimuths), len(distances))
    result = np.full((*heights.shape, 3), np.nan, dtype=np.float32)
    if len(azimuths) < 3 or len(distances) < 2:
        return result
    angles = np.radians(azimuths)
    step = 2 * math.pi / len(azimuths)
    radial = np.full_like(heights, np.nan)
    before, after = np.full_like(heights, np.nan), np.full_like(heights, np.nan)
    before[:, 1:], after[:, :-1] = heights[:, :-1], heights[:, 1:]
    both = np.isfinite(before) & np.isfinite(after)
    backward = np.isfinite(before) & ~np.isfinite(after)
    forward = np.isfinite(after) & ~np.isfinite(before)
    d = np.asarray(distances, dtype=np.float64)
    previous_d, next_d = np.r_[np.nan, d[:-1]], np.r_[d[1:], np.nan]
    np.divide(after - before, next_d - previous_d, out=radial, where=both)
    np.divide(heights - before, d - previous_d, out=radial, where=backward)
    np.divide(after - heights, next_d - d, out=radial, where=forward)
    before_angle, after_angle = np.roll(heights, 1, axis=0), np.roll(heights, -1, axis=0)
    both = np.isfinite(before_angle) & np.isfinite(after_angle)
    backward = np.isfinite(before_angle) & ~np.isfinite(after_angle)
    forward = np.isfinite(after_angle) & ~np.isfinite(before_angle)
    transverse = np.full_like(heights, np.nan)
    chord = d * math.sin(step)
    radial_offset = radial * d * (math.cos(step) - 1)
    np.divide(after_angle - before_angle, 2 * chord, out=transverse, where=both)
    np.divide(heights - before_angle + radial_offset, chord, out=transverse, where=backward)
    np.divide(after_angle - heights - radial_offset, chord, out=transverse, where=forward)
    east = radial * np.sin(angles)[:, None] + transverse * np.cos(angles)[:, None]
    north = radial * np.cos(angles)[:, None] - transverse * np.sin(angles)[:, None]
    length = np.sqrt(east * east + north * north + 1)
    valid = np.isfinite(heights) & np.isfinite(length)
    result[..., 0][valid] = (-east / length)[valid]
    result[..., 1][valid] = (-north / length)[valid]
    result[..., 2][valid] = (1 / length)[valid]
    return result


def distance_schedule(maximum_distance_meters: float) -> np.ndarray:
    """Level-of-detail schedule: dense nearby, logarithmic in the far field."""
    sections = [
        np.geomspace(2, min(1_000, maximum_distance_meters), 48),
        np.geomspace(1_050, min(20_000, maximum_distance_meters), 42) if maximum_distance_meters > 1_000 else [],
        np.geomspace(20_500, maximum_distance_meters, 34) if maximum_distance_meters > 20_000 else [],
    ]
    return np.unique(np.asarray([round(float(value), 2) for section in sections for value in section], dtype=float))


def raster_source_version(collection: RasterCollection) -> str:
    payload = json.dumps(collection.datasets, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


class SemanticIndex:
    """One in-memory spatial query for all sampled points of one viewpoint."""

    def __init__(self, records: Sequence[tuple[object, SemanticClass, float, str]]):
        self.geometries = [record[0] for record in records]
        self.semantics = [record[1] for record in records]
        self.confidences = [record[2] for record in records]
        self.sources = [record[3] for record in records]
        self.tree = STRtree(self.geometries) if self.geometries else None
        # A 2-D water label on an older DEM can paint a bank as a blue wall.
        # Keep only independently measured, effectively horizontal lake faces.
        # Rivers and 2-D/uncertain sources retain the original DEM behaviour.
        self.water_geometries, self.water_levels = [], []
        for geometry, semantic, _confidence, source in records:
            if semantic != SemanticClass.WATER or source != "swissTLM3D":
                continue
            for part in get_parts(geometry):
                if part.geom_type != "Polygon" or not part.is_valid or not part.has_z:
                    continue
                coordinates = [*part.exterior.coords, *(point for ring in part.interiors for point in ring.coords)]
                heights = np.asarray(coordinates, dtype=float)[:, 2]
                if not np.isfinite(heights).all() or heights.min() < -500 or heights.max() > 9_000:
                    continue
                if np.ptp(heights) > .01:  # tolerate only centimetre-scale source rounding
                    continue
                self.water_geometries.append(part)
                self.water_levels.append(float(np.median(heights)))
        self.water_tree = STRtree(self.water_geometries) if self.water_geometries else None

    def water_surface_heights(self, longitudes: np.ndarray, latitudes: np.ndarray) -> np.ndarray:
        """Static source lake levels; NaN means retain the terrain measurement.

        Query the complete path before occlusion so an old low raster does not
        hide a valid lake surface. Holes, outer boundaries and conflicting
        overlapping source elevations remain unresolved. These are source
        survey levels, never an estimate of the current hydrological state.
        """
        result = np.full(len(longitudes), np.nan)
        if self.water_tree is None or not len(longitudes):
            return result
        east, north = WGS84_TO_LV95.transform(longitudes, latitudes)
        matches = self.water_tree.query(points(east, north), predicate="within")
        if not matches.size:
            return result
        lowest, highest = np.full(len(result), np.inf), np.full(len(result), -np.inf)
        indices, faces = matches
        levels = np.asarray(self.water_levels)[faces]
        np.minimum.at(lowest, indices, levels)
        np.maximum.at(highest, indices, levels)
        valid = np.isfinite(lowest) & (highest - lowest <= .01)
        result[valid] = (lowest[valid] + highest[valid]) / 2
        return result

    def classify(self, longitudes: np.ndarray, latitudes: np.ndarray):
        size = len(longitudes)
        # np.full coerces str-backed Enums through a fixed-width string dtype
        # before placing them into an object array ("SemanticClass.U" here).
        # Assigning into an existing object array preserves the Enum instance.
        semantics = np.empty(size, dtype=object)
        semantics[:] = SemanticClass.UNKNOWN_TERRAIN
        confidences = np.full(size, .35, dtype=float)
        sources = np.full(size, "swissALTI3D", dtype=object)
        if self.tree is None or size == 0:
            return semantics, confidences, sources
        eastings, northings = WGS84_TO_LV95.transform(longitudes, latitudes)
        query_points = points(np.asarray(eastings), np.asarray(northings))
        matches = self.tree.query(query_points, predicate="within")
        if matches.size == 0:
            return semantics, confidences, sources
        # Later/higher priority records overwrite broad generic land cover.
        priorities = {
            SemanticClass.UNKNOWN_TERRAIN: 0,
            SemanticClass.OPEN_GRASSLAND: 1,
            SemanticClass.ROCK: 2,
            SemanticClass.FOREST: 3,
            SemanticClass.SNOW_OR_GLACIER: 4,
            SemanticClass.SETTLEMENT: 5,
            SemanticClass.SURFACED_GROUND: 6,
            SemanticClass.PAVED_GROUND: 7,
            SemanticClass.RIVER: 8,
            SemanticClass.WATER: 9,
        }
        chosen = np.zeros(size, dtype=np.int8)
        for point_index, geometry_index in zip(matches[0], matches[1]):
            semantic = self.semantics[int(geometry_index)]
            priority = priorities.get(semantic, 0)
            if priority >= chosen[int(point_index)]:
                index = int(point_index)
                semantics[index] = semantic
                confidences[index] = self.confidences[int(geometry_index)]
                sources[index] = self.sources[int(geometry_index)]
                chosen[index] = priority
        return semantics, confidences, sources


class BuildingIndex:
    """Decoded building footprints shared by nearby viewpoints in one worker."""

    def __init__(self, rows: Sequence[object], preferred_source: str | None = None):
        self.preferred_source = preferred_source
        prepared = []
        for row in rows:
            try:
                parts = [
                    part for part in get_parts(from_wkb(bytes(row["geometry_wkb"])))
                    if part.geom_type == "Polygon" and part.area > .05
                ]
                if parts:
                    prepared.append((row, max(parts, key=lambda part: part.area)))
            except Exception:
                continue
        self.records = prepared
        self.geometries = [record[1] for record in prepared]
        self.tree = STRtree(self.geometries) if self.geometries else None

    def nearby(self, east: float, north: float, radius_meters: float):
        if self.tree is None:
            return []
        # Match the database RTree's bounding-box candidate semantics. Resolve
        # source precedence only between overlapping footprints downstream.
        bounds = box(east - radius_meters, north - radius_meters, east + radius_meters, north + radius_meters)
        indices = self.tree.query(bounds)
        return [(self.records[int(index)][0], self.records[int(index)][1]) for index in indices]


def _semantic_class(value: str, kind: str | None = None) -> SemanticClass:
    normalized = value.casefold().replace("ö", "oe").replace("ä", "ae").replace("ü", "ue")
    if kind == "water":
        return SemanticClass.RIVER if any(token in normalized for token in ("fluss", "fliessgewaesser", "river", "stream", "bach", "canal")) else SemanticClass.WATER
    if kind == "forest" or any(token in normalized for token in ("wald", "gehoelz", "forest", "baum", "obstanlage")):
        return SemanticClass.FOREST
    if any(token in normalized for token in ("gletscher", "schneefeld", "glacier", "firn")):
        return SemanticClass.SNOW_OR_GLACIER
    if any(token in normalized for token in ("fels", "rock", "geroell", "lockergestein")):
        return SemanticClass.ROCK
    if any(token in normalized for token in ("siedlung", "parkplatz", "flugplatz", "industrie", "schule", "spital")):
        return SemanticClass.SETTLEMENT
    if any(token in normalized for token in ("reben", "golf", "camping", "acker", "wiese", "weide")):
        return SemanticClass.OPEN_GRASSLAND
    return SemanticClass.UNKNOWN_TERRAIN


def load_semantic_index(database, latitude: float, longitude: float, radius_meters: float = 20_000) -> SemanticIndex:
    latitude_delta = radius_meters / 111_320
    longitude_delta = radius_meters / (111_320 * max(.2, math.cos(math.radians(latitude))))
    bounds = (longitude - longitude_delta, longitude + longitude_delta, latitude - latitude_delta, latitude + latitude_delta)
    records: list[tuple[object, SemanticClass, float, str]] = []
    land = database.execute("""SELECT f.geometry_wkb,f.geometry_crs,f.class,f.source FROM land_cover_spatial_index s
        CROSS JOIN land_cover_features f ON f.row_id=s.row_id
        WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?""", bounds).fetchall()
    for row in land:
        if row["source"] == "SITG-paved-ground":
            # The dedicated importer qualifies actual ground-level surface
            # polygons. Neither a road name nor a broad urban area proves paving.
            if row["class"] != "paved_ground" or row["geometry_crs"] != 2056:
                continue
            semantic = SemanticClass.PAVED_GROUND
        elif row["source"] == "BE-MOPUBE-ground-cover":
            # The review importer accepts only measured AV93 cover. Roads
            # may be unpaved; preserve that uncertainty in a distinct class.
            from benchly.context.ground_cover import MOPUBE_SEMANTICS
            if row["class"] not in MOPUBE_SEMANTICS or row["geometry_crs"] != 2056:
                continue
            semantic = SemanticClass(row["class"])
        else:
            semantic = _semantic_class(str(row["class"]))
        if semantic == SemanticClass.UNKNOWN_TERRAIN:
            continue
        try:
            records.append((from_wkb(bytes(row["geometry_wkb"])), semantic, .9, str(row["source"])))
        except Exception:
            continue
    context = database.execute("""SELECT f.* FROM environment_spatial_index s
        CROSS JOIN environment_features f ON f.row_id=s.row_id
        WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?
          AND f.kind IN ('water','forest') AND f.geometry_wkb IS NOT NULL""", bounds).fetchall()
    for row in context:
        if row["kind"] == "water" and not feature_is_surface_water(row):
            continue
        subtype = str(row["subtype"] or "")
        if row["kind"] == "water" and "raw_tags" in row.keys():
            try:
                tags = json.loads(row["raw_tags"] or "{}")
                subtype = str(tags.get("waterway") or tags.get("objektart") or tags.get("OBJEKTART") or subtype)
            except (ValueError, TypeError, AttributeError):
                pass
        semantic = _semantic_class(subtype, str(row["kind"]))
        try:
            records.append((from_wkb(bytes(row["geometry_wkb"])), semantic, .98, str(row["source"])))
        except Exception:
            continue
    return SemanticIndex(records)


def sample_terrain_rays(
    latitude: float,
    longitude: float,
    terrain: RasterCollection,
    config: PanoramaConfig,
    semantics: SemanticIndex | None = None,
    regional_terrain: RasterCollection | None = None,
    border_terrain: RasterCollection | None = None,
    high_resolution_distance_meters: float = 20_000,
    observer_ground_elevation_meters: float | None = None,
    local_terrain: RasterCollection | None = None,
    local_terrain_distance_meters: float | None = None,
) -> list[TerrainRay]:
    """Sample a full-circle LOD path in a few raster batches.

    swissALTI3D remains authoritative nearby. A prepared regional overview can
    answer far samples much more cheaply; missing pixels fall back through the
    primary terrain and finally an optional cross-border DEM.
    """
    distances = distance_schedule(config.maximum_distance_meters)
    azimuths = np.arange(config.column_count, dtype=float) * config.angular_resolution_degrees
    flat_bearings = np.repeat(azimuths, len(distances))
    flat_distances = np.tile(distances, len(azimuths))
    longitudes, latitudes, _ = WGS84.fwd(
        np.full(len(flat_bearings), longitude),
        np.full(len(flat_bearings), latitude),
        flat_bearings,
        flat_distances,
    )
    locations = list(zip(latitudes.tolist(), longitudes.tolist()))
    elevations: list[float | None] = [None] * len(locations)
    terrain_sources = np.full(len(locations), "unavailable", dtype=object)

    def sample(indices: np.ndarray, collection: RasterCollection | None, source: str) -> None:
        if collection is None or not getattr(collection, "datasets", True) or not len(indices):
            return
        missing = [int(index) for index in indices if elevations[int(index)] is None]
        if not missing:
            return
        values = collection.sample_many([locations[index] for index in missing])
        for index, value in zip(missing, values):
            if value is not None:
                elevations[index] = float(value)
                terrain_sources[index] = source

    local_limit = config.local_terrain_distance_meters if local_terrain_distance_meters is None else local_terrain_distance_meters
    local = np.flatnonzero(flat_distances <= local_limit) if local_terrain is not None else np.asarray([], dtype=int)
    near = np.flatnonzero(
        (flat_distances <= high_resolution_distance_meters)
        & ((flat_distances > local_limit) if local_terrain is not None else True)
    )
    far = np.flatnonzero(flat_distances > high_resolution_distance_meters)
    sample(local, local_terrain, "swissALTI3D-local")
    sample(near, terrain, "swissALTI3D")
    sample(far, regional_terrain, "regional-terrain")
    sample(far, terrain, "swissALTI3D")
    all_indices = np.arange(len(locations))
    sample(all_indices, border_terrain, "cross-border-terrain")
    water_surface = np.zeros(len(locations), dtype=bool)
    if semantics is not None:
        levels = semantics.water_surface_heights(np.asarray(longitudes), np.asarray(latitudes))
        for index in np.flatnonzero(np.isfinite(levels)):
            # Do not conceal missing terrain coverage with a semantic polygon.
            if elevations[index] is not None:
                elevations[index] = float(levels[index])
                terrain_sources[index] = "swissTLM3D-water-surface"
                water_surface[index] = True
    classes = np.empty(len(locations), dtype=object)
    classes[:] = SemanticClass.UNKNOWN_TERRAIN
    confidences = np.full(len(locations), .35)
    sources = np.full(len(locations), "swissALTI3D", dtype=object)
    visible_by_ray: list[list[int]] = []
    complete_by_ray: list[bool] = []
    eye = observer_ground_elevation_meters + config.observer_height_meters if observer_ground_elevation_meters is not None else None
    for ray_index in range(len(azimuths)):
        offset = ray_index * len(distances)
        visible: list[int] = []
        complete = True
        top = config.minimum_elevation_angle
        for sample_index, distance in enumerate(distances):
            elevation = elevations[offset + sample_index]
            if elevation is None:
                complete = False
                continue
            if eye is None:
                visible.append(sample_index)
                continue
            drop = distance * distance / (2 * 6_371_008.8) * (1 - config.refraction_coefficient)
            angle = math.degrees(math.atan2(float(elevation) - drop - eye, float(distance)))
            if angle > top:
                visible.append(sample_index)
                top = angle

        visible_by_ray.append(visible)
        complete_by_ray.append(complete)

    if semantics:
        semantic_indices = np.asarray([
            ray_index * len(distances) + sample_index
            for ray_index, visible in enumerate(visible_by_ray)
            for sample_index in visible
        ], dtype=int)
        if len(semantic_indices):
            selected_classes, selected_confidences, selected_sources = semantics.classify(
                np.asarray(longitudes)[semantic_indices], np.asarray(latitudes)[semantic_indices],
            )
            classes[semantic_indices] = selected_classes
            confidences[semantic_indices] = selected_confidences
            sources[semantic_indices] = selected_sources
    # Every visible sample describes a measured part of the slope. Keeping
    # only range-shell endpoints plus semantic transitions made depth depend
    # on material: the same hillside acquired extra distance steps whenever
    # a ray crossed a clearing. Its neighbours then painted long vertical
    # haze lanes despite having identical terrain. The LOD schedule already
    # bounds each ray to fewer than 150 samples; retain its visible envelope
    # independently of classification. Hidden samples remain excluded.
    normals = _terrain_surface_normals(elevations, distances, azimuths)
    normals.reshape(-1, 3)[water_surface] = (0, 0, 1)
    rays = []
    for ray_index, azimuth in enumerate(azimuths):
        offset = ray_index * len(distances)
        ray_elevations = elevations[offset:offset + len(distances)]
        samples = []
        for sample_index in visible_by_ray[ray_index]:
            elevation = ray_elevations[sample_index]
            if elevation is None:  # retained indices always have elevation; keep the invariant explicit
                continue
            start = max(0, sample_index - 2)
            end = min(len(ray_elevations), sample_index + 3)
            neighborhood = [float(value) for value in ray_elevations[start:end] if value is not None]
            relief = max(neighborhood) - min(neighborhood) if neighborhood else 0.0
            previous = next((index for index in range(sample_index - 1, -1, -1) if ray_elevations[index] is not None), None)
            following = next((index for index in range(sample_index + 1, len(ray_elevations)) if ray_elevations[index] is not None), None)
            if previous is None and following is None:
                slope = 0.0
            else:
                left = previous if previous is not None else sample_index
                right = following if following is not None else sample_index
                run = float(distances[right] - distances[left])
                rise = float(ray_elevations[right] - ray_elevations[left])
                slope = math.degrees(math.atan2(rise, run)) if run else 0.0
            # Values originate from the validated raster/index pipeline and
            # are already range checked above. Avoid repeating Pydantic's
            # generic schema walk tens of thousands of times per panorama.
            samples.append(TerrainSample.model_construct(
                distance_meters=float(distances[sample_index]),
                elevation_meters=float(elevation),
                semantic=classes[offset + sample_index],
                confidence=float(confidences[offset + sample_index]),
                source=str(sources[offset + sample_index]),
                terrain_source=str(terrain_sources[offset + sample_index]),
                slope_degrees=slope,
                relief_meters=relief,
                surface_normal=(tuple(float(value) for value in normals[ray_index, sample_index])
                                if np.isfinite(normals[ray_index, sample_index, 0]) else None),
            ))
        expected = len(samples) if complete_by_ray[ray_index] else len(samples) + 1
        rays.append(TerrainRay.model_construct(
            azimuth_degrees=float(azimuth),
            samples=tuple(samples),
            expected_sample_count=expected,
        ))
    # Ordinary LOD cells can widen, move or omit narrow mapped roads. Refine
    # only at real paving boundaries; retain every original terrain sample.
    from benchly.panorama.paving import refine_paved_ground_rays
    return refine_paved_ground_rays(
        rays, latitude, longitude, terrain, config, semantics,
        regional_terrain, border_terrain, high_resolution_distance_meters,
        local_terrain, local_terrain_distance_meters,
    )


def refine_building_contact_rays(
    rays: Sequence[TerrainRay], buildings: Sequence[BuildingGeometry],
    latitude: float, longitude: float, terrain: RasterCollection,
    config: PanoramaConfig, semantics: SemanticIndex | None = None,
) -> list[TerrainRay]:
    """Sample actual wall-contact terrain instead of clipping at an LOD shell.

    A wall crossing successive range samples otherwise gains a new ground
    cutoff at each shell, producing saw teeth even along one straight face.
    Add measured ground at its exact intersection, retaining every existing
    visible terrain sample and independently classifying the added positions.
    """
    from benchly.panorama.visibility import _ray_polygon_distance

    by_index = {round(ray.azimuth_degrees / config.angular_resolution_degrees) % config.column_count: ray
                for ray in rays}
    contacts: dict[tuple[int, float], tuple[float, float]] = {}
    for building in buildings:
        # Footprint vertices with qualified DEM heights can still miss curved
        # ground between corners. Sample each retained wall intersection even
        # beyond 500m, so a coarse radial LOD cannot leave sky below its base.
        # Source-only structures without that ground evidence retain the
        # conservative near-wall range; do not snap distant raised roofs or
        # border structures to an unsupported DEM surface.
        contact_limit = (config.maximum_distance_meters if building.footprint_ground_elevations is not None
                         else min(500, config.maximum_distance_meters))
        bearings = [math.degrees(math.atan2(east, north)) % 360 for east, north in building.footprint]
        anchor = bearings[0]
        unwrapped = [anchor + (bearing - anchor + 180) % 360 - 180 for bearing in bearings]
        lower, upper = min(unwrapped), max(unwrapped)
        if upper - lower >= 180:
            continue
        for raw_index in range(math.floor(lower / config.angular_resolution_degrees),
                               math.ceil(upper / config.angular_resolution_degrees) + 1):
            index = raw_index % config.column_count
            ray = by_index.get(index)
            if ray is None:
                continue
            azimuth = index * config.angular_resolution_degrees
            distance = _ray_polygon_distance(building.footprint, azimuth)
            if distance is None or distance > contact_limit:
                continue
            if any(abs(sample.distance_meters - distance) < 1e-6 for sample in ray.samples):
                continue
            lon, lat, _ = WGS84.fwd(longitude, latitude, azimuth, distance)
            contacts[(index, distance)] = (lat, lon)
    if not contacts:
        return list(rays)
    keys, locations = list(contacts), list(contacts.values())
    elevations = terrain.sample_many(locations)
    classes = np.empty(len(keys), dtype=object)
    classes[:] = SemanticClass.UNKNOWN_TERRAIN
    confidences, sources = np.full(len(keys), .35), np.full(len(keys), "swissALTI3D", dtype=object)
    if semantics is not None:
        classes, confidences, sources = semantics.classify(
            np.asarray([point[1] for point in locations]), np.asarray([point[0] for point in locations]))
    levels = (semantics.water_surface_heights(np.asarray([p[1] for p in locations]), np.asarray([p[0] for p in locations]))
              if semantics is not None else np.full(len(locations), np.nan))
    added: dict[int, list[TerrainSample]] = defaultdict(list)
    missing: dict[int, int] = defaultdict(int)
    for position, ((index, distance), elevation) in enumerate(zip(keys, elevations, strict=True)):
        if elevation is None or not math.isfinite(float(elevation)):
            missing[index] += 1
            continue
        neighbours = by_index[index].samples
        nearest = min(neighbours, key=lambda sample: abs(sample.distance_meters - distance), default=None)
        water_surface = math.isfinite(float(levels[position]))
        added[index].append(TerrainSample(
            distance_meters=distance, elevation_meters=float(levels[position] if water_surface else elevation),
            semantic=classes[position], confidence=float(confidences[position]), source=str(sources[position]),
            terrain_source="swissTLM3D-water-surface" if water_surface else "swissALTI3D-building-contact",
            slope_degrees=nearest.slope_degrees if nearest else None,
            relief_meters=nearest.relief_meters if nearest else None,
            surface_normal=(0, 0, 1) if water_surface else None,
        ))
    result = []
    for ray in rays:
        index = round(ray.azimuth_degrees / config.angular_resolution_degrees) % config.column_count
        samples = tuple(sorted((*ray.samples, *added[index]), key=lambda sample: sample.distance_meters))
        expected = len(samples) + missing[index] + int(not ray.has_complete_coverage)
        result.append(ray.model_copy(update={"samples": samples, "expected_sample_count": expected}))
    return result


def _row_height(row, key: str):
    return float(row[key]) if key in row.keys() and row[key] is not None else None


def load_building_index(database, latitude: float, longitude: float,
                        radius_meters: float = 10_000) -> BuildingIndex:
    """Load and decode a reusable superset of nearby authoritative buildings."""
    rows = nearby_context(database, latitude, longitude, radius_meters, ["building"])
    sources = {str(row["source"]) for row in rows}
    preferred_source = (
        "swissBUILDINGS3D" if "swissBUILDINGS3D" in sources
        else "swissTLM3D" if "swissTLM3D" in sources else None
    )
    # Imports are spatially progressive. A nearby 3-D tile does not establish
    # coverage for every other footprint in this query. Resolve source priority
    # per overlapping footprint below, retaining non-overlapping fallback data.
    return BuildingIndex(rows, preferred_source)


def _footprint_orientation(coordinates: tuple[tuple[float, float], ...]) -> float | None:
    """Return the longest footprint edge orientation, modulo 180 degrees."""
    if len(coordinates) < 2:
        return None
    closed = (*coordinates, coordinates[0])
    edges = [
        (math.hypot(second[0] - first[0], second[1] - first[1]), first, second)
        for first, second in zip(closed, closed[1:])
    ]
    length, first, second = max(edges, key=lambda item: item[0])
    if length <= .05:
        return None
    return math.degrees(math.atan2(second[0] - first[0], second[1] - first[1])) % 180


def _building_levels(tags) -> int | None:
    try:
        value = tags.get("building:levels", 0)
        if isinstance(value, bool):
            return None
        number = float(value)
        return int(number) if number.is_integer() and 1 <= number <= 100 else None
    except (ValueError, TypeError, AttributeError, OverflowError):
        return None


def _source_facade_parts(records, origin_east, origin_north):
    """Keep actual mapped units without changing the official solid's extent.

    OSM way/area representations are duplicates, not additional houses. Reject
    conflicting/overlapping units rather than inventing divisions of a block.
    """
    unique = {}
    for row, geometry in records:
        source_id = str(row["source_id"])
        if source_id.startswith("area-") and source_id[5:].isdigit():
            area_id = int(source_id[5:])
            source_id = f"way-{area_id // 2}" if area_id % 2 == 0 else f"relation-{(area_id - 1) // 2}"
        try:
            tags = json.loads(row["raw_tags"] or "{}") if "raw_tags" in row.keys() else {}
        except (ValueError, TypeError):
            tags = {}
        levels = _building_levels(tags)
        if source_id in unique:
            other_row, other, other_levels = unique[source_id]
            if not geometry.equals(other) or levels != other_levels:
                return ()
            continue
        unique[source_id] = (row, geometry, levels)
    values = sorted(unique.items())
    if len(values) < 2:
        return ()
    for index, (_source_id, (_row, geometry, _levels)) in enumerate(values):
        for _other_id, (_other_row, other, _other_levels) in values[:index]:
            if geometry.intersection(other).area / max(.01, min(geometry.area, other.area)) > .1:
                return ()
    result = []
    for source_id, (row, geometry, levels) in values:
        polygons = [part for part in get_parts(geometry) if part.geom_type == "Polygon"]
        if len(polygons) != 1:
            continue
        origin_longitude, origin_latitude = LV95_TO_WGS84.transform(origin_east, origin_north)
        coordinates = _true_local_xy(polygons[0].exterior.coords[:-1], origin_latitude, origin_longitude)
        if len(coordinates) >= 3:
            result.append(BuildingFacadePart(source_id=f"OpenStreetMap:{source_id}",
                source_version=str(row["source_version"]) if "source_version" in row.keys() and row["source_version"] else None,
                footprint=coordinates, levels=levels,
                levels_source=f"OpenStreetMap:{source_id}:building:levels" if levels else None))
    return tuple(result) if len(result) > 1 else ()


def _true_local_xy(coordinates, latitude: float, longitude: float):
    """Use the same true-north bearing and geodesic range as terrain rays.

    Subtracting LV95 coordinates instead uses grid north (over two degrees
    different in the eastern sample), so terrain and walls miss each other.
    Preserve measured vertices while changing their horizontal reference frame.
    """
    points = np.asarray(coordinates, dtype=float)
    longitudes, latitudes = LV95_TO_WGS84.transform(points[:, 0], points[:, 1])
    bearings, _back, distances = WGS84.inv(np.full(len(points), longitude), np.full(len(points), latitude),
                                         np.asarray(longitudes), np.asarray(latitudes))
    radians = np.radians(bearings)
    return tuple((float(east), float(north)) for east, north in zip(
        np.sin(radians) * distances, np.cos(radians) * distances, strict=True))


def buildings_for_viewpoint(building_index: BuildingIndex, latitude: float, longitude: float,
                            terrain: RasterCollection, radius_meters: float = 10_000) -> list[BuildingGeometry]:
    """Project a cached absolute building index into one exact local viewpoint."""
    origin_east, origin_north = WGS84_TO_LV95.transform(longitude, latitude)
    nearby = building_index.nearby(origin_east, origin_north, radius_meters)
    prepared = []
    for row, geometry in nearby:
        try:
            distance = float(Point(origin_east, origin_north).distance(geometry))
            if distance > radius_meters or geometry.covers(Point(origin_east, origin_north)):
                continue
            source = str(row["source"])
            explicit_height = _row_height(row, "height_meters")
            priority = 4 if source == "swissBUILDINGS3D" else 3 if source == "OpenStreetMap" and explicit_height else 2 if source == "swissTLM3D" else 1
            prepared.append((priority, distance, row, geometry, explicit_height))
        except Exception:
            continue
    prepared.sort(key=lambda item: (
        -item[0], item[1], str(item[2]["source"]), str(item[2]["source_id"]),
    ))

    # Suppress lower-priority duplicates by substantial footprint overlap,
    # without confusing genuinely adjacent houses.
    selected = []
    facade_parts = defaultdict(list)
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for priority, distance, row, geometry, explicit_height in prepared:
        min_x, min_y, max_x, max_y = geometry.bounds
        cells = [(x, y) for x in range(math.floor(min_x / 25), math.floor(max_x / 25) + 1)
                 for y in range(math.floor(min_y / 25), math.floor(max_y / 25) + 1)]
        candidates = {index for cell in cells for index in grid.get(cell, ())}
        duplicate = False
        for index in sorted(candidates):
            other = selected[index][3]
            overlap = geometry.intersection(other).area
            if overlap / max(.01, min(geometry.area, other.area)) >= .65:
                duplicate = True
                # A 3-D solid can aggregate a whole terrace. Suppressing every
                # smaller mapped house also erased its real facade divisions.
                # Retain only well-contained, genuinely smaller OSM units as
                # descriptive metadata; the authoritative silhouette stays put.
                if (str(row["source"]) == "OpenStreetMap" and str(selected[index][2]["source"]) == "swissBUILDINGS3D"
                        and geometry.area >= 6 and geometry.area < other.area * .8
                        and overlap / geometry.area >= .9):
                    facade_parts[index].append((row, geometry))
                break
        if duplicate:
            continue
        selected.append((priority, distance, row, geometry, explicit_height))
        for cell in cells:
            grid[cell].append(len(selected) - 1)

    centers = [(float(item[2]["center_latitude"]), float(item[2]["center_longitude"])) for item in selected]
    ground_samples = terrain.sample_many(centers)
    result = []
    profile_locations = []
    for selected_index, ((priority, distance, row, geometry, explicit_height), sampled_ground) in enumerate(zip(selected, ground_samples)):
        source = str(row["source"])
        ground = _row_height(row, "ground_elevation_meters")
        ground = ground if ground is not None else sampled_ground
        if ground is None:
            continue
        roof = _row_height(row, "roof_elevation_meters")
        eaves = _row_height(row, "eaves_elevation_meters")
        if roof is None:
            roof = ground + (explicit_height or 8.5)
        if roof <= ground:
            continue
        if eaves is not None and not ground <= eaves <= roof:
            eaves = None
        if eaves is None:
            eaves = roof
        tolerance = .2 if distance <= 500 else 1 if distance <= 2_000 else 3
        simplified = geometry.simplify(tolerance, preserve_topology=True)
        parts = [part for part in get_parts(simplified) if part.geom_type == "Polygon"]
        if not parts:
            continue
        polygon = max(parts, key=lambda part: part.area)
        # swissBUILDINGS3D footprints may retain a Z coordinate.  Panorama
        # visibility works in the local horizontal plane, so deliberately
        # consume only X/Y instead of unpacking the coordinate tuple as 2-D.
        coordinates = _true_local_xy(polygon.exterior.coords[:-1], latitude, longitude)
        if len(coordinates) < 3:
            continue
        confidence = .98 if source == "swissBUILDINGS3D" else .8 if explicit_height is not None else .48
        tags = {}
        try:
            tags = json.loads(str(row["raw_tags"] or "{}")) if "raw_tags" in row.keys() else {}
        except (ValueError, TypeError, AttributeError):
            tags = {}
        levels = _building_levels(tags)
        levels_source = f"{source}:{row['source_id']}:building:levels" if levels else None
        reference = tags.get("benchly:building_reference", {}) if isinstance(tags, dict) else {}
        registered_storeys, registered_storeys_source = None, None
        if isinstance(reference, dict) and reference.get("source") == "BFS-GWR":
            storeys = reference.get("storeys")
            if isinstance(storeys, int) and not isinstance(storeys, bool) and 1 <= storeys <= 99:
                registered_storeys = storeys
                registered_storeys_source = f"BFS-GWR:{reference.get('egid')}@{reference.get('exportDate')}#{reference.get('responseSha256')}"
        roof_faces = ()
        mesh = tags.get("benchly:roof_mesh", {}) if isinstance(tags, dict) else {}
        if isinstance(mesh, dict) and mesh.get("version") == 1 and mesh.get("crs") == 2056:
            try:
                faces = mesh.get("faces", [])
                if len(faces) <= 4096 and all(len(face) == 3 and all(len(point) == 3 and
                    all(math.isfinite(float(value)) for value in point) for point in face) for face in faces):
                    vertices = list(dict.fromkeys((float(point[0]), float(point[1])) for face in faces for point in face))
                    transformed = dict(zip(vertices, _true_local_xy(vertices, latitude, longitude), strict=True)) if vertices else {}
                    roof_faces = tuple(tuple((*transformed[(float(point[0]), float(point[1]))],
                        float(point[2])) for point in face) for face in faces)
            except (TypeError, ValueError):
                pass
        facade_references = []
        references = tags.get("benchly:facade_references", {}) if isinstance(tags, dict) else {}
        if isinstance(references, dict) and references.get("version") == 1 and references.get("crs") == 2056:
            entries = references.get("faces", [])
            if isinstance(entries, list) and len(entries) <= 16:
                for entry in entries:
                    try:
                        reference = FacadeReference.model_validate(entry)
                        # Source roof edges may overhang their footprint by
                        # centimetres; never adopt an unrelated wall plane.
                        if any(polygon.exterior.distance(Point(*anchor[:2])) > .35 for anchor in (reference.start, reference.end)):
                            continue
                        local = _true_local_xy((reference.start[:2], reference.end[:2]), latitude, longitude)
                        facade_references.append(reference.model_copy(update={
                            "start": (*local[0], *reference.start[2:]), "end": (*local[1], *reference.end[2:])}))
                    except (TypeError, ValueError, KeyError):
                        continue
        result.append(BuildingGeometry.model_construct(
            source_id=f"{source}:{row['source_id']}",
            footprint=coordinates,
            ground_elevation_meters=float(ground),
            eaves_elevation_meters=float(eaves),
            roof_elevation_meters=float(max(roof, eaves)),
            source=source,
            source_version=str(row["source_version"]) if "source_version" in row.keys() and row["source_version"] else None,
            confidence=confidence,
            roof_kind="known-pitched" if source == "swissBUILDINGS3D" and roof - eaves >= 1 else "flat-or-unknown",
            orientation_degrees=_footprint_orientation(coordinates),
            levels=levels,
            levels_source=levels_source,
            registered_storeys=registered_storeys,
            registered_storeys_source=registered_storeys_source,
            roof_faces=roof_faces,
            facade_parts=_source_facade_parts(facade_parts[selected_index], origin_east, origin_north),
            facade_references=tuple(facade_references),
        ))
        # The source ground attribute anchors the solid's height datum, but
        # one terrain point cannot describe visible contact along a hillside.
        # Sample ALTI at every footprint vertex even for measured 3-D solids;
        # roofs/eaves retain their absolute measured heights. This clips the
        # visible facade to its local ground instead of suspending its lower
        # edge at a higher point from another side of the building.
        locations = []
        for coordinate in polygon.exterior.coords[:-1]:
            lon, lat = LV95_TO_WGS84.transform(coordinate[0], coordinate[1])
            locations.append((lat, lon))
        profile_locations.append(locations)
    locations = [point for profile in profile_locations for point in profile]
    sampled = terrain.sample_many(locations) if locations else []
    cursor = 0
    for index, locations in enumerate(profile_locations):
        profile = sampled[cursor:cursor + len(locations)]
        cursor += len(locations)
        if profile and all(value is not None for value in profile):
            result[index] = result[index].model_copy(update={"footprint_ground_elevations": tuple(float(value) for value in profile)})
    return result


def load_buildings(database, latitude: float, longitude: float, terrain: RasterCollection,
                   radius_meters: float = 10_000) -> list[BuildingGeometry]:
    """Compatibility entry point for a single uncached viewpoint."""
    index = load_building_index(database, latitude, longitude, radius_meters)
    return buildings_for_viewpoint(index, latitude, longitude, terrain, radius_meters)
