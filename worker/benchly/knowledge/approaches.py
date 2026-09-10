"""Local pedestrian approach evidence, never a blanket wheelchair suitability claim."""
from __future__ import annotations
import json
import math
import hashlib
from collections import defaultdict
from shapely.geometry import LineString, Point
from shapely.ops import substring
from pyproj import Transformer
from benchly.context.geometry import WGS84_TO_LV95
from benchly.knowledge.geography import geometry
from benchly.knowledge.models import Approach
from benchly.knowledge.repository import compact, record_evidence, upsert
from benchly.runtime import now_iso

METHOD = "pedestrian-approach-2"
TO_WGS84 = Transformer.from_crs(2056, 4326, always_xy=True)
WALKABLE = {"footway", "path", "pedestrian", "track", "steps", "living_street", "residential", "service"}


def terrain_metadata(terrain):
    if not terrain.datasets:
        return []
    return [{"source": "swissALTI3D", "cache_manifest": hashlib.sha256(compact(terrain.datasets).encode()).hexdigest(),
             "tile_count": len(terrain.datasets), "surface": "bare_earth"}]


def usable(tags):
    return (tags.get("highway") in WALKABLE or tags.get("highway") in {"cycleway", "bridleway"} and tags.get("foot") in {"yes", "designated", "permissive"}) and tags.get("foot", tags.get("access")) not in {"no", "private"}


def slope_profile(coordinates, sample, coverage=None):
    """Absolute, distance-weighted grade and uphill gain along the actual approach."""
    line = LineString(coordinates)
    coverage = coverage if coverage is not None else {}
    coverage.update(expected=0, sampled=0)
    if line.length < 1 or sample is None:
        return None, None, None
    distances = [float(value) for value in range(0, math.ceil(line.length), 10)] + [line.length]
    coverage["expected"] = len(distances)
    heights = []
    for distance in distances:
        point = line.interpolate(distance)
        lon, lat = TO_WGS84.transform(point.x, point.y)
        height = sample(lat, lon)
        if height is None or not math.isfinite(height):
            return None, None, None
        heights.append(height)
        coverage["sampled"] += 1
    grades, lengths, gains = [], [], []
    for index in range(1, len(distances)):
        length = distances[index] - distances[index - 1]
        if length < 1:
            continue
        delta = heights[index] - heights[index - 1]
        grades.append(100 * abs(delta) / length)
        lengths.append(length)
        gains.append(max(0, delta))
    if not grades:
        return None, None, None
    return round(sum(grade * length for grade, length in zip(grades, lengths)) / sum(lengths), 2), round(max(grades), 2), round(sum(gains), 2)


def approach_candidates(bench, context):
    point = Point(*WGS84_TO_LV95.transform(bench["longitude"], bench["latitude"]))
    segments, graph = [], defaultdict(list)
    for row in context:
        tags = json.loads(row["raw_tags"] or "{}")
        if row["kind"] != "path" or not usable(tags) or not row["geometry_wkb"]:
            continue
        line = geometry(row["geometry_wkb"])
        if line.geom_type != "LineString" or line.length < 1:
            continue
        coords = [tuple(coord[:2]) for coord in line.coords]
        refs = tags.get("_node_refs", "").split(",")
        def node_key(index):
            # OSM node identity allows real junctions and bridges, but never creates a junction at a crossing.
            if len(refs) == len(coords) and refs[index]:
                return ("osm", refs[index])
            return ("geometry", round(coords[index][0], 3), round(coords[index][1], 3), tags.get("layer", "0"))
        for index in range(1, len(coords)):
            segment = LineString([coords[index - 1], coords[index]])
            if segment.length < .01 or segment.distance(point) > 325:
                continue
            edge = len(segments)
            first, last = node_key(index - 1), node_key(index)
            segments.append((segment, row, first, last))
            graph[first].append((edge, last, coords[index]))
            graph[last].append((edge, first, coords[index - 1]))
    if not segments:
        return []
    edge = min(range(len(segments)), key=lambda index: (segments[index][0].distance(point), segments[index][1]["source_id"]))
    line, nearest, first, last = segments[edge]
    distance = line.distance(point)
    if distance > 25:
        return []
    snap = line.interpolate(line.project(point))
    candidates, frontier = [], []
    for key, endpoint in ((first, line.coords[0]), (last, line.coords[-1])):
        coords = [(snap.x, snap.y)]
        if Point(endpoint).distance(snap) > .01:
            coords.append(tuple(endpoint))
        frontier.append((coords, [nearest], {edge}, key))
    expanded = 0
    while frontier and len(candidates) < 24 and expanded < 500:
        coords, sources, visited, key = frontier.pop()
        expanded += 1
        route = LineString(coords) if len(coords) > 1 else None
        if route is not None and route.length >= 200:
            candidates.append((distance, list(substring(route, 0, 200).coords), sources))
            continue
        extensions = [(candidate, target, endpoint) for candidate, target, endpoint in graph[key] if candidate not in visited]
        if not extensions or len(visited) >= 100:
            if route is not None:
                candidates.append((distance, coords, sources))
            continue
        for candidate, target, endpoint in extensions[:4]:
            row = segments[candidate][1]
            next_sources = sources if sources[-1]["source_id"] == row["source_id"] else sources + [row]
            frontier.append((coords + [endpoint], next_sources, visited | {candidate}, target))
    return candidates


