"""Import OSM benches and their nearby environmental context."""

from __future__ import annotations

import json
import sqlite3
import sys
import unicodedata
import urllib.parse
from pathlib import Path
from typing import Optional

from pydantic.dataclasses import dataclass

from benchly.benches.repository import (
    add_media,
    deactivate_stale_osm_benches,
    invalidate_enrichment,
    remove_demo_benches,
    replace_exact_imported_media,
    upsert_osm_benches,
)
from benchly.context.repository import discard_old_osm_context, upsert_environment_features
from benchly.benches.domain import CONTEXT_TAGS, KEEP_TAGS, context_kind, parse_bool, parse_direction, parse_height
from benchly.context.geometry import (
    feature_bounds_wgs84,
    geometry_wkb_from_coordinates,
    project_wgs84_wkb,
)
from benchly.runtime import now_iso

@dataclass
class ImportedBench:
    osm_type: str
    osm_id: int
    latitude: float
    longitude: float
    tags: dict[str, str]


@dataclass
class ImportedContext:
    osm_type: str
    osm_id: int
    kind: str
    center_latitude: float
    center_longitude: float
    min_latitude: float
    max_latitude: float
    min_longitude: float
    max_longitude: float
    tags: dict[str, str]
    geometry_wkb: Optional[bytes]


