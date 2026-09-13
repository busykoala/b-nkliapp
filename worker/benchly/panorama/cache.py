"""Content-addressed, atomic panorama geometry and render caches."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from benchly.panorama.binary import decode_geometry, encode_geometry
from benchly.panorama.models import GeometryIdentity, LightMapIdentity, PanoramaGeometry, RenderIdentity


Model = TypeVar("Model", bound=BaseModel)


def _key(model: BaseModel) -> str:
    payload = json.dumps(model.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def geometry_cache_key(identity: GeometryIdentity) -> str:
    return _key(identity)


def render_cache_key(identity: RenderIdentity) -> str:
    return _key(identity)


def lightmap_cache_key(identity: LightMapIdentity) -> str:
    return _key(identity)


class PanoramaCache:
    def __init__(self, root: Path, generation_id: str | None = None):
        self.root = root
        self.generation_id = generation_id

    @property
    def base(self) -> Path:
        return self.root / "active" / self.generation_id if self.generation_id else self.root / "working"

    def geometry_path(self, key: str) -> Path:
        return self.base / "capsules" / key[:2] / f"{key}.bpc"

    def render_path(self, key: str) -> Path:
        return self.base / "renders" / key[:2] / f"{key}.webp"

    def material_path(self, key: str) -> Path:
        return self.base / "materials" / key[:2] / f"{key}.webp"

    def lightmap_path(self, key: str) -> Path:
        return self.base / "lightmaps" / key[:2] / f"{key}.webp"

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
        self._atomic_write(path, encode_geometry(geometry))
        return path

    def get_geometry(self, key: str) -> PanoramaGeometry | None:
        path = self.geometry_path(key)
        if not path.exists():
            return None
        try:
            return decode_geometry(path.read_bytes())
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            return None

    def put_material(self, key: str, image: bytes) -> Path:
        path = self.material_path(key)
        self._atomic_write(path, image)
        return path

    def put_render(self, key: str, image: bytes) -> Path:
        path = self.render_path(key)
        self._atomic_write(path, image)
        return path

    def get_render(self, key: str) -> bytes | None:
        path = self.render_path(key)
        try:
            return path.read_bytes() if path.exists() else None
        except OSError:
            return None

    def put_lightmap(self, key: str, image: bytes) -> Path:
        path = self.lightmap_path(key)
        self._atomic_write(path, image)
        return path

    def get_lightmap(self, key: str) -> bytes | None:
        path = self.lightmap_path(key)
        try:
            return path.read_bytes() if path.exists() else None
        except OSError:
            return None
