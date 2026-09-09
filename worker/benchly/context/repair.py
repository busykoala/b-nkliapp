"""Repair old name-based swissTLM classifications from retained source metadata."""

import json
import math
from collections import Counter

from sqlalchemy import exists, select, update

from benchly.benches.models import Bench, BenchEnrichment
from benchly.benches.repository import invalidate_enrichment
from benchly.context.geometry import classify_official_layer
from benchly.context.repository import discard_environment_rows, upsert_environment_features, upsert_land_cover
from benchly.db import write
from benchly.runtime import now_iso


def repair_official_classifications(database, *, apply=False):
    stats = Counter()
    maximum = database.execute("SELECT coalesce(max(row_id),0) FROM environment_features").fetchone()[0]
    cursor = 0
    invalidated = False
    while True:
        # Force the primary-key range scan; the source/import-date index causes
        # a full source scan and sort for every page on the national database.
        rows = database.execute("""SELECT * FROM environment_features NOT INDEXED
            WHERE source='swissTLM3D' AND row_id>? AND row_id<=?
              AND source_id NOT LIKE 'tlm_bauten_gebaeude%'
            ORDER BY row_id LIMIT 500""", (cursor, maximum)).fetchall()
        if not rows:
            break
        removals, environments, covers = [], [], []
        for row in rows:
            cursor = row["row_id"]
            stats["checked"] += 1
            table, kind = classify_official_layer(row["source_id"].split(":", 1)[0], json.loads(row["raw_tags"] or "{}"))
            if table == "environment" and kind == row["kind"]:
                continue
            stats[f"{row['kind']}->{kind or 'ignored'}"] += 1
            removals.append(row["row_id"])
            if table == "land_cover":
                cover = {key: row[key] for key in (
                    "source", "source_id", "geometry_wkb", "geometry_crs", "min_latitude", "max_latitude",
                    "min_longitude", "max_longitude", "source_version", "source_updated_at", "imported_at",
                )}
                cover["cover_class"] = kind
                covers.append(cover)
            elif table == "environment":
                environments.append({**dict(row), "kind": kind, "subtype": kind})
        if apply and removals:
            # Invalidate in the same transaction as the first correction. An
            # interrupted repair can never leave previously derived values fresh.
            if not invalidated:
                invalidate_enrichment(database, environment=True)
                invalidated = True
            upsert_land_cover(database, covers)
            upsert_environment_features(database, environments)
            discard_environment_rows(database, removals)
            database.commit()
    return dict(stats)


def apply_surface_water_plan(database, rows):
    """Apply a reviewed distance plan only while its identity and values match.

    Source geometries remain intact. The caller verifies the source version and
    owns the transaction; no unrelated enrichment fields are rewritten.
    """
    seen = set()
    for row in rows:
        if row["row_id"] in seen:
            raise ValueError("Duplicate bench in surface-water repair plan")
        seen.add(row["row_id"])
        old, new = row["distance_water_meters"], row["new_distance_water_meters"]
        if not isinstance(old, (float, int)) or not math.isfinite(old) or old < 0:
            raise ValueError("Invalid previous water distance")
        if new is not None and (not math.isfinite(new) or new < old - .001):
            raise ValueError("Removing underground water cannot reduce the distance")
        if row["new_waterfront"] != int(new is not None and new <= 75):
            raise ValueError("Inconsistent waterfront value")
    stats = {"updated": 0, "skipped_changed": 0}
    for row in rows:
        same_bench = exists(select(Bench.row_id).where(
            Bench.row_id == row["row_id"], Bench.id == row["id"], Bench.active == 1,
            Bench.latitude == row["latitude"], Bench.longitude == row["longitude"],
        ))
        result = write(database, update(BenchEnrichment).where(
            BenchEnrichment.bench_row_id == row["row_id"], same_bench,
            BenchEnrichment.distance_water_meters == row["distance_water_meters"],
            BenchEnrichment.waterfront == row["waterfront"],
        ).values(
            distance_water_meters=row["new_distance_water_meters"],
            waterfront=row["new_waterfront"], environment_computed_at=now_iso(),
            pipeline_version=None,
        ))
        stats["updated" if result.rowcount else "skipped_changed"] += 1
    return stats
