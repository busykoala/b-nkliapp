"""Offline panorama art-review fixtures.

The exporter deliberately consumes already cached geometry. It never contacts
an upstream map service, so renderer and browser iterations are fast and kind
to the source infrastructure.
"""

from __future__ import annotations

import gzip
import json
import subprocess
from argparse import Namespace
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from astral import Observer
from astral.sun import azimuth as sun_azimuth, elevation as sun_elevation

from benchly.db import connect_database
from benchly.panorama.binary import decode_geometry
from benchly.panorama.cache import PanoramaCache, lightmap_cache_key, render_cache_key
from benchly.panorama.models import LightMapIdentity, PanoramaGeometry, RenderIdentity
from benchly.panorama.repository import (
    activate_local_review_generation,
    install_fixture_geometry,
    mark_lightmap_ready,
    mark_render_ready,
    require_schema,
)
from benchly.panorama.watercolor import render_lightmap_webp, render_material_webp, render_panorama_webp


REVIEW_SNAPSHOTS = (
    {"id": "clear-morning", "sunAzimuth": 105, "sunAltitude": 8, "cloudCover": .08, "precipitation": "none", "phase": "day"},
    {"id": "clear-noon", "sunAzimuth": 180, "sunAltitude": 58, "cloudCover": .05, "precipitation": "none", "phase": "day"},
    {"id": "low-evening", "sunAzimuth": 260, "sunAltitude": 6, "cloudCover": .18, "precipitation": "none", "phase": "dusk"},
    {"id": "mountain-shade", "sunAzimuth": 25, "sunAltitude": 4, "cloudCover": .12, "precipitation": "none", "phase": "day"},
    {"id": "broken-clouds", "sunAzimuth": 190, "sunAltitude": 34, "cloudCover": .52, "precipitation": "none", "phase": "day"},
    {"id": "overcast", "sunAzimuth": 190, "sunAltitude": 34, "cloudCover": .9, "precipitation": "none", "phase": "day"},
    {"id": "rain", "sunAzimuth": 190, "sunAltitude": 25, "cloudCover": .94, "precipitation": "rain", "phase": "day"},
    {"id": "snow", "sunAzimuth": 170, "sunAltitude": 18, "cloudCover": .86, "precipitation": "snow", "phase": "day"},
    {"id": "moon-night", "sunAzimuth": 0, "sunAltitude": -28, "cloudCover": .08, "precipitation": "none", "phase": "night", "moonPhase": .72},
)


def _load_geometry(path: Path) -> PanoramaGeometry:
    if path.suffix == ".bpc":
        return decode_geometry(path.read_bytes())
    if path.suffix == ".npz":
        with np.load(path, allow_pickle=False) as archive:
            return PanoramaGeometry.model_validate_json(archive["manifest"].tobytes())
    payload = gzip.decompress(path.read_bytes()) if path.name.endswith(".json.gz") else path.read_bytes()
    return PanoramaGeometry.model_validate_json(payload)


def _parse_fixture(value: str) -> tuple[str, Path]:
    bench_id, separator, source = value.partition("=")
    if not separator or not bench_id or not source:
        raise ValueError("--fixture must be BENCH_ID=GEOMETRY_PATH")
    path = Path(source).resolve()
    if not path.is_file():
        raise ValueError(f"fixture geometry does not exist: {path}")
    return bench_id, path


def render_fixture_job(args: Namespace) -> None:
    database = connect_database(Path(args.database).resolve())
    git_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=Path(__file__).resolve().parents[3],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    generation_id = f"local-{git_commit[:12]}"
    activate_local_review_generation(database, generation_id, git_commit)
    cache = PanoramaCache(Path(args.cache_dir).resolve(), generation_id)
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    require_schema(database)
    manifest: dict[str, object] = {
        "format": "benchly-panorama-review", "schema": 1, "gitCommit": git_commit,
        "snapshots": REVIEW_SNAPSHOTS, "benches": [],
    }
    now = datetime.fromisoformat(args.at).astimezone(UTC) if args.at else datetime.now(UTC)
    try:
        for raw in args.fixture:
            bench_id, source = _parse_fixture(raw)
            geometry = _load_geometry(source)
            bench = database.execute("SELECT row_id,id,latitude,longitude FROM benches WHERE id=? AND active=1", (bench_id,)).fetchone()
            if bench is None:
                raise ValueError(f"active bench not found: {bench_id}")
            if abs(float(bench["latitude"]) - geometry.latitude) > 1e-7 or abs(float(bench["longitude"]) - geometry.longitude) > 1e-7:
                raise ValueError(f"fixture coordinates do not match {bench_id}")
            install_fixture_geometry(database, bench, geometry, str(source), source.stat().st_size, generation_id)
            identity = RenderIdentity(
                geometry_key=geometry.identity_key, center_azimuth_degrees=0, horizontal_fov_degrees=360,
                width=args.width, height=args.height, season_bucket=args.season, source_completeness=geometry.complete,
            )
            render_key = render_cache_key(identity)
            image = render_panorama_webp(geometry, args.width, args.height, args.season)
            render_path = cache.put_render(render_key, image)
            material = render_material_webp(geometry)
            material_path = cache.put_material(render_key, material)
            mark_render_ready(
                database, int(bench["row_id"]), identity, str(render_path), len(image),
                material_path=str(material_path), material_bytes=len(material), generation_id=generation_id,
            )

            observer = Observer(latitude=geometry.latitude, longitude=geometry.longitude)
            light_identity = LightMapIdentity(
                geometry_key=geometry.identity_key, solar_bucket=now.replace(minute=now.minute - now.minute % 10, second=0, microsecond=0).isoformat(),
                sun_azimuth_degrees=float(sun_azimuth(observer, now)), sun_altitude_degrees=float(sun_elevation(observer, now)),
            )
            light_key = lightmap_cache_key(light_identity)
            light = render_lightmap_webp(geometry, light_identity.sun_azimuth_degrees, light_identity.sun_altitude_degrees)
            light_path = cache.put_lightmap(light_key, light)
            mark_lightmap_ready(database, int(bench["row_id"]), light_identity, light_key, str(light_path), len(light))

            review_dir = output / bench_id
            review_dir.mkdir(parents=True, exist_ok=True)
            for snapshot in REVIEW_SNAPSHOTS:
                light_bytes = render_lightmap_webp(geometry, float(snapshot["sunAzimuth"]), float(snapshot["sunAltitude"]))
                (review_dir / f"{snapshot['id']}.light.webp").write_bytes(light_bytes)
            (review_dir / f"base-{args.season}.webp").write_bytes(image)
            manifest["benches"].append({
                "id": bench_id, "latitude": geometry.latitude, "longitude": geometry.longitude,
                "source": str(source), "geometryImplementation": geometry.version, "geometryComplete": geometry.complete,
                "base": str(review_dir / f"base-{args.season}.webp"), "renderKey": render_key,
            })
        database.commit()
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"fixtures": len(args.fixture), "output": str(output)}, separators=(",", ":")))
    finally:
        database.close()
