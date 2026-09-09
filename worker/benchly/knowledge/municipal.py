"""Zürich's CC0 municipal bench inventory; native OBJID remains the stable identity."""
from __future__ import annotations
import hashlib
import json
import urllib.parse
from pathlib import Path
from benchly.catalog import load_catalog
from benchly.context.sources import download_file
from benchly.db import connect_database
from benchly.knowledge.inventories import InventoryRecord, import_inventory

SOURCE = "Stadt Zürich Sitzbankkataster"


def normalize_zurich(payload):
    if payload.get("type") != "FeatureCollection" or payload.get("crs"):
        raise ValueError("Expected the official WGS84 GeoJSON response")
    seen = set()
    records = []
    for feature in payload["features"]:
        props = feature["properties"]
        identity = props.get("objid")
        if identity is None or str(identity) in seen:
            raise ValueError("Missing or duplicate municipal OBJID")
        seen.add(str(identity))
        if feature["geometry"]["type"] != "Point":
            raise ValueError("Expected a municipal point location")
        lon, lat = feature["geometry"]["coordinates"][:2]
        records.append(InventoryRecord(external_id=str(identity), latitude=lat, longitude=lon,
            attributes={**props, "operator": "Stadt Zürich", "description": props.get("adresse") or None}))
    if not records:
        raise ValueError("Empty municipal inventory; existing records were retained")
    return records


def import_zurich_benches(args):
    base = str(load_catalog().providers.zurichBenchWfsUrl)
    url = f"{base}?{urllib.parse.urlencode(dict(service='WFS', version='1.1.0', request='GetFeature',
        typeName='bankstandorte_ogd', outputFormat='application/json', srsName='EPSG:4326'))}"
    cache = Path(args.cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    raw = cache / "zurich-benches.geojson"
    if args.input:
        content = Path(args.input).read_bytes()
    else:
        download_file(url, raw)
        content = raw.read_bytes()
    # The WFS has no per-object modification date. A content hash versions the dataset without inventing one.
    version = "sha256:" + hashlib.sha256(content).hexdigest()
    records = normalize_zurich(json.loads(content))
    normalized = cache / "zurich-benches.jsonl"
    normalized.write_text("\n".join(record.model_dump_json() for record in records) + "\n")
    database = connect_database(Path(args.database))
    try:
        result = import_inventory(database, normalized, SOURCE, version)
        print(json.dumps({"source": SOURCE, "version": version, "records": len(records), **result}), flush=True)
    finally:
        database.close()
