"""Transparent resolution of source assertions. Confidence here is a support grade, not a probability."""
from __future__ import annotations
import json
from collections import defaultdict
from sqlalchemy import delete
from benchly.db import write
from datetime import datetime, timezone
from benchly.benches.domain import parse_bool
from benchly.knowledge.models import AttributeState, Completeness
from benchly.knowledge.repository import compact, record_evidence, upsert
from benchly.runtime import now_iso

METHOD = "attribute-resolution-1"
PHYSICAL = ("backrest", "armrest", "covered", "wheelchair", "seats", "material", "direction")
CATEGORIES = {
    "physical": PHYSICAL,
    "location": ("municipality", "canton", "locality"),
    "accessibility": ("approach_steps", "approach_surface", "approach_slope", "step_free"),
    "imagery": ("imagery_available",),
    "surroundings": ("land_context", "canopy_context", "waterfront"),
    "amenities": ("toilets", "drinking_water", "fountain", "shelter", "picnic_table", "playground", "waste_basket", "fireplace"),
    "environment": ("elevation", "road_day_noise", "road_night_noise", "rail_day_noise", "rail_night_noise"),
    "recent_verification": ("presence",),
}
PRIORITY = {"community": 1.0, "official": .9, "osm": .8, "gis": .65, "imagery": .4}


def age_days(value, now):
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        return max(0, (now - date).total_seconds() / 86400)
    except (ValueError, TypeError, AttributeError):
        return None


def resolve(assertions, now=None):
    now = now or datetime.now(timezone.utc)
    # Multiple runs/images from one capture group or edits by one person do not create independent votes.
    latest = {}
    for row in assertions:
        key = (row["source_type"], row["source_id"])
        timestamp = row.get("observed_at") or row.get("source_updated_at") or row["imported_at"]
        if key not in latest or timestamp >= latest[key][0]:
            latest[key] = (timestamp, row)
    support = defaultdict(float)
    voters = defaultdict(set)
    for _, row in latest.values():
        value = row["value_json"]
        if value == "null":
            continue
        age = age_days(row.get("observed_at") or row.get("source_updated_at"), now)
        half_life = 180 if row["attribute"] == "presence" else 730
        freshness = .5 if age is None else 1 / (1 + age / half_life)
        reliability = row.get("confidence") if row.get("confidence") is not None else .5
        # Model self-confidence cannot promote imagery to a measurement.
        if row["source_type"] == "imagery":
            reliability = min(reliability, .5)
        support[value] += PRIORITY.get(row["source_type"], .25) * reliability * freshness
        voters[value].add((row["source_type"], row["source_id"]))
    if not support:
        return {"value_json": None, "confidence": "unknown", "conflicting": 0, "evidence_count": 0, "source_types_json": "[]", "latest_at": None}
    ranked = sorted(support, key=lambda value: (-support[value], value))
    winner = ranked[0]
    conflict = len(ranked) > 1
    # Close contradictions stay unresolved; all underlying assertions remain inspectable.
    unresolved = conflict and support[winner] < support[ranked[1]] * 1.5
    confidence = "unknown" if unresolved else "low" if conflict or support[winner] < .5 else "high" if support[winner] >= 1 and len(voters[winner]) > 1 else "medium"
    return dict(value_json=None if unresolved else winner, confidence=confidence, conflicting=int(conflict),
                evidence_count=len(latest), source_types_json=compact(sorted({key[0] for key in latest})),
                latest_at=max((row.get("observed_at") or row.get("source_updated_at") or "" for _, row in latest.values()), default="") or None)


