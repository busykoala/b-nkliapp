"""Validation manifest and quality benchmark for scene inference models."""

from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Sequence

from benchly.imagery.client import DEFAULT_MODEL, download_image, infer_scene, inference_endpoint
from benchly.imagery.providers import optional_float
from benchly.imagery.calibration import evaluate_predictions, sample_strata

EVALUATION_CATEGORIES = {
    "true_forest", "forest_edge", "park", "urban", "alpine_open", "waterfront", "irrelevant",
}
LABEL_KEYS = ("relevant", "forest", "lake_view", "mountain_view", "open_view", "limited_view")


def _binary_f1(expected: Sequence[bool], predicted: Sequence[bool]) -> float:
    true_positive = sum(wanted and actual for wanted, actual in zip(expected, predicted))
    false_positive = sum(not wanted and actual for wanted, actual in zip(expected, predicted))
    false_negative = sum(wanted and not actual for wanted, actual in zip(expected, predicted))
    denominator = 2 * true_positive + false_positive + false_negative
    return 1.0 if denominator == 0 else 2 * true_positive / denominator


def validate_evaluation_dataset(records: Sequence[object], allow_small: bool = False) -> list[dict[str, object]]:
    if len(records) < 100 and not allow_small:
        raise ValueError("the public-label benchmark requires at least 100 labelled locations")
    normalized: list[dict[str, object]] = []
    identifiers: set[str] = set()
    categories = {category: 0 for category in EVALUATION_CATEGORIES}
    for raw in records:
        if not isinstance(raw, dict):
            raise ValueError("evaluation record is not an object")
        identifier = str(raw.get("id") or "")
        category = str(raw.get("category") or "")
        latitude, longitude = optional_float(raw.get("latitude")), optional_float(raw.get("longitude"))
        if not identifier or identifier in identifiers:
            raise ValueError("evaluation ids must be present and unique")
        if category not in EVALUATION_CATEGORIES:
            raise ValueError(f"invalid evaluation category: {category}")
        if latitude is None or longitude is None or not (45.7 <= latitude <= 47.9 and 5.7 <= longitude <= 10.7):
            raise ValueError(f"invalid Swiss location: {identifier}")
        expected = raw.get("expected")
        if not isinstance(expected, dict) or any(not isinstance(expected.get(key), bool) for key in LABEL_KEYS):
            raise ValueError(f"missing boolean ground truth: {identifier}")
        images = raw.get("images")
        if not isinstance(images, list) or not 1 <= len(images) <= 4:
            raise ValueError(f"evaluation needs one to four images: {identifier}")
        normalized_images = []
        for image in images:
            if isinstance(image, str) and allow_small:
                normalized_images.append({"url": image, "provider": "fixture", "source_url": image, "license": "fixture"})
                continue
            if not isinstance(image, dict):
                raise ValueError(f"image provenance is required: {identifier}")
            values = {key: str(image.get(key) or "") for key in ("url", "provider", "source_url", "license")}
            if not values["url"].startswith("https://") or not values["source_url"].startswith("https://") or not values["provider"] or not values["license"]:
                raise ValueError(f"invalid image provenance: {identifier}")
            normalized_images.append({**image, **values})
        identifiers.add(identifier)
        categories[category] += 1
        normalized.append({**raw, **sample_strata(raw), "latitude": latitude, "longitude": longitude, "images": normalized_images})
    if not allow_small and any(count < 5 for count in categories.values()):
        raise ValueError("evaluation must contain at least five locations in every required category")
    return normalized


def benchmark_models(dataset_path: Path, models: Sequence[str], allow_small: bool = False,
                     requests_per_second: float = .25) -> dict[str, object]:
    records = validate_evaluation_dataset(
        [json.loads(line) for line in dataset_path.read_text().splitlines() if line.strip()], allow_small,
    )
    endpoint = os.environ.get("INFERENCE_BASE_URL", inference_endpoint())
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    if not api_key:
        raise RuntimeError("INFERENCE_API_KEY is required")
    results: dict[str, dict[str, object]] = {}
    minimum_interval = 1 / max(.05, min(.25, requests_per_second))
    last_image_request = 0.0
    for model in models:
        wanted: dict[str, list[bool]] = {key: [] for key in LABEL_KEYS}
        actual: dict[str, list[bool]] = {key: [] for key in LABEL_KEYS}
        high_confidence_forest: list[tuple[bool, bool]] = []
        durations: list[float] = []
        valid = 0
        predictions = {}
        for record_index, record in enumerate(records, start=1):
            images = []
            for image in record.get("images", [])[:4]:
                time.sleep(max(0, minimum_interval - (time.monotonic() - last_image_request)))
                last_image_request = time.monotonic()
                images.append(download_image(str(image["url"])))
            started = time.monotonic()
            prediction = None
            for attempt in range(2):
                try:
                    prediction = infer_scene(images, endpoint, api_key, model)
                    break
                except (ValueError, json.JSONDecodeError):
                    if attempt:
                        break
            durations.append(time.monotonic() - started)
            if prediction is None:
                continue
            valid += 1
            predictions[record["id"]] = prediction
            expected = record.get("expected", {})
            relevant = prediction["relevance_probability"] >= .55 and prediction["rejection_reason"] == "none"
            high_confidence_forest.append((
                bool(expected.get("forest")),
                relevant and float(prediction["forest_probability"]) >= .9,
            ))
            for key in LABEL_KEYS:
                wanted[key].append(bool(expected.get(key)))
                actual[key].append(relevant if key == "relevant" else relevant and float(prediction[f"{key}_probability"]) >= .5)
            if record_index % 10 == 0 or record_index == len(records):
                print(f"benchmark {model}: {record_index}/{len(records)}", file=sys.stderr, flush=True)
        f1_values = [_binary_f1(wanted[key], actual[key]) for key in LABEL_KEYS if wanted[key]]
        non_forest = [predicted for expected, predicted in zip(wanted["forest"], actual["forest"]) if not expected]
        forest_false_positive_rate = sum(non_forest) / len(non_forest) if non_forest else 0
        high_forest_predictions = sum(predicted for _, predicted in high_confidence_forest)
        high_forest_true_positives = sum(expected and predicted for expected, predicted in high_confidence_forest)
        ordered = sorted(durations)
        p95 = ordered[min(len(ordered) - 1, math.ceil(len(ordered) * .95) - 1)] if ordered else math.inf
        macro_f1 = sum(f1_values) / len(f1_values) if f1_values else 0
        validation = evaluate_predictions(records, predictions)
        results[model] = {
            "validation": validation,
            "locations": len(records), "valid_json_rate": valid / len(records) if records else 0,
            "forest_false_positive_rate": forest_false_positive_rate,
            "high_confidence_forest_predictions": high_forest_predictions,
            "high_confidence_forest_precision": high_forest_true_positives / high_forest_predictions if high_forest_predictions else None,
            "macro_f1": macro_f1, "p95_seconds": p95,
            "accepted": valid == len(records) and bool(validation["calibration_ready"])
            and forest_false_positive_rate <= .02 and macro_f1 >= .85 and p95 <= 20,
        }
    accepted = [model for model in models if results[model]["accepted"]]
    recommended = None
    if accepted:
        best = max(accepted, key=lambda model: float(results[model]["macro_f1"]))
        recommended = DEFAULT_MODEL if DEFAULT_MODEL in accepted and float(results[best]["macro_f1"]) - float(results[DEFAULT_MODEL]["macro_f1"]) <= .02 else best
    return {"models": results, "recommended": recommended}
