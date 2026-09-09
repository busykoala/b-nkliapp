"""Conservative municipal inventory matching; ambiguous neighbours remain review candidates."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field
from benchly.benches.domain import parse_bool, parse_direction
from benchly.benches.repository import upsert_inventory_benches
from benchly.geo import distance_meters
from benchly.knowledge.models import SourceRecord
from benchly.knowledge.repository import compact, record_evidence, upsert
from benchly.runtime import now_iso

METHOD = "inventory-match-1"


class InventoryRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    external_id: str = Field(min_length=1, max_length=200)
    latitude: float = Field(ge=45.7, le=47.9)
    longitude: float = Field(ge=5.7, le=10.7)
    attributes: dict = Field(default_factory=dict)
    source_updated_at: str | None = None


def match_record(record, candidates):
    nearby = []
    for bench in candidates:
        distance = distance_meters(record.latitude, record.longitude, bench["latitude"], bench["longitude"])
        if distance > 15:
            continue
        agreements, contradictions = 0, 0
        for field in ("backrest", "armrest", "covered", "material", "seats"):
            raw = record.attributes.get(field)
            incoming = parse_bool(str(raw)) if field in {"backrest", "armrest", "covered"} and raw is not None else raw
            existing = bench.get(field)
            if incoming is None or existing is None:
                continue
            if str(incoming).strip().lower() == str(existing).strip().lower():
                agreements += 1
            else:
                contradictions += 1
        nearby.append({"bench_row_id": bench["row_id"], "distance_meters": round(distance, 2), "agreements": agreements, "contradictions": contradictions})
    nearby.sort(key=lambda item: item["distance_meters"])
    dense = len(nearby) > 1
    eligible = [item for item in nearby if item["distance_meters"] <= (2 if dense else 6) and item["agreements"] >= (2 if dense else 1) and not item["contradictions"]]
    if len(eligible) == 1 and (not dense or all(item is eligible[0] or item["distance_meters"] >= eligible[0]["distance_meters"] + 5 for item in nearby)):
        return eligible[0]["bench_row_id"], .9 if dense else .8, "matched", nearby
    return None, None, "review" if nearby else "new", nearby


def retain_osm_source(database, bench):
    if not bench["id"].startswith("osm-"):
        return
    upsert(database, SourceRecord, dict(bench_row_id=bench["row_id"], source="OpenStreetMap", external_id=f"{bench['osm_type']}/{bench['osm_id']}",
        latitude=bench["latitude"], longitude=bench["longitude"], source_version=str(bench.get("osm_version")) if bench.get("osm_version") else None,
        source_updated_at=bench.get("osm_timestamp"), imported_at=bench["imported_at"], raw_attributes_json=bench["raw_tags"],
        match_confidence=1, match_status="identity", candidates_json="[]", method_version=METHOD), ["source", "external_id"])


def import_inventory(database, path: Path, source: str, version: str, id_field="id", updated_field="updated_at"):
    """GeoJSON in WGS84 or normalized JSONL. Field mapping happens at the provider boundary."""
    if not source.strip() or source == "OpenStreetMap":
        raise ValueError("A distinct inventory source is required")
    if not version.strip():
        raise ValueError("A source dataset version is required")
    def records():
        if path.suffix.lower() in {"geojson", ".geojson", ".json"}:
            payload = json.loads(path.read_text())
            if payload.get("type") != "FeatureCollection":
                raise ValueError("Expected a WGS84 GeoJSON FeatureCollection")
            if payload.get("crs"):
                raise ValueError("Use RFC 7946 WGS84 GeoJSON without a custom CRS")
            for feature in payload["features"]:
                if feature["geometry"]["type"] != "Point":
                    raise ValueError("Inventory benches must have point geometry")
                props = feature["properties"]
                external_id = props.get(id_field, feature.get("id"))
                if external_id is None:
                    raise ValueError(f"Missing stable inventory field: {id_field}")
                lon, lat = feature["geometry"]["coordinates"][:2]
                yield InventoryRecord(external_id=str(external_id), latitude=lat, longitude=lon, attributes=props, source_updated_at=props.get(updated_field))
        else:
            with path.open() as stream:
                for line in stream:
                    if line.strip():
                        yield InventoryRecord.model_validate_json(line)
    counts = {"matched": 0, "new": 0, "review": 0, "identity": 0}
    for record in records():
        prior = database.execute("SELECT bench_row_id,match_status FROM bench_source_records WHERE source=? AND external_id=?", (source, record.external_id)).fetchone()
        lon, lat = record.longitude, record.latitude
        candidates = [dict(row) for row in database.execute("""SELECT b.* FROM bench_spatial_index s JOIN benches b ON b.row_id=s.row_id
            WHERE b.active=1 AND s.min_longitude<=? AND s.max_longitude>=? AND s.min_latitude<=? AND s.max_latitude>=?""",
            (lon + .00021, lon - .00021, lat + .00014, lat - .00014))]
        row_id, confidence, status, candidates = match_record(record, candidates)
        if prior and prior["bench_row_id"] is not None:
            old = database.execute("SELECT * FROM benches WHERE row_id=?", (prior["bench_row_id"],)).fetchone()
            if old and distance_meters(lat, lon, old["latitude"], old["longitude"]) <= 6:
                row_id, confidence, status = old["row_id"], 1, "identity"
            else:
                row_id, confidence, status = None, None, "review"
        if status == "new":
            digest = hashlib.sha256(f"{source}:{record.external_id}".encode()).hexdigest()
            canonical_id = f"inventory-{digest[:24]}"
            attrs = record.attributes
            upsert_inventory_benches(database, [dict(id=canonical_id, osm_type=f"inventory-{hashlib.sha256(source.encode()).hexdigest()[:12]}",
                osm_id=int(digest[:15], 16), latitude=lat, longitude=lon, source_updated_at=record.source_updated_at or "", imported_at=now_iso(),
                name=attrs.get("name"), operator=attrs.get("operator"), description=attrs.get("description"),
                backrest=parse_bool(str(attrs.get("backrest", ""))), armrest=parse_bool(str(attrs.get("armrest", ""))),
                covered=parse_bool(str(attrs.get("covered", ""))), wheelchair=parse_bool(str(attrs.get("wheelchair", ""))),
                material=attrs.get("material"), direction_degrees=parse_direction(str(attrs.get("direction", ""))), raw_tags=compact(attrs))], preserve_edits=True)
            row_id = database.execute("SELECT row_id FROM benches WHERE id=?", (canonical_id,)).fetchone()[0]
            confidence = 1
        upsert(database, SourceRecord, dict(bench_row_id=row_id, source=source, external_id=record.external_id,
            latitude=lat, longitude=lon, source_version=version, source_updated_at=record.source_updated_at, imported_at=now_iso(),
            raw_attributes_json=compact(record.attributes), match_confidence=confidence, match_status=status,
            candidates_json=compact(candidates), method_version=METHOD), ["source", "external_id"])
        if row_id is not None:
            for attribute in ("backrest", "armrest", "covered", "wheelchair", "material", "seats"):
                raw = record.attributes.get(attribute)
                value = parse_bool(str(raw)) if attribute in {"backrest", "armrest", "covered", "wheelchair"} and raw is not None else raw
                if attribute == "seats":
                    value = int(raw) if raw is not None and str(raw).isdigit() else None
                record_evidence(database, row_id, attribute, value, "official", f"{source}:{record.external_id}",
                    source_updated_at=record.source_updated_at, confidence=.9, method=METHOD,
                    withdraw=True, metadata={"source_version": version, "match_confidence": confidence,
                    "inventory_source": source, "external_id": record.external_id})
        counts[status] += 1
        if sum(counts.values()) % 500 == 0:
            database.commit()
    database.commit()
    return counts
