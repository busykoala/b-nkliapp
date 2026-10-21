"""Qualify existing cadastral cover without guessing a road's finish."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import math

from shapely import from_wkb
from shapely.errors import ShapelyError
from shapely.geometry.base import BaseGeometry


MOPUBE_SOURCE = "BE-MOPUBE-ground-cover"
# Cadastral BBF class names/codes, not the projected BBPRJF layer. A road
# includes unpaved paths; this deliberately never qualifies PAVED_GROUND.
MOPUBE_CLASSES = {
    1: ("Strasse, Weg", "surfaced_ground"),
    2: ("Trottoir", "surfaced_ground"),
    7: ("übrige befestigte", "surfaced_ground"),
    8: ("Acker, Wiese, Weide", "open_grassland"),
}
MOPUBE_SEMANTICS = frozenset(value[1] for value in MOPUBE_CLASSES.values())


@dataclass(frozen=True)
class GroundCoverSurface:
    source_id: str
    class_code: int
    source_label: str
    semantic: str
    geometry: BaseGeometry
    updated_at: str | None


def mopube_ground_surfaces(records: list[dict]) -> tuple[GroundCoverSurface, ...]:
    """Read a verified LV95 BBF extract, retaining its actual polygon topology.

    Only AV93-quality measured cover is adopted. Gardens, traffic islands,
    vegetation, water and buildings remain outside this bounded extension:
    none establishes the finish of its ground. There is no geometry repair,
    guessed road width, or inference from proximity to a building.
    """
    result, seen = [], set()
    for record in records:
        code = record.get("art")
        if type(code) is not int or code not in MOPUBE_CLASSES:
            continue
        label, semantic = MOPUBE_CLASSES[code]
        if record.get("bbartt_bez_de") != label:
            raise ValueError("MOPUBE cover code/label mismatch")
        if type(record.get("qualitaet")) is not int or record["qualitaet"] != 0 or record.get("qualit_bez_de") != "AV93":
            continue
        identity = record.get("bbfid")
        if not isinstance(identity, str) or not identity or identity in seen:
            raise ValueError("MOPUBE requires unique BBFID identities")
        seen.add(identity)
        try:
            geometry = from_wkb(bytes.fromhex(record["geometry_wkb"]))
        except (KeyError, TypeError, ValueError, ShapelyError) as error:
            raise ValueError("MOPUBE requires WKB polygon geometry") from error
        if (geometry.geom_type not in {"Polygon", "MultiPolygon"} or
                not geometry.is_valid or geometry.is_empty or geometry.has_z or geometry.area <= 0):
            raise ValueError("MOPUBE cover polygon is invalid")
        x0, y0, x1, y1 = geometry.bounds
        if not (all(math.isfinite(value) for value in geometry.bounds) and
                2_300_000 <= x0 <= x1 <= 2_900_000 and 1_000_000 <= y0 <= y1 <= 1_400_000):
            raise ValueError("MOPUBE requires finite LV95 coordinates")
        updated = record.get("guelteintr")
        if updated is not None:
            try:
                datetime.fromisoformat(updated)
            except (TypeError, ValueError) as error:
                raise ValueError("MOPUBE cover date is invalid") from error
        result.append(GroundCoverSurface(identity, code, label, semantic, geometry, updated))
    return tuple(result)
