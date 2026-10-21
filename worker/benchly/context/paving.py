"""Qualify surveyed ground-level paving without inferring a road's finish."""
from __future__ import annotations

from dataclasses import dataclass
from functools import reduce
import math
import hashlib

from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry


PAVING_SOURCE = "SITG-paved-ground"
PAVING_DATASET = "CAD_DOMROUTIER_REVET_NIV0"
PAVED_FINISHES = frozenset({"Béton", "Béton bitumineux", "Pavés"})


@dataclass(frozen=True)
class PavedSurface:
    source_id: str
    parent_surface_id: str
    geometry: BaseGeometry
    finish: str
    updated_milliseconds: int | None


def sitg_paved_surfaces(payload: dict) -> tuple[PavedSurface, ...]:
    """Read a complete ESRI JSON query in LV95, preserving holes and islands.

    Generic OTEMO road/path polygons do not establish paving. Neither do
    traffic islands, parking labels, building proximity or unspecified finishes.
    Only the explicit finish of a ground-level surveyed surface qualifies.
    """
    reference = payload.get("spatialReference", {})
    if reference.get("latestWkid", reference.get("wkid")) != 2056:
        raise ValueError("SITG paving requires EPSG:2056 coordinates")
    if payload.get("geometryType") != "esriGeometryPolygon" or payload.get("exceededTransferLimit"):
        raise ValueError("SITG paving requires a complete polygon query")
    result = []
    seen = set()
    for feature in payload.get("features", []):
        attributes = feature.get("attributes", {})
        level, finish = attributes.get("NIVEAU"), attributes.get("REVETEMENT")
        if type(level) is not int or level != 0 or finish not in PAVED_FINISHES:
            continue
        identity = attributes.get("ID_SURFACE")
        if type(identity) is not int or identity <= 0:
            raise ValueError("SITG paving requires positive surface identifiers")
        rings = feature.get("geometry", {}).get("rings", [])
        if not rings:
            raise ValueError("SITG paving surface has no polygon rings")
        polygons = []
        for ring in rings:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("SITG paving ring must be explicitly closed")
            if any(len(point) != 2 or any(type(value) not in (int, float) or not math.isfinite(value)
                       for value in point) or not (2_300_000 <= point[0] <= 2_900_000
                       and 1_000_000 <= point[1] <= 1_400_000) for point in ring):
                raise ValueError("SITG paving has invalid LV95 coordinates")
            polygon = Polygon(ring)
            if not polygon.is_valid or polygon.area <= 0:
                raise ValueError("SITG paving ring is invalid")
            # Ring parity represents holes and islands. Crossing shells are
            # invalid source topology; XOR must not silently repair them.
            for previous in polygons:
                if previous.intersection(polygon).area > 0 and not (
                        previous.covers(polygon) or polygon.covers(previous)):
                    raise ValueError("SITG paving rings overlap without nesting")
            polygons.append(polygon)
        geometry = reduce(lambda first, second: first.symmetric_difference(second), polygons)
        if not geometry.is_valid or geometry.is_empty:
            raise ValueError("SITG paving polygon topology is invalid")
        updated = attributes.get("DATEDT")
        if updated is not None and (type(updated) is not int or not 0 <= updated < 4_102_444_800_000):
            raise ValueError("SITG paving treatment date is invalid")
        # ID_SURFACE groups an object that can have several finish polygons.
        # Bind each component to its normalized measured geometry and finish;
        # the service's mutable OBJECTID is not a permanent identifier.
        component = hashlib.sha256(finish.encode() + b"\0" + geometry.normalize().wkb).hexdigest()
        source_id = f"{identity}:{component}"
        if source_id in seen:
            raise ValueError("SITG paving query repeats a surface component")
        seen.add(source_id)
        result.append(PavedSurface(source_id, str(identity), geometry, finish, updated))
    return tuple(result)
