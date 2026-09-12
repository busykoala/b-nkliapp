"""Resumable local analysis, calibration and review artifacts."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
import html
import json
import math
from pathlib import Path
import sqlite3
import uuid

import numpy as np
from scipy.optimize import minimize, minimize_scalar

from benchly.context.rasters import RasterCollection
from benchly.db import connect_database
from benchly.enrichment.terrain_profile import wgs84_to_lv95
from benchly.geo import circular_difference
from .model import DIRECTIONS, METHOD_VERSION, DirectionSignal, accuracy_bucket, fuse_signals
from .signals import KnownBenchDirections, context_signals, image_axis_signal, is_viewpoint
from .sources import OsmDirectionContext, SwissImageCache, cached_osm_pbf


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def open_analysis(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(path)
    database.row_factory = sqlite3.Row
    database.execute("PRAGMA journal_mode=WAL")
    database.execute("PRAGMA foreign_keys=ON")
    database.executescript("""
      CREATE TABLE IF NOT EXISTS direction_analysis_runs(
        run_id TEXT PRIMARY KEY,status TEXT NOT NULL,method_version TEXT NOT NULL,source_database TEXT NOT NULL,
        source_identity TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL,weights_json TEXT NOT NULL DEFAULT '{}',temperature REAL NOT NULL DEFAULT 1,
        stats_json TEXT NOT NULL DEFAULT '{}',started_at TEXT NOT NULL,finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS direction_analysis_benches(
        run_id TEXT NOT NULL,bench_row_id INTEGER NOT NULL,bench_id TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,
        observed_direction REAL,spatial_split TEXT NOT NULL,viewpoint INTEGER NOT NULL DEFAULT 0,
        source_updated_at TEXT,canton_name TEXT,PRIMARY KEY(run_id,bench_row_id)
      );
      CREATE TABLE IF NOT EXISTS direction_signals(
        run_id TEXT NOT NULL,bench_row_id INTEGER NOT NULL,name TEXT NOT NULL,weight REAL NOT NULL,
        probabilities_json TEXT NOT NULL,details_json TEXT NOT NULL,
        PRIMARY KEY(run_id,bench_row_id,name)
      );
      CREATE TABLE IF NOT EXISTS direction_probabilities(
        run_id TEXT NOT NULL,bench_row_id INTEGER NOT NULL,direction_degrees INTEGER NOT NULL,probability REAL NOT NULL,
        PRIMARY KEY(run_id,bench_row_id,direction_degrees)
      );
      CREATE TABLE IF NOT EXISTS direction_predictions(
        run_id TEXT NOT NULL,bench_row_id INTEGER NOT NULL,direction_degrees INTEGER NOT NULL,
        top_probability REAL NOT NULL,entropy REAL NOT NULL,signal_count INTEGER NOT NULL,
        PRIMARY KEY(run_id,bench_row_id)
      );
      CREATE TABLE IF NOT EXISTS direction_reviews(
        run_id TEXT NOT NULL,bench_row_id INTEGER NOT NULL,reviewer TEXT NOT NULL,
        verdict TEXT NOT NULL CHECK(verdict IN ('plausible','unclear','implausible')),reviewed_at TEXT NOT NULL,
        PRIMARY KEY(run_id,bench_row_id,reviewer)
      );
      CREATE TABLE IF NOT EXISTS direction_review_images(
        run_id TEXT NOT NULL,bench_row_id INTEGER NOT NULL,cache_path TEXT NOT NULL,source_json TEXT NOT NULL,
        PRIMARY KEY(run_id,bench_row_id)
      );
      CREATE TABLE IF NOT EXISTS direction_review_failures(
        run_id TEXT NOT NULL,bench_row_id INTEGER NOT NULL,error TEXT NOT NULL,attempted_at TEXT NOT NULL,
        PRIMARY KEY(run_id,bench_row_id)
      );
      CREATE TABLE IF NOT EXISTS direction_review_images(
        run_id TEXT NOT NULL,bench_row_id INTEGER NOT NULL,cache_path TEXT NOT NULL,source_json TEXT NOT NULL,
        PRIMARY KEY(run_id,bench_row_id)
      );
      CREATE INDEX IF NOT EXISTS direction_analysis_label_idx ON direction_analysis_benches(run_id,observed_direction,spatial_split);
      CREATE INDEX IF NOT EXISTS direction_prediction_probability_idx ON direction_predictions(run_id,top_probability);
    """)
    columns = {row[1] for row in database.execute("PRAGMA table_info(direction_analysis_benches)")}
    if "canton_name" not in columns:
        database.execute("ALTER TABLE direction_analysis_benches ADD COLUMN canton_name TEXT")
    run_columns = {row[1] for row in database.execute("PRAGMA table_info(direction_analysis_runs)")}
    if "source_identity" not in run_columns:
        database.execute("ALTER TABLE direction_analysis_runs ADD COLUMN source_identity TEXT NOT NULL DEFAULT ''")
    return database


def spatial_split(latitude: float, longitude: float) -> str:
    easting, northing = wgs84_to_lv95(latitude, longitude)
    cell = f"{math.floor(easting / 10_000)}:{math.floor(northing / 10_000)}"
    bucket = int(hashlib.sha256(cell.encode()).hexdigest()[:8], 16) % 10
    return "train" if bucket < 6 else "validation" if bucket < 8 else "test"


def _select_benches(database, mode: str, bounds: tuple[float, float, float, float] | None, limit: int | None):
    clauses = ["b.active=1"]
    parameters: list[object] = []
    if mode == "labelled":
        clauses.append("b.direction_degrees IS NOT NULL")
    elif mode == "unlabelled":
        clauses.append("b.direction_degrees IS NULL")
    if bounds:
        clauses.append("b.longitude BETWEEN ? AND ? AND b.latitude BETWEEN ? AND ?")
        parameters.extend((bounds[0], bounds[2], bounds[1], bounds[3]))
    sql = f"""
      SELECT b.row_id,b.id,b.osm_type,b.osm_id,b.latitude,b.longitude,b.name,b.description,b.raw_tags,
        b.direction_degrees,b.source_updated_at,e.view_sectors,e.obstruction_types,e.obstruction_distances,g.canton_name
      FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
      LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id
      WHERE {' AND '.join(clauses)}
      ORDER BY CAST(b.longitude*100 AS INTEGER),CAST(b.latitude*100 AS INTEGER),b.row_id
    """
    if limit and limit > 0:
        sql += " LIMIT ?"
        parameters.append(limit)
    return database.execute(sql, parameters)


def _signal_from_row(row: sqlite3.Row) -> DirectionSignal:
    probabilities = json.loads(row["probabilities_json"])
    return DirectionSignal(row["name"], tuple(float(probabilities[str(direction)]) for direction in DIRECTIONS),
                           float(row["weight"]), json.loads(row["details_json"]))


def _target_index(direction: float) -> int:
    return int(round((direction % 360) / 45)) % 8


def _labelled_signal_sets(analysis: sqlite3.Connection, run_id: str, split: str):
    benches = analysis.execute("""
      SELECT bench_row_id,observed_direction FROM direction_analysis_benches
      WHERE run_id=? AND spatial_split=? AND observed_direction IS NOT NULL
    """, (run_id, split)).fetchall()
    result = []
    for bench in benches:
        signals = [_signal_from_row(row) for row in analysis.execute(
            "SELECT * FROM direction_signals WHERE run_id=? AND bench_row_id=? ORDER BY name",
            (run_id, bench["bench_row_id"]),
        )]
        if signals:
            result.append((signals, float(bench["observed_direction"])))
    return result


def calibrate(analysis: sqlite3.Connection, run_id: str) -> tuple[dict[str, float], float]:
    train = _labelled_signal_sets(analysis, run_id, "train")
    validation = _labelled_signal_sets(analysis, run_id, "validation")
    names = sorted({signal.name for signals, _target in train for signal in signals})
    if len(train) < 40 or not names:
        return {}, 1.0

    def loss(values: np.ndarray) -> float:
        weights = {name: float(value) for name, value in zip(names, values)}
        # A weak shrinkage toward the transparent hand-tuned unit weight still
        # permits a harmful signal to reach exactly zero.
        total = .01 * float(np.sum((values - 1) ** 2))
        for signals, target in train:
            estimate = fuse_signals(signals, weights)
            total -= math.log(max(1e-9, estimate.probabilities[_target_index(target)])) if estimate else 0
        return total / len(train)

    optimized = minimize(loss, np.ones(len(names)), method="L-BFGS-B", bounds=[(0, 5)] * len(names))
    weights = {name: round(float(value), 6) for name, value in zip(names, optimized.x)}
    if len(validation) < 20:
        return weights, 1.0

    def temperature_loss(value: float) -> float:
        total = 0.0
        for signals, target in validation:
            estimate = fuse_signals(signals, weights, value)
            total -= math.log(max(1e-9, estimate.probabilities[_target_index(target)])) if estimate else 0
        return total / len(validation)

    result = minimize_scalar(temperature_loss, bounds=(.35, 4), method="bounded")
    return weights, round(float(result.x), 6)


def rebuild_predictions(analysis: sqlite3.Connection, run_id: str, weights: dict[str, float], temperature: float) -> None:
    analysis.execute("DELETE FROM direction_probabilities WHERE run_id=?", (run_id,))
    analysis.execute("DELETE FROM direction_predictions WHERE run_id=?", (run_id,))
    benches = analysis.execute("SELECT bench_row_id FROM direction_analysis_benches WHERE run_id=?", (run_id,)).fetchall()
    for bench in benches:
        row_id = int(bench["bench_row_id"])
        signals = [_signal_from_row(row) for row in analysis.execute(
            "SELECT * FROM direction_signals WHERE run_id=? AND bench_row_id=? ORDER BY name", (run_id, row_id)
        )]
        estimate = fuse_signals(signals, weights, temperature)
        if estimate is None:
            continue
        analysis.executemany("INSERT INTO direction_probabilities VALUES(?,?,?,?)", [
            (run_id, row_id, direction, probability) for direction, probability in zip(DIRECTIONS, estimate.probabilities)
        ])
        analysis.execute("INSERT INTO direction_predictions VALUES(?,?,?,?,?,?)", (
            run_id, row_id, estimate.direction_degrees, estimate.top_probability, estimate.entropy, estimate.signal_count,
        ))
    analysis.commit()


def _evaluation_summary(rows: list[sqlite3.Row]) -> dict[str, object]:
    buckets = [accuracy_bucket(row["direction_degrees"], row["observed_direction"]) for row in rows]
    errors = [
        min(
            abs(float(row["direction_degrees"]) - float(row["observed_direction"])),
            360 - abs(float(row["direction_degrees"]) - float(row["observed_direction"])),
        )
        for row in rows
    ]
    return {
        "count": len(rows),
        "within_22_5": sum(item[0] for item in buckets) / len(buckets) if buckets else None,
        "within_45": sum(item[1] for item in buckets) / len(buckets) if buckets else None,
        "within_90": sum(item[2] for item in buckets) / len(buckets) if buckets else None,
        "axis_within_22_5": sum(item[3] for item in buckets) / len(buckets) if buckets else None,
        "median_angular_error": float(np.median(errors)) if errors else None,
    }


def _calibration_metrics(analysis: sqlite3.Connection, run_id: str) -> dict[str, object]:
    rows = analysis.execute("""
      SELECT p.bench_row_id,p.top_probability,p.direction_degrees,b.observed_direction
      FROM direction_predictions p JOIN direction_analysis_benches b USING(run_id,bench_row_id)
      WHERE p.run_id=? AND b.spatial_split='test' AND b.observed_direction IS NOT NULL
    """, (run_id,)).fetchall()
    if not rows:
        return {"count": 0, "brier": None, "log_loss": None, "expected_calibration_error": None, "bins": []}
    brier = 0.0
    log_loss = 0.0
    bins: list[dict[str, object]] = []
    grouped: list[list[tuple[float, bool]]] = [[] for _ in range(10)]
    for row in rows:
        probabilities = dict(analysis.execute(
            "SELECT direction_degrees,probability FROM direction_probabilities WHERE run_id=? AND bench_row_id=?",
            (run_id, row["bench_row_id"]),
        ))
        target = DIRECTIONS[_target_index(float(row["observed_direction"]))]
        target_probability = max(1e-9, float(probabilities.get(target, 0)))
        log_loss -= math.log(target_probability)
        brier += sum((float(probabilities.get(direction, 0)) - (1 if direction == target else 0)) ** 2 for direction in DIRECTIONS)
        confidence = float(row["top_probability"])
        correct = accuracy_bucket(float(row["direction_degrees"]), float(row["observed_direction"]))[1]
        grouped[min(9, int(confidence * 10))].append((confidence, correct))
    ece = 0.0
    for index, values in enumerate(grouped):
        if not values:
            continue
        mean_confidence = sum(value[0] for value in values) / len(values)
        accuracy = sum(value[1] for value in values) / len(values)
        ece += len(values) / len(rows) * abs(mean_confidence - accuracy)
        bins.append({
            "minimum": index / 10, "maximum": (index + 1) / 10, "count": len(values),
            "mean_confidence": mean_confidence, "within_45": accuracy,
        })
    return {
        "count": len(rows), "brier": brier / len(rows), "log_loss": log_loss / len(rows),
        "expected_calibration_error": ece, "bins": bins,
    }


def metrics(analysis: sqlite3.Connection, run_id: str, weights: dict[str, float], temperature: float) -> dict[str, object]:
    result: dict[str, object] = {}
    analyzed = int(analysis.execute("SELECT count(*) FROM direction_analysis_benches WHERE run_id=?", (run_id,)).fetchone()[0])
    predicted = int(analysis.execute("SELECT count(*) FROM direction_predictions WHERE run_id=?", (run_id,)).fetchone()[0])
    result.update(analyzed=analyzed, predicted=predicted, coverage=predicted / analyzed if analyzed else 0)
    threshold_rows = []
    for threshold in (.9, .8, .7, 0):
        rows = analysis.execute("""
          SELECT p.direction_degrees,p.top_probability,b.observed_direction,b.spatial_split
          FROM direction_predictions p JOIN direction_analysis_benches b USING(run_id,bench_row_id)
          WHERE p.run_id=? AND p.top_probability>=?
        """, (run_id, threshold)).fetchall()
        labelled = [row for row in rows if row["observed_direction"] is not None]
        test = [row for row in labelled if row["spatial_split"] == "test"]
        evaluated = test
        evaluation = _evaluation_summary(evaluated)
        threshold_rows.append({
            "minimum_probability": threshold, "count": len(rows), "coverage": len(rows) / analyzed if analyzed else 0,
            "evaluated": len(evaluated), **{key: value for key, value in evaluation.items() if key != "count"},
        })
    result["thresholds"] = threshold_rows
    strata = {}
    for label, where in {
        "ordinary": "b.viewpoint=0", "viewpoint": "b.viewpoint=1",
        "path": "EXISTS(SELECT 1 FROM direction_signals s WHERE s.run_id=b.run_id AND s.bench_row_id=b.bench_row_id AND s.name='path')",
        "building": "EXISTS(SELECT 1 FROM direction_signals s WHERE s.run_id=b.run_id AND s.bench_row_id=b.bench_row_id AND s.name='building')",
        "terrain": "EXISTS(SELECT 1 FROM direction_signals s WHERE s.run_id=b.run_id AND s.bench_row_id=b.bench_row_id AND s.name='terrain')",
        "water": "EXISTS(SELECT 1 FROM direction_signals s WHERE s.run_id=b.run_id AND s.bench_row_id=b.bench_row_id AND s.name='water')",
    }.items():
        rows = analysis.execute(f"""
          SELECT p.direction_degrees,b.observed_direction FROM direction_predictions p
          JOIN direction_analysis_benches b USING(run_id,bench_row_id)
          WHERE p.run_id=? AND b.spatial_split='test' AND b.observed_direction IS NOT NULL AND {where}
        """, (run_id,)).fetchall()
        strata[label] = _evaluation_summary(rows)
    relationships: dict[str, list[dict[str, float]]] = {"path_outlook_same_side": [], "path_outlook_conflict": []}
    paired = analysis.execute("""
      SELECT p.direction_degrees,b.observed_direction,path.details_json path_details,open.details_json open_details
      FROM direction_analysis_benches b JOIN direction_predictions p USING(run_id,bench_row_id)
      JOIN direction_signals path ON path.run_id=b.run_id AND path.bench_row_id=b.bench_row_id AND path.name='path'
      JOIN direction_signals open ON open.run_id=b.run_id AND open.bench_row_id=b.bench_row_id AND open.name='openness'
      WHERE b.run_id=? AND b.spatial_split='test' AND b.observed_direction IS NOT NULL
    """, (run_id,)).fetchall()
    for row in paired:
        path_direction = float(json.loads(row["path_details"])["toward_path_degrees"])
        open_direction = float(json.loads(row["open_details"])["best_sector_degrees"])
        difference = circular_difference(path_direction, open_direction)
        key = "path_outlook_same_side" if difference <= 45 else "path_outlook_conflict" if difference >= 135 else None
        if key:
            relationships[key].append({
                "direction_degrees": float(row["direction_degrees"]),
                "observed_direction": float(row["observed_direction"]),
            })
    for label, rows in relationships.items():
        strata[label] = _evaluation_summary(rows)  # type: ignore[arg-type]
    result["strata"] = strata
    result["calibration"] = _calibration_metrics(analysis, run_id)
    ablations: dict[str, object] = {}
    signal_names = [row[0] for row in analysis.execute(
        "SELECT DISTINCT name FROM direction_signals WHERE run_id=? ORDER BY name", (run_id,)
    )]
    test_benches = analysis.execute("""
      SELECT bench_row_id,observed_direction FROM direction_analysis_benches
      WHERE run_id=? AND spatial_split='test' AND observed_direction IS NOT NULL
    """, (run_id,)).fetchall()
    for name in signal_names:
        without_rows = []
        for bench in test_benches:
            signals = [_signal_from_row(row) for row in analysis.execute(
                "SELECT * FROM direction_signals WHERE run_id=? AND bench_row_id=? AND name<>? ORDER BY name",
                (run_id, bench["bench_row_id"], name),
            )]
            estimate = fuse_signals(signals, weights, temperature)
            if estimate:
                without_rows.append({"direction_degrees": estimate.direction_degrees, "observed_direction": bench["observed_direction"]})
        ablations[name] = _evaluation_summary(without_rows)  # type: ignore[arg-type]
    result["drop_one_ablations"] = ablations
    path_distance = {}
    for maximum in (1, 3, 5, 8, 15, 30):
        rows = analysis.execute("""
          SELECT b.observed_direction,s.* FROM direction_analysis_benches b
          JOIN direction_signals s USING(run_id,bench_row_id)
          WHERE b.run_id=? AND b.spatial_split='test' AND b.observed_direction IS NOT NULL AND s.name='path'
            AND json_extract(s.details_json,'$.distance_meters')<=?
        """, (run_id, maximum)).fetchall()
        buckets = []
        for row in rows:
            estimate = fuse_signals([_signal_from_row(row)])
            if estimate:
                buckets.append(accuracy_bucket(estimate.direction_degrees, float(row["observed_direction"])))
        path_distance[str(maximum)] = {
            "count": len(buckets), "within_45": sum(item[1] for item in buckets) / len(buckets) if buckets else None,
            "axis_within_22_5": sum(item[3] for item in buckets) / len(buckets) if buckets else None,
        }
    result["path_distance_meters"] = path_distance
    return result


def review_sample(analysis: sqlite3.Connection, run_id: str, limit: int = 300) -> list[sqlite3.Row]:
    candidates = analysis.execute("""
      SELECT b.*,p.direction_degrees predicted,p.top_probability,p.entropy,group_concat(s.name) signal_names
      FROM direction_analysis_benches b JOIN direction_predictions p USING(run_id,bench_row_id)
      LEFT JOIN direction_signals s USING(run_id,bench_row_id)
      WHERE b.run_id=? AND b.observed_direction IS NULL
      GROUP BY b.run_id,b.bench_row_id ORDER BY b.bench_row_id
    """, (run_id,)).fetchall()
    # Deterministic round-robin across canton (or a spatial fallback),
    # environment and confidence. Reserve extra review slices for the cases
    # most likely to expose a bad heuristic without letting them dominate.
    def group_key(row: sqlite3.Row) -> tuple[object, ...]:
        probability_band = math.floor(float(row["top_probability"]) * 10) / 10
        easting, northing = wgs84_to_lv95(float(row["latitude"]), float(row["longitude"]))
        region = row["canton_name"] or f"grid-{math.floor(easting / 25_000)}-{math.floor(northing / 25_000)}"
        names = set(str(row["signal_names"] or "").split(","))
        environment = "building" if "building" in names else "water" if "water" in names else "outlook" if row["viewpoint"] else "path" if "path" in names else "other"
        return region, environment, probability_band

    sample: list[sqlite3.Row] = []
    selected: set[int] = set()

    def add_spread(predicate, quota: int) -> None:
        target = min(limit, len(sample) + quota)
        groups: dict[tuple[object, ...], list[sqlite3.Row]] = {}
        for row in candidates:
            if int(row["bench_row_id"]) not in selected and predicate(row):
                groups.setdefault(group_key(row), []).append(row)
        ordered = [rows for _key, rows in sorted(
            groups.items(), key=lambda item: (len(item[1]), str(item[0])), reverse=True,
        )]
        while ordered and len(sample) < target:
            remaining = []
            for rows in ordered:
                if rows and len(sample) < target:
                    row = rows.pop(0)
                    sample.append(row)
                    selected.add(int(row["bench_row_id"]))
                if rows:
                    remaining.append(rows)
            ordered = remaining

    add_spread(lambda row: bool(row["viewpoint"]), min(60, limit))
    add_spread(lambda row: "building" in set(str(row["signal_names"] or "").split(",")), min(50, max(0, limit - len(sample))))
    add_spread(lambda row: float(row["top_probability"]) >= .5, min(40, max(0, limit - len(sample))))
    add_spread(lambda _row: True, max(0, limit - len(sample)))
    return sample


def write_reports(analysis: sqlite3.Connection, run_id: str, directory: Path, stats: dict[str, object]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "summary.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False))
    with (directory / "directions.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["bench_id", "latitude", "longitude", "observed_direction", "predicted_direction", "top_probability", "entropy", *[f"p_{value}" for value in DIRECTIONS]])
        rows = analysis.execute("""
          SELECT b.*,p.direction_degrees predicted,p.top_probability,p.entropy
          FROM direction_analysis_benches b JOIN direction_predictions p USING(run_id,bench_row_id)
          WHERE b.run_id=? ORDER BY b.bench_row_id
        """, (run_id,))
        for row in rows:
            probabilities = dict(analysis.execute("SELECT direction_degrees,probability FROM direction_probabilities WHERE run_id=? AND bench_row_id=?", (run_id, row["bench_row_id"])))
            writer.writerow([row["bench_id"], row["latitude"], row["longitude"], row["observed_direction"], row["predicted"], row["top_probability"], row["entropy"], *[probabilities.get(value) for value in DIRECTIONS]])
    sample = review_sample(analysis, run_id)
    with (directory / "review.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["bench_id", "region", "environment", "viewpoint", "latitude", "longitude", "predicted_direction", "top_probability", "verdict", "reviewer"])
        for row in sample:
            easting, northing = wgs84_to_lv95(float(row["latitude"]), float(row["longitude"]))
            region = row["canton_name"] or f"grid-{math.floor(easting / 25_000)}-{math.floor(northing / 25_000)}"
            names = set(str(row["signal_names"] or "").split(","))
            environment = "building" if "building" in names else "water" if "water" in names else "outlook" if row["viewpoint"] else "path" if "path" in names else "other"
            review = analysis.execute("""
              SELECT verdict,reviewer FROM direction_reviews WHERE run_id=? AND bench_row_id=?
              ORDER BY reviewed_at DESC LIMIT 1
            """, (run_id, row["bench_row_id"])).fetchone()
            writer.writerow([
                row["bench_id"], region, environment, row["viewpoint"], row["latitude"], row["longitude"],
                row["predicted"], row["top_probability"], review["verdict"] if review else "", review["reviewer"] if review else "",
            ])
    cards = []
    for row in sample:
        easting, northing = wgs84_to_lv95(float(row["latitude"]), float(row["longitude"]))
        region = row["canton_name"] or f"Raster {math.floor(easting / 25_000)}-{math.floor(northing / 25_000)}"
        signals = analysis.execute("SELECT name,details_json FROM direction_signals WHERE run_id=? AND bench_row_id=? ORDER BY name", (run_id, row["bench_row_id"])).fetchall()
        details = [{"name": signal["name"], **json.loads(signal["details_json"])} for signal in signals]
        review_image = analysis.execute(
            "SELECT cache_path FROM direction_review_images WHERE run_id=? AND bench_row_id=?", (run_id, row["bench_row_id"])
        ).fetchone()
        patch = review_image["cache_path"] if review_image else next((item.get("cache_path") for item in details if item["name"] == "image_axis"), None)
        image = f'<img src="file://{html.escape(str(patch))}" alt="SWISSIMAGE-Ausschnitt">' if patch else ""
        angle_keys = {
            "path": "toward_path_degrees", "building": "away_degrees", "water": "toward_degrees",
            "openness": "best_sector_degrees", "terrain": "downhill_degrees", "nearby_benches": "direction_degrees",
        }
        arrows = []
        for signal in details:
            angles = []
            if signal["name"] in angle_keys and angle_keys[signal["name"]] in signal:
                angles = [float(signal[angle_keys[signal["name"]]])]
            elif signal["name"] in {"image_axis", "way_axis"} and "axis_degrees" in signal:
                angles = [(float(signal["axis_degrees"]) + 90) % 360, (float(signal["axis_degrees"]) + 270) % 360]
            arrows.extend(
                f'<i class="signal-arrow" style="transform:translate(-50%,-100%) rotate({angle}deg)" title="{html.escape(str(signal["name"]))}">↑</i>'
                for angle in angles
            )
        cards.append(f"""<article><div class="visual">{image}<div class="north">N</div>{''.join(arrows)}
          <i class="prediction" style="transform:translate(-50%,-100%) rotate({row['predicted']}deg)" title="fusionierte Richtung">↑</i></div>
          <h2>{html.escape(row['bench_id'])}</h2>
          <p>{html.escape(str(region))} · {row['predicted']}° · p={row['top_probability']:.3f} · Entropie={row['entropy']:.3f}</p>
          <p>□ plausibel &nbsp; □ unklar &nbsp; □ unplausibel</p>
          <pre>{html.escape(json.dumps(details, indent=2, ensure_ascii=False))}</pre></article>""")
    summary_rows = "".join(
        f"<tr><td>{row['minimum_probability']:.2f}</td><td>{row['coverage']:.1%}</td><td>{row['evaluated']}</td><td>{row['within_45']:.1%}</td></tr>"
        for row in stats["thresholds"] if row["within_45"] is not None  # type: ignore[index]
    )
    (directory / "review.html").write_text(f"""<!doctype html><meta charset="utf-8"><title>Bänkli-Richtungsanalyse</title>
      <style>body{{font:15px system-ui;margin:2rem;background:#f7efd8;color:#26483d}}table{{border-collapse:collapse}}td,th{{padding:.45rem;border:1px solid #9aab9e}}main{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}}article{{background:#fffaf0;padding:1rem;border-radius:14px}}.visual{{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#d9ddcf}}img{{width:100%;height:100%;object-fit:cover}}.north{{position:absolute;top:.3rem;left:50%;font-weight:800;text-shadow:0 1px 3px white}}.prediction,.signal-arrow{{position:absolute;left:50%;top:50%;height:42%;transform-origin:50% 100%;font-style:normal;font-size:38px;color:#b92f20;text-shadow:0 1px 3px white}}.signal-arrow{{height:34%;font-size:26px;color:#136f63;opacity:.75}}pre{{white-space:pre-wrap;font-size:11px}}</style>
      <h1>Bänkli-Richtungsanalyse {html.escape(run_id)}</h1><table><tr><th>p ≥</th><th>Abdeckung</th><th>Test n</th><th>±45°</th></tr>{summary_rows}</table><main>{''.join(cards)}</main>""")


def prepare_review(args) -> dict[str, object]:
    analysis = open_analysis(Path(args.analysis_database).resolve())
    try:
        run = analysis.execute(
            "SELECT * FROM direction_analysis_runs WHERE run_id=? AND status='completed'", (args.run_id,)
        ).fetchone()
        if not run:
            raise RuntimeError(f"Completed direction analysis run not found: {args.run_id}")
        sample = review_sample(analysis, args.run_id, args.sample_size)
        imagery = SwissImageCache(Path(args.cache_dir).resolve() / "swissimage", requests_per_second=args.requests_per_second)
        present = {int(row["bench_row_id"]) for row in sample if analysis.execute(
            "SELECT 1 FROM direction_review_images WHERE run_id=? AND bench_row_id=?", (args.run_id, row["bench_row_id"])
        ).fetchone()}
        before = len(present)
        processed = 0
        prepared = 0
        failures = 0
        for bench, crop, error in imagery.crop_many(sample):
            if error is not None or crop is None:
                failures += 1
                analysis.execute(
                    "INSERT OR REPLACE INTO direction_review_failures VALUES(?,?,?,?)",
                    (args.run_id, bench["bench_row_id"], str(error or "No crop returned"), _now()),
                )
                continue
            _image, _resolution, metadata = crop
            analysis.execute(
                "INSERT OR REPLACE INTO direction_review_images VALUES(?,?,?,?)",
                (args.run_id, bench["bench_row_id"], metadata["cache_path"], json.dumps(metadata, separators=(",", ":"))),
            )
            analysis.execute(
                "DELETE FROM direction_review_failures WHERE run_id=? AND bench_row_id=?", (args.run_id, bench["bench_row_id"])
            )
            processed += 1
            if int(bench["bench_row_id"]) not in present:
                prepared += 1
            if processed % 25 == 0:
                analysis.commit()
                print(json.dumps({"run_id": args.run_id, "review_images_processed": processed, "new_images": prepared, "failures": failures}), flush=True)
        analysis.commit()
        stats = json.loads(run["stats_json"])
        available = sum(bool(analysis.execute(
            "SELECT 1 FROM direction_review_images WHERE run_id=? AND bench_row_id=?", (args.run_id, row["bench_row_id"])
        ).fetchone()) for row in sample)
        review_stats = {
            "requested": len(sample), "already_present": before, "prepared_this_run": prepared,
            "available": available, "failures": failures,
        }
        stats["visual_review"] = review_stats
        analysis.execute("UPDATE direction_analysis_runs SET stats_json=? WHERE run_id=?", (json.dumps(stats), args.run_id))
        analysis.commit()
        write_reports(analysis, args.run_id, Path(args.report_directory).resolve() / args.run_id, stats)
        return review_stats
    finally:
        analysis.close()


def import_reviews(args) -> dict[str, object]:
    analysis = open_analysis(Path(args.analysis_database).resolve())
    try:
        run = analysis.execute(
            "SELECT * FROM direction_analysis_runs WHERE run_id=? AND status='completed'", (args.run_id,)
        ).fetchone()
        if not run:
            raise RuntimeError(f"Completed direction analysis run not found: {args.run_id}")
        imported = 0
        ignored = 0
        with Path(args.csv).resolve().open(newline="") as handle:
            for row in csv.DictReader(handle):
                verdict = str(row.get("verdict") or "").strip().lower()
                if not verdict:
                    ignored += 1
                    continue
                if verdict not in {"plausible", "unclear", "implausible"}:
                    raise RuntimeError(f"Invalid review verdict for {row.get('bench_id')}: {verdict}")
                bench = analysis.execute(
                    "SELECT bench_row_id FROM direction_analysis_benches WHERE run_id=? AND bench_id=?",
                    (args.run_id, row.get("bench_id")),
                ).fetchone()
                if not bench:
                    raise RuntimeError(f"Review bench is not part of {args.run_id}: {row.get('bench_id')}")
                analysis.execute(
                    "INSERT OR REPLACE INTO direction_reviews VALUES(?,?,?,?,?)",
                    (args.run_id, bench["bench_row_id"], args.reviewer, verdict, _now()),
                )
                imported += 1
        analysis.commit()
        rows = analysis.execute("""
          SELECT r.verdict,p.top_probability FROM direction_reviews r
          JOIN direction_predictions p USING(run_id,bench_row_id)
          WHERE r.run_id=? AND r.reviewer=?
        """, (args.run_id, args.reviewer)).fetchall()
        thresholds = []
        for minimum in (.9, .8, .7, .6, .5, 0):
            selected = [row for row in rows if float(row["top_probability"]) >= minimum]
            thresholds.append({
                "minimum_probability": minimum, "reviewed": len(selected),
                "plausible": sum(row["verdict"] == "plausible" for row in selected) / len(selected) if selected else None,
                "unclear": sum(row["verdict"] == "unclear" for row in selected) / len(selected) if selected else None,
                "implausible": sum(row["verdict"] == "implausible" for row in selected) / len(selected) if selected else None,
            })
        stats = json.loads(run["stats_json"])
        stats.setdefault("human_reviews", {})[args.reviewer] = {"count": len(rows), "thresholds": thresholds}
        analysis.execute("UPDATE direction_analysis_runs SET stats_json=? WHERE run_id=?", (json.dumps(stats), args.run_id))
        analysis.commit()
        write_reports(analysis, args.run_id, Path(args.report_directory).resolve() / args.run_id, stats)
        return {"imported": imported, "blank_rows_ignored": ignored, "reviewer": args.reviewer, "thresholds": thresholds}
    finally:
        analysis.close()


def analyze(args) -> dict[str, object]:
    source_path = Path(args.database).resolve()
    analysis_path = Path(args.analysis_database).resolve()
    report_directory = Path(args.report_directory).resolve()
    cache_directory = Path(args.cache_dir).resolve()
    source = connect_database(source_path)
    analysis = open_analysis(analysis_path)
    run_id = args.run_id or f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    source_identity = f"{source_path.stat().st_size}:{source_path.stat().st_mtime_ns}"
    existing = analysis.execute("SELECT * FROM direction_analysis_runs WHERE run_id=?", (run_id,)).fetchone()
    if existing and (
        existing["method_version"] != METHOD_VERSION or existing["source_identity"] not in ("", source_identity)
        or existing["mode"] != args.mode
    ):
        raise RuntimeError(f"Analysis run {run_id} belongs to different model, source snapshot or mode")
    if not existing:
        analysis.execute("INSERT INTO direction_analysis_runs(run_id,status,method_version,source_database,source_identity,mode,started_at) VALUES(?,?,?,?,?,?,?)",
                         (run_id, "running", METHOD_VERSION, str(source_path), source_identity, args.mode, _now()))
        analysis.commit()
    elif existing["status"] != "running":
        analysis.execute(
            "UPDATE direction_analysis_runs SET status='running',finished_at=NULL WHERE run_id=?", (run_id,)
        )
        analysis.commit()
    pbf = cached_osm_pbf(cache_directory, args.pbf, download=args.download_pbf, url=args.pbf_url)
    osm = OsmDirectionContext(pbf)
    known_benches = KnownBenchDirections(source)
    terrain = RasterCollection(Path(args.terrain_dir)) if args.terrain_dir else None
    imagery = None if args.skip_imagery else SwissImageCache(cache_directory / "swissimage", requests_per_second=args.requests_per_second)
    processed = 0
    image_failures = 0
    try:
        def pending_batches():
            batch = []
            for bench in _select_benches(source, args.mode, tuple(args.bounds) if args.bounds else None, args.limit):
                exists = analysis.execute(
                    "SELECT 1 FROM direction_analysis_benches WHERE run_id=? AND bench_row_id=?",
                    (run_id, bench["row_id"]),
                ).fetchone()
                if exists:
                    continue
                batch.append(bench)
                if len(batch) == 500:
                    yield batch
                    batch = []
            if batch:
                yield batch

        for batch in pending_batches():
            crops = imagery.crop_many(batch, max_gsd=.11, fallback=False) if imagery else (
                (bench, None, None) for bench in batch
            )
            for bench, crop, crop_error in crops:
                row_id = int(bench["row_id"])
                viewpoint_distance = osm.viewpoint_distance(float(bench["latitude"]), float(bench["longitude"]))
                viewpoint = is_viewpoint(bench, viewpoint_distance)
                signals = context_signals(
                    source, bench, terrain=terrain, nearby_viewpoint_meters=viewpoint_distance, known_benches=known_benches,
                )
                way = osm.way_axis_signal(str(bench["osm_type"]), int(bench["osm_id"]))
                if way:
                    signals.append(way)
                if imagery and crop_error is not None:
                    image_failures += 1
                    if args.fail_on_image_error:
                        raise RuntimeError(f"SWISSIMAGE failed for {bench['id']}: {crop_error}") from crop_error
                elif imagery and crop is not None:
                    try:
                        image, meters_per_pixel, metadata = crop
                        signal = image_axis_signal(image, meters_per_pixel)
                        if signal:
                            signals.append(DirectionSignal(signal.name, signal.probabilities, signal.weight, {**signal.details, **metadata}))
                    except Exception as error:
                        image_failures += 1
                        if args.fail_on_image_error:
                            raise RuntimeError(f"SWISSIMAGE failed for {bench['id']}: {error}") from error
                analysis.execute("INSERT INTO direction_analysis_benches VALUES(?,?,?,?,?,?,?,?,?,?)", (
                    run_id, row_id, bench["id"], bench["latitude"], bench["longitude"], bench["direction_degrees"],
                    spatial_split(float(bench["latitude"]), float(bench["longitude"])), int(viewpoint), bench["source_updated_at"], bench["canton_name"],
                ))
                for signal in signals:
                    analysis.execute("INSERT INTO direction_signals VALUES(?,?,?,?,?,?)", (
                        run_id, row_id, signal.name, signal.weight,
                        json.dumps({str(direction): probability for direction, probability in zip(DIRECTIONS, signal.probabilities)}, separators=(",", ":")),
                        json.dumps(signal.details, separators=(",", ":"), ensure_ascii=False),
                    ))
                processed += 1
                if processed % 100 == 0:
                    analysis.commit()
                    print(json.dumps({"run_id": run_id, "processed": processed, "image_failures": image_failures}), flush=True)
        analysis.commit()
        weights, temperature = calibrate(analysis, run_id)
        rebuild_predictions(analysis, run_id, weights, temperature)
        stats = metrics(analysis, run_id, weights, temperature)
        pbf_identity = f"{pbf.stat().st_size}:{pbf.stat().st_mtime_ns}" if pbf else None
        stats.update(
            run_id=run_id, newly_processed=processed, image_failures=image_failures, weights=weights, temperature=temperature,
            source_versions={"database": source_identity, "osm_pbf": pbf_identity, "method": METHOD_VERSION},
        )
        write_reports(analysis, run_id, report_directory / run_id, stats)
        analysis.execute("UPDATE direction_analysis_runs SET status='completed',weights_json=?,temperature=?,stats_json=?,finished_at=? WHERE run_id=?",
                         (json.dumps(weights), temperature, json.dumps(stats), _now(), run_id))
        analysis.commit()
        return stats
    except BaseException:
        analysis.execute("UPDATE direction_analysis_runs SET status='failed',finished_at=? WHERE run_id=?", (_now(), run_id))
        analysis.commit()
        raise
    finally:
        if terrain:
            terrain.close()
        source.close()
        analysis.close()