def analyze_approach(bench, context, sample=None, preferred_coordinates=None):
    candidates = approach_candidates(bench, context)
    analyzed = []
    for distance, coords, sources in candidates:
        route = LineString(coords)
        tags = [json.loads(row["raw_tags"] or "{}") for row in sources]
        barriers = []
        for row in context:
            if row["kind"] == "barrier" and row["geometry_wkb"] and route.distance(geometry(row["geometry_wkb"])) <= 1.5:
                barriers.append({"source_id": row["source_id"], "tags": json.loads(row["raw_tags"] or "{}")})
        steps = any(tag.get("highway") == "steps" for tag in tags)
        structure = any(tag.get("bridge", "no") != "no" or tag.get("tunnel", "no") != "no" for tag in tags)
        dem_coverage = {}
        average, maximum, gain = slope_profile(list(reversed(coords)), None if structure else sample, dem_coverage)
        explicit = all(tag.get("wheelchair") in {"yes", "designated"} for tag in tags)
        blocked = steps or any(item["tags"].get("access") in {"no", "private"} or item["tags"].get("barrier") in {"stile", "turnstile"} for item in barriers)
        step_free = 0 if blocked else 1 if explicit and not barriers and route.length >= 100 and distance <= 3 else None
        def uniform(key):
            values = {tag.get(key) for tag in tags}
            return next(iter(values)) if len(values) == 1 else "mixed" if None not in values else None
        widths = []
        for tag in tags:
            try:
                width = float(str(tag.get("width", "")).rstrip(" m"))
                if math.isfinite(width) and width > 0:
                    widths.append(width)
            except ValueError:
                pass
        result = dict(bench_row_id=bench["row_id"], source_id=sources[0]["source_id"], distance_meters=round(distance, 1),
            length_meters=round(route.length, 1), average_slope_percent=average, maximum_slope_percent=maximum, elevation_gain_meters=gain,
            steps=int(steps), barriers_json=compact(barriers), surface=uniform("surface"), smoothness=uniform("smoothness"),
            width_meters=min(widths) if len(widths) == len(tags) else None, step_free_possible=step_free,
            confidence="medium" if route.length >= 100 and distance <= 3 and average is not None else "low",
            evidence_json=compact({"source_ids": [row["source_id"] for row in sources], "tags": tags, "coordinates_lv95": coords,
                "terrain_ambiguity": "bridge_or_tunnel" if structure else None,
                "dem_coverage": dem_coverage,
                "dem_sample_spacing_meters": 10, "scope": "local_approach_only", "unmapped_last_meters": distance,
                "barriers_completeness": "unknown", "latitude": bench["latitude"], "longitude": bench["longitude"]}),
            method_version=METHOD, computed_at=now_iso())
        analyzed.append(result)
    if not analyzed:
        return dict(bench_row_id=bench["row_id"], confidence="unknown", barriers_json="[]", evidence_json=compact({"reason": "no_connected_pedestrian_approach_within_25m"}), method_version=METHOD, computed_at=now_iso())
    return min(analyzed, key=lambda item: (item["steps"], len(json.loads(item["barriers_json"])), item["length_meters"] < 100,
                                          preferred_coordinates is not None and json.loads(item["evidence_json"])["coordinates_lv95"] != preferred_coordinates,
                                          item["maximum_slope_percent"] if item["maximum_slope_percent"] is not None else 1000))


def prepare_approach(database, bench, context, sample=None, dem_inputs=None):
    """Read previous evidence and sample the DEM before acquiring a write lock."""
    previous = database.execute("SELECT * FROM bench_approaches WHERE bench_row_id=?", (bench["row_id"],)).fetchone()
    previous_metadata = json.loads(previous["evidence_json"]) if previous else {}
    previous_dem = previous_metadata.pop("dem_inputs", None)
    previous_coverage = previous_metadata.pop("dem_coverage", None)
    values = Approach.model_validate(analyze_approach(bench, context, sample,
        preferred_coordinates=previous_metadata.get("coordinates_lv95") if sample is None else None)).model_dump()
    metadata = json.loads(values["evidence_json"])
    comparison = {key: value for key, value in metadata.items() if key != "dem_coverage"}
    if sample is None and previous and previous["method_version"] == METHOD and previous_metadata == comparison:
        for field in ("average_slope_percent", "maximum_slope_percent", "elevation_gain_meters", "confidence"):
            values[field] = previous[field]
        if previous_dem:
            metadata["dem_inputs"] = previous_dem
        if previous_coverage:
            metadata["dem_coverage"] = previous_coverage
    elif sample is not None:
        metadata["dem_inputs"] = dem_inputs or [{"source": "supplied DEM", "version": None}]
    values["evidence_json"] = compact(metadata)
    return values


def store_approach(database, bench, values):
    upsert(database, Approach, values, ["bench_row_id"])
    for attr, field in {"approach_steps": "steps", "approach_surface": "surface", "approach_slope": "maximum_slope_percent", "step_free": "step_free_possible"}.items():
        record_evidence(database, bench["row_id"], attr, values[field], "gis", "local-approach", confidence=.65,
                        method=METHOD, metadata={"latitude": bench["latitude"], "longitude": bench["longitude"], "source_id": values["source_id"]})
    return values


def enrich_approach(database, bench, context, sample=None, dem_inputs=None):
    return store_approach(database, bench, prepare_approach(database, bench, context, sample, dem_inputs))
