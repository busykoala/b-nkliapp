"""Content-addressed, atomic panorama geometry and render caches."""

from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
from typing import TypeVar

import numpy as np
from pydantic import BaseModel

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
    def __init__(self, root: Path):
        self.root = root

    def geometry_path(self, key: str) -> Path:
        return self.root / "geometry-v4" / key[:2] / f"{key}.npz"

    def render_path(self, key: str) -> Path:
        return self.root / "renders-v19" / key[:2] / f"{key}.webp"

    def lightmap_path(self, key: str) -> Path:
        return self.root / "lightmaps-v1" / key[:2] / f"{key}.webp"

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
        # NPZ gives the v4 cache a binary, checksummed container today and lets
        # later revisions split hot arrays out of the manifest without another
        # path or cache migration.
        manifest = np.frombuffer(geometry.model_dump_json(exclude_none=True).encode(), dtype=np.uint8)
        output = io.BytesIO()
        np.savez_compressed(output, manifest=manifest)
        self._atomic_write(path, output.getvalue())
        return path

    def get_geometry(self, key: str) -> PanoramaGeometry | None:
        path = self.geometry_path(key)
        if not path.exists():
            return None
        try:
            with np.load(path, allow_pickle=False) as archive:
                return PanoramaGeometry.model_validate_json(archive["manifest"].tobytes())
        except (OSError, ValueError, KeyError):
            return None

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
