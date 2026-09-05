"""Fuse image observations and audit their persisted evidence."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional, Sequence

from benchly.catalog import load_catalog
from benchly.imagery.prediction import PROBABILITY_KEYS, validate_scene_prediction
from benchly.imagery.repository import upsert_likely_metadata
from benchly.runtime import now_iso

RECONCILER_VERSION = load_catalog().runtime.sceneReconcilerVersion


def weighted_probability(groups: Sequence[tuple[dict[str, object], float]], key: str) -> Optional[float]:
    values = [(float(prediction[key]), weight) for prediction, weight in groups if key in prediction]
    return sum(value * weight for value, weight in values) / sum(weight for _, weight in values) if values else None


def fuse_frame_predictions(items: Sequence[tuple[dict[str, object], float]]) -> dict[str, object]:
    if not items:
        raise ValueError("cannot fuse an empty evidence group")
    fused: dict[str, object] = {key: weighted_probability(items, key) for key in PROBABILITY_KEYS}
    canopy_scores = {
        context: sum(
            float(prediction["canopy_probability"]) * weight
            for prediction, weight in items if prediction["canopy_context"] == context
        )
        for context in ("none", "partial", "dense", "unknown")
    }
    fused["canopy_context"] = max(canopy_scores, key=canopy_scores.get)
    fused["rejection_reason"] = "none"
    return validate_scene_prediction(fused)


def reconcile_environment(connection: sqlite3.Connection, limit: int = 5000,
                          bounds: Optional[tuple[float, float, float, float]] = None,
                          max_total: Optional[int] = None) -> dict[str, int]:
    bounds_clause = ""
    parameters: list[object] = []
    if bounds:
        bounds_clause = "AND b.longitude BETWEEN ? AND ? AND b.latitude BETWEEN ? AND ?"
        parameters.extend((bounds[0], bounds[2], bounds[1], bounds[3]))
    parameters.append(limit)
    bench_rows = connection.execute(f"""
        SELECT DISTINCT b.row_id,e.in_forest,e.land_context,e.waterfront,e.canopy_context,
          CASE WHEN lm.bench_row_id IS NULL THEN 0 ELSE 1 END likely_exists
        FROM benches b JOIN bench_image_evidence bie ON bie.bench_row_id=b.row_id
        LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
        JOIN image_observations io ON io.id=bie.image_observation_id
        LEFT JOIN bench_likely_metadata lm ON lm.bench_row_id=b.row_id
        WHERE b.active=1 AND io.analysis_status='analyzed'
          AND coalesce(io.license,'')<>'' AND io.source_url LIKE 'https://%'
          AND (lm.updated_at IS NULL OR lm.updated_at<io.analyzed_at)
          {bounds_clause}
        ORDER BY b.row_id LIMIT ?
    """, parameters).fetchall()
    stats = {"reconciled": 0, "conflicts": 0}
    existing_total = int(connection.execute("SELECT count(*) FROM bench_likely_metadata").fetchone()[0])
    newly_created = 0
    for bench in bench_rows:
        if max_total is not None and max_total > 0 and not bench["likely_exists"] and existing_total + newly_created >= max_total:
            continue
        rows = connection.execute("""
            SELECT io.id,io.provider,io.capture_group_id,io.predictions,io.model_version,
              io.source_url,io.license,io.captured_at,io.relevance_probability,
              bie.distance_meters,bie.evidence_weight,bie.direct_view_eligible
            FROM bench_image_evidence bie JOIN image_observations io ON io.id=bie.image_observation_id
            WHERE bie.bench_row_id=? AND io.analysis_status='analyzed' AND io.relevance_probability>=.55
              AND coalesce(io.license,'')<>'' AND io.source_url LIKE 'https://%'
            ORDER BY io.provider,io.capture_group_id,bie.distance_meters,io.id
        """, (bench["row_id"],)).fetchall()
        groups: list[tuple[dict[str, object], float]] = []
        view_groups: list[tuple[dict[str, object], float]] = []
        grouped_rows: dict[tuple[str, str], list[tuple[sqlite3.Row, dict[str, object], float]]] = {}
        for row in rows:
            try:
                prediction = validate_scene_prediction(json.loads(row["predictions"]))
                weight = max(.001, float(row["evidence_weight"]) * float(prediction["relevance_probability"]))
                grouped_rows.setdefault((str(row["provider"]), str(row["capture_group_id"])), []).append((row, prediction, weight))
            except (ValueError, TypeError, json.JSONDecodeError):
                continue
        summary = []
        models: set[str] = set()
        for (provider, capture_group), items in grouped_rows.items():
            fused = fuse_frame_predictions([(prediction, weight) for _row, prediction, weight in items])
            group_weight = max(float(row["evidence_weight"]) for row, _prediction, _weight in items)
            groups.append((fused, group_weight))
            direct_items = [(prediction, weight) for row, prediction, weight in items if row["direct_view_eligible"]]
            if direct_items:
                view_groups.append((fuse_frame_predictions(direct_items), group_weight))
            representative = min((row for row, _prediction, _weight in items), key=lambda row: float(row["distance_meters"]))
            summary.append({
                "provider": provider, "captureGroup": capture_group,
                "distanceMeters": round(float(representative["distance_meters"])),
                "sourceUrl": representative["source_url"], "license": representative["license"],
                "capturedAt": max((row["captured_at"] for row, _prediction, _weight in items if row["captured_at"]), default=None),
                "directView": bool(direct_items), "relevantFrames": len(items),
            })
            models.update(str(row["model_version"]) for row, _prediction, _weight in items if row["model_version"])
        if not groups:
            continue
        probabilities = {key: weighted_probability(groups, key) for key in (
            "forest_probability", "park_probability", "open_probability", "urban_probability",
            "buildings_probability", "road_rail_probability",
        )}
        probabilities.update({key: weighted_probability(view_groups, key) for key in (
            "lake_view_probability", "mountain_view_probability", "open_view_probability", "limited_view_probability",
        )})
        land_candidates = {key.removesuffix("_probability"): value for key, value in probabilities.items() if key in {"forest_probability", "park_probability", "open_probability", "urban_probability"} and value is not None}
        land_context, land_probability = max(land_candidates.items(), key=lambda item: item[1])
        canopy_votes = [(str(prediction["canopy_context"]), float(prediction["canopy_probability"]), weight) for prediction, weight in groups]
        canopy_context = max(("none", "partial", "dense", "unknown"), key=lambda value: sum(prob * weight for name, prob, weight in canopy_votes if name == value))
        canopy_probability = weighted_probability(groups, "canopy_probability")
        contradictory_exact = bool(bench["waterfront"]) or bench["land_context"] in {"forest_edge", "open", "urban", "park"}
        conflicted = False
        if land_context == "forest" and not bench["in_forest"]:
            forest_allowed = land_probability >= .9 and bench["canopy_context"] == "dense" and len(groups) >= 2 and not contradictory_exact
            if not forest_allowed:
                conflicted = True
                stats["conflicts"] += 1
                alternatives = {key: value for key, value in land_candidates.items() if key != "forest"}
                land_context, land_probability = max(alternatives.items(), key=lambda item: item[1]) if alternatives else (None, None)
        strongest = max((value for value in probabilities.values() if value is not None), default=0)
        confidence = "low" if conflicted else "high" if len(groups) >= 2 and strongest >= .85 else "medium" if strongest >= .65 else "low"
        upsert_likely_metadata(connection, {
            "bench_row_id": bench["row_id"],
            "land_context": land_context,
            "land_context_probability": land_probability,
            "canopy_context": canopy_context,
            "canopy_probability": canopy_probability,
            "lake_view_probability": probabilities["lake_view_probability"],
            "mountain_view_probability": probabilities["mountain_view_probability"],
            "open_view_probability": probabilities["open_view_probability"],
            "limited_view_probability": probabilities["limited_view_probability"],
            "buildings_probability": probabilities["buildings_probability"],
            "road_rail_probability": probabilities["road_rail_probability"],
            "confidence": confidence,
            "evidence_group_count": len(groups),
            "evidence_summary": json.dumps(summary, separators=(",", ":")),
            "model_version": ",".join(sorted(models)),
            "reconciler_version": RECONCILER_VERSION,
            "updated_at": now_iso(),
        })
        newly_created += int(not bench["likely_exists"])
        stats["reconciled"] += 1
        if stats["reconciled"] % 100 == 0:
            connection.commit()
    connection.commit()
    return stats


def likely_provenance_issues(connection: sqlite3.Connection) -> int:
    issues = 0
    for row in connection.execute("""
      SELECT evidence_summary,model_version,reconciler_version,updated_at FROM bench_likely_metadata
    """):
        try:
            evidence = json.loads(row["evidence_summary"] or "[]")
        except (TypeError, json.JSONDecodeError):
            evidence = None
        valid = (
            isinstance(evidence, list) and bool(evidence)
            and bool(row["model_version"]) and bool(row["reconciler_version"]) and bool(row["updated_at"])
        )
        if valid:
            valid = all(
                isinstance(item, dict)
                and all(item.get(key) for key in ("provider", "captureGroup", "sourceUrl", "license"))
                and str(item["sourceUrl"]).startswith("https://")
                for item in evidence
            )
        issues += int(not valid)
    return issues


def audit_environment(connection: sqlite3.Connection) -> dict[str, object]:
    scalar = lambda sql: connection.execute(sql).fetchone()[0]
    model_versions = {
        str(row["model_version"] or "unknown"): int(row["count"])
        for row in connection.execute(
            "SELECT model_version,count(*) count FROM image_observations WHERE analyzed_at IS NOT NULL GROUP BY model_version"
        )
    }
    database_path = str(connection.execute("PRAGMA database_list").fetchone()[2] or "")
    image_suffixes = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".heic"}
    image_files_on_data_volume = 0
    if database_path and database_path != ":memory:":
        image_files_on_data_volume = sum(
            path.is_file() and path.suffix.lower() in image_suffixes
            for path in Path(database_path).resolve().parent.rglob("*")
        )
    daerligen = connection.execute("""
      SELECT count(*) benches,
        coalesce(sum(CASE WHEN e.in_forest=1 THEN 1 ELSE 0 END),0) forest_false_positives,
        coalesce(sum(CASE WHEN e.waterfront=1 THEN 1 ELSE 0 END),0) waterfront_confirmed,
        coalesce(sum(CASE WHEN e.environment_computed_at IS NOT NULL THEN 1 ELSE 0 END),0) classified
      FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
      WHERE b.active=1 AND b.latitude BETWEEN 46.6618 AND 46.6629
        AND b.longitude BETWEEN 7.8085 AND 7.8100
    """).fetchone()
    likely_total = scalar("SELECT count(*) FROM bench_likely_metadata")
    provenance_issues = likely_provenance_issues(connection)
    return {
        "sqlite_quick_check": scalar("PRAGMA quick_check"),
        "active_benches": scalar("SELECT count(*) FROM benches WHERE active=1"),
        "exact_geometry_features": scalar("SELECT count(*) FROM environment_features WHERE geometry_wkb IS NOT NULL"),
        "deterministic_context": scalar("SELECT count(*) FROM bench_enrichments WHERE land_context IS NOT NULL"),
        "terrain_horizons": scalar("SELECT count(*) FROM bench_enrichments WHERE json_array_length(terrain_horizon_profile)=72"),
        "current_sun_models": scalar("""SELECT count(*) FROM bench_enrichments
          WHERE pipeline_version IN ('4.2.0','4.3.0','4.4.0','GeoAdmin-Horizont v4','GeoAdmin-Horizont v5','GeoAdmin-Horizont v6') AND json_array_length(horizon_profile)=72"""),
        "canopy_neighborhoods": scalar("""SELECT count(*) FROM bench_enrichments
          WHERE canopy_share_3m IS NOT NULL AND canopy_share_10m IS NOT NULL AND canopy_share_25m IS NOT NULL"""),
        "water_distances": scalar("SELECT count(*) FROM bench_enrichments WHERE distance_water_meters IS NOT NULL"),
        "path_distances": scalar("SELECT count(*) FROM bench_enrichments WHERE distance_path_meters IS NOT NULL"),
        "building_heights": scalar("""SELECT count(*) FROM environment_features
          WHERE kind='building' AND source='swissBUILDINGS3D' AND height_meters IS NOT NULL"""),
        "image_observations": scalar("SELECT count(*) FROM image_observations"),
        "analyzed_images": scalar("SELECT count(*) FROM image_observations WHERE analysis_status='analyzed'"),
        "irrelevant_images": scalar("SELECT count(*) FROM image_observations WHERE analysis_status='irrelevant'"),
        "likely_metadata": likely_total,
        "pilot_remaining": max(0, 1000 - int(likely_total)),
        "high_confidence": scalar("SELECT count(*) FROM bench_likely_metadata WHERE confidence='high'"),
        "model_versions": model_versions,
        "pending_or_retry_images": scalar("SELECT count(*) FROM image_observations WHERE analysis_status IN ('pending','retry')"),
        "forest_conflicts": scalar("""SELECT count(*) FROM bench_likely_metadata lm JOIN bench_enrichments e USING(bench_row_id)
          WHERE lm.land_context='forest' AND e.land_context IN ('forest_edge','open','urban','park')"""),
        "likely_rows_without_provenance": provenance_issues,
        "raw_image_columns": scalar("""SELECT count(*) FROM pragma_table_info('image_observations')
          WHERE lower(name) LIKE '%blob%' OR lower(name) LIKE '%thumbnail%' OR lower(name) IN ('image','bytes','payload')"""),
        "image_files_on_data_volume": int(image_files_on_data_volume),
        "daerligen": dict(daerligen),
    }
