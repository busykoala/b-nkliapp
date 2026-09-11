"""Held-out calibration and subgroup metrics for a growing, human-labelled benchmark."""
from __future__ import annotations
import hashlib
import math
from collections import defaultdict
import numpy as np
from scipy.optimize import minimize

STRATA = ("canton", "region", "elevation_band", "landscape_type", "provider", "distance_band", "season", "capture_date", "image_quality")
LABELS = ("relevant", "forest", "lake_view", "mountain_view", "open_view", "limited_view")


def sample_strata(record):
    record = {key: value for key, value in record.items() if value != "unknown"}
    images = record.get("images", [])
    first = images[0] if images and isinstance(images[0], dict) else {}
    elevation = record.get("elevation_meters")
    distance = record.get("imagery_distance_meters")
    return {**{key: record.get(key) or "unknown" for key in STRATA},
        "provider": record.get("provider") or first.get("provider", "unknown"),
        "landscape_type": record.get("landscape_type") or record.get("category", "unknown"),
        "elevation_band": record.get("elevation_band") or ("unknown" if elevation is None else "low" if elevation < 800 else "montane" if elevation < 1600 else "alpine"),
        "distance_band": record.get("distance_band") or ("unknown" if distance is None else "0-15m" if distance <= 15 else "15-50m" if distance <= 50 else "50m+")}


def benchmark_coverage(records):
    coverage = {key: defaultdict(int) for key in STRATA}
    for record in records:
        for key, value in sample_strata(record).items():
            coverage[key][str(value)] += 1
    return {"labelled": len(records), "physical_labels_reviewed": sum(bool(record.get("physical_reviewed_at")) for record in records),
            "strata": {key: dict(counts) for key, counts in coverage.items()}}


def split_groups(records):
    """Keep shared images and local coordinate clusters in the same partition."""
    parents = list(range(len(records)))
    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index
    seen = {}
    for index, record in enumerate(records):
        keys = [f"cell:{math.floor(record['latitude'] * 100)}:{math.floor(record['longitude'] * 100)}", f"bench:{record.get('bench_id', record['id'])}"]
        keys += [f"image:{item['url']}" for item in record.get("images", []) if isinstance(item, dict)]
        for key in keys:
            if key in seen:
                parents[root(index)] = root(seen[key])
            seen[key] = index
    groups = defaultdict(list)
    for index, record in enumerate(records):
        groups[root(index)].append(record["id"])
    # A 20% split left only 17 calibration locations in the checked-in
    # 100-location grouped benchmark, below fit_platt's minimum of 30. Keep
    # shared imagery and coordinate clusters together, but reserve roughly a
    # third so calibration can be evaluated rather than silently skipped.
    labels = {key: "calibration" if int(hashlib.sha256(min(ids).encode()).hexdigest()[:8], 16) % 3 == 0 else "test" for key, ids in groups.items()}
    return [labels[root(index)] for index in range(len(records))]


def metrics(expected, scores, bins=10):
    pairs = list(zip(expected, scores))
    if not pairs:
        return {"count": 0, "precision": None, "recall": None, "f1": None, "brier": None, "ece": None, "confusion": {"tp": 0, "fp": 0, "tn": 0, "fn": 0}, "reliability": []}
    tp = sum(bool(y) and p >= .5 for y, p in pairs)
    fp = sum(not y and p >= .5 for y, p in pairs)
    fn = sum(bool(y) and p < .5 for y, p in pairs)
    tn = len(pairs) - tp - fp - fn
    reliability = []
    for index in range(bins):
        bucket = [(y, p) for y, p in pairs if min(bins - 1, int(p * bins)) == index]
        reliability.append({"from": index / bins, "to": (index + 1) / bins, "count": len(bucket),
            "mean_score": sum(p for _, p in bucket) / len(bucket) if bucket else None,
            "observed_frequency": sum(y for y, _ in bucket) / len(bucket) if bucket else None})
    return {"count": len(pairs), "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None, "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None,
        "brier": sum((p - y) ** 2 for y, p in pairs) / len(pairs),
        "ece": sum(bucket["count"] * abs(bucket["mean_score"] - bucket["observed_frequency"]) for bucket in reliability if bucket["count"]) / len(pairs),
        "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn}, "reliability": reliability}


def fit_platt(expected, scores):
    if len(scores) < 30 or sum(expected) < 5 or len(expected) - sum(expected) < 5:
        return None
    logits = np.log(np.clip(scores, 1e-5, 1 - 1e-5) / (1 - np.clip(scores, 1e-5, 1 - 1e-5)))
    truth = np.array(expected, dtype=float)
    def loss(params):
        z = params[0] * logits + params[1]
        return float(np.mean(np.logaddexp(0, z) - truth * z) + .001 * np.sum(np.square(params)))
    result = minimize(loss, np.array([1., 0.]), method="L-BFGS-B", bounds=[(0, 10), (-10, 10)])
    return [float(value) for value in result.x] if result.success else None


def calibrated_score(score, params):
    clipped = min(1 - 1e-5, max(1e-5, score))
    logit = params[0] * math.log(clipped / (1 - clipped)) + params[1]
    return 1 / (1 + math.exp(-logit))


def evaluate_predictions(records, predictions):
    partitions = split_groups(records)
    report = {"method": "held-out-platt-2", "coverage": benchmark_coverage(records), "labels": {}, "subgroups": {},
              "split": {part: sum(value == part for value in partitions) for part in ("calibration", "test")},
              "note": "Raw model scores are not calibrated probabilities; calibration is fitted only on the calibration partition."}
    for label in LABELS:
        key = "relevance_probability" if label == "relevant" else f"{label}_probability"
        calibration = [(record["expected"][label], predictions[record["id"]][key]) for record, part in zip(records, partitions) if part == "calibration" and record["id"] in predictions]
        params = fit_platt([y for y, _ in calibration], [p for _, p in calibration])
        test = [(record, predictions[record["id"]][key]) for record, part in zip(records, partitions) if part == "test" and record["id"] in predictions]
        report["labels"][label] = {"raw": metrics([record["expected"][label] for record, _ in test], [score for _, score in test]),
            "calibration_parameters": params, "calibrated": metrics([record["expected"][label] for record, _ in test], [calibrated_score(score, params) for _, score in test]) if params else None}
        for stratum in STRATA:
            groups = defaultdict(list)
            for record, score in test:
                groups[str(sample_strata(record)[stratum])].append((record["expected"][label], score))
            report["subgroups"].setdefault(stratum, {})[label] = {
                name: {"raw": metrics([y for y, _ in pairs], [p for _, p in pairs]),
                       "calibrated": metrics([y for y, _ in pairs], [calibrated_score(p, params) for _, p in pairs]) if params else None}
                for name, pairs in groups.items()}
    report["calibration_ready"] = report["split"]["calibration"] >= 30 and all(
        report["labels"][label]["calibration_parameters"] is not None for label in LABELS
    )
    return report
