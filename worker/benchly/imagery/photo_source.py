"""Public photo source identifiers, bounded discovery and RAM-only analysis."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
from concurrent.futures import Future, ThreadPoolExecutor
from urllib.parse import urlsplit

from benchly.db import open_database
from benchly.imagery.client import _request_json, download_image
from benchly.imagery.photo_prediction import PHOTO_MODEL_VERSION, PHOTO_PROMPT_VERSION, infer_bench_photo
from benchly.imagery.providers import ProviderDelay
from benchly.imagery.photo_repository import (
    create_photo_schema, discover_photo, finish_photo_discovery, save_photo_result, save_source,
)
from benchly.runtime import now_iso

IMAGE_PATH = re.compile(r"^/comments/(\d+)/image(?:\?big=true)?$")


def photo_source_base_url():
    """Keep installation-specific source locations in private runtime configuration."""
    value = os.environ.get("BENCHLY_PHOTO_SOURCE_URL", "").strip().rstrip("/")
    url = urlsplit(value)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment):
        raise ValueError("BENCHLY_PHOTO_SOURCE_URL must be configured as an HTTPS origin")
    # Accessing port also rejects malformed authority values.
    if url.port is not None and not 1 <= url.port <= 65535:
        raise ValueError("invalid photo source port")
    return value


def image_record(source_id, path, captured_at=None):
    match = IMAGE_PATH.fullmatch(str(path or ""))
    if not match:
        return None
    image_id = int(match[1])
    return {"source_id": source_id, "image_id": image_id,
            "fetch_url": f"{photo_source_base_url()}/comments/{image_id}/image?big=true", "captured_at": captured_at}


def discover_source_photos(source_id, request_json=_request_json):
    """Traverse public comment pages, keeping only photo identifiers and dates."""
    photos = {}
    end = None
    for _ in range(100):
        url = f"{photo_source_base_url()}/bench/{source_id}/comments?count=100"
        if end is not None:
            url += f"&end={end}"
        comments = request_json(url)
        if not isinstance(comments, list):
            raise ValueError("invalid comment page")
        if not comments:
            return list(photos.values())
        timestamps = []
        for comment in comments:
            timestamp = comment.get("creation")
            if isinstance(timestamp, (float, int)):
                timestamps.append(int(timestamp))
                # This is the upload time; it does not establish the capture date.
            row = image_record(source_id, comment.get("restIconPath"))
            if row:
                photos[row["image_id"]] = row
        if len(comments) < 100:
            return list(photos.values())
        if not timestamps or (end is not None and min(timestamps) >= end):
            raise ValueError("comment pagination did not advance")
        end = min(timestamps)
    raise ValueError("comment pagination exceeded 100 pages")


def seed_sources(database, features):
    for feature in features:
        source_id = int(feature["id"])
        longitude, latitude = feature["geometry"]["coordinates"][:2]
        properties = feature["properties"]
        # No contributor IDs, names, comment text or image data enter this database.
        metadata = {key: properties.get(key) for key in (
            "sight", "location", "infrastructure", "accessibility", "canton", "commune",
        )}
        save_source(database, {"source_id": source_id, "latitude": latitude, "longitude": longitude,
                              "source_url": f"{photo_source_base_url()}/bench/{source_id}",
                              "source_metadata": json.dumps(metadata, ensure_ascii=False),
                              "discovered_at": now_iso()})
        photo = image_record(source_id, properties.get("mainImagePath"))
        if photo:
            discover_photo(database, photo)
    database.commit()


def photo_needs_analysis(photo, model_version, max_attempts):
    current = photo["prompt_version"] == PHOTO_PROMPT_VERSION and photo["model_version"] == model_version
    return (photo["status"] != "analyzed" or not current) and (
        photo["attempts"] < max_attempts or photo["status"] == "analyzed" or not current
    )


def analyze_bank_photos(args):
    """Run locally, checkpoint structured outputs, release each photo after inference."""
    endpoint = os.environ.get("INFERENCE_BASE_URL", "http://127.0.0.1:18080")
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    if not api_key:
        raise ValueError("INFERENCE_API_KEY is required")
    database = open_database(Path(args.output))
    create_photo_schema(database)
    if args.index:
        seed_sources(database, json.loads(Path(args.index).read_text()))
    model = args.model
    model_version = PHOTO_MODEL_VERSION if model in {"qwen35-general", "general"} else model
    counters = {"analyzed": 0, "failed": 0, "discovered_sources": 0}
    # Two sources ahead: only bounded metadata and image buffers are in memory.
    sources = database.execute("SELECT * FROM bank_photo_sources ORDER BY source_id").fetchall()
    if args.source_ids:
        sources = [s for s in sources if s["source_id"] in args.source_ids]
    priority = {source_id: index for index, source_id in enumerate(getattr(args, "priority_source_ids", None) or [])}
    sources.sort(key=lambda s: (priority.get(s["source_id"], len(priority)), s["source_id"]))
    def known_photos(source_id):
        return [dict(row) for row in database.execute(
            "SELECT * FROM bank_photo_observations WHERE source_id=? ORDER BY image_id", (source_id,)
        ).fetchall()]

    def prepare(source, known):
        discovered, discovery_error = None, None
        if args.discover_comments and not source["comments_discovered_at"]:
            try:
                discovered = discover_source_photos(source["source_id"])
            except ProviderDelay:
                raise
            except Exception as error:
                discovery_error = error
        known_ids = {photo["image_id"] for photo in known}
        pending = [photo for photo in known if photo_needs_analysis(photo, model_version, args.max_attempts)]
        pending.extend(photo for photo in discovered or [] if photo["image_id"] not in known_ids)
        first = min(pending, key=lambda photo: photo["image_id"], default=None)
        payload, download_error = None, None
        if first:
            try:
                payload = download_image(first["fetch_url"])
            except ProviderDelay:
                raise
            except Exception as error:
                download_error = error
        return discovered, discovery_error, first, payload, download_error

    with ThreadPoolExecutor(max_workers=2) as discovery_pool, ThreadPoolExecutor(max_workers=1) as pool:
        prepared_sources = {
            index: discovery_pool.submit(prepare, source, known_photos(source["source_id"]))
            for index, source in enumerate(sources[:2])
        }
        for index, source in enumerate(sources):
            source_id = source["source_id"]
            current_discovery = prepared_sources.pop(index)
            # Two sources and their first pending images may run ahead of inference.
            # Threads only fetch bytes; every database read/write stays here.
            if index + 2 < len(sources):
                next_source = sources[index + 2]
                prepared_sources[index + 2] = discovery_pool.submit(
                    prepare, next_source, known_photos(next_source["source_id"]),
                )
            discovered, discovery_error, first, first_payload, first_error = current_discovery.result()
            current_discovery = None
            if discovered is not None:
                for photo in discovered:
                    discover_photo(database, photo)
                finish_photo_discovery(database, source_id, now_iso())
                counters["discovered_sources"] += 1
            elif discovery_error:
                finish_photo_discovery(database, source_id, error=str(discovery_error)[:300])
            database.commit()
            photos = [photo for photo in known_photos(source_id) if photo_needs_analysis(photo, model_version, args.max_attempts)]
            if photos and first and all(first[key] == photos[0][key] for key in ("source_id", "image_id", "fetch_url")):
                pending = Future()
                if first_error:
                    pending.set_exception(first_error)
                else:
                    pending.set_result(first_payload)
            else:
                pending = pool.submit(download_image, photos[0]["fetch_url"]) if photos else None
            first_payload = first = first_error = None
            for position, photo in enumerate(photos):
                payload = None
                attempts = photo["attempts"] + 1 if (
                    photo["prompt_version"] == PHOTO_PROMPT_VERSION and photo["model_version"] == model_version
                ) else 1
                try:
                    payload = pending.result()
                    pending = pool.submit(download_image, photos[position + 1]["fetch_url"]) if position + 1 < len(photos) else None
                    prediction = infer_bench_photo(payload, endpoint, api_key, model)
                    save_photo_result(database, source_id, photo["image_id"], {
                        "status": "analyzed", "image_sha256": hashlib.sha256(payload[0]).hexdigest(),
                        "prediction": prediction.model_dump_json(), "model_version": model_version,
                        "prompt_version": PHOTO_PROMPT_VERSION, "analyzed_at": now_iso(),
                        "attempts": attempts, "last_error": None,
                    })
                    counters["analyzed"] += 1
                except ProviderDelay:
                    raise
                except Exception as error:
                    save_photo_result(database, source_id, photo["image_id"], {
                        "status": "failed", "last_error": str(error)[:300], "attempts": attempts,
                        "prompt_version": PHOTO_PROMPT_VERSION, "model_version": model_version,
                        "prediction": None, "analyzed_at": None,
                        "image_sha256": hashlib.sha256(payload[0]).hexdigest() if payload else None,
                    })
                    counters["failed"] += 1
                    if pending is None or pending.done():
                        pending = pool.submit(download_image, photos[position + 1]["fetch_url"]) if position + 1 < len(photos) else None
                finally:
                    payload = None
                database.commit()
                if (counters["analyzed"] + counters["failed"]) % 25 == 0:
                    print(json.dumps({**counters, "source": source_id, "sources_visited": index + 1}), flush=True)
                if args.limit and counters["analyzed"] + counters["failed"] >= args.limit:
                    database.close()
                    return counters
    database.close()
    print(json.dumps(counters), flush=True)
    return counters
