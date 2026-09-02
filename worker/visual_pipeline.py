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
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Sequence

PROMPT_VERSION = "benchly-scene-1.0"
RECONCILER_VERSION = "benchly-evidence-1.0"
DEFAULT_MODEL = "benchly-vision"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BYTES = 24 * 1024 * 1024


@dataclass(frozen=True)
class DiscoveredImage:
    provider: str
    provider_image_id: str
    capture_group_id: str
    source_url: str
    fetch_url: str
    latitude: float
    longitude: float
    heading: Optional[float] = None
    captured_at: Optional[str] = None
    author: Optional[str] = None
    license: Optional[str] = None


class ProviderDelay(RuntimeError):
    def __init__(self, message: str, seconds: int = 3600):
        super().__init__(message)
        self.seconds = seconds


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def distance_meters(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    mean_latitude = math.radians((latitude_a + latitude_b) / 2)
    return math.hypot(
        (latitude_b - latitude_a) * 111_320,
        (longitude_b - longitude_a) * 111_320 * math.cos(mean_latitude),
    )


def bearing_degrees(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    latitude_a_rad, latitude_b_rad = math.radians(latitude_a), math.radians(latitude_b)
    longitude_delta = math.radians(longitude_b - longitude_a)
    y = math.sin(longitude_delta) * math.cos(latitude_b_rad)
    x = math.cos(latitude_a_rad) * math.sin(latitude_b_rad) - math.sin(latitude_a_rad) * math.cos(latitude_b_rad) * math.cos(longitude_delta)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def circular_difference(first: float, second: float) -> float:
    return abs(((first - second + 540) % 360) - 180)


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


def _float(value: object) -> Optional[float]:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def search_panoramax(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    endpoint = os.environ.get("PANORAMAX_API", "https://api.panoramax.xyz/api/search")
    url = endpoint + "?" + urllib.parse.urlencode({"bbox": ",".join(map(str, bounds)), "limit": "100"})
    payload = _request_json(url)
    features = payload.get("features", []) if isinstance(payload, dict) else []
    results: list[DiscoveredImage] = []
    for feature in features:
        properties = feature.get("properties", {})
        coordinates = feature.get("geometry", {}).get("coordinates", [])
        image_id = str(properties.get("id") or feature.get("id") or "")
        if not image_id or len(coordinates) < 2:
            continue
        assets = properties.get("assets") or feature.get("assets") or {}
        fetch_url = next((asset.get("href") for key in ("sd", "thumb", "hd", "original") if isinstance((asset := assets.get(key)), dict) and asset.get("href")), None)
        if not fetch_url:
            fetch_url = f"{endpoint.rsplit('/api/', 1)[0]}/api/pictures/{urllib.parse.quote(image_id)}/sd.jpg"
        sequence = properties.get("sequence") or properties.get("sequence_id") or image_id
        results.append(DiscoveredImage(
            provider="Panoramax", provider_image_id=image_id,
            capture_group_id=f"panoramax:{sequence}",
            source_url=str(properties.get("view_url") or f"https://panoramax.xyz/#focus=pic&pic={urllib.parse.quote(image_id)}"),
            fetch_url=str(fetch_url), latitude=float(coordinates[1]), longitude=float(coordinates[0]),
            heading=_float(properties.get("heading") or properties.get("compass_angle")),
            captured_at=properties.get("datetime"), author=properties.get("author"),
            license=properties.get("license") or "CC-BY-SA-4.0",
        ))
    return results


def search_commons(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    west, south, east, north = bounds
    latitude, longitude = (south + north) / 2, (west + east) / 2
    radius = min(10_000, max(300, int(distance_meters(south, west, north, east) / 2)))
    parameters = {
        "action": "query", "format": "json", "generator": "geosearch", "ggsnamespace": "6",
        "ggscoord": f"{latitude}|{longitude}", "ggsradius": str(radius), "ggslimit": "100",
        "prop": "coordinates|imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": "1280",
    }
    payload = _request_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(parameters))
    pages = payload.get("query", {}).get("pages", {}).values() if isinstance(payload, dict) else []
    results: list[DiscoveredImage] = []
    for page in pages:
        coordinates = (page.get("coordinates") or [{}])[0]
        info = (page.get("imageinfo") or [{}])[0]
        latitude_value, longitude_value = _float(coordinates.get("lat")), _float(coordinates.get("lon"))
        image_id = str(page.get("pageid") or "")
        fetch_url = info.get("thumburl") or info.get("url")
        if latitude_value is None or longitude_value is None or not image_id or not fetch_url:
            continue
        metadata = info.get("extmetadata") or {}
        metadata_value = lambda key: (metadata.get(key) or {}).get("value")
        captured_at = metadata_value("DateTimeOriginal") or metadata_value("DateTime")
        group_day = str(captured_at or "unknown")[:10]
        group_location = f"{round(latitude_value, 4)}:{round(longitude_value, 4)}"
        results.append(DiscoveredImage(
            provider="Wikimedia Commons", provider_image_id=image_id,
            capture_group_id=f"commons:{group_location}:{group_day}",
            source_url=str(info.get("descriptionurl") or f"https://commons.wikimedia.org/?curid={image_id}"),
            fetch_url=str(fetch_url), latitude=latitude_value, longitude=longitude_value,
            captured_at=str(captured_at) if captured_at else None,
            author=metadata_value("Artist"), license=metadata_value("LicenseShortName"),
        ))
    return results


def search_kartaview(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    west, south, east, north = bounds
    latitude, longitude = (south + north) / 2, (west + east) / 2
    radius = min(1000, max(300, int(distance_meters(south, west, north, east) / 2)))
    endpoint = os.environ.get("KARTAVIEW_API", "https://api.openstreetcam.org/1.0/list/nearby-photos/")
    form = urllib.parse.urlencode({"lat": latitude, "lng": longitude, "radius": radius}).encode()
    payload = _request_json(endpoint, data=form, headers={"Content-Type": "application/x-www-form-urlencoded"})
    data = payload.get("currentPageItems", []) if isinstance(payload, dict) else []
    results: list[DiscoveredImage] = []
    for photo in data if isinstance(data, list) else []:
        image_id = str(photo.get("id") or "")
        latitude, longitude = _float(photo.get("lat")), _float(photo.get("lng") or photo.get("lon"))
        # KartaView's historical `proc` path is frequently gone while `lth` remains available.
        image_path = str(photo.get("lth_name") or photo.get("th_name") or photo.get("name") or "").lstrip("/")
        storage, _, remainder = image_path.partition("/")
        fetch_url = f"https://{storage}.openstreetcam.org/{remainder}" if storage and remainder else None
        if not image_id or latitude is None or longitude is None or not fetch_url:
            continue
        sequence = photo.get("sequence_id") or image_id
        results.append(DiscoveredImage(
            provider="KartaView", provider_image_id=image_id, capture_group_id=f"kartaview:{sequence}",
            source_url=f"https://kartaview.org/details/{sequence}/{photo.get('sequence_index', 0)}/track-info",
            fetch_url=str(fetch_url), latitude=latitude, longitude=longitude,
            heading=_float(photo.get("heading") or photo.get("headers")), captured_at=photo.get("shot_date") or photo.get("date_added"),
            author=photo.get("username"), license="CC-BY-SA-4.0",
        ))
    return results


def swissimage_at(latitude: float, longitude: float) -> DiscoveredImage:
    crop = .0018
    parameters = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0",
        "LAYERS": "ch.swisstopo.swissimage", "CRS": "EPSG:4326",
        "BBOX": f"{latitude - crop},{longitude - crop},{latitude + crop},{longitude + crop}",
        "WIDTH": "1280", "HEIGHT": "1280", "FORMAT": "image/jpeg", "STYLES": "",
    }
    cell = f"{round(latitude, 4)}:{round(longitude, 4)}"
    return DiscoveredImage(
        provider="SWISSIMAGE", provider_image_id=f"swissimage:{cell}", capture_group_id=f"swissimage:{cell}",
        source_url=f"https://map.geo.admin.ch/#/map?lang=de&center={longitude},{latitude}&z=10&bgLayer=ch.swisstopo.swissimage",
        fetch_url="https://wms.geo.admin.ch/?" + urllib.parse.urlencode(parameters), latitude=latitude, longitude=longitude,
        license="swisstopo OGD",
    )


def search_swissimage(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    west, south, east, north = bounds
    return [swissimage_at((south + north) / 2, (west + east) / 2)]


PROVIDERS = {
    "Panoramax": search_panoramax,
    "Wikimedia Commons": search_commons,
    "KartaView": search_kartaview,
    "SWISSIMAGE": search_swissimage,
}


def _candidate_cells(connection: sqlite3.Connection, cell_degrees: float, limit: int) -> list[sqlite3.Row]:
    return connection.execute("""
        SELECT CAST(latitude / ? AS INTEGER) lat_cell,CAST(longitude / ? AS INTEGER) lon_cell,
          min(latitude) min_latitude,max(latitude) max_latitude,min(longitude) min_longitude,max(longitude) max_longitude
        FROM benches WHERE active=1
        GROUP BY lat_cell,lon_cell
        ORDER BY ((lat_cell * 1103515245 + lon_cell * 12345) & 2147483647)
        LIMIT ?
    """, (cell_degrees, cell_degrees, limit * 20)).fetchall()


def discover_open_images(connection: sqlite3.Connection, max_cells: int = 500, cell_degrees: float = 0.02, requests_per_second: float = 1.0) -> dict[str, int]:
    stats = {"cells": 0, "requests": 0, "images": 0, "links": 0, "failed": 0}
    minimum_interval = 1 / max(0.1, requests_per_second)
    failures: dict[str, int] = {provider: 0 for provider in PROVIDERS}
    for cell in _candidate_cells(connection, cell_degrees, max_cells):
        if stats["cells"] >= max_cells:
            break
        cell_id = f"{cell['lat_cell']}:{cell['lon_cell']}:{cell_degrees}"
        bounds = (
            cell["lon_cell"] * cell_degrees, cell["lat_cell"] * cell_degrees,
            (cell["lon_cell"] + 1) * cell_degrees, (cell["lat_cell"] + 1) * cell_degrees,
        )
        expanded = (bounds[0] - .004, bounds[1] - .003, bounds[2] + .004, bounds[3] + .003)
        ground_images = 0
        processed_cell = False
        for provider, search in PROVIDERS.items():
            if failures[provider] >= 3:
                continue
            if provider == "SWISSIMAGE" and ground_images:
                continue
            previous = connection.execute(
                "SELECT status,discovered_at,retry_after FROM image_discovery_cells WHERE provider=? AND cell_id=?", (provider, cell_id),
            ).fetchone()
            if previous and previous["status"] == "completed" and previous["discovered_at"] and previous["discovered_at"] >= (datetime.now(timezone.utc) - timedelta(days=30)).isoformat():
                continue
            if previous and previous["status"] == "delayed" and previous["retry_after"] and previous["retry_after"] > now_iso():
                continue
            started = time.monotonic()
            processed_cell = True
            stats["requests"] += 1
            retry_after = None
            error_text = None
            try:
                if provider == "SWISSIMAGE":
                    ambiguous = connection.execute("""
                      SELECT b.latitude,b.longitude FROM benches b
                      WHERE b.active=1 AND b.latitude BETWEEN ? AND ? AND b.longitude BETWEEN ? AND ?
                        AND NOT EXISTS(
                          SELECT 1 FROM bench_image_evidence bie JOIN image_observations io ON io.id=bie.image_observation_id
                          WHERE bie.bench_row_id=b.row_id AND io.provider<>'SWISSIMAGE'
                        )
                      ORDER BY b.row_id LIMIT 4
                    """, (bounds[1], bounds[3], bounds[0], bounds[2])).fetchall()
                    images = [swissimage_at(row["latitude"], row["longitude"]) for row in ambiguous]
                else:
                    images = search(expanded)
                failures[provider] = 0
                for image in images:
                    cursor = connection.execute("""
                        INSERT INTO image_observations(provider,provider_image_id,capture_group_id,source_url,fetch_url,
                          latitude,longitude,heading,captured_at,author,license,discovered_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(provider,provider_image_id) DO UPDATE SET capture_group_id=excluded.capture_group_id,
                          source_url=excluded.source_url,fetch_url=excluded.fetch_url,latitude=excluded.latitude,
                          longitude=excluded.longitude,heading=excluded.heading,captured_at=excluded.captured_at,
                          author=excluded.author,license=excluded.license,discovered_at=excluded.discovered_at
                        RETURNING id
                    """, (image.provider, image.provider_image_id, image.capture_group_id, image.source_url,
                          image.fetch_url, image.latitude, image.longitude, image.heading, image.captured_at,
                          image.author, image.license, now_iso()))
                    observation_id = cursor.fetchone()[0]
                    latitude_delta = 300 / 111_320
                    longitude_delta = 300 / (111_320 * max(.2, math.cos(math.radians(image.latitude))))
                    benches = connection.execute("""
                        SELECT row_id,latitude,longitude,direction_degrees FROM benches
                        WHERE active=1 AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
                    """, (image.latitude - latitude_delta, image.latitude + latitude_delta,
                          image.longitude - longitude_delta, image.longitude + longitude_delta)).fetchall()
                    for bench in benches:
                        distance = distance_meters(image.latitude, image.longitude, bench["latitude"], bench["longitude"])
                        if distance > 300:
                            continue
                        camera_to_bench = bearing_degrees(image.latitude, image.longitude, bench["latitude"], bench["longitude"])
                        bench_to_camera = bearing_degrees(bench["latitude"], bench["longitude"], image.latitude, image.longitude)
                        direct = int(
                            distance <= 150
                            and image.heading is not None
                            and bench["direction_degrees"] is not None
                            and circular_difference(float(image.heading), camera_to_bench) <= 60
                            and circular_difference(float(bench["direction_degrees"]), bench_to_camera) <= 60
                        )
                        connection.execute("""
                            INSERT INTO bench_image_evidence(bench_row_id,image_observation_id,distance_meters,direct_view_eligible,evidence_weight)
                            VALUES(?,?,?,?,?) ON CONFLICT DO UPDATE SET distance_meters=excluded.distance_meters,
                              direct_view_eligible=excluded.direct_view_eligible,evidence_weight=excluded.evidence_weight
                        """, (bench["row_id"], observation_id, distance, direct, max(.15, 1 - distance / 350)))
                        stats["links"] += 1
                status = "completed"
                stats["images"] += len(images)
                if provider != "SWISSIMAGE":
                    ground_images += len(images)
            except ProviderDelay as error:
                images = []
                status, error_text = "delayed", str(error)
                retry_after = (datetime.now(timezone.utc) + timedelta(seconds=error.seconds)).isoformat()
                failures[provider] += 1
                stats["failed"] += 1
            except Exception as error:
                images = []
                status, error_text = "failed", str(error)[:500]
                failures[provider] += 1
                stats["failed"] += 1
            connection.execute("""
                INSERT INTO image_discovery_cells(provider,cell_id,min_latitude,max_latitude,min_longitude,max_longitude,
                  status,image_count,attempts,last_error,discovered_at,retry_after)
                VALUES(?,?,?,?,?,?,?,?,1,?,?,?)
                ON CONFLICT(provider,cell_id) DO UPDATE SET status=excluded.status,image_count=excluded.image_count,
                  attempts=image_discovery_cells.attempts+1,last_error=excluded.last_error,
                  discovered_at=excluded.discovered_at,retry_after=excluded.retry_after
            """, (provider, cell_id, bounds[1], bounds[3], bounds[0], bounds[2], status, len(images), error_text, now_iso(), retry_after))
            connection.commit()
            time.sleep(max(0, minimum_interval - (time.monotonic() - started)))
        stats["cells"] += int(processed_cell)
    return stats


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
Return JSON only with every key below. Probabilities are numbers from 0 to 1:
relevance_probability, rejection_reason (none|blurred|indoor|close_object|historical|unrelated),
forest_probability, park_probability, open_probability, urban_probability,
canopy_context (none|partial|dense|unknown), canopy_probability,
water_probability, lake_view_probability, mountain_view_probability, open_view_probability,
limited_view_probability, buildings_probability, road_rail_probability, bench_visible_probability.
Judge the shared scene, not the identity of any person or object owner."""


PROBABILITY_KEYS = (
    "relevance_probability", "forest_probability", "park_probability", "open_probability", "urban_probability",
    "canopy_probability", "water_probability", "lake_view_probability", "mountain_view_probability",
    "open_view_probability", "limited_view_probability", "buildings_probability", "road_rail_probability",
    "bench_visible_probability",
)


def validate_scene_prediction(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("prediction is not an object")
    result: dict[str, object] = {}
    for key in PROBABILITY_KEYS:
        probability = _float(value.get(key))
        if probability is None or not 0 <= probability <= 1:
            raise ValueError(f"invalid probability: {key}")
        result[key] = probability
    rejection = value.get("rejection_reason")
    canopy = value.get("canopy_context")
    if rejection not in {"none", "blurred", "indoor", "close_object", "historical", "unrelated"}:
        raise ValueError("invalid rejection_reason")
    if canopy not in {"none", "partial", "dense", "unknown"}:
        raise ValueError("invalid canopy_context")
    result["rejection_reason"], result["canopy_context"] = rejection, canopy
    return result


def _prediction_from_response(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise ValueError("invalid inference response")
    content = payload.get("choices", [{}])[0].get("message", {}).get("content")
    if isinstance(content, list):
        content = "".join(item.get("text", "") for item in content if isinstance(item, dict))
    if not isinstance(content, str):
        raise ValueError("missing inference content")
    text = content.strip().removeprefix("```json").removesuffix("```").strip()
    return validate_scene_prediction(json.loads(text))


def infer_scene(images: Sequence[tuple[bytes, str]], endpoint: str, api_key: str, model: str = DEFAULT_MODEL) -> dict[str, object]:
    encoded_bytes = sum(4 * math.ceil(len(payload) / 3) for payload, _ in images)
    if not images or encoded_bytes > MAX_REQUEST_BYTES:
        raise ValueError("invalid inference image payload")
    content: list[dict[str, object]] = [{"type": "text", "text": SCENE_PROMPT}]
    for payload, content_type in images:
        encoded = base64.b64encode(payload).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{encoded}"}})
    request_payload = json.dumps({
        "model": model, "temperature": 0, "max_tokens": 900,
        "messages": [{"role": "user", "content": content}],
        "response_format": {"type": "json_object"},
    }, separators=(",", ":")).encode()
    return _prediction_from_response(_request_json(
        endpoint.rstrip("/") + "/v1/chat/completions", data=request_payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, timeout=180,
    ))


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


def analyze_scenes(connection: sqlite3.Connection, limit: int, deadline: float, requests_per_second: float = .25) -> dict[str, int]:
    endpoint = os.environ.get("INFERENCE_BASE_URL", "http://inference-api.inference.svc.cluster.local:8080")
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    model = os.environ.get("BENCHLY_VISION_MODEL", DEFAULT_MODEL)
    if not api_key:
        raise RuntimeError("INFERENCE_API_KEY is required")
    groups = connection.execute("""
        SELECT provider,capture_group_id,min(discovered_at) discovered_at
        FROM image_observations WHERE analysis_status IN ('pending','retry') AND attempts<3
        GROUP BY provider,capture_group_id ORDER BY discovered_at LIMIT ?
    """, (limit,)).fetchall()
    stats = {"groups": 0, "images": 0, "failed": 0, "irrelevant": 0}
    minimum_interval = 1 / max(.05, requests_per_second)
    last_image_request = 0.0
    for group in groups:
        if time.monotonic() >= deadline:
            break
        rows = connection.execute("""
            SELECT o.*,coalesce(min(e.distance_meters),999) nearest_bench
            FROM image_observations o LEFT JOIN bench_image_evidence e ON e.image_observation_id=o.id
            WHERE o.provider=? AND o.capture_group_id=? GROUP BY o.id ORDER BY nearest_bench,o.id
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
            prediction = None
            for attempt in range(2):
                try:
                    prediction = infer_scene(in_memory, endpoint, api_key, model)
                    break
                except (ValueError, json.JSONDecodeError):
                    if attempt:
                        raise
            assert prediction is not None
            relevant = prediction["relevance_probability"] >= .55 and prediction["rejection_reason"] == "none"
            status = "analyzed" if relevant else "irrelevant"
            for index, row in enumerate(frames):
                connection.execute("""
                    UPDATE image_observations SET analysis_status=?,relevance_probability=?,predictions=?,
                      image_sha256=?,model_version=?,prompt_version=?,analyzed_at=?,attempts=attempts+1,last_error=NULL
                    WHERE id=?
                """, (status, prediction["relevance_probability"], json.dumps(prediction, separators=(",", ":")),
                      hashes[index], model, PROMPT_VERSION, now_iso(), row["id"]))
            # Frames not selected are redundant members of the same capture group.
            selected_ids = {row["id"] for row in frames}
            connection.executemany(
                "UPDATE image_observations SET analysis_status='grouped',model_version=?,prompt_version=?,analyzed_at=? WHERE id=?",
                [(model, PROMPT_VERSION, now_iso(), row["id"]) for row in rows if row["id"] not in selected_ids],
            )
            stats["groups"] += 1
            stats["images"] += len(frames)
            stats["irrelevant"] += int(not relevant)
        except Exception as error:
            connection.executemany(
                "UPDATE image_observations SET analysis_status='retry',attempts=attempts+1,last_error=? WHERE id=?",
                [(str(error)[:500], row["id"]) for row in frames],
            )
            stats["failed"] += 1
        finally:
            # No image object escapes this iteration; CPython releases the byte buffers here.
            connection.commit()
            time.sleep(max(0, minimum_interval - (time.monotonic() - started)))
    return stats


def _weighted_probability(groups: Sequence[tuple[dict[str, object], float]], key: str) -> Optional[float]:
    values = [(float(prediction[key]), weight) for prediction, weight in groups if key in prediction]
    return sum(value * weight for value, weight in values) / sum(weight for _, weight in values) if values else None


def reconcile_environment(connection: sqlite3.Connection, limit: int = 5000) -> dict[str, int]:
    bench_rows = connection.execute("""
        SELECT DISTINCT b.row_id,e.in_forest,e.land_context,e.waterfront,e.canopy_context
        FROM benches b JOIN bench_image_evidence bie ON bie.bench_row_id=b.row_id
        LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
        JOIN image_observations io ON io.id=bie.image_observation_id
        LEFT JOIN bench_likely_metadata lm ON lm.bench_row_id=b.row_id
        WHERE b.active=1 AND io.analysis_status='analyzed'
          AND (lm.updated_at IS NULL OR lm.updated_at<io.analyzed_at)
        ORDER BY b.row_id LIMIT ?
    """, (limit,)).fetchall()
    stats = {"reconciled": 0, "conflicts": 0}
    for bench in bench_rows:
        rows = connection.execute("""
            SELECT io.provider,io.capture_group_id,io.predictions,io.model_version,
              min(io.source_url) source_url,min(io.license) license,max(io.captured_at) captured_at,
              min(bie.distance_meters) distance_meters,max(bie.evidence_weight) evidence_weight,
              max(bie.direct_view_eligible) direct_view_eligible
            FROM bench_image_evidence bie JOIN image_observations io ON io.id=bie.image_observation_id
            WHERE bie.bench_row_id=? AND io.analysis_status='analyzed' AND io.relevance_probability>=.55
            GROUP BY io.provider,io.capture_group_id
        """, (bench["row_id"],)).fetchall()
        groups: list[tuple[dict[str, object], float]] = []
        view_groups: list[tuple[dict[str, object], float]] = []
        for row in rows:
            try:
                group = (validate_scene_prediction(json.loads(row["predictions"])), float(row["evidence_weight"]))
                groups.append(group)
                if row["direct_view_eligible"]:
                    view_groups.append(group)
            except (ValueError, TypeError, json.JSONDecodeError):
                continue
        if not groups:
            continue
        probabilities = {key: _weighted_probability(groups, key) for key in (
            "forest_probability", "park_probability", "open_probability", "urban_probability",
            "buildings_probability", "road_rail_probability",
        )}
        probabilities.update({key: _weighted_probability(view_groups, key) for key in (
            "lake_view_probability", "mountain_view_probability", "open_view_probability", "limited_view_probability",
        )})
        land_candidates = {key.removesuffix("_probability"): value for key, value in probabilities.items() if key in {"forest_probability", "park_probability", "open_probability", "urban_probability"} and value is not None}
        land_context, land_probability = max(land_candidates.items(), key=lambda item: item[1])
        canopy_votes = [(str(prediction["canopy_context"]), float(prediction["canopy_probability"]), weight) for prediction, weight in groups]
        canopy_context = max(("none", "partial", "dense", "unknown"), key=lambda value: sum(prob * weight for name, prob, weight in canopy_votes if name == value))
        canopy_probability = _weighted_probability(groups, "canopy_probability")
        contradictory_exact = bool(bench["waterfront"]) or bench["land_context"] in {"open", "urban", "park"}
        if land_context == "forest" and not bench["in_forest"]:
            forest_allowed = land_probability >= .9 and bench["canopy_context"] == "dense" and len(groups) >= 2 and not contradictory_exact
            if not forest_allowed:
                stats["conflicts"] += 1
                alternatives = {key: value for key, value in land_candidates.items() if key != "forest"}
                land_context, land_probability = max(alternatives.items(), key=lambda item: item[1]) if alternatives else (None, None)
        strongest = max((value for value in probabilities.values() if value is not None), default=0)
        confidence = "high" if len(groups) >= 2 and strongest >= .85 else "medium" if strongest >= .65 else "low"
        summary = [{
            "provider": row["provider"], "captureGroup": row["capture_group_id"],
            "distanceMeters": round(float(row["distance_meters"])),
            "sourceUrl": row["source_url"], "license": row["license"], "capturedAt": row["captured_at"],
            "directView": bool(row["direct_view_eligible"]),
        } for row in rows]
        models = sorted({str(row["model_version"]) for row in rows if row["model_version"]})
        connection.execute("""
            INSERT INTO bench_likely_metadata(bench_row_id,land_context,land_context_probability,canopy_context,
              canopy_probability,lake_view_probability,mountain_view_probability,open_view_probability,
              limited_view_probability,buildings_probability,road_rail_probability,confidence,evidence_group_count,
              evidence_summary,model_version,reconciler_version,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(bench_row_id) DO UPDATE SET land_context=excluded.land_context,
              land_context_probability=excluded.land_context_probability,canopy_context=excluded.canopy_context,
              canopy_probability=excluded.canopy_probability,lake_view_probability=excluded.lake_view_probability,
              mountain_view_probability=excluded.mountain_view_probability,open_view_probability=excluded.open_view_probability,
              limited_view_probability=excluded.limited_view_probability,buildings_probability=excluded.buildings_probability,
              road_rail_probability=excluded.road_rail_probability,confidence=excluded.confidence,
              evidence_group_count=excluded.evidence_group_count,evidence_summary=excluded.evidence_summary,
              model_version=excluded.model_version,reconciler_version=excluded.reconciler_version,updated_at=excluded.updated_at
        """, (bench["row_id"], land_context, land_probability, canopy_context, canopy_probability,
              probabilities["lake_view_probability"], probabilities["mountain_view_probability"],
              probabilities["open_view_probability"], probabilities["limited_view_probability"],
              probabilities["buildings_probability"], probabilities["road_rail_probability"], confidence,
              len(groups), json.dumps(summary, separators=(",", ":")), ",".join(models), RECONCILER_VERSION, now_iso()))
        stats["reconciled"] += 1
        if stats["reconciled"] % 100 == 0:
            connection.commit()
    connection.commit()
    return stats


def audit_environment(connection: sqlite3.Connection) -> dict[str, object]:
    scalar = lambda sql: connection.execute(sql).fetchone()[0]
    model_versions = {
        str(row["model_version"] or "unknown"): int(row["count"])
        for row in connection.execute(
            "SELECT model_version,count(*) count FROM image_observations WHERE analyzed_at IS NOT NULL GROUP BY model_version"
        )
    }
    return {
        "active_benches": scalar("SELECT count(*) FROM benches WHERE active=1"),
        "exact_geometry_features": scalar("SELECT count(*) FROM environment_features WHERE geometry_wkb IS NOT NULL"),
        "deterministic_context": scalar("SELECT count(*) FROM bench_enrichments WHERE land_context IS NOT NULL"),
        "image_observations": scalar("SELECT count(*) FROM image_observations"),
        "analyzed_images": scalar("SELECT count(*) FROM image_observations WHERE analysis_status='analyzed'"),
        "irrelevant_images": scalar("SELECT count(*) FROM image_observations WHERE analysis_status='irrelevant'"),
        "likely_metadata": scalar("SELECT count(*) FROM bench_likely_metadata"),
        "high_confidence": scalar("SELECT count(*) FROM bench_likely_metadata WHERE confidence='high'"),
        "model_versions": model_versions,
        "pending_or_retry_images": scalar("SELECT count(*) FROM image_observations WHERE analysis_status IN ('pending','retry')"),
        "forest_conflicts": scalar("""SELECT count(*) FROM bench_likely_metadata lm JOIN bench_enrichments e USING(bench_row_id)
          WHERE lm.land_context='forest' AND e.land_context IN ('open','urban','park')"""),
        "likely_rows_without_provenance": scalar("SELECT count(*) FROM bench_likely_metadata WHERE evidence_summary IS NULL OR evidence_summary='[]'"),
        "raw_image_columns": 0,
    }


def _binary_f1(expected: Sequence[bool], predicted: Sequence[bool]) -> float:
    true_positive = sum(wanted and actual for wanted, actual in zip(expected, predicted))
    false_positive = sum(not wanted and actual for wanted, actual in zip(expected, predicted))
    false_negative = sum(wanted and not actual for wanted, actual in zip(expected, predicted))
    denominator = 2 * true_positive + false_positive + false_negative
    return 1.0 if denominator == 0 else 2 * true_positive / denominator


def benchmark_models(dataset_path, models: Sequence[str], allow_small: bool = False) -> dict[str, object]:
    records = [json.loads(line) for line in dataset_path.read_text().splitlines() if line.strip()]
    if len(records) < 100 and not allow_small:
        raise RuntimeError("The public-label benchmark requires at least 100 labelled locations")
    endpoint = os.environ.get("INFERENCE_BASE_URL", "http://inference-api.inference.svc.cluster.local:8080")
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    if not api_key:
        raise RuntimeError("INFERENCE_API_KEY is required")
    label_keys = ("forest", "lake_view", "mountain_view", "open_view", "limited_view")
    results: dict[str, dict[str, object]] = {}
    for model in models:
        wanted: dict[str, list[bool]] = {key: [] for key in label_keys}
        actual: dict[str, list[bool]] = {key: [] for key in label_keys}
        durations: list[float] = []
        valid = 0
        for record in records:
            images = [_download_image(url) for url in record.get("images", [])[:4]]
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
            for key in label_keys:
                wanted[key].append(bool(expected.get(key)))
                actual[key].append(float(prediction[f"{key}_probability"]) >= .5)
        f1_values = [_binary_f1(wanted[key], actual[key]) for key in label_keys if wanted[key]]
        non_forest = [(expected, predicted) for expected, predicted in zip(wanted["forest"], actual["forest"]) if not expected]
        forest_false_positive_rate = sum(predicted for _, predicted in non_forest) / len(non_forest) if non_forest else 0
        ordered = sorted(durations)
        p95 = ordered[min(len(ordered) - 1, math.ceil(len(ordered) * .95) - 1)] if ordered else math.inf
        macro_f1 = sum(f1_values) / len(f1_values) if f1_values else 0
        results[model] = {
            "locations": len(records), "valid_json_rate": valid / len(records) if records else 0,
            "forest_false_positive_rate": forest_false_positive_rate,
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
