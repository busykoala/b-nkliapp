"""Small, source-specific downloads used by offline enrichment jobs."""

from __future__ import annotations

import json
import os
import urllib.request
from argparse import Namespace
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, ValidationError

from benchly.catalog import load_catalog
from benchly.runtime import now_iso

MAX_SONBASE_BYTES = 750_000_000


class RasterArtifactState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    url: HttpUrl
    etag: str | None = None
    last_modified: str | None = None
    content_length: int = Field(ge=1, le=MAX_SONBASE_BYTES)
    downloaded_at: str


def validate_sonbase_raster(path: Path) -> None:
    import rasterio

    with rasterio.open(path) as dataset:
        if dataset.count != 1 or dataset.crs is None or dataset.crs.to_epsg() != 2056:
            raise ValueError("sonBASE raster must be a one-band EPSG:2056 GeoTIFF")
        if dataset.nodata is None or dataset.width < 1 or dataset.height < 1:
            raise ValueError("sonBASE raster has no valid dimensions or NoData marker")


def _read_state(path: Path) -> RasterArtifactState | None:
    try:
        return RasterArtifactState.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError):
        return None


def refresh_sonbase(target: Path, url: str | None = None) -> dict[str, object]:
    source_url = url or str(load_catalog().providers.sonbaseDayCogUrl)
    target.parent.mkdir(parents=True, exist_ok=True)
    state_path = target.with_suffix(target.suffix + ".json")
    current = _read_state(state_path)

    head = urllib.request.Request(source_url, method="HEAD", headers={"User-Agent": "Benchly/1.0 (+https://bänkliapp.ch/danke)"})
    with urllib.request.urlopen(head, timeout=60) as response:
        length = int(response.headers.get("Content-Length") or 0)
        etag = response.headers.get("ETag")
        last_modified = response.headers.get("Last-Modified")
    if length < 1 or length > MAX_SONBASE_BYTES:
        raise ValueError(f"Unexpected sonBASE size: {length} bytes")
    if target.exists() and current and current.content_length == length and current.etag == etag and current.last_modified == last_modified:
        validate_sonbase_raster(target)
        return {"changed": False, "bytes": length, "version": etag or last_modified}

    temporary = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(source_url, headers={"User-Agent": "Benchly/1.0 (+https://bänkliapp.ch/danke)"})
    downloaded = 0
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                downloaded += len(chunk)
                if downloaded > MAX_SONBASE_BYTES:
                    raise ValueError("sonBASE download exceeded its configured size limit")
                output.write(chunk)
        if downloaded != length:
            raise ValueError(f"Incomplete sonBASE download: {downloaded} of {length} bytes")
        validate_sonbase_raster(temporary)
        os.replace(temporary, target)
        state = RasterArtifactState(
            source_id="sonbase",
            url=source_url,
            etag=etag,
            last_modified=last_modified,
            content_length=downloaded,
            downloaded_at=now_iso(),
        )
        state_temporary = state_path.with_suffix(state_path.suffix + ".part")
        state_temporary.write_text(state.model_dump_json(indent=2) + "\n", encoding="utf-8")
        os.replace(state_temporary, state_path)
        return {"changed": True, "bytes": downloaded, "version": etag or last_modified}
    finally:
        temporary.unlink(missing_ok=True)


def run_refresh_sonbase(args: Namespace) -> None:
    print(json.dumps(refresh_sonbase(Path(args.target).resolve()), indent=2))