def collect_existing(database, bench):
    """Bridge existing OSM, GIS, photo and community stores without changing their published values."""
    row_id = bench["row_id"]
    tags = json.loads(bench.get("raw_tags") or "{}")
    source_type = "community" if bench.get("created_by_user_id") else "osm"
    source_id = f"user:{bench['created_by_user_id']}" if source_type == "community" else bench["id"]
    for attr in (PHYSICAL if bench.get("created_by_user_id") or bench["id"].startswith("osm-") else ()):
        raw = tags.get(attr)
        value = parse_bool(str(raw)) if attr in {"backrest", "armrest", "covered", "wheelchair"} else raw
        if attr == "seats" and raw is not None:
            value = int(raw) if str(raw).isdigit() else None
        record_evidence(database, row_id, attr, value, source_type, source_id,
                        source_updated_at=bench.get("osm_timestamp"), observed_at=bench["imported_at"] if source_type == "community" else None, confidence=.8,
                        withdraw=True, metadata={"osm_version": bench.get("osm_version"), "changeset": bench.get("osm_changeset")})
    for edit in database.execute("SELECT * FROM bench_metadata_edits WHERE bench_row_id=? ORDER BY created_at,id", (row_id,)):
        if edit["field"] not in PHYSICAL:
            continue
        value = edit["new_value"]
        if edit["field"] in {"backrest", "armrest", "covered", "wheelchair"}:
            value = parse_bool(value)
        elif edit["field"] == "seats" and value is not None:
            value = int(value) if value.isdigit() else None
        record_evidence(database, row_id, edit["field"], value, "community", f"user:{edit['user_id']}",
                        observed_at=edit["created_at"], confidence=.9, method="community-edit-1", withdraw=True)
    for answer in database.execute("SELECT * FROM bench_verification_answers WHERE bench_row_id=?", (row_id,)):
        record_evidence(database, row_id, answer["attribute"], json.loads(answer["value_json"]), "community", f"user:{answer['user_id']}",
                        observed_at=answer["observed_at"], confidence=.9, method="verification-1")
    for sighting in database.execute("SELECT * FROM bench_confirmations WHERE bench_row_id=?", (row_id,)):
        record_evidence(database, row_id, "presence", True, "community", f"user:{sighting['user_id']}",
                        observed_at=sighting["last_seen_at"] or sighting["created_at"], confidence=.9, method="presence-1")
    enrichment = database.execute("SELECT * FROM bench_enrichments WHERE bench_row_id=?", (row_id,)).fetchone()
    photo = None
    if database.execute("SELECT 1 FROM sqlite_master WHERE name='bank_photo_evidence'").fetchone():
        photo = database.execute("SELECT * FROM bank_photo_evidence WHERE bench_row_id=?", (row_id,)).fetchone()
        if photo and (photo["bench_latitude"] != bench["latitude"] or photo["bench_longitude"] != bench["longitude"]):
            photo = None
    if photo:
        signals = json.loads(photo["signals"])
        for attr, value in {"imagery_available": True if signals.get("photos") else None, "land_context": signals.get("land_context"),
                            "image_water_type": signals.get("water_type"),
                            "image_long_view": True if signals.get("long_view") else None,
                            "image_mountain_view": True if signals.get("mountain") else None}.items():
            record_evidence(database, row_id, attr, value, "imagery", "matched-photo-set", confidence=.4,
                method="source-photo-evidence-1", metadata={"latitude": bench["latitude"], "longitude": bench["longitude"],
                    "evaluated_at": photo["evaluated_at"], "model_version": photo["model_version"],
                    "rule_version": photo["rule_version"], "signals": signals, "calibrated": False})
    if enrichment:
        enrichment = dict(enrichment)
        for attr, field in {"land_context": "land_context", "canopy_context": "canopy_context", "waterfront": "waterfront", "elevation": "elevation_meters"}.items():
            value = enrichment.get(field)
            # Do not count an existing photo projection a second time as independent GIS evidence.
            if photo and attr == "land_context" and json.loads(photo["applied_enrichment"] or "{}").get(field) == value:
                value = json.loads(photo["base_enrichment"] or "{}").get(field)
            if value == "unknown":
                value = None
            record_evidence(database, row_id, attr, value, "gis", "environment",
                            source_updated_at=enrichment.get("environment_computed_at") or enrichment.get("computed_at"), confidence=.7,
                            method=enrichment.get("pipeline_version") or "legacy-gis",
                            withdraw=True, metadata={"latitude": bench["latitude"], "longitude": bench["longitude"]})
    images = database.execute("""SELECT i.*,e.distance_meters,e.direct_view_eligible FROM bench_image_evidence e
      JOIN image_observations i ON i.id=e.image_observation_id WHERE e.bench_row_id=? AND i.analysis_status='analyzed'""", (row_id,)).fetchall()
    for image in images:
        predictions = json.loads(image["predictions"] or "{}")
        for attribute, value in predictions.items():
            if attribute.endswith("_probability"):
                record_evidence(database, row_id, f"image_score:{attribute.removesuffix('_probability')}", value, "imagery",
                    f"{image['provider']}:{image['capture_group_id']}", observed_at=image["captured_at"], confidence=.4,
                    method=image["model_version"] or "legacy-image", metadata={"image_id": image["id"], "calibrated": False})
        land = max(("forest", "park", "open", "urban"), key=lambda key: predictions.get(f"{key}_probability", 0))
        if predictions.get(f"{land}_probability", 0) >= .85:
            record_evidence(database, row_id, "land_context", land, "imagery", f"{image['provider']}:{image['capture_group_id']}",
                observed_at=image["captured_at"], confidence=.4, method=image["model_version"] or "legacy-image",
                metadata={"image_id": image["id"], "latitude": bench["latitude"], "longitude": bench["longitude"], "calibrated": False})
        record_evidence(database, row_id, "imagery_available", True, "imagery", f"{image['provider']}:{image['capture_group_id']}",
                        observed_at=image["captured_at"], confidence=.4, method=image["model_version"] or "legacy-image",
                        metadata={"image_id": image["id"], "distance_meters": image["distance_meters"], "predictions": json.loads(image["predictions"] or "{}"), "calibrated": False})
    for view in database.execute("SELECT * FROM bench_view_observations WHERE bench_row_id=? AND retracted_at IS NULL AND kind='correction'", (row_id,)):
        for attr in ("openness", "sky", "relief", "water", "horizon", "naturalness", "disturbance"):
            record_evidence(database, row_id, f"view_{attr}", view[attr], "community", f"user:{view['user_id']}",
                            observed_at=view["observed_at"], confidence=.8, method="community-view-1", metadata={"season": view["season"], "observation_id": view["id"]})
    for light in database.execute("SELECT * FROM bench_light_observations WHERE bench_row_id=? AND retracted_at IS NULL", (row_id,)):
        record_evidence(database, row_id, f"light_{light['season']}_{light['day_phase']}", light["choice"], "community", f"user:{light['user_id']}",
                        observed_at=light["observed_at"], confidence=.8, method="community-light-1", metadata={"cloud_cover": light["cloud_cover"], "observation_id": light["id"]})


