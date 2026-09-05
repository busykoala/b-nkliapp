"""Bounded open-imagery discovery, inference and evidence reconciliation.

Image bytes exist only in local variables for the duration of one inference call.
They are never written to SQLite, a file, or an application media row.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable, Optional, Sequence

from benchly.catalog import load_catalog
from benchly.geo import bearing_degrees, circular_difference
from benchly.imagery.discovery import discover_images
from benchly.imagery.evidence import audit_environment, likely_provenance_issues, reconcile_environment
from benchly.imagery.prediction import prediction_schema as _prediction_schema, validate_scene_prediction
from benchly.imagery.providers import (
    DiscoveredImage,
    ProviderDelay,
    optional_float as _float,
    search_commons as provider_search_commons,
    search_kartaview as provider_search_kartaview,
    search_panoramax as provider_search_panoramax,
    search_swissimage,
    swissimage_at,
)
from benchly.imagery.repository import (
    mark_analyzed,
    mark_grouped,
    mark_retry,
)
from benchly.runtime import now_iso

_RUNTIME = load_catalog().runtime
_PROVIDERS = load_catalog().providers
PROMPT_VERSION = _RUNTIME.scenePromptVersion
DEFAULT_MODEL = "benchly-vision"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BYTES = 24 * 1024 * 1024
EVALUATION_CATEGORIES = {
    "true_forest", "forest_edge", "park", "urban", "alpine_open", "waterfront", "irrelevant",
}


def _request_json(url: str, *, data: Optional[bytes] = None, headers: Optional[dict[str, str]] = None, timeout: int = 45) -> object:
    request_headers = {"User-Agent": "Benchly/1.0 (open imagery metadata; contact: bänkliapp.ch)", **(headers or {})}
    request = urllib.request.Request(url, data=data, headers=request_headers)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            retry_after = error.headers.get("Retry-After")
            if error.code in {429, 503}:
                raise ProviderDelay(
                    f"{error.code} from {urllib.parse.urlsplit(url).netloc}",
                    int(retry_after) if retry_after and retry_after.isdigit() else 3600,
                ) from error
            if error.code < 500 or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)
    raise RuntimeError("unreachable provider retry state")


def search_panoramax(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    return provider_search_panoramax(bounds, _request_json)


def search_commons(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    return provider_search_commons(bounds, _request_json)


def search_kartaview(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    return provider_search_kartaview(bounds, _request_json)


PROVIDERS = {
    "Panoramax": search_panoramax,
    "Wikimedia Commons": search_commons,
    "KartaView": search_kartaview,
    "SWISSIMAGE": search_swissimage,
}


def discover_open_images(connection: sqlite3.Connection, max_cells: int = 500, cell_degrees: float = 0.02,
                         requests_per_second: float = 1.0,
                         bounds: Optional[tuple[float, float, float, float]] = None,
                         include_resolved: bool = False) -> dict[str, int]:
    return discover_images(
        connection,
        PROVIDERS,
        swissimage_at,
        max_cells=max_cells,
        cell_degrees=cell_degrees,
        requests_per_second=requests_per_second,
        bounds=bounds,
        include_resolved=include_resolved,
    )


def _download_image(url: str) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (temporary scene analysis)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_type = response.headers.get_content_type()
        if not content_type.startswith("image/"):
            raise ValueError(f"not an image: {content_type}")
        payload = response.read(MAX_IMAGE_BYTES + 1)
    if len(payload) > MAX_IMAGE_BYTES:
        raise ValueError("image exceeds 8 MB")
    return payload, content_type


SCENE_PROMPT = """Analyze these nearby, openly licensed photographs only as environmental evidence.
Do not identify or describe people, faces, licence plates, addresses or other personal information.
Reject indoor, blurred, historical/artwork, close-object and otherwise irrelevant frames.
Forest means predominantly continuous woodland with dense trees and understory. A park, waterfront,
street, garden, orchard, row of trees or isolated overhead canopy is not forest. Never infer forest
from one tree or canopy alone. Mark lake, mountain, open or limited view only when actually visible.
Return JSON only with every key below. Probabilities are numbers from 0 to 1:
relevance_probability, rejection_reason (none|blurred|indoor|close_object|historical|unrelated),
forest_probability, park_probability, open_probability, urban_probability,
canopy_context (none|partial|dense|unknown), canopy_probability,
water_probability, lake_view_probability, mountain_view_probability, open_view_probability,
limited_view_probability, buildings_probability, road_rail_probability, bench_visible_probability.
Judge the shared scene, not the identity of any person or object owner."""

FRAME_PROMPT = """Analyze each numbered nearby, openly licensed photograph independently.
Do not identify or describe people, faces, licence plates, addresses or other personal information.
Mark indoor, blurred, historical/artwork, close-object and unrelated frames as irrelevant instead of
letting them influence the other frames. Forest means predominantly continuous woodland with dense
trees and understory; parks, waterfronts, streets, gardens, orchards, rows of trees and isolated canopy
are not forest. Mark view traits only when actually visible. Return one strict prediction per index."""


def _response_schema(name: str, schema: dict[str, object]) -> dict[str, object]:
    return {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}


def _content_from_response(payload: object) -> object:
    if not isinstance(payload, dict):
        raise ValueError("invalid inference response")
    content = payload.get("choices", [{}])[0].get("message", {}).get("content")
    if isinstance(content, list):
        content = "".join(item.get("text", "") for item in content if isinstance(item, dict))
    if not isinstance(content, str):
        raise ValueError("missing inference content")
    text = content.strip().removeprefix("```json").removesuffix("```").strip()
    return json.loads(text)


def _prediction_from_response(payload: object) -> dict[str, object]:
    return validate_scene_prediction(_content_from_response(payload))


def _image_content(images: Sequence[tuple[bytes, str]], prompt: str, numbered: bool = False) -> list[dict[str, object]]:
    content: list[dict[str, object]] = [{"type": "text", "text": prompt}]
    for index, (payload, content_type) in enumerate(images):
        if numbered:
            content.append({"type": "text", "text": f"Frame {index}"})
        encoded = base64.b64encode(payload).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{encoded}"}})
    return content


def _inference_request(images: Sequence[tuple[bytes, str]], endpoint: str, api_key: str, model: str,
                       prompt: str, response_format: dict[str, object], numbered: bool = False) -> object:
    encoded_bytes = sum(4 * math.ceil(len(payload) / 3) for payload, _ in images)
    if not images or encoded_bytes > MAX_REQUEST_BYTES:
        raise ValueError("invalid inference image payload")
    request_payload = json.dumps({
        "model": model, "temperature": 0, "max_tokens": 1800,
        "messages": [{"role": "user", "content": _image_content(images, prompt, numbered)}],
        "response_format": response_format,
    }, separators=(",", ":")).encode()
    if len(request_payload) > MAX_REQUEST_BYTES:
        raise ValueError("invalid inference request payload")
    return _request_json(
        endpoint.rstrip("/") + "/v1/chat/completions", data=request_payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, timeout=180,
    )


def infer_scene(images: Sequence[tuple[bytes, str]], endpoint: str, api_key: str, model: str = DEFAULT_MODEL) -> dict[str, object]:
    payload = _inference_request(
        images, endpoint, api_key, model, SCENE_PROMPT,
        _response_schema("benchly_scene", _prediction_schema()),
    )
    return _prediction_from_response(payload)


def infer_scene_frames(images: Sequence[tuple[bytes, str]], endpoint: str, api_key: str,
                       model: str = DEFAULT_MODEL) -> list[dict[str, object]]:
    frame_schema = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "frames": {
                "type": "array", "minItems": len(images), "maxItems": len(images),
                "items": {
                    "type": "object", "additionalProperties": False,
                    "properties": {"index": {"type": "integer", "minimum": 0, "maximum": max(0, len(images) - 1)},
                                   "prediction": _prediction_schema()},
                    "required": ["index", "prediction"],
                },
            },
        },
        "required": ["frames"],
    }
    payload = _inference_request(
        images, endpoint, api_key, model, FRAME_PROMPT,
        _response_schema("benchly_frames", frame_schema), numbered=True,
    )
    value = _content_from_response(payload)
    if not isinstance(value, dict) or not isinstance(value.get("frames"), list):
        raise ValueError("missing frame predictions")
    predictions: list[Optional[dict[str, object]]] = [None] * len(images)
    for item in value["frames"]:
        if not isinstance(item, dict) or not isinstance(item.get("index"), int):
            raise ValueError("invalid frame prediction")
        index = item["index"]
        if not 0 <= index < len(images) or predictions[index] is not None:
            raise ValueError("invalid frame index")
        predictions[index] = validate_scene_prediction(item.get("prediction"))
    if any(prediction is None for prediction in predictions):
        raise ValueError("incomplete frame predictions")
    return [prediction for prediction in predictions if prediction is not None]


def _diverse_frames(rows: Sequence[sqlite3.Row], maximum: int = 4) -> list[sqlite3.Row]:
    selected: list[sqlite3.Row] = []
    buckets: set[object] = set()
    for row in rows:
        bucket: object = round(float(row["heading"]) / 45) % 8 if row["heading"] is not None else row["id"]
        if bucket in buckets:
            continue
        buckets.add(bucket)
        selected.append(row)
        if len(selected) == maximum:
            break
    return selected


def analyze_scenes(connection: sqlite3.Connection, limit: int, deadline: float, requests_per_second: float = .25,
                   bounds: Optional[tuple[float, float, float, float]] = None) -> dict[str, int]:
    endpoint = os.environ.get("INFERENCE_BASE_URL", str(_PROVIDERS.inferenceDefaultUrl))
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    model = os.environ.get("BENCHLY_VISION_MODEL", DEFAULT_MODEL)
    if not api_key:
        raise RuntimeError("INFERENCE_API_KEY is required")
    groups_today = connection.execute("""
      SELECT count(*) FROM (
        SELECT provider,capture_group_id FROM image_observations
        WHERE analyzed_at IS NOT NULL AND date(analyzed_at)=date('now')
        GROUP BY provider,capture_group_id
      )
    """).fetchone()[0]
    limit = max(0, min(limit, 300 - int(groups_today)))
    target_join = ""
    target_clause = ""
    parameters: list[object] = []
    if bounds:
        target_join = """JOIN bench_image_evidence target_e ON target_e.image_observation_id=image_observations.id
          JOIN benches target_b ON target_b.row_id=target_e.bench_row_id"""
        target_clause = "AND target_b.longitude BETWEEN ? AND ? AND target_b.latitude BETWEEN ? AND ?"
        parameters.extend((bounds[0], bounds[2], bounds[1], bounds[3]))
    parameters.append(limit)
    groups = connection.execute(f"""
        SELECT provider,capture_group_id,min(discovered_at) discovered_at
        FROM image_observations {target_join}
        WHERE analysis_status IN ('pending','retry') AND attempts<3
          AND coalesce(license,'')<>'' AND source_url LIKE 'https://%' AND fetch_url LIKE 'https://%'
          {target_clause}
        GROUP BY provider,capture_group_id ORDER BY discovered_at LIMIT ?
    """, parameters).fetchall()
    stats = {"groups": 0, "images": 0, "failed": 0, "irrelevant": 0}
    minimum_interval = 1 / max(.05, requests_per_second)
    last_image_request = 0.0
    for group in groups:
        if time.monotonic() >= deadline:
            break
        rows = connection.execute("""
            SELECT o.*,coalesce(min(e.distance_meters),999) nearest_bench
            FROM image_observations o LEFT JOIN bench_image_evidence e ON e.image_observation_id=o.id
            WHERE o.provider=? AND o.capture_group_id=?
              AND coalesce(o.license,'')<>'' AND o.source_url LIKE 'https://%' AND o.fetch_url LIKE 'https://%'
            GROUP BY o.id ORDER BY nearest_bench,o.id
        """, (group["provider"], group["capture_group_id"])).fetchall()
        frames = _diverse_frames(rows)
        started = time.monotonic()
        try:
            in_memory: list[tuple[bytes, str]] = []
            for row in frames:
                time.sleep(max(0, minimum_interval - (time.monotonic() - last_image_request)))
                last_image_request = time.monotonic()
                in_memory.append(_download_image(row["fetch_url"]))
            hashes = [hashlib.sha256(payload).hexdigest() for payload, _ in in_memory]
            predictions = None
            for attempt in range(2):
                try:
                    predictions = infer_scene_frames(in_memory, endpoint, api_key, model)
                    break
                except (ValueError, json.JSONDecodeError):
                    if attempt:
                        raise
            assert predictions is not None
            relevant_count = 0
            for index, (row, prediction) in enumerate(zip(frames, predictions)):
                relevant = prediction["relevance_probability"] >= .55 and prediction["rejection_reason"] == "none"
                status = "analyzed" if relevant else "irrelevant"
                mark_analyzed(connection, row["id"], {
                    "analysis_status": status,
                    "relevance_probability": prediction["relevance_probability"],
                    "predictions": json.dumps(prediction, separators=(",", ":")),
                    "image_sha256": hashes[index],
                    "model_version": model,
                    "prompt_version": PROMPT_VERSION,
                    "analyzed_at": now_iso(),
                })
            # Frames not selected are redundant members of the same capture group.
            selected_ids = {row["id"] for row in frames}
            mark_grouped(
                connection,
                [row["id"] for row in rows if row["id"] not in selected_ids],
                model,
                PROMPT_VERSION,
                now_iso(),
            )
            stats["groups"] += 1
            stats["images"] += len(frames)
            relevant_count = sum(
                prediction["relevance_probability"] >= .55 and prediction["rejection_reason"] == "none"
                for prediction in predictions
            )
            stats["irrelevant"] += len(frames) - relevant_count
        except Exception as error:
            mark_retry(connection, [row["id"] for row in frames], str(error))
            stats["failed"] += 1
        finally:
            # No image object escapes this iteration; CPython releases the byte buffers here.
            connection.commit()
            time.sleep(max(0, minimum_interval - (time.monotonic() - started)))
    return stats


def _binary_f1(expected: Sequence[bool], predicted: Sequence[bool]) -> float:
    true_positive = sum(wanted and actual for wanted, actual in zip(expected, predicted))
    false_positive = sum(not wanted and actual for wanted, actual in zip(expected, predicted))
    false_negative = sum(wanted and not actual for wanted, actual in zip(expected, predicted))
    denominator = 2 * true_positive + false_positive + false_negative
    return 1.0 if denominator == 0 else 2 * true_positive / denominator


def validate_evaluation_dataset(records: Sequence[object], allow_small: bool = False) -> list[dict[str, object]]:
    label_keys = ("relevant", "forest", "lake_view", "mountain_view", "open_view", "limited_view")
    if len(records) < 100 and not allow_small:
        raise ValueError("the public-label benchmark requires at least 100 labelled locations")
    normalized: list[dict[str, object]] = []
    identifiers: set[str] = set()
    categories: dict[str, int] = {category: 0 for category in EVALUATION_CATEGORIES}
    for raw in records:
        if not isinstance(raw, dict):
            raise ValueError("evaluation record is not an object")
        identifier = str(raw.get("id") or "")
        category = str(raw.get("category") or "")
        latitude, longitude = _float(raw.get("latitude")), _float(raw.get("longitude"))
        if not identifier or identifier in identifiers:
            raise ValueError("evaluation ids must be present and unique")
        if category not in EVALUATION_CATEGORIES:
            raise ValueError(f"invalid evaluation category: {category}")
        if latitude is None or longitude is None or not (45.7 <= latitude <= 47.9 and 5.7 <= longitude <= 10.7):
            raise ValueError(f"invalid Swiss location: {identifier}")
        expected = raw.get("expected")
        if not isinstance(expected, dict) or any(not isinstance(expected.get(key), bool) for key in label_keys):
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
            normalized_images.append(values)
        identifiers.add(identifier)
        categories[category] += 1
        normalized.append({**raw, "latitude": latitude, "longitude": longitude, "images": normalized_images})
    if not allow_small and any(count < 5 for count in categories.values()):
        raise ValueError("evaluation must contain at least five locations in every required category")
    return normalized


def benchmark_models(dataset_path, models: Sequence[str], allow_small: bool = False,
                     requests_per_second: float = .25) -> dict[str, object]:
    records = validate_evaluation_dataset(
        [json.loads(line) for line in dataset_path.read_text().splitlines() if line.strip()], allow_small,
    )
    endpoint = os.environ.get("INFERENCE_BASE_URL", str(_PROVIDERS.inferenceDefaultUrl))
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    if not api_key:
        raise RuntimeError("INFERENCE_API_KEY is required")
    label_keys = ("relevant", "forest", "lake_view", "mountain_view", "open_view", "limited_view")
    results: dict[str, dict[str, object]] = {}
    minimum_interval = 1 / max(.05, min(.25, requests_per_second))
    last_image_request = 0.0
    for model in models:
        wanted: dict[str, list[bool]] = {key: [] for key in label_keys}
        actual: dict[str, list[bool]] = {key: [] for key in label_keys}
        high_confidence_forest: list[tuple[bool, bool]] = []
        durations: list[float] = []
        valid = 0
        for record_index, record in enumerate(records, start=1):
            images = []
            for image in record.get("images", [])[:4]:
                time.sleep(max(0, minimum_interval - (time.monotonic() - last_image_request)))
                last_image_request = time.monotonic()
                images.append(_download_image(str(image["url"])))
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
            expected = record.get("expected", {})
            relevant = prediction["relevance_probability"] >= .55 and prediction["rejection_reason"] == "none"
            high_confidence_forest.append((
                bool(expected.get("forest")),
                relevant and float(prediction["forest_probability"]) >= .9,
            ))
            for key in label_keys:
                wanted[key].append(bool(expected.get(key)))
                if key == "relevant":
                    actual[key].append(relevant)
                else:
                    actual[key].append(relevant and float(prediction[f"{key}_probability"]) >= .5)
            if record_index % 10 == 0 or record_index == len(records):
                print(f"benchmark {model}: {record_index}/{len(records)}", file=sys.stderr, flush=True)
        f1_values = [_binary_f1(wanted[key], actual[key]) for key in label_keys if wanted[key]]
        non_forest = [(expected, predicted) for expected, predicted in zip(wanted["forest"], actual["forest"]) if not expected]
        forest_false_positive_rate = sum(predicted for _, predicted in non_forest) / len(non_forest) if non_forest else 0
        high_forest_predictions = sum(predicted for _, predicted in high_confidence_forest)
        high_forest_true_positives = sum(expected and predicted for expected, predicted in high_confidence_forest)
        high_forest_precision = high_forest_true_positives / high_forest_predictions if high_forest_predictions else None
        ordered = sorted(durations)
        p95 = ordered[min(len(ordered) - 1, math.ceil(len(ordered) * .95) - 1)] if ordered else math.inf
        macro_f1 = sum(f1_values) / len(f1_values) if f1_values else 0
        results[model] = {
            "locations": len(records), "valid_json_rate": valid / len(records) if records else 0,
            "forest_false_positive_rate": forest_false_positive_rate,
            "high_confidence_forest_predictions": high_forest_predictions,
            "high_confidence_forest_precision": high_forest_precision,
            "macro_f1": macro_f1, "p95_seconds": p95,
            "accepted": valid == len(records) and forest_false_positive_rate <= .02 and macro_f1 >= .85 and p95 <= 20,
        }
    accepted = [model for model in models if results[model]["accepted"]]
    recommended = None
    if accepted:
        best = max(accepted, key=lambda model: float(results[model]["macro_f1"]))
        if DEFAULT_MODEL in accepted and float(results[best]["macro_f1"]) - float(results[DEFAULT_MODEL]["macro_f1"]) <= .02:
            recommended = DEFAULT_MODEL
        else:
            recommended = best
    return {"models": results, "recommended": recommended}
