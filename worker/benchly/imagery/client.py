"""Bounded image download and schema-constrained inference client."""

from __future__ import annotations

import base64
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional, Sequence

from benchly.catalog import load_catalog
from benchly.imagery.prediction import prediction_schema, validate_scene_prediction
from benchly.imagery.providers import ProviderDelay
from benchly.imagery.contracts import InferenceResponse

DEFAULT_MODEL = "benchly-vision"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BYTES = 24 * 1024 * 1024

ASSESSMENT_GUIDE = """Assess the immediate setting and the visible horizontal view separately.
The four land probabilities describe alternative dominant surroundings: forest is continuous woodland,
park is managed green space or garden, open is field/meadow/alpine terrain with few built elements, and
urban is predominantly buildings or paving. A tree row, orchard or one large tree is not a forest.
View probabilities are independent and may be high together. Open view means a broad horizontal
landscape sightline into the distance; visible sky above a wall, arch, hedge or close trees is not an
open view. Limited view means most horizontal sightlines are blocked nearby. Mountain view requires
recognisable high or steep alpine terrain; low rounded wooded or agricultural hills are not mountains.
Lake view requires an actually visible lake. Never infer a view from location metadata.
Canopy describes the local overhead tree cover, independently of the land class. Judge every field;
do not force unrelated probabilities to zero merely because one trait is strong."""

SCENE_PROMPT = f"""Analyze these nearby photographs, authorized for this analysis, only as environmental evidence.
Do not identify or describe people, faces, licence plates, addresses or other personal information.
Reject indoor, blurred, historical/artwork, close-object and otherwise irrelevant frames.
{ASSESSMENT_GUIDE}
Return JSON only with every key below. Probabilities are numbers from 0 to 1:
relevance_probability, rejection_reason (none|blurred|indoor|close_object|historical|unrelated),
forest_probability, park_probability, open_probability, urban_probability,
canopy_context (none|partial|dense|unknown), canopy_probability,
water_probability, lake_view_probability, mountain_view_probability, open_view_probability,
limited_view_probability, buildings_probability, road_rail_probability, bench_visible_probability.
Judge the shared scene, not the identity of any person or object owner."""

FRAME_PROMPT = f"""Analyze each numbered nearby photograph, authorized for this analysis, independently.
Do not identify or describe people, faces, licence plates, addresses or other personal information.
Mark indoor, blurred, historical/artwork, close-object and unrelated frames as irrelevant instead of
letting them influence the other frames. {ASSESSMENT_GUIDE}
Return one strict prediction per index."""


def _request_json(url: str, *, data: Optional[bytes] = None,
                  headers: Optional[dict[str, str]] = None, timeout: int = 45) -> object:
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


def download_image(url: str) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (temporary scene analysis)"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            content_type = response.headers.get_content_type()
            if not content_type.startswith("image/"):
                raise ValueError(f"not an image: {content_type}")
            payload = response.read(MAX_IMAGE_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code in {429, 503}:
            retry_after = error.headers.get("Retry-After")
            raise ProviderDelay(
                f"{error.code} from {urllib.parse.urlsplit(url).netloc}",
                int(retry_after) if retry_after and retry_after.isdigit() else 3600,
            ) from error
        raise
    if len(payload) > MAX_IMAGE_BYTES:
        raise ValueError("image exceeds 8 MB")
    return payload, content_type


def _response_schema(name: str, schema: dict[str, object]) -> dict[str, object]:
    return {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}


def _content_from_response(payload: object) -> object:
    content = InferenceResponse.model_validate(payload).choices[0].message.content
    if isinstance(content, list):
        content = "".join(item.get("text", "") for item in content if isinstance(item, dict))
    if not isinstance(content, str):
        raise ValueError("missing inference content")
    return json.loads(content.strip().removeprefix("```json").removesuffix("```").strip())


def _image_content(images: Sequence[tuple[bytes, str]], prompt: str,
                   numbered: bool = False) -> list[dict[str, object]]:
    content: list[dict[str, object]] = [{"type": "text", "text": prompt}]
    for index, (payload, content_type) in enumerate(images):
        if numbered:
            content.append({"type": "text", "text": f"Frame {index}"})
        encoded = base64.b64encode(payload).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{encoded}"}})
    return content


def _inference_request(images: Sequence[tuple[bytes, str]], endpoint: str, api_key: str, model: str,
                       prompt: str, response_format: dict[str, object], numbered: bool = False,
                       disable_thinking: bool = False) -> object:
    encoded_bytes = sum(4 * math.ceil(len(payload) / 3) for payload, _ in images)
    if not images or encoded_bytes > MAX_REQUEST_BYTES:
        raise ValueError("invalid inference image payload")
    request_payload = json.dumps({
        "model": model, "temperature": 0, "max_tokens": 1800,
        "messages": [{"role": "user", "content": _image_content(images, prompt, numbered)}],
        "response_format": response_format,
        **({"chat_template_kwargs": {"enable_thinking": False}} if disable_thinking else {}),
    }, separators=(",", ":")).encode()
    if len(request_payload) > MAX_REQUEST_BYTES:
        raise ValueError("invalid inference request payload")
    return _request_json(
        endpoint.rstrip("/") + "/v1/chat/completions", data=request_payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, timeout=180,
    )


def infer_scene(images: Sequence[tuple[bytes, str]], endpoint: str, api_key: str,
                model: str = DEFAULT_MODEL) -> dict[str, object]:
    payload = _inference_request(
        images, endpoint, api_key, model, SCENE_PROMPT,
        _response_schema("benchly_scene", prediction_schema()),
    )
    return validate_scene_prediction(_content_from_response(payload))


def infer_scene_frames(images: Sequence[tuple[bytes, str]], endpoint: str, api_key: str,
                       model: str = DEFAULT_MODEL) -> list[dict[str, object]]:
    frame_schema = {
        "type": "object", "additionalProperties": False,
        "properties": {"frames": {"type": "array", "minItems": len(images), "maxItems": len(images), "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"index": {"type": "integer", "minimum": 0, "maximum": max(0, len(images) - 1)},
                           "prediction": prediction_schema()},
            "required": ["index", "prediction"],
        }}},
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


def inference_endpoint() -> str:
    return str(load_catalog().providers.inferenceDefaultUrl)
