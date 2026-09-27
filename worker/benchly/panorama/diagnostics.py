"""Development-only evidence report for one real panorama and selected ray."""

from __future__ import annotations

import hashlib
import json
from argparse import Namespace
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from benchly.context.rasters import RasterCollection
from benchly.panorama.binary import decode_geometry
from benchly.panorama.material import MATERIAL_ID_TO_SEMANTIC, MATERIAL_SEMANTIC_IDS
from benchly.panorama.models import PanoramaGeometry, SemanticClass, VisibleSpan


SEMANTIC_COLOURS = {
    SemanticClass.SKY: (196, 220, 228),
    SemanticClass.WATER: (53, 119, 148),
    SemanticClass.RIVER: (82, 153, 177),
    SemanticClass.FOREST: (40, 91, 63),
    SemanticClass.OPEN_GRASSLAND: (156, 174, 104),
    SemanticClass.ROCK: (113, 107, 99),
    SemanticClass.SNOW_OR_GLACIER: (225, 238, 239),
    SemanticClass.SETTLEMENT: (188, 137, 96),
    SemanticClass.BUILDING: (166, 86, 61),
    SemanticClass.UNKNOWN_TERRAIN: (137, 126, 147),
}
LEGACY_IDS = {
    round((index + 1) / len(SemanticClass) * 255): semantic
    for index, semantic in enumerate(SemanticClass)
}


def _sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def selected_ray(geometry: PanoramaGeometry, azimuth_degrees: float,
                 elevation_angle_degrees: float) -> tuple[int, VisibleSpan | None]:
    index = round((azimuth_degrees % 360) / geometry.config.angular_resolution_degrees) % len(geometry.columns)
    spans = geometry.columns[index].spans
    owner = next((span for span in reversed(spans)
                  if span.lower_angle_degrees <= elevation_angle_degrees <= span.upper_angle_degrees), None)
    return index, owner


def _semantic_image(material: Image.Image) -> Image.Image:
    values = np.asarray(material.convert("RGBA"), dtype=np.uint8)
    ids = values[..., 1]
    modern = bool(np.any((ids > 0) & (ids <= max(MATERIAL_ID_TO_SEMANTIC))))
    lookup = MATERIAL_ID_TO_SEMANTIC if modern else LEGACY_IDS
    output = np.empty((*ids.shape, 3), dtype=np.uint8)
    output[:] = SEMANTIC_COLOURS[SemanticClass.SKY]
    for identifier, semantic in lookup.items():
        output[ids == identifier] = SEMANTIC_COLOURS[semantic]
    unknown = (ids != 0) & ~np.isin(ids, list(lookup))
    output[unknown] = (220, 31, 120)
    if modern:
        alpha = values[..., 3:4].astype(np.float32) / 255
        sky = np.asarray(SEMANTIC_COLOURS[SemanticClass.SKY], dtype=np.float32)
        output = np.round(output * alpha + sky * (1 - alpha)).astype(np.uint8)
    return Image.fromarray(output, "RGB")


def _depth_image(material: Image.Image) -> Image.Image:
    values = np.asarray(material.convert("RGBA"), dtype=np.uint8)
    depth = values[..., 0].astype(np.float32) / 255
    # A perceptually ordered cyan/yellow/magenta ramp makes discontinuities
    # obvious without resembling any production material palette.
    red = np.clip(2 * depth - .25, 0, 1)
    green = np.clip(1.35 - 2 * np.abs(depth - .45), 0, 1)
    blue = np.clip(1.15 - 1.8 * depth, 0, 1)
    colour = np.round(np.stack((red, green, blue), axis=-1) * 255).astype(np.uint8)
    land = values[..., 1] > 0
    colour[~land] = (206, 222, 226)
    return Image.fromarray(colour, "RGB")


def _panel(image: Image.Image, title: str, size: tuple[int, int]) -> Image.Image:
    resized = image.convert("RGB").resize(size, Image.Resampling.NEAREST)
    panel = Image.new("RGB", (size[0], size[1] + 34), (247, 241, 227))
    panel.paste(resized, (0, 34))
    ImageDraw.Draw(panel).text((12, 10), title, fill=(36, 63, 53))
    return panel


def _artifact(path: Path) -> dict[str, object]:
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": _sha256(path)}


def _manifest_matches(path: Path | None, geometry_key: str) -> list[dict[str, object]]:
    if path is None:
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [item for item in payload.get("artifacts", []) if item.get("geometry_key") == geometry_key]


