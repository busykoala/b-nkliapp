"""Pure normalization and scoring rules for imported Bänkli data."""

from __future__ import annotations

import json
import unicodedata
from typing import Optional

KEEP_TAGS = {
    "amenity", "backrest", "armrest", "seats", "material", "direction", "covered",
    "wheelchair", "operator", "description", "image", "wikimedia_commons", "mapillary",
    "weather_protection", "surface", "colour", "access", "start_date",
    "bin", "fireplace",
    "name", "inscription", "memorial:text", "addr:city", "addr:postcode", "addr:state", "place",
}
CONTEXT_TAGS = KEEP_TAGS | {
    "building", "building:levels", "height", "roof:height", "natural", "water", "waterway",
    "barrier", "smoothness", "width", "incline", "step_count", "kerb", "tourism", "drinking_water", "bridge", "tunnel", "layer",
    "landuse", "leisure", "highway", "name", "leaf_type", "leaf_cycle", "maxspeed", "foot", "sac_scale",
}
MAJOR_ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary"}
PATHS = {"footway", "path", "pedestrian", "track", "steps", "bridleway", "cycleway", "residential", "living_street", "service"}
CARDINAL = {
    "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5,
    "SE": 135, "SSE": 157.5, "S": 180, "SSW": 202.5, "SW": 225,
    "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
}


def normalize_location_key(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(character for character in normalized if not unicodedata.combining(character)).lower()


def parse_bool(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {"yes", "true", "1", "designated"}:
        return 1
    if normalized in {"no", "false", "0"}:
        return 0
    return None


def parse_direction(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    normalized = value.strip().upper()
    if normalized in CARDINAL:
        return CARDINAL[normalized]
    try:
        return float(normalized.rstrip("°")) % 360
    except ValueError:
        return None


def parse_height(tags: dict[str, str]) -> Optional[float]:
    value = tags.get("height")
    if value:
        try:
            normalized = value.lower().replace("meters", "").replace("meter", "").replace("m", "").strip()
            return max(0.0, min(300.0, float(normalized)))
        except ValueError:
            pass
    levels = tags.get("building:levels")
    if levels:
        try:
            return max(2.5, min(300.0, float(levels) * 3.1 + float(tags.get("roof:height", "0").rstrip("m") or 0)))
        except ValueError:
            pass
    return None


def context_kind(tags: dict[str, str]) -> Optional[str]:
    if tags.get("building") not in {None, "no"}:
        return "building"
    if tags.get("natural") == "tree":
        return "tree"
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in {"reservoir", "basin"}:
        return "water"
    if tags.get("natural") == "wood" or tags.get("landuse") == "forest":
        return "forest"
    if tags.get("highway") in MAJOR_ROADS:
        return "major_road"
    if tags.get("highway") in PATHS:
        return "path"
    if tags.get("barrier") not in {None, "no"}:
        return "barrier"
    if tags.get("amenity") in {"toilets", "drinking_water", "fountain", "shelter"}:
        return tags["amenity"]
    if tags.get("leisure") in {"picnic_table", "playground"}:
        return tags["leisure"]
    if tags.get("amenity") == "fireplace" or tags.get("leisure") == "firepit":
        return "fireplace"
    if tags.get("amenity") == "waste_basket":
        return "waste_basket"
    return None


def score_view(openness: float, relief: float, water: float, naturalness: float, remoteness: float) -> int:
    values = [max(0.0, min(1.0, item)) for item in (openness, relief, water, naturalness, remoteness)]
    return round(100 * (0.35 * values[0] + 0.25 * values[1] + 0.15 * values[2] + 0.15 * values[3] + 0.10 * values[4]))


def bench_environment_hints(raw_tags: object) -> dict[str, float]:
    """Read optional human impressions stored with the normal bench record."""
    try:
        tags = json.loads(str(raw_tags or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    hints = tags.get("environment_hints") if isinstance(tags, dict) else None
    if not isinstance(hints, dict):
        return {}
    return {
        key: max(0.0, min(1.0, float(value)))
        for key, value in hints.items()
        if key in {"openness", "relief", "water", "naturalness", "remoteness"}
        and isinstance(value, (int, float))
    }


def apply_environment_hints(
    components: dict[str, float], raw_tags: object, weight: float = 0.4,
) -> dict[str, float]:
    """Blend local impressions into geometric estimates without replacing them."""
    result = dict(components)
    for key, hint in bench_environment_hints(raw_tags).items():
        current = result.get(key)
        result[key] = hint if current is None else (1 - weight) * current + weight * hint
    return result
