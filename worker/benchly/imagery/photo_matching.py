"""Conservative source identity matching, independent of photograph contents."""

import math
from collections import defaultdict
from itertools import combinations

from scipy.spatial import cKDTree

from benchly.geo import distance_meters

PHOTO_LOCATION_CONFLICT_DISTANCE_METERS = 100


def _sphere(latitude, longitude):
    lat, lon = math.radians(latitude), math.radians(longitude)
    return (6_371_000 * math.cos(lat) * math.cos(lon),
            6_371_000 * math.cos(lat) * math.sin(lon), 6_371_000 * math.sin(lat))


def valid_source_coordinate(source):
    return (-90 <= source["latitude"] <= 90 and -180 <= source["longitude"] <= 180)


def photo_location_conflicts(sources, observations):
    """Detect identical image bytes attributed to geographically different sites.

    A shared scene can cover nearby benches. Reuse beyond 100 m leaves its
    location unresolved; neither source is selected as the presumed correct one.
    """
    locations = {s["source_id"]: s for s in sources if valid_source_coordinate(s)}
    grouped = defaultdict(set)
    for observation in observations:
        if (observation["status"] == "analyzed" and observation["image_sha256"]
                and observation["source_id"] in locations):
            grouped[observation["image_sha256"]].add(observation["source_id"])
    conflicts = {}
    for image_hash, source_ids in grouped.items():
        for first_id, second_id in combinations(sorted(source_ids), 2):
            first, second = locations[first_id], locations[second_id]
            separation = distance_meters(first["latitude"], first["longitude"], second["latitude"], second["longitude"])
            if separation > PHOTO_LOCATION_CONFLICT_DISTANCE_METERS:
                conflicts[image_hash] = {
                    "image_sha256": image_hash, "source_ids": sorted(source_ids),
                    "conflicting_pair": [first_id, second_id], "separation_meters": round(separation, 2),
                    "reason": "identical_image_at_distant_sources",
                }
                break
    return conflicts


def match_photo_sources(sources, benches):
    """Return reviewable matches; never borrow identity from a wider vicinity."""
    if not benches:
        return {s["source_id"]: {"bench_id": None,
                "match_method": "unmatched" if valid_source_coordinate(s) else "invalid_coordinates",
                "match_distance_meters": None}
                for s in sources}
    tree = cKDTree([_sphere(b["latitude"], b["longitude"]) for b in benches])
    result = {}
    for source in sources:
        # Trigonometric distance functions wrap longitude. Never let a broken
        # source coordinate silently wrap around the globe onto a Swiss bench.
        if not valid_source_coordinate(source):
            result[source["source_id"]] = {
                "bench_id": None, "match_method": "invalid_coordinates", "match_distance_meters": None,
            }
            continue
        candidates = []
        for index in tree.query_ball_point(_sphere(source["latitude"], source["longitude"]), 5.01):
            bench = benches[index]
            distance = distance_meters(source["latitude"], source["longitude"], bench["latitude"], bench["longitude"])
            if distance <= 5:
                candidates.append((distance, bench))
        exact = [(distance, bench) for distance, bench in candidates if distance < .1]
        if len(exact) == 1:
            distance, bench = exact[0]
            method = "source_coordinate"
        elif len(candidates) == 1:
            distance, bench = candidates[0]
            method = "unique_within_5m"
        else:
            result[source["source_id"]] = {
                "bench_id": None, "match_method": "ambiguous" if candidates else "unmatched",
                "match_distance_meters": None,
            }
            continue
        result[source["source_id"]] = {
            "bench_id": bench["id"], "match_method": method, "match_distance_meters": distance,
        }
    return result
