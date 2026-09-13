#!/usr/bin/env python3
"""Benchmark deterministic panorama paint and local cache reads.

The command is deliberately offline. It consumes cached JSON/NPZ geometry so
renderer iterations never contact swisstopo, OpenStreetMap, or production.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))

from benchly.panorama.models import PanoramaGeometry  # noqa: E402
from benchly.panorama.watercolor import PAINT_SCALE, render_panorama_webp  # noqa: E402


def load_geometry(path: Path) -> PanoramaGeometry:
    if path.suffix == ".npz":
        with np.load(path, allow_pickle=False) as archive:
            payload = archive["manifest"].tobytes()
    else:
        payload = gzip.decompress(path.read_bytes()) if path.name.endswith(".gz") else path.read_bytes()
    return PanoramaGeometry.model_validate_json(payload)


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def benchmark(path: Path, iterations: int, season: str) -> dict[str, object]:
    decode_started = time.perf_counter()
    geometry = load_geometry(path)
    decode_ms = (time.perf_counter() - decode_started) * 1_000
    timings: list[float] = []
    image = b""
    for _ in range(iterations):
        started = time.perf_counter()
        image = render_panorama_webp(geometry, 4096, 1024, season)
        timings.append((time.perf_counter() - started) * 1_000)
    with tempfile.TemporaryDirectory(prefix="benchly-panorama-") as directory:
        artifact = Path(directory) / "artifact.webp"
        artifact.write_bytes(image)
        cache_timings = []
        for _ in range(max(20, iterations * 4)):
            started = time.perf_counter()
            cached = artifact.read_bytes()
            cache_timings.append((time.perf_counter() - started) * 1_000)
            if cached != image:
                raise RuntimeError("cache read changed artifact bytes")
    pixels = np.asarray(Image.open(io.BytesIO(image)).convert("RGB"), dtype=np.int16)
    return {
        "fixture": str(path),
        "geometryColumns": len(geometry.columns),
        "maximumHorizontalSamplingErrorDegrees": round(180 / (4096 * PAINT_SCALE), 4),
        "maximumVerticalSamplingErrorDegrees": round(
            (geometry.config.maximum_elevation_angle - geometry.config.minimum_elevation_angle)
            / (2 * 1024 * PAINT_SCALE), 4,
        ),
        "geometryDecodeMs": round(decode_ms, 3),
        "renderMedianMs": round(statistics.median(timings), 3),
        "renderP95Ms": round(percentile(timings, .95), 3),
        "cachedReadMedianMs": round(statistics.median(cache_timings), 3),
        "seamMeanAbsoluteError": round(float(np.abs(pixels[:, 0] - pixels[:, -1]).mean()), 3),
        "bytes": len(image),
        "sha256": hashlib.sha256(image).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture", nargs="+", type=Path)
    parser.add_argument("--iterations", type=int, default=7)
    parser.add_argument("--season", choices=("spring", "summer", "autumn", "winter"), default="autumn")
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("--iterations must be positive")
    print(json.dumps({
        "format": "benchly-panorama-benchmark-v1",
        "iterations": args.iterations,
        "results": [benchmark(path.resolve(), args.iterations, args.season) for path in args.fixture],
    }, indent=2))


if __name__ == "__main__":
    main()
