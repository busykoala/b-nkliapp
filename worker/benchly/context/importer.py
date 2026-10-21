"""Import validated official Swiss vector datasets into context tables."""

from __future__ import annotations

import json
import math
import sqlite3
import unicodedata
from pathlib import Path
from typing import Optional

from benchly.benches.repository import invalidate_enrichment
from benchly.context.repository import (
    discard_old_official_generation,
    upsert_environment_features,
    upsert_land_cover,
)
from benchly.benches.domain import parse_height
from benchly.context.geometry import (
    WGS84_TO_LV95,
    building_footprint_wkb_from_geojson,
    classify_official_layer,
    feature_bounds_wgs84,
    geopackage_layers,
    geometry_wkb_from_geojson,
    iter_layer_features,
)
from benchly.runtime import now_iso

def _geometry_z_values(value: object) -> list[float]:
    output: list[float] = []
    if isinstance(value, (list, tuple)):
        if len(value) >= 3 and all(isinstance(item, (int, float)) for item in value[:3]):
            output.append(float(value[2]))
        else:
            for item in value:
                output.extend(_geometry_z_values(item))
    return output


def _property_number(properties: dict, *tokens: str) -> Optional[float]:
    for key, value in properties.items():
        normalized = unicodedata.normalize("NFKD", str(key)).encode("ascii", "ignore").decode().lower()
        if all(token in normalized for token in tokens):
            try:
                number = float(value)
                if math.isfinite(number):
                    return number
            except (TypeError, ValueError):
                continue
    return None


def _measured_roof_faces(geometry: dict, eaves: float | None) -> list:
    """Retain real roof planes from the solid, excluding floors/vertical walls."""
    if eaves is None or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        return []
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    result = []
    for polygon in polygons:
        ring = polygon[0]
        if len(ring) < 4 or any(len(point) < 3 for point in ring):
            continue
        vertices = []
        for point in ring[:-1]:
            if not all(math.isfinite(value) for value in point[:3]):
                break
            east, north = WGS84_TO_LV95.transform(*point[:2])
            vertices.append((round(east, 3), round(north, 3), round(point[2], 3)))
        else:
            for second, third in zip(vertices[1:], vertices[2:]):
                face = (vertices[0], second, third)
                # Building_solid is triangulated. Nonvertical upper faces are
                # roof evidence; floor and wall triangles must not become roofs.
                area = abs((second[0] - face[0][0]) * (third[1] - face[0][1]) -
                           (second[1] - face[0][1]) * (third[0] - face[0][0]))
                if area > .02 and min(point[2] for point in face) >= eaves - .5:
                    result.append(face)
    return result if len(result) <= 4096 else []


def import_swissbuildings_gdb(connection: sqlite3.Connection, geodatabase: Path,
                              source_version: str, imported_at: str, source_prefix: str = "archive") -> dict[str, int]:
    layers = [layer for layer in geopackage_layers(geodatabase) if "building_solid" in layer.lower()]
    if not layers:
        raise RuntimeError(f"No Building_solid layer found in {geodatabase}")
    stats = {"building": 0, "skipped": 0}
    batch: list[dict[str, object]] = []

    def flush() -> None:
        if not batch:
            return
        upsert_environment_features(connection, batch)
        connection.commit()
        batch.clear()

    for layer in layers:
        # Building solids are TINs; GeoJSON cannot represent them directly.
        # Keep the triangular faces and their Z coordinates for footprint/height.
        for offset, feature in enumerate(iter_layer_features(geodatabase, layer, geometry_type="MULTIPOLYGONZ")):
            geometry_json = feature.get("geometry")
            properties = feature.get("properties") or {}
            if not geometry_json:
                stats["skipped"] += 1
                continue
            try:
                geometry = building_footprint_wkb_from_geojson(geometry_json)
                min_lon, min_lat, max_lon, max_lat = feature_bounds_wgs84(geometry)
            except Exception:
                stats["skipped"] += 1
                continue
            if max_lat < 45.7 or min_lat > 47.9 or max_lon < 5.7 or min_lon > 10.7:
                continue
            heights = _geometry_z_values(geometry_json.get("coordinates"))
            # The solid may extend below the terrain into a basement. Official
            # terrain/roof attributes share the source height datum and take
            # precedence over its extrema.
            ground = _property_number(properties, "gelaende", "punkt")
            if ground is None:
                ground = _property_number(properties, "boden", "kote")
            if ground is None and heights:
                ground = min(heights)
            roof = _property_number(properties, "dach", "max")
            if roof is None:
                roof = max(heights) if heights else _property_number(properties, "max", "kote")
            eaves = _property_number(properties, "dach", "min") or _property_number(properties, "trauf")
            if eaves is not None and ((ground is not None and eaves < ground) or (roof is not None and eaves > roof)):
                eaves = None
            height = roof - ground if roof is not None and ground is not None else _property_number(properties, "gebaude", "hohe")
            if height is not None and not 1.5 <= height <= 300:
                height = None
            source_id_value = feature.get("id") or properties.get("EGID") or properties.get("egid") or properties.get("UUID") or properties.get("uuid") or offset
            source_id = f"{source_prefix}:{layer}:{source_id_value}"
            compact_tags = {str(key): value for key, value in properties.items() if str(key).lower() in {"egid", "uuid", "objektart", "objecttype", "name"}}
            roof_faces = _measured_roof_faces(geometry_json, eaves)
            if roof_faces:
                compact_tags["benchly:roof_mesh"] = {"version": 1, "crs": 2056, "faces": roof_faces}
            batch.append({
                "source": "swissBUILDINGS3D",
                "source_id": source_id,
                "kind": "building",
                "subtype": "solid",
                "center_latitude": (min_lat + max_lat) / 2,
                "center_longitude": (min_lon + max_lon) / 2,
                "min_latitude": min_lat,
                "max_latitude": max_lat,
                "min_longitude": min_lon,
                "max_longitude": max_lon,
                "height_meters": height,
                "raw_tags": json.dumps(compact_tags, ensure_ascii=False, separators=(",", ":")),
                "imported_at": imported_at,
                "geometry_wkb": geometry,
                "geometry_crs": 2056,
                "source_version": source_version,
                "source_updated_at": imported_at,
                "ground_elevation_meters": ground,
                "eaves_elevation_meters": eaves,
                "roof_elevation_meters": roof,
            })
            stats["building"] += 1
            if len(batch) >= 1000:
                flush()
    flush()
    return stats