def refresh_states(database, bench):
    assertions = defaultdict(list)
    write(database, delete(AttributeState).where(AttributeState.bench_row_id == bench["row_id"]))
    for row in database.execute("SELECT * FROM bench_attribute_evidence WHERE bench_row_id=? ORDER BY id", (bench["row_id"],)):
        row = dict(row)
        metadata = json.loads(row["metadata_json"])
        # Retain historical spatial evidence, but exclude it after a move.
        if "latitude" in metadata and (metadata["latitude"] != bench["latitude"] or metadata["longitude"] != bench["longitude"]):
            continue
        if row["method_version"] in {"community-view-1", "community-light-1"}:
            table = "bench_view_observations" if row["method_version"] == "community-view-1" else "bench_light_observations"
            if not database.execute(f"SELECT 1 FROM {table} WHERE id=? AND retracted_at IS NULL", (metadata.get("observation_id"),)).fetchone():
                continue
        if row["source_type"] == "osm" and metadata.get("osm_version") != bench.get("osm_version"):
            continue
        if row["source_type"] == "imagery" and "image_id" in metadata:
            current = database.execute("""SELECT 1 FROM bench_image_evidence e JOIN image_observations i ON i.id=e.image_observation_id
              WHERE e.bench_row_id=? AND i.id=? AND i.analysis_status='analyzed'""", (bench["row_id"], metadata["image_id"])).fetchone()
            if not current:
                continue
        if row["method_version"] == "source-photo-evidence-1":
            current = database.execute("SELECT evaluated_at FROM bank_photo_evidence WHERE bench_row_id=?", (bench["row_id"],)).fetchone()
            if not current or current[0] != metadata.get("evaluated_at"):
                continue
        if row["method_version"] == "inventory-match-1":
            current = database.execute("""SELECT latitude,longitude FROM bench_source_records WHERE bench_row_id=? AND source=? AND external_id=?
              AND source_version=? AND match_status IN ('identity','matched','new')""",
              (bench["row_id"], metadata.get("inventory_source"), metadata.get("external_id"), metadata.get("source_version"))).fetchone()
            if not current:
                continue
            from benchly.geo import distance_meters
            if distance_meters(current[0], current[1], bench["latitude"], bench["longitude"]) > 6:
                continue
        if row["method_version"] == "nearby-amenities-1":
            current = database.execute("SELECT distance_meters FROM bench_amenities WHERE bench_row_id=? AND category=?", (bench["row_id"], row["attribute"])).fetchone()
            if not current or current[0] != json.loads(row["value_json"]):
                continue
        if row["method_version"] == "pedestrian-approach-1":
            fields = {"approach_steps": "steps", "approach_surface": "surface", "approach_slope": "maximum_slope_percent", "step_free": "step_free_possible"}
            field = fields.get(row["attribute"])
            current = database.execute(f"SELECT {field} FROM bench_approaches WHERE bench_row_id=?", (bench["row_id"],)).fetchone() if field else None
            if not current or current[0] != json.loads(row["value_json"]):
                continue
        if row["method_version"] == "official-places-1":
            current = database.execute("SELECT source_version FROM bench_geography WHERE bench_row_id=?", (bench["row_id"],)).fetchone()
            if not current or current[0] != metadata.get("source_version"):
                continue
        if row["method_version"] == "sonbase-point-1":
            mode, period, _ = row["attribute"].split("_")
            current = database.execute("SELECT value,dataset_version FROM bench_noise_exposure WHERE bench_row_id=? AND mode=? AND period=?", (bench["row_id"], mode, period)).fetchone()
            if not current or current[0] != json.loads(row["value_json"]) or current[1] != metadata.get("dataset_version"):
                continue
        assertions[row["attribute"]].append(row)
    now = now_iso()
    states = {}
    for attr, rows in assertions.items():
        state = resolve(rows)
        states[attr] = state
        upsert(database, AttributeState, dict(bench_row_id=bench["row_id"], attribute=attr, **state, method_version=METHOD, resolved_at=now), ["bench_row_id", "attribute"])
    for category, attrs in CATEGORIES.items():
        missing = [attr for attr in attrs if attr not in states or states[attr]["value_json"] is None]
        uncertain = sum(attr in states and (states[attr]["confidence"] in {"low", "unknown"} or states[attr]["conflicting"]) for attr in attrs)
        upsert(database, Completeness, dict(bench_row_id=bench["row_id"], category=category, known_count=len(attrs) - len(missing),
            total_count=len(attrs), uncertain_count=uncertain, missing_json=compact(missing), computed_at=now, method_version=METHOD), ["bench_row_id", "category"])
    return states
