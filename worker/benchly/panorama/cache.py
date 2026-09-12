"""Content-addressed, atomic panorama geometry and render caches."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from benchly.panorama.models import GeometryIdentity, PanoramaGeometry, RenderIdentity


Model = TypeVar("Model", bound=BaseModel)


def _key(model: BaseModel) -> str:
    payload = json.dumps(model.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def geometry_cache_key(identity: GeometryIdentity) -> str:
    return _key(identity)


def render_cache_key(identity: RenderIdentity) -> str:
    return _key(identity)


class PanoramaCache:
    def __init__(self, root: Path):
        self.root = root

    def geometry_path(self, key: str) -> Path:
        return self.root / "geometry" / key[:2] / f"{key}.json.gz"

    def render_path(self, key: str) -> Path:
        return self.root / "renders" / key[:2] / f"{key}.svg.gz"

    @staticmethod
    def _atomic_write(path: Path, payload: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.part")
        try:
            temporary.write_bytes(payload)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def put_geometry(self, geometry: PanoramaGeometry) -> Path:
        path = self.geometry_path(geometry.identity_key)
        payload = gzip.compress(geometry.model_dump_json().encode(), compresslevel=6, mtime=0)
        self._atomic_write(path, payload)
        return path

    def get_geometry(self, key: str) -> PanoramaGeometry | None:
        path = self.geometry_path(key)
        if not path.exists():
            return None
        try:
            return PanoramaGeometry.model_validate_json(gzip.decompress(path.read_bytes()))
        except (OSError, ValueError):
            return None

    def put_render(self, key: str, svg: str) -> Path:
        path = self.render_path(key)
        self._atomic_write(path, gzip.compress(svg.encode(), compresslevel=6, mtime=0))
        return path

    def get_render(self, key: str) -> str | None:
        path = self.render_path(key)
        try:
            return gzip.decompress(path.read_bytes()).decode() if path.exists() else None
        except OSError:
            return None
