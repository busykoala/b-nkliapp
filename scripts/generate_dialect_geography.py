#!/usr/bin/env python3
"""Build licensed, reproducible dialect-area geometry from swissBOUNDARIES3D.

Only municipalities explicitly named as anchors in the research catalogue are
assigned. Locality-only exceptions stay in the resolver; gaps deliberately fall
back to the conservative language-area resolver instead of invented polygons.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import struct
import unicodedata
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely import from_wkb
from shapely.geometry import Point, Polygon, mapping
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "config/dialects/catalogue.json"
DEFAULT_SOURCE = ROOT / "data/sources/dialects/swissboundaries3d_2026-01/swissBOUNDARIES3D_1_5_LV95_LN02.gpkg"
OUTPUT = ROOT / "config/dialects/areas.generated.json"
SOURCE_SHA256 = "68e922353c76fa5db3cef06a32f9711c0198faa6fbd2b5bcde9edc88b0f8999f"
BFS_LANGUAGE_ROOT = ROOT / "data/sources/dialects/bfs-language-areas-2020/shapefile"
BFS_LANGUAGE_SHP = BFS_LANGUAGE_ROOT / "K4sprg20220501gf_ch2007Poly.shp"
BFS_LANGUAGE_DBF = BFS_LANGUAGE_ROOT / "K4sprg20220501gf_ch2007Poly.dbf"
BFS_ARCHIVE_SHA256 = "2ac8a8d68929f63c5f3f2ed5dee72c3c3a3fc4a64077072fcade53135f2191a6"


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(character for character in value if not unicodedata.combining(character))
    value = re.sub(r"\([^)]*\)", " ", value.casefold())
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def anchor_aliases(anchor: str) -> set[str]:
    stripped = re.sub(r"\([^)]*\)", " ", anchor)
    return {alias for value in (anchor, stripped, *stripped.split("/")) if (alias := normalize(value))}


def gpkg_wkb(blob: bytes) -> bytes:
    if blob[:2] != b"GP":
        return blob
    flags = blob[3]
    envelope_indicator = (flags >> 1) & 0b111
    envelope_doubles = {0: 0, 1: 4, 2: 6, 3: 6, 4: 8}.get(envelope_indicator)
    if envelope_doubles is None:
        raise ValueError(f"Unsupported GeoPackage envelope indicator: {envelope_indicator}")
    return blob[8 + envelope_doubles * struct.calcsize("d") :]


def source_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dbf_records(path: Path) -> list[dict[str, str]]:
    data = path.read_bytes()
    record_count = struct.unpack_from("<I", data, 4)[0]
    header_length, record_length = struct.unpack_from("<HH", data, 8)
    fields: list[tuple[str, int]] = []
    offset = 32
    while data[offset] != 0x0D:
        descriptor = data[offset : offset + 32]
        fields.append((descriptor[:11].split(b"\0", 1)[0].decode("ascii"), descriptor[16]))
        offset += 32
    records = []
    for index in range(record_count):
        record = data[header_length + index * record_length : header_length + (index + 1) * record_length]
        cursor = 1
        values: dict[str, str] = {}
        for name, length in fields:
            values[name] = record[cursor : cursor + length].decode("utf-8", errors="replace").strip()
            cursor += length
        records.append(values)
    return records


def ring_area(ring: list[tuple[float, float]]) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2


def shapefile_polygons(path: Path) -> list[object]:
    data = path.read_bytes()
    records: list[object] = []
    offset = 100
    while offset < len(data):
        _, content_words = struct.unpack_from(">II", data, offset)
        content = memoryview(data)[offset + 8 : offset + 8 + content_words * 2]
        shape_type = struct.unpack_from("<I", content, 0)[0]
        if shape_type != 5:
            raise ValueError(f"Expected Polygon shapefile record, got {shape_type}")
        part_count, point_count = struct.unpack_from("<II", content, 36)
        part_starts = list(struct.unpack_from(f"<{part_count}I", content, 44)) + [point_count]
        points_offset = 44 + part_count * 4
        points = [struct.unpack_from("<dd", content, points_offset + index * 16) for index in range(point_count)]
        rings = [points[part_starts[index] : part_starts[index + 1]] for index in range(part_count)]
        outer_sign = 1 if ring_area(max(rings, key=lambda ring: abs(ring_area(ring)))) > 0 else -1
        outers = [ring for ring in rings if (1 if ring_area(ring) > 0 else -1) == outer_sign]
        holes = [ring for ring in rings if ring not in outers]
        polygons = []
        for outer in outers:
            shell = Polygon(outer)
            contained = [hole for hole in holes if shell.covers(Point(hole[0]))]
            polygons.append(Polygon(outer, contained))
        records.append(unary_union(polygons))
        offset += 8 + content_words * 2
    return records


def bfs_language_areas(to_wgs84, municipality_geometries: list[object]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    if not BFS_LANGUAGE_SHP.exists() or not BFS_LANGUAGE_DBF.exists():
        raise SystemExit(f"Missing BFS language-area shapefile under {BFS_LANGUAGE_ROOT}")
    archive = BFS_LANGUAGE_ROOT.parent / "theme-kart.zip"
    if archive.exists() and source_digest(archive) != BFS_ARCHIVE_SHA256:
        raise SystemExit("BFS ThemaKart archive checksum does not match the pinned source")
    languages = {"1": "de", "2": "fr", "3": "it", "4": "rm"}
    records = dbf_records(BFS_LANGUAGE_DBF)
    polygons = shapefile_polygons(BFS_LANGUAGE_SHP)
    if len(records) != len(polygons) or set(record["id"] for record in records) != set(languages):
        raise SystemExit("Unexpected BFS language-area structure")
    source_areas = [(languages[record["id"]], record["name"], transform(to_wgs84, polygon)) for record, polygon in zip(records, polygons)]
    assigned: dict[str, list[object]] = defaultdict(list)
    for municipality in municipality_geometries:
        sample = municipality.representative_point()
        candidates = [item for item in source_areas if item[2].covers(sample)]
        if not candidates:
            candidates = sorted(source_areas, key=lambda item: municipality.intersection(item[2]).area, reverse=True)[:1]
        assigned[candidates[0][0]].append(municipality)
    updated = [{
        "type": "Feature",
        "properties": {"language": language, "name": name, "sourceVersion": "sprg20220501", "municipalityCount": len(assigned[language])},
        "geometry": mapping(unary_union(assigned[language]).simplify(0.00015, preserve_topology=True)),
    } for language, name, _ in source_areas]
    source = [{
        "type": "Feature",
        "properties": {"language": language, "name": name, "sourceVersion": "sprg20220501"},
        "geometry": mapping(geometry.simplify(0.00015, preserve_topology=True)),
    } for language, name, geometry in source_areas]
    return updated, source


def build(source: Path) -> dict[str, object]:
    if not source.exists():
        raise SystemExit(f"Missing source GeoPackage: {source}")
    archive = source.parent / "source.gpkg.zip"
    if archive.exists() and source_digest(archive) != SOURCE_SHA256:
        raise SystemExit("swissBOUNDARIES3D archive checksum does not match the pinned STAC asset")

    catalogue = json.loads(CATALOGUE.read_text())
    connection = sqlite3.connect(source)
    rows = connection.execute(
        "select bfs_nummer, name, icc, geom from tlm_hoheitsgebiet where objektart = 'Gemeindegebiet'"
    ).fetchall()
    country_row = connection.execute(
        "select geom from tlm_landesgebiet where icc = 'CH'"
    ).fetchone()
    connection.close()
    if country_row is None:
        raise SystemExit("swissBOUNDARIES3D source has no CH national territory")
    municipalities = {normalize(row[1]): row for row in rows}
    transformer = Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)

    def to_wgs84(x, y, z=None):  # noqa: ARG001 - intentionally discard source elevation
        return transformer.transform(x, y)

    geometries: dict[str, list[object]] = defaultdict(list)
    assignments: dict[str, list[dict[str, object]]] = defaultdict(list)
    unresolved: dict[str, list[str]] = defaultdict(list)
    country_parts = []
    decoded: dict[int, object] = {}

    def geometry(row: tuple[object, ...]):
        bfs = int(row[0])
        if bfs not in decoded:
            decoded[bfs] = transform(to_wgs84, from_wkb(gpkg_wkb(row[3])))
        return decoded[bfs]

    for row in rows:
        country_parts.append(geometry(row))

    for area in catalogue["areas"]:
        seen_bfs: set[int] = set()
        for anchor in area["anchors"]:
            matches = {municipalities[alias] for alias in anchor_aliases(anchor) if alias in municipalities}
            if not matches:
                unresolved[area["id"]].append(anchor)
            for row in matches:
                bfs = int(row[0])
                if bfs in seen_bfs:
                    continue
                seen_bfs.add(bfs)
                geometries[area["id"]].append(geometry(row))
                assignments[area["id"]].append({"bfsId": bfs, "name": row[1]})

    features = []
    for area in catalogue["areas"]:
        parts = geometries.get(area["id"], [])
        if not parts:
            continue
        # ~16 m tolerance: small enough for border benches, large enough for a compact build artifact.
        merged = unary_union(parts).simplify(0.00015, preserve_topology=True)
        features.append({
            "type": "Feature",
            "properties": {
                "areaId": area["id"],
                "source": "swissBOUNDARIES3D",
                "sourceVersion": "2026-01",
                "municipalities": sorted(assignments[area["id"]], key=lambda item: int(item["bfsId"])),
            },
            "geometry": mapping(merged),
        })

    # The national territory explicitly includes Switzerland's lake shares and
    # keeps benches on piers/shorelines inside CH. A municipality union can
    # otherwise leave those water-edge points outside after simplification.
    country = transform(to_wgs84, from_wkb(gpkg_wkb(country_row[0]))).simplify(0.00015, preserve_topology=True)
    language_areas, language_area_fallbacks = bfs_language_areas(to_wgs84, country_parts)
    return {
        "type": "FeatureCollection",
        "metadata": {
            "schemaVersion": "1.0.1",
            "generatedFrom": "swissBOUNDARIES3D_2026-01",
            "sourceUrl": "https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d",
            "sourceArchiveSha256": SOURCE_SHA256,
            "bfsSourceArchiveSha256": BFS_ARCHIVE_SHA256,
            "sourcesRetrieved": "2026-09-13",
            "bfsSourceUrl": "https://dam-api.bfs.admin.ch/hub/api/dam/assets/36390072/master",
            "license": "swissBOUNDARIES3D: Open Government Data / FSDI terms; BFS ThemaKart: reproduction with attribution for non-commercial use",
            "catalogueVersion": f"{catalogue['schemaVersion']}-{catalogue['researchDate']}",
            "method": "union-of-explicit-current-municipality-anchors",
            "territorySource": "swissBOUNDARIES3D:tlm_landesgebiet:CH",
            "languageAreaMethod": "BFS-sprg20220501-crosswalk-to-swissBOUNDARIES3D-2026-with-0.0005-degree-seam-tolerance",
            "areaCount": len(features),
            "unresolvedAnchors": unresolved,
        },
        "territory": mapping(country),
        "languageAreas": language_areas,
        "languageAreaFallbacks": language_area_fallbacks,
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    encoded = json.dumps(build(args.source), ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != encoded:
            raise SystemExit("Dialect geography artifact is stale; run scripts/generate_dialect_geography.py")
        print(f"Dialect geography is current ({json.loads(encoded)['metadata']['areaCount']} areas)")
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(encoded)
    temporary.replace(OUTPUT)
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({json.loads(encoded)['metadata']['areaCount']} areas)")


if __name__ == "__main__":
    main()
