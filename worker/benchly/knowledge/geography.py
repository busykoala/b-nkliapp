"""Exact LV95 boundary joins; locality names are ranked separately, never administrative proof."""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
from sqlalchemy import delete
from shapely import from_wkb, to_wkb
from shapely.geometry import Point, shape
from shapely.ops import transform
from benchly.context.geometry import WGS84_TO_LV95, geopackage_layers, iter_layer_features
from benchly.db import write
from benchly.knowledge.models import Geography, PlaceFeature
from benchly.knowledge.repository import upsert
from benchly.runtime import now_iso

METHOD = "official-places-1"
LOCALITIES = {"2300": 0, "2301": 1, "2302": 2, "2303": 3, "1500": 0, "1501": 1, "1502": 2, "1503": 3,
              "ort": 0, "ortsteil": 1, "quartier": 2, "quartierteil": 3, "1101": 4, "lokalname swisstopo": 4}


@lru_cache(maxsize=4096)
def geometry(blob):
    return from_wkb(blob)


def identifier(value):
    if value is None or str(value).startswith("99999"):
        return None
    return str(int(value)) if isinstance(value, (int, float)) else str(value)


def import_places(database, path: Path, source: str, version: str):
    """Read GPKG/GDB through GDAL once. Swap generations only after a complete import."""
    imported = now_iso()
    count = 0
    for layer in geopackage_layers(path):
        upper = layer.upper()
        kind = "locality" if source == "swissNAMES3D" else (
            "municipality" if "HOHEITSGEBIET" in upper else "canton" if "KANTON" in upper else "district" if "BEZIRK" in upper else None)
        if kind is None:
            continue
        for feature in iter_layer_features(path, layer):
            props = {key.upper(): value for key, value in feature["properties"].items()}
            category = str(props.get("OBJEKTART", "")).lower()
            if kind == "locality" and category not in LOCALITIES:
                continue
            if kind == "municipality" and category not in {"0", "gemeindegebiet"}:
                continue  # cantonal lakes and communal territories are not municipalities
            name = props.get("NAME")
            source_id = props.get("UUID") or feature.get("id")
            if not name or source_id is None:
                continue
            original = shape(feature["geometry"])
            if original.is_empty or not original.is_valid:
                continue
            min_lon, min_lat, max_lon, max_lat = original.bounds
            projected = transform(WGS84_TO_LV95.transform, original)
            upsert(database, PlaceFeature, dict(source=source, source_id=f"{layer}:{source_id}", kind=kind, name=str(name),
                municipality_id=identifier(props.get("BFS_NUMMER")) if kind == "municipality" else None,
                canton_id=identifier(props.get("KANTONSNUMMER")), district_id=identifier(props.get("BEZIRKSNUMMER")),
                rank=LOCALITIES.get(category, 0), geometry_wkb=to_wkb(projected), min_lon=min_lon, max_lon=max_lon,
                min_lat=min_lat, max_lat=max_lat, source_version=version, source_updated_at=None, imported_at=imported), ["source", "source_id"])
            count += 1
    if not count:
        raise ValueError(f"No recognised {source} features; the existing generation was retained")
    write(database, delete(PlaceFeature).where(PlaceFeature.source == source, PlaceFeature.imported_at != imported))
    database.commit()
    geometry.cache_clear()
    return count


def enrich_geography(database, bench):
    lon, lat = bench["longitude"], bench["latitude"]
    point = Point(*WGS84_TO_LV95.transform(lon, lat))
    # Coarse RTree filter, then exact geometry distance/containment in metres.
    rows = database.execute("""SELECT p.* FROM official_place_spatial s JOIN official_place_features p ON p.id=s.id
      WHERE s.min_lon<=? AND s.max_lon>=? AND s.min_lat<=? AND s.max_lat>=?""",
      (lon + .04, lon - .04, lat + .027, lat - .027)).fetchall()
    if not rows:
        write(database, delete(Geography).where(Geography.bench_row_id == bench["row_id"]))
        return None
    selected = {}
    for kind in ("municipality", "canton", "district"):
        matches = [row for row in rows if row["kind"] == kind and geometry(row["geometry_wkb"]).covers(point)]
        # Border coordinates can be ambiguous. Retain unknown rather than choosing an arbitrary municipality.
        if len(matches) == 1:
            selected[kind] = matches[0]
    names = [(geometry(row["geometry_wkb"]).distance(point), row) for row in rows if row["kind"] == "locality"]
    names = [(distance, row) for distance, row in names if distance <= 2500]
    names.sort(key=lambda pair: (pair[0] + pair[1]["rank"] * 100, pair[1]["source_id"]))
    values = dict(bench_row_id=bench["row_id"], confidence="high" if "municipality" in selected else "unknown",
                  source_version=";".join(sorted({row["source"] + ":" + row["source_version"] for row in rows})),
                  method_version=METHOD, computed_at=now_iso())
    for kind in ("municipality", "canton", "district"):
        row = selected.get(kind)
        values[f"{kind}_id"] = row[f"{kind}_id"] if row else None
        values[f"{kind}_name"] = row["name"] if row else None
    values.update(locality_id=names[0][1]["source_id"] if names else None,
                  locality_name=names[0][1]["name"] if names else None,
                  locality_distance_meters=round(names[0][0], 1) if names else None)
    upsert(database, Geography, values, ["bench_row_id"])
    return values