def panorama_diagnostic_job(args: Namespace) -> None:
    capsule_path = Path(args.capsule).resolve()
    painting_path = Path(args.painting).resolve()
    material_path = Path(args.material).resolve()
    lightmap_path = Path(args.lightmap).resolve() if args.lightmap else None
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    geometry = decode_geometry(capsule_path.read_bytes())
    painting = Image.open(painting_path).convert("RGB")
    material = Image.open(material_path).convert("RGBA")

    if args.pixel_x is not None or args.pixel_y is not None:
        if args.pixel_x is None or args.pixel_y is None:
            raise ValueError("--pixel-x and --pixel-y must be supplied together")
        azimuth = (float(args.pixel_x) + .5) / material.width * 360
        elevation = geometry.config.maximum_elevation_angle - (
            (float(args.pixel_y) + .5) / material.height
            * (geometry.config.maximum_elevation_angle - geometry.config.minimum_elevation_angle)
        )
    else:
        azimuth = float(args.azimuth)
        elevation = float(args.elevation_angle)
    index, owner = selected_ray(geometry, azimuth, elevation)
    column = geometry.columns[index]

    false_depth = _depth_image(material)
    false_semantics = _semantic_image(material)
    false_depth.save(output / "depth.png")
    false_semantics.save(output / "semantics.png")
    panel_size = (min(1600, painting.width), round(min(1600, painting.width) * painting.height / painting.width))
    panels = [
        _panel(painting, "Painting", panel_size),
        _panel(false_depth, "Log distance", panel_size),
        _panel(false_semantics, "Semantic class", panel_size),
    ]
    montage = Image.new("RGB", (panel_size[0], sum(item.height for item in panels)), (247, 241, 227))
    y = 0
    for panel in panels:
        montage.paste(panel, (0, y)); y += panel.height
    montage.save(output / "comparison.png")

    collections = {}
    for name, directory in (("local_terrain", args.terrain_dir), ("near_terrain", args.near_terrain_dir),
                            ("regional_terrain", args.regional_terrain_dir),
                            ("border_terrain", args.border_terrain_dir)):
        if not directory:
            continue
        collection = RasterCollection(Path(directory).resolve())
        try:
            collections[name] = collection.describe_point(geometry.latitude, geometry.longitude)
        finally:
            collection.close()
    artifacts = {
        "capsule": _artifact(capsule_path),
        "painting": _artifact(painting_path),
        "material": _artifact(material_path),
    }
    if lightmap_path:
        artifacts["lightmap"] = _artifact(lightmap_path)
    report = {
        "geometry": {
            "identity": geometry.identity_key,
            "implementation": geometry.version,
            "latitude": geometry.latitude,
            "longitude": geometry.longitude,
            "complete": geometry.complete,
            "warnings": list(geometry.warnings),
        },
        "observer": {
            "ground_elevation_meters": geometry.ground_elevation_meters,
            "eye_elevation_meters": geometry.eye_elevation_meters,
            "display_elevation_meters": geometry.display_elevation_meters,
            "sampled_dem_elevation_meters": geometry.terrain_ground_elevation_meters,
            "provenance": geometry.ground_elevation_provenance,
            "confidence": geometry.ground_elevation_confidence,
            "disagreement_meters": geometry.ground_elevation_disagreement_meters,
            "coordinate_reference": "WGS 84 longitude/latitude (EPSG:4326)",
        },
        "selection": {
            "pixel": None if args.pixel_x is None else [args.pixel_x, args.pixel_y],
            "azimuth_degrees": azimuth,
            "sampled_azimuth_degrees": column.azimuth_degrees,
            "elevation_angle_degrees": elevation,
            "skyline_angle_degrees": column.skyline_angle_degrees,
            "owner": None if owner is None else {
                "semantic": owner.semantic.value,
                "distance_meters": owner.distance_meters,
                "lower_angle_degrees": owner.lower_angle_degrees,
                "upper_angle_degrees": owner.upper_angle_degrees,
                "terrain_source": owner.terrain_source,
                "confidence": owner.confidence,
                "object_id": owner.object_id,
            },
        },
        "raster_sources_at_observer": collections,
        "artifacts": artifacts,
        "manifest_matches": _manifest_matches(Path(args.manifest).resolve() if args.manifest else None,
                                               geometry.identity_key),
        "outputs": {"comparison": str(output / "comparison.png"), "depth": str(output / "depth.png"),
                    "semantics": str(output / "semantics.png")},
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(output / "report.json"), "owner": report["selection"]["owner"]}, separators=(",", ":")))