def import_swisstlm_geopackage(
    connection: sqlite3.Connection,
    geopackage: Path,
    source_version: str,
    imported_at: Optional[str] = None,
    finalize: bool = True,
) -> dict[str, int]:
    imported_at = imported_at or now_iso()
    stats = {"building": 0, "forest": 0, "water": 0, "land_cover": 0, "skipped": 0}
    batch: list[dict[str, object]] = []
    land_batch: list[dict[str, object]] = []

    def flush() -> None:
        if batch:
            upsert_environment_features(connection, batch)
            batch.clear()
        if land_batch:
            upsert_land_cover(connection, land_batch)
            land_batch.clear()
        connection.commit()

    for layer in geopackage_layers(geopackage):
        layer_hint, _ = classify_official_layer(layer, {})
        if layer_hint is None and not any(token in layer.lower() for token in ("wald", "wasser", "gewaesser", "gebäude", "gebaeude", "bodenbedeck", "landcover")):
            continue
        for offset, feature in enumerate(iter_layer_features(geopackage, layer)):
            geometry_json = feature.get("geometry")
            properties = feature.get("properties") or {}
            table, kind_or_class = classify_official_layer(layer, properties)
            if not geometry_json or not table or not kind_or_class:
                stats["skipped"] += 1
                continue
            try:
                geometry = geometry_wkb_from_geojson(geometry_json)
                min_lon, min_lat, max_lon, max_lat = feature_bounds_wgs84(geometry)
            except Exception:
                stats["skipped"] += 1
                continue
            if max_lat < 45.7 or min_lat > 47.9 or max_lon < 5.7 or min_lon > 10.7:
                continue
            raw_source_id = feature.get("id") or properties.get("UUID") or properties.get("uuid") or offset
            source_id = f"{layer}:{raw_source_id}"
            if table == "land_cover":
                land_batch.append({
                    "source": "swissTLM3D",
                    "source_id": source_id,
                    "cover_class": kind_or_class,
                    "geometry_wkb": geometry,
                    "geometry_crs": 2056,
                    "min_latitude": min_lat,
                    "max_latitude": max_lat,
                    "min_longitude": min_lon,
                    "max_longitude": max_lon,
                    "source_version": source_version,
                    "source_updated_at": imported_at,
                    "imported_at": imported_at,
                })
                stats["land_cover"] += 1
            else:
                height = parse_height({str(key).lower(): str(value) for key, value in properties.items() if value is not None})
                batch.append({
                    "source": "swissTLM3D",
                    "source_id": source_id,
                    "kind": kind_or_class,
                    "subtype": kind_or_class,
                    "center_latitude": (min_lat + max_lat) / 2,
                    "center_longitude": (min_lon + max_lon) / 2,
                    "min_latitude": min_lat,
                    "max_latitude": max_lat,
                    "min_longitude": min_lon,
                    "max_longitude": max_lon,
                    "height_meters": height,
                    "raw_tags": json.dumps(properties, ensure_ascii=False, separators=(",", ":")),
                    "imported_at": imported_at,
                    "geometry_wkb": geometry,
                    "geometry_crs": 2056,
                    "source_version": source_version,
                    "source_updated_at": imported_at,
                })
                stats[kind_or_class] += 1
            if len(batch) + len(land_batch) >= 1000:
                flush()
    flush()
    if finalize:
        finalize_swisstlm_import(connection, imported_at)
    return stats


def finalize_swisstlm_import(connection: sqlite3.Connection, imported_at: str) -> None:
    """Publish one complete swissTLM generation after every archive part was imported."""
    discard_old_official_generation(connection, imported_at)
    invalidate_enrichment(connection, environment=True)
    connection.commit()