def import_osm(connection: sqlite3.Connection, pbf_path: Path, source_version: str = "local") -> tuple[int, int]:
    try:
        import osmium
    except ImportError as error:
        raise RuntimeError("The OSM import requires `pip install -r worker/requirements.txt`.") from error

    # Scheduled workers can briefly start against a database created by the
    # previous web image. Keep the refresh compatible with that schema while
    # still preserving direct edits as soon as the migration is present.
    metadata_edits_available = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='bench_metadata_edits'"
    ).fetchone()
    # Demo records make a fresh UI useful, but must never survive the first real import.
    remove_demo_benches(connection)
    connection.commit()
    imported_at = now_iso()
    pending: list[ImportedBench] = []
    pending_context: list[ImportedContext] = []
    total = 0
    context_total = 0

    def flush() -> None:
        nonlocal total
        if not pending:
            return
        rows = []
        for bench in pending:
            tags = bench.tags
            location_name = tags.get("addr:city") or tags.get("place")
            location_key = ("".join(character for character in unicodedata.normalize("NFKD", location_name or "") if not unicodedata.combining(character))).lower() or None
            rows.append({
                "id": f"osm-{bench.osm_type}-{bench.osm_id}",
                "osm_type": bench.osm_type,
                "osm_id": bench.osm_id,
                "latitude": bench.latitude,
                "longitude": bench.longitude,
                "backrest": parse_bool(tags.get("backrest")),
                "armrest": parse_bool(tags.get("armrest")),
                "covered": parse_bool(tags.get("covered")),
                "wheelchair": parse_bool(tags.get("wheelchair")),
                "seats": int(tags["seats"]) if tags.get("seats", "").isdigit() else None,
                "material": tags.get("material"),
                "direction_degrees": parse_direction(tags.get("direction")),
                "operator": tags.get("operator"),
                "description": tags.get("description"),
                "raw_tags": json.dumps(tags, ensure_ascii=False, separators=(",", ":")),
                "active": 1,
                "source_updated_at": imported_at,
                "imported_at": imported_at,
                "name": tags.get("name"),
                "dedication": tags.get("inscription") or tags.get("memorial:text"),
                "location_name": location_name,
                "location_key": location_key,
                "location_postcode": tags.get("addr:postcode"),
                "location_canton": tags.get("addr:state"),
            })
        upsert_osm_benches(connection, rows, preserve_edits=bool(metadata_edits_available))
        for bench in pending:
            bench_id = f"osm-{bench.osm_type}-{bench.osm_id}"
            row = connection.execute("SELECT row_id FROM benches WHERE id=?", (bench_id,)).fetchone()
            if not row:
                continue
            replace_exact_imported_media(connection, row["row_id"])
            media_rows: list[dict[str, object]] = []
            image_url = bench.tags.get("image")
            if image_url and image_url.startswith(("https://", "http://")):
                media_rows.append({
                    "bench_row_id": row["row_id"],
                    "relation": "exact",
                    "provider": "OpenStreetMap image",
                    "external_id": image_url,
                    "source_url": image_url,
                    "thumbnail_url": image_url,
                    "title": "Bild der Sitzbank",
                    "fetched_at": imported_at,
                })
            commons = bench.tags.get("wikimedia_commons")
            if commons and commons.lower().startswith("file:"):
                filename = commons.split(":", 1)[1]
                encoded = urllib.parse.quote(filename.replace(" ", "_"))
                media_rows.append({
                    "bench_row_id": row["row_id"],
                    "relation": "exact",
                    "provider": "Wikimedia Commons",
                    "external_id": commons,
                    "source_url": f"https://commons.wikimedia.org/wiki/File:{encoded}",
                    "thumbnail_url": f"https://commons.wikimedia.org/wiki/Special:Redirect/file/{encoded}?width=800",
                    "title": filename,
                    "fetched_at": imported_at,
                })
            add_media(connection, media_rows)
        connection.commit()
        total += len(rows)
        pending.clear()

    def flush_context() -> None:
        nonlocal context_total
        if not pending_context:
            return
        rows = []
        for item in pending_context:
            tags = item.tags
            rows.append({
                "source": "OpenStreetMap",
                "source_id": f"{item.osm_type}-{item.osm_id}",
                "kind": item.kind,
                "subtype": tags.get("building") or tags.get("natural") or tags.get("water") or tags.get("highway") or tags.get("landuse"),
                "center_latitude": item.center_latitude,
                "center_longitude": item.center_longitude,
                "min_latitude": item.min_latitude,
                "max_latitude": item.max_latitude,
                "min_longitude": item.min_longitude,
                "max_longitude": item.max_longitude,
                "height_meters": parse_height(tags),
                "raw_tags": json.dumps(tags, ensure_ascii=False, separators=(",", ":")),
                "imported_at": imported_at,
                "geometry_wkb": item.geometry_wkb,
                "geometry_crs": 2056,
                "source_version": source_version,
                "source_updated_at": imported_at,
            })
        upsert_environment_features(connection, rows)
        connection.commit()
        context_total += len(rows)
        pending_context.clear()

    class BenchHandler(osmium.SimpleHandler):
        def _append(self, osm_type: str, osm_id: int, latitude: float, longitude: float, tags) -> None:
            if not (45.7 <= latitude <= 47.9 and 5.7 <= longitude <= 10.7):
                return
            clean_tags = {tag.k: tag.v for tag in tags if tag.k in KEEP_TAGS}
            pending.append(ImportedBench(osm_type, int(osm_id), latitude, longitude, clean_tags))
            if len(pending) >= 1000:
                flush()

        def _append_context(self, osm_type: str, osm_id: int, coordinates, tags, geometry_wkb: Optional[bytes] = None) -> None:
            clean_tags = {tag.k: tag.v for tag in tags if tag.k in CONTEXT_TAGS}
            kind = context_kind(clean_tags)
            if not kind or not coordinates:
                return
            latitudes = [point[0] for point in coordinates]
            longitudes = [point[1] for point in coordinates]
            if max(latitudes) < 45.7 or min(latitudes) > 47.9 or max(longitudes) < 5.7 or min(longitudes) > 10.7:
                return
            pending_context.append(ImportedContext(
                osm_type, int(osm_id), kind,
                sum(latitudes) / len(latitudes), sum(longitudes) / len(longitudes),
                min(latitudes), max(latitudes), min(longitudes), max(longitudes), clean_tags,
                geometry_wkb or geometry_wkb_from_coordinates(
                    coordinates, kind,
                    len(coordinates) >= 4 and coordinates[0] == coordinates[-1],
                ),
            ))
            if len(pending_context) >= 2000:
                flush_context()

        def node(self, node) -> None:
            if node.tags.get("amenity") == "bench" and node.location.valid():
                self._append("node", node.id, node.location.lat, node.location.lon, node.tags)
            if node.location.valid() and node.tags.get("natural") == "tree":
                self._append_context("node", node.id, [(node.location.lat, node.location.lon)], node.tags)

        def way(self, way) -> None:
            locations = [(node.lat, node.lon) for node in way.nodes if node.location.valid()]
            if way.tags.get("amenity") == "bench" and locations:
                self._append("way", way.id, sum(p[0] for p in locations) / len(locations), sum(p[1] for p in locations) / len(locations), way.tags)
            self._append_context("way", way.id, locations, way.tags)

        def area(self, area) -> None:
            clean_tags = {tag.k: tag.v for tag in area.tags if tag.k in CONTEXT_TAGS}
            if not context_kind(clean_tags):
                return
            try:
                factory = osmium.geom.WKBFactory()
                geometry = project_wgs84_wkb(factory.create_multipolygon(area))
                # Area IDs distinguish relation-derived areas from way callbacks.
                bounds = feature_bounds_wgs84(geometry)
                coordinates = [(bounds[1], bounds[0]), (bounds[3], bounds[2])]
                self._append_context("area", area.id, coordinates, area.tags, geometry)
            except Exception as error:
                print(f"Skipping invalid OSM area {area.id}: {error}", file=sys.stderr)

    BenchHandler().apply_file(str(pbf_path), locations=True)
    flush()
    flush_context()
    deactivate_stale_osm_benches(connection, imported_at)
    discard_old_osm_context(connection, imported_at)
    invalidate_enrichment(connection, environment=True)
    connection.commit()
    return total, context_total
