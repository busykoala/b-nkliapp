"""Regional tree evidence with explicit geographic scope and national fallback."""

from __future__ import annotations

import json
import tempfile
import urllib.parse
from argparse import Namespace
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from shapely.geometry import Point

from benchly.catalog import load_catalog
from benchly.context.sources import download_file
from benchly.context.repository import (
    discard_old_source_generation,
    upsert_environment_features,
    upsert_official_source,
)
from benchly.db import connect_database
from benchly.runs.repository import begin_run, finish_run
from benchly.runtime import now_iso

ZURICH_SOURCE = "Stadt Zürich Baumkataster"
BASEL_SOURCE = "Kanton Basel-Stadt Baumkataster"
# Kept as a compatibility alias for existing callers and tests.
SOURCE = ZURICH_SOURCE


class TreeGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["Point"]
    coordinates: tuple[float, float]


class TreeProperties(BaseModel):
    model_config = ConfigDict(extra="ignore")
    objectid: int
    baumnummer: str | None = None
    baumnamedeu: str | None = None
    baumnamelat: str | None = None
    kategorie: str | None = None
    kronendurchmesser: float | None = Field(default=None, ge=0, le=80)
    pflanzjahr: int | None = Field(default=None, ge=1500, le=2200)


class TreeFeature(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["Feature"]
    geometry: TreeGeometry
    properties: TreeProperties


class TreeCollection(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["FeatureCollection"]
    features: list[dict[str, object]]


def import_zurich_trees(database, geojson: Path, source_version: str) -> int:
    collection = TreeCollection.model_validate_json(geojson.read_text(encoding="utf-8"))
    imported_at = now_iso()
    batch: list[dict[str, object]] = []
    imported = 0
    for raw in collection.features:
        feature = TreeFeature.model_validate(raw)
        longitude, latitude = feature.geometry.coordinates
        if not (8.45 <= longitude <= 8.63 and 47.31 <= latitude <= 47.45):
            continue
        properties = feature.properties
        tags = {
            "name": properties.baumnamedeu,
            "species": properties.baumnamelat,
            "category": properties.kategorie,
            "crown_diameter_m": properties.kronendurchmesser,
            "planting_year": properties.pflanzjahr,
        }
        batch.append({
            "source": ZURICH_SOURCE,
            "source_id": properties.baumnummer or str(properties.objectid),
            "kind": "tree",
            "subtype": properties.kategorie,
            "center_latitude": latitude,
            "center_longitude": longitude,
            "min_latitude": latitude,
            "max_latitude": latitude,
            "min_longitude": longitude,
            "max_longitude": longitude,
            "raw_tags": json.dumps(tags, ensure_ascii=False, separators=(",", ":")),
            "imported_at": imported_at,
            "geometry_wkb": Point(longitude, latitude).wkb,
            "geometry_crs": 4326,
            "source_version": source_version,
            "source_updated_at": imported_at,
        })
        if len(batch) >= 1000:
            upsert_environment_features(database, batch)
            imported += len(batch)
            batch.clear()
    if batch:
        upsert_environment_features(database, batch)
        imported += len(batch)
    discard_old_source_generation(database, ZURICH_SOURCE, imported_at)
    upsert_official_source(database, {
        "source": ZURICH_SOURCE,
        "version": source_version,
        "asset_url": str(load_catalog().providers.zurichTreeWfsUrl),
        "imported_at": imported_at,
        "stats": json.dumps({"trees": imported}, separators=(",", ":")),
    })
    database.commit()
    return imported


class BaselTreeProperties(BaseModel):
    model_config = ConfigDict(extra="ignore")
    gml_id: str
    ba_baumnr: str | None = None
    baumart_lateinisch: str | None = None
    baumart_deutsch: str | None = None
    ba_gruppe: str | None = None
    ba_standjahr: int | None = Field(default=None, ge=0, le=500)


class BaselTreeFeature(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["Feature"]
    geometry: TreeGeometry
    properties: BaselTreeProperties


def import_basel_trees(database, geojson: Path, source_version: str) -> int:
    collection = TreeCollection.model_validate_json(geojson.read_text(encoding="utf-8"))
    imported_at = now_iso()
    batch: list[dict[str, object]] = []
    imported = 0
    for raw in collection.features:
        feature = BaselTreeFeature.model_validate(raw)
        longitude, latitude = feature.geometry.coordinates
        if not (7.52 <= longitude <= 7.72 and 47.50 <= latitude <= 47.62):
            continue
        properties = feature.properties
        tags = {
            "name": properties.baumart_deutsch,
            "species": properties.baumart_lateinisch,
            "category": properties.ba_gruppe,
            "stand_age_years": properties.ba_standjahr,
        }
        batch.append({
            "source": BASEL_SOURCE,
            "source_id": properties.ba_baumnr or properties.gml_id,
            "kind": "tree",
            "subtype": properties.ba_gruppe,
            "center_latitude": latitude,
            "center_longitude": longitude,
            "min_latitude": latitude,
            "max_latitude": latitude,
            "min_longitude": longitude,
            "max_longitude": longitude,
            "raw_tags": json.dumps(tags, ensure_ascii=False, separators=(",", ":")),
            "imported_at": imported_at,
            "geometry_wkb": Point(longitude, latitude).wkb,
            "geometry_crs": 4326,
            "source_version": source_version,
            "source_updated_at": imported_at,
        })
        if len(batch) >= 1000:
            upsert_environment_features(database, batch)
            imported += len(batch)
            batch.clear()
    if batch:
        upsert_environment_features(database, batch)
        imported += len(batch)
    discard_old_source_generation(database, BASEL_SOURCE, imported_at)
    upsert_official_source(database, {
        "source": BASEL_SOURCE,
        "version": source_version,
        "asset_url": str(load_catalog().providers.baselTreeGeoJsonUrl),
        "imported_at": imported_at,
        "stats": json.dumps({"trees": imported}, separators=(",", ":")),
    })
    database.commit()
    return imported


def import_zurich_trees_job(args: Namespace) -> None:
    base_url = str(load_catalog().providers.zurichTreeWfsUrl)
    url = f"{base_url}?{urllib.parse.urlencode({
        'service': 'WFS', 'version': '1.1.0', 'request': 'GetFeature',
        'typeName': 'baumkataster_baumstandorte', 'outputFormat': 'application/json', 'srsName': 'EPSG:4326',
    })}"
    database = connect_database(Path(args.database).resolve())
    run_id = begin_run(database, "import-zurich-trees")
    try:
        with tempfile.TemporaryDirectory(prefix="benchly-zurich-trees-") as directory:
            target = Path(directory) / "trees.geojson"
            version = download_file(url, target)
            imported = import_zurich_trees(database, target, version)
        finish_run(database, run_id, "completed", {"trees": imported})
        print(json.dumps({"trees": imported, "source_version": version}, indent=2))
    except Exception as error:
        database.rollback()
        finish_run(database, run_id, "failed", {"error": str(error)})
        raise
    finally:
        database.close()


def import_basel_trees_job(args: Namespace) -> None:
    url = str(load_catalog().providers.baselTreeGeoJsonUrl)
    database = connect_database(Path(args.database).resolve())
    run_id = begin_run(database, "import-basel-trees")
    try:
        with tempfile.TemporaryDirectory(prefix="benchly-basel-trees-") as directory:
            target = Path(directory) / "trees.geojson"
            version = download_file(url, target)
            imported = import_basel_trees(database, target, version)
        finish_run(database, run_id, "completed", {"trees": imported})
        print(json.dumps({"trees": imported, "source_version": version}, indent=2))
    except Exception as error:
        database.rollback()
        finish_run(database, run_id, "failed", {"error": str(error)})
        raise
    finally:
        database.close()
