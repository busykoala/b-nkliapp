"""Render a named, immutable review iteration from downloaded cluster capsules.

No network, app database writes, geography regeneration, or publication. Run
prepare.ts first for actual astronomical states and synthetic weather cases.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "worker"))
from benchly.panorama.binary import decode_geometry  # noqa: E402
from benchly.panorama.models import RENDER_IMPLEMENTATION  # noqa: E402
from benchly.panorama.watercolor import render_lightmap_webp, render_material_webp, render_panorama_webp  # noqa: E402
from source import snapshot as source_snapshot, sources as source_files  # noqa: E402


def paint(job):
    bench, key, source, output, seasons, lighting, omit_facade_references, legacy_radial_lighting = job
    raw = source.read_bytes()
    start = time.perf_counter()
    geometry = decode_geometry(raw)
    decode_ms = (time.perf_counter() - start) * 1000
    if key != geometry.identity_key or abs(geometry.latitude - bench["latitude"]) > 1e-7 or abs(geometry.longitude - bench["longitude"]) > 1e-7:
        raise ValueError(f"Capsule binding changed: {bench['id']}")
    if omit_facade_references:
        # A documented local painting control: keep exact geographic samples,
        # lighting, identity/texture seed and capsule bytes; omit only marks.
        geometry = geometry.model_copy(update={"buildings": tuple(building.model_copy(
            update={"facade_references": ()}) for building in geometry.buildings)})
    destination = output / bench["id"]
    destination.mkdir(parents=True)
    material = render_material_webp(geometry)
    (destination / "material.webp").write_bytes(material)
    results = []
    for season in seasons:
        start = time.perf_counter()
        raster_height = round(4096 * (geometry.config.maximum_elevation_angle - geometry.config.minimum_elevation_angle) / 360)
        image = render_panorama_webp(geometry, 4096, raster_height, season)
        elapsed = (time.perf_counter() - start) * 1000
        (destination / f"base-{season}.webp").write_bytes(image)
        pixels = np.asarray(Image.open(io.BytesIO(image)).convert("RGB"), dtype=np.int16)
        results.append({"season": season, "width": 4096, "height": raster_height, "renderMs": round(elapsed, 2), "bytes": len(image),
                        "sha256": hashlib.sha256(image).hexdigest(),
                        "seamMeanAbsoluteError": round(float(np.abs(pixels[:, 0] - pixels[:, -1]).mean()), 3)})
        # Light is independent of weather; share identical sun states within a season.
        lights = {}
        for scene in bench["scenarios"]:
            if scene["season"] != season:
                continue
            sun = scene["sun"]
            light_name = f"{season}-{scene['id']}.light.webp"
            if lighting:
                (destination / light_name).write_bytes((lighting / bench["id"] / light_name).read_bytes())
                continue
            identity = (sun["azimuth"], sun["altitude"])
            if identity not in lights:
                lights[identity] = render_lightmap_webp(geometry, *identity, use_surface_normals=not legacy_radial_lighting)
            (destination / light_name).write_bytes(lights[identity])
    semantics = {}
    for column in geometry.columns:
        for span in column.spans:
            semantics[span.semantic.value] = semantics.get(span.semantic.value, 0) + 1
    diagnostics = {"columnCount": len(geometry.columns), "buildings": len(geometry.buildings),
                   "terrainSpansWithNormals": sum(span.surface_normal is not None for column in geometry.columns for span in column.spans),
                   "facadeReferences": [{"buildingId": building.object_id, **reference.model_dump(mode="json")}
                       for building in geometry.buildings for reference in building.facade_references],
                   "semanticSpanCounts": semantics, "warnings": geometry.warnings,
                   "minimumElevation": geometry.config.minimum_elevation_angle,
                   "maximumElevation": geometry.config.maximum_elevation_angle,
                   "sourceVersions": [source.model_dump() for source in geometry.sources],
                   "complete": geometry.complete}
    (destination / "geometry-diagnostics.json").write_text(json.dumps(diagnostics, indent=2, default=str) + "\n")
    print(json.dumps({"bench": bench["number"], "id": bench["id"], "renderMs": [r["renderMs"] for r in results]}), flush=True)
    return {**bench, "geometryKey": key, "capsuleSha256": hashlib.sha256(raw).hexdigest(),
            "decodeMs": round(decode_ms, 2), "diagnostics": diagnostics, "renders": results}


def contact_sheet(output, benches, season):
    width, height = 900, 600
    sheet = Image.new("RGB", (width * 2, height * ((len(benches) + 1) // 2)), "#f5f1e7")
    draw = ImageDraw.Draw(sheet)
    for i, bench in enumerate(benches):
        image = Image.open(output / bench["id"] / f"base-{season}.webp").convert("RGB")
        # A 110-degree crop around the artist's selected bearing; circular at north.
        left = round((bench["heading"] - 55) / 360 * image.width)
        crop_width = round(110 / 360 * image.width)
        repeated = Image.new("RGB", (image.width * 3, image.height))
        for j in range(3): repeated.paste(image, (j * image.width, 0))
        minimum = bench["diagnostics"]["minimumElevation"]
        maximum = bench["diagnostics"]["maximumElevation"]
        scale = image.height / (maximum - minimum)
        top = round((maximum - min(46, maximum)) * scale)
        bottom = round((maximum - max(-19, minimum)) * scale)
        crop = repeated.crop((left + image.width, top, left + image.width + crop_width, bottom))
        crop.thumbnail((width - 20, height - 38))
        x, y = i % 2 * width, i // 2 * height
        sheet.paste(crop, (x + 10, y + 28))
        draw.text((x + 10, y + 7), f"{bench['number']:02} {bench['id']} / {season}", fill="#28332e")
    sheet.save(output / f"contact-{season}.jpg", quality=92)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, help="New iteration name; existing outputs are never overwritten")
    parser.add_argument("--seasons", nargs="+", choices=("spring", "summer", "autumn", "winter"), default=["autumn"])
    parser.add_argument("--numbers", nargs="+", type=int)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--lighting", help="Use this iteration's fixed lightmaps for a controlled painting-only comparison")
    parser.add_argument("--geometry-root", type=Path, help="Use locally re-extracted, source-verified geography from this builder root")
    parser.add_argument("--omit-facade-references", action="store_true", help="Controlled local before view with identical geography/seed but no curated facade painting")
    parser.add_argument("--legacy-radial-lighting", action="store_true", help="Controlled local lightmaps using the previous ray-slope approximation")
    args = parser.parse_args()
    if args.legacy_radial_lighting and args.lighting:
        parser.error("A radial-lighting control must render its own lightmaps; omit --lighting")
    if not args.stage.replace("-", "").replace("_", "").isalnum(): parser.error("stage must be a simple name")
    output = ROOT / "test-results/panorama-artist-review" / args.stage
    if output.exists(): parser.error(f"preserving existing iteration: {output}")
    snapshot = ROOT / "data/panorama-artist-review/cluster"
    scenes = json.loads((snapshot.parent / "scenarios.json").read_text())
    benches = [b for b in scenes["benches"] if not args.numbers or b["number"] in args.numbers]
    index = {line.split("\t")[2]: line.split("\t")[0] for line in (snapshot / "verified-index.tsv").read_text().splitlines()}
    sources = {bench_id: snapshot / "capsules" / key[:2] / f"{key}.bpc" for bench_id, key in index.items()}
    if args.geometry_root:
        geography = args.geometry_root.resolve()
        with sqlite3.connect(f"file:{geography / 'progress.sqlite'}?mode=ro", uri=True) as database:
            rows = database.execute("SELECT bench_id,geometry_key,relative_path,sha256 FROM extractions WHERE status='ready'").fetchall()
        available = {row[0]: row for row in rows}
        for bench in benches:
            _, key, relative, checksum = available[bench["id"]]
            path = (geography / relative).resolve()
            if not path.is_relative_to(geography) or hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
                raise ValueError("Local extraction checksum mismatch")
            index[bench["id"]], sources[bench["id"]] = key, path
    output.mkdir(parents=True)
    code = source_snapshot(output)
    lighting = output.parent / args.lighting if args.lighting else None
    if lighting:
        previous = json.loads((lighting / "manifest.json").read_text())
        if previous.get("legacyRadialLighting", False) != args.legacy_radial_lighting:
            raise ValueError("Reused lightmaps must use the same terrain-normal method")
        for bench in benches:
            before = next(b for b in previous["benches"] if b["id"] == bench["id"])
            if before["geometryKey"] != index[bench["id"]] or before["scenarios"] != bench["scenarios"]:
                # Catalogue bearings can change without changing illumination.
                if before["geometryKey"] != index[bench["id"]] or any(
                    a["sun"] != b["sun"] or a["at"] != b["at"] for a, b in zip(before["scenarios"], bench["scenarios"], strict=True)
                ): raise ValueError("Lighting comparison requires identical geometry and astronomical states")
    jobs = [(b, index[b["id"]], sources[b["id"]], output, args.seasons, lighting, args.omit_facade_references, args.legacy_radial_lighting) for b in benches]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(paint, jobs))
    if source_files() != code["files"]:
        (output / "SOURCE_CHANGED_DURING_RENDER.txt").write_text("This iteration is not a reproducible comparison. Sources changed while painting.\n")
        raise RuntimeError("Source changed while rendering; preserve this failed iteration and use a new stage")
    manifest = {"format": "benchly-artist-iteration", "stage": args.stage,
                "renderImplementation": RENDER_IMPLEMENTATION, "sourceSnapshotSha256": code["sha256"],
                "gitCommit": code["gitCommit"],
                "recordsSha256": scenes["recordsSha256"], "seasons": args.seasons, "fixedLightingFrom": args.lighting,
                "omitFacadeReferences": args.omit_facade_references, "legacyRadialLighting": args.legacy_radial_lighting, "benches": results}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str) + "\n")
    for season in args.seasons: contact_sheet(output, results, season)
    print(json.dumps({"output": str(output), "benches": len(results), "seasons": args.seasons}))


if __name__ == "__main__":
    main()
