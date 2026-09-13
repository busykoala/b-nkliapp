"""Deterministic raster-watercolor painter for geographic panoramas.

The geometry remains factual. This module only turns its connected depth and
semantic masks into soft pigment washes; it never inserts a landmark or a
landscape class that is absent from the source contract.
"""

from __future__ import annotations

import hashlib
import io
import math
from collections import defaultdict

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from benchly.panorama.models import PanoramaGeometry, SemanticClass, TERRAIN_DEPTH_LIMITS_METERS, terrain_depth_layer


SEASON_PALETTES = {
    "spring": {
        SemanticClass.WATER: (72, 157, 181), SemanticClass.RIVER: (65, 148, 175),
        SemanticClass.FOREST: (63, 121, 82), SemanticClass.OPEN_GRASSLAND: (150, 175, 101),
        SemanticClass.ROCK: (143, 137, 128), SemanticClass.SNOW_OR_GLACIER: (235, 239, 234),
        SemanticClass.SETTLEMENT: (174, 148, 119), SemanticClass.BUILDING: (181, 135, 100),
        SemanticClass.UNKNOWN_TERRAIN: (116, 142, 111),
    },
    "summer": {
        SemanticClass.WATER: (63, 151, 179), SemanticClass.RIVER: (56, 143, 170),
        SemanticClass.FOREST: (53, 112, 75), SemanticClass.OPEN_GRASSLAND: (139, 164, 89),
        SemanticClass.ROCK: (139, 132, 122), SemanticClass.SNOW_OR_GLACIER: (233, 238, 233),
        SemanticClass.SETTLEMENT: (171, 145, 116), SemanticClass.BUILDING: (180, 132, 96),
        SemanticClass.UNKNOWN_TERRAIN: (106, 133, 103),
    },
    "autumn": {
        SemanticClass.WATER: (70, 149, 174), SemanticClass.RIVER: (63, 140, 164),
        SemanticClass.FOREST: (75, 116, 73), SemanticClass.OPEN_GRASSLAND: (164, 154, 83),
        SemanticClass.ROCK: (145, 132, 117), SemanticClass.SNOW_OR_GLACIER: (235, 236, 228),
        SemanticClass.SETTLEMENT: (178, 139, 105), SemanticClass.BUILDING: (181, 123, 86),
        SemanticClass.UNKNOWN_TERRAIN: (126, 128, 88),
    },
    "winter": {
        SemanticClass.WATER: (88, 149, 166), SemanticClass.RIVER: (82, 141, 158),
        SemanticClass.FOREST: (66, 99, 78), SemanticClass.OPEN_GRASSLAND: (147, 152, 118),
        SemanticClass.ROCK: (139, 137, 132), SemanticClass.SNOW_OR_GLACIER: (237, 240, 236),
        SemanticClass.SETTLEMENT: (164, 145, 124), SemanticClass.BUILDING: (172, 139, 111),
        SemanticClass.UNKNOWN_TERRAIN: (119, 132, 116),
    },
}

_LAYERS = tuple(range(len(TERRAIN_DEPTH_LIMITS_METERS) + 1))
_LAYER_HAZE = (.01, .05, .12, .22, .34, .46, .56, .64)
_LAYER_OPACITY = (.97, .95, .92, .88, .83, .78, .73, .68)
_MOUNTAIN = {
    SemanticClass.SNOW_OR_GLACIER, SemanticClass.ROCK, SemanticClass.UNKNOWN_TERRAIN,
    SemanticClass.OPEN_GRASSLAND, SemanticClass.FOREST,
}
PAINT_SCALE = .31


def _seed(key: str, salt: str = "") -> int:
    return int(hashlib.sha256(f"{key}:{salt}".encode()).hexdigest()[:16], 16)


def _mix(first: tuple[int, int, int], second: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(left + (right - left) * amount) for left, right in zip(first, second))


def _angle_y(angle: float, geometry: PanoramaGeometry, height: int) -> int:
    minimum, maximum = geometry.config.minimum_elevation_angle, geometry.config.maximum_elevation_angle
    return round((maximum - angle) / (maximum - minimum) * height)


def _wrap_blur(image: Image.Image, radius: float) -> Image.Image:
    if radius <= 0:
        return image
    width, height = image.size
    padding = min(width, max(2, math.ceil(radius * 4)))
    repeated = Image.new(image.mode, (width + padding * 2, height))
    repeated.paste(image, (padding, 0))
    repeated.paste(image.crop((width - padding, 0, width, height)), (0, 0))
    repeated.paste(image.crop((0, 0, padding, height)), (padding + width, 0))
    return repeated.filter(ImageFilter.GaussianBlur(radius)).crop((padding, 0, padding + width, height))


def _paper_noise(width: int, height: int, seed: int, scale: int = 44) -> Image.Image:
    rng = np.random.default_rng(seed)
    small_width = max(4, math.ceil(width / scale))
    small_height = max(4, math.ceil(height / scale))
    values = rng.normal(128, 27, (small_height, small_width)).clip(0, 255).astype(np.uint8)
    values[:, -1] = values[:, 0]
    return Image.fromarray(values, "L").resize((width, height), Image.Resampling.BICUBIC)


def _span_masks(geometry: PanoramaGeometry, width: int, height: int):
    masks = {}
    draws = {}
    # Painting more angular columns than the working raster can represent is
    # both expensive and visually meaningless. Sample at the centre of every
    # paint pixel; the final Lanczos pass retains the contour precision of the
    # delivery image.
    column_count = len(geometry.columns)
    maximum_angle = geometry.config.maximum_elevation_angle
    angle_scale = height / (maximum_angle - geometry.config.minimum_elevation_angle)
    for left in range(width):
        index = min(column_count - 1, math.floor((left + .5) * column_count / width))
        column = geometry.columns[index]
        right = left + 1
        for span in column.spans:
            if span.semantic == SemanticClass.BUILDING or span.semantic not in SEASON_PALETTES["summer"]:
                continue
            top = max(0, min(height, round((maximum_angle - span.upper_angle_degrees) * angle_scale)))
            bottom = max(0, min(height, round((maximum_angle - span.lower_angle_degrees) * angle_scale)))
            if bottom <= top:
                continue
            key = (span.semantic, terrain_depth_layer(span.distance_meters))
            if key not in draws:
                masks[key] = Image.new("L", (width, height))
                draws[key] = ImageDraw.Draw(masks[key])
            draws[key].rectangle((left, top, right, bottom), fill=255)
    masks = {key: _wrap_blur(mask, 1.65) for key, mask in masks.items()}
    return masks


def _gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    y = np.linspace(0, 1, height, dtype=np.float32)[:, None, None]
    first, second = np.array(top, dtype=np.float32), np.array(bottom, dtype=np.float32)
    rgb = np.broadcast_to(first + (second - first) * y, (height, width, 3)).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def _paint_wash(base: Image.Image, mask: Image.Image, color: tuple[int, int, int], opacity: float,
                pigments: tuple[Image.Image, Image.Image]) -> None:
    if not mask.getbbox():
        return
    for pass_index, shift in enumerate(((-2, 1), (1, 0))):
        tint = _mix(color, (47, 65, 57), .22) if pass_index == 0 else _mix(color, (246, 235, 207), .16)
        layer = Image.new("RGB", base.size, tint)
        alpha = ImageChops.multiply(mask, pigments[pass_index])
        alpha = ImageChops.offset(alpha, shift[0], shift[1])
        factor = opacity * (.48 if pass_index == 0 else .62)
        alpha = alpha.point(lambda value, factor=factor: round(value * factor))
        base.paste(layer, (0, 0), alpha)


def _sky_mask(geometry: PanoramaGeometry, width: int, height: int) -> Image.Image:
    mask = Image.new("L", (width, height))
    skyline = [((index + .5) / len(geometry.columns) * width,
                _angle_y(column.skyline_angle_degrees, geometry, height)) for index, column in enumerate(geometry.columns)]
    ImageDraw.Draw(mask).polygon([(0, 0), (width, 0), *reversed(skyline)], fill=255)
    return _wrap_blur(mask, 1.2)


def _paint_sky(base: Image.Image, geometry: PanoramaGeometry, broad_pigment: Image.Image) -> None:
    width, height = base.size
    mask = _sky_mask(geometry, width, height)
    cool = broad_pigment.point(lambda value: 8 + value * 18 // 255)
    warm = _gradient((width, height), (0, 0, 0), (255, 255, 255)).convert("L")
    cool = ImageChops.multiply(cool, mask)
    warm = ImageChops.multiply(warm.point(lambda value: value * 18 // 255), mask)
    base.paste(Image.new("RGB", base.size, (128, 177, 188)), (0, 0), cool)
    base.paste(Image.new("RGB", base.size, (238, 198, 139)), (0, 0), warm)


def _pool_pigment(base: Image.Image, mask: Image.Image, color: tuple[int, int, int], strength: float) -> None:
    """Collect a restrained pigment edge at factual surface boundaries."""
    width, _height = base.size
    edge = mask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(.7))
    edge = edge.point(lambda value: round(value * strength))
    base.paste(Image.new("RGB", base.size, _mix(color, (49, 67, 61), .38)), (0, 0), edge)


def _paint_landform_relief(base: Image.Image, masks) -> None:
    """Model factual layer boundaries as soft watercolor folds."""
    width, _height = base.size
    combined = Image.new("L", base.size)
    edges = Image.new("L", base.size)
    for layer in _LAYERS:
        for semantic in _MOUNTAIN:
            mask = masks.get((semantic, layer))
            if mask is not None:
                combined = ImageChops.lighter(combined, mask)
                edges = ImageChops.lighter(edges, mask.filter(ImageFilter.FIND_EDGES))
    if not combined.getbbox():
        return
    shadow = ImageChops.multiply(combined, ImageChops.offset(edges, max(1, width // 1800), 3))
    shadow = _wrap_blur(shadow, 1.45).point(lambda value: round(value * .18))
    highlight = ImageChops.multiply(combined, ImageChops.offset(edges, -max(1, width // 2300), -2))
    highlight = _wrap_blur(highlight, 1.05).point(lambda value: round(value * .09))
    base.paste(Image.new("RGB", base.size, (68, 84, 72)), (0, 0), shadow)
    base.paste(Image.new("RGB", base.size, (235, 230, 207)), (0, 0), highlight)


def _paint_forest_details(base: Image.Image, masks, canopy_field: Image.Image, seed: int) -> None:
    """Add clustered canopy mass only where geographic forest is visible."""
    forest = Image.new("L", base.size)
    for layer in _LAYERS:
        mask = masks.get((SemanticClass.FOREST, layer))
        if mask is not None:
            forest = ImageChops.lighter(forest, mask)
    if not forest.getbbox():
        return
    # Broad connected blooms read as canopy masses without turning mapped
    # forest into a field of decorative dots or claiming individual trees.
    clusters = canopy_field.point(lambda value: max(15, min(70, 42 + 128 - value)))
    clusters = ImageChops.multiply(forest, _wrap_blur(clusters, 2.1))
    base.paste(Image.new("RGB", base.size, (38, 76, 58)), (0, 0), clusters)
    canopy_light = canopy_field.point(lambda value: max(0, min(34, value - 119)))
    canopy_light = ImageChops.multiply(forest, _wrap_blur(ImageChops.offset(canopy_light, -3, -2), 1.5))
    base.paste(Image.new("RGB", base.size, (174, 176, 112)), (0, 0), canopy_light)

    # Irregular overlapping crown groups follow the upper edge of each real
    # forest depth mask. They make woodland legible without pretending that
    # an individual procedural crown corresponds to a surveyed tree.
    crown_groups = Image.new("L", base.size)
    crowns = ImageDraw.Draw(crown_groups)
    width, _height = base.size
    rng = np.random.default_rng(seed)
    for layer in range(min(3, len(_LAYERS))):
        mask = masks.get((SemanticClass.FOREST, layer))
        if mask is None or not mask.getbbox():
            continue
        pixels = np.asarray(mask)
        left, _top, right, _bottom = mask.getbbox()
        step = 24 + layer * 7
        x = left + int(rng.integers(0, step))
        while x < right:
            vertical = np.flatnonzero(pixels[:, min(width - 1, x)] > 110)
            if vertical.size:
                top = int(vertical[0])
                count = int(rng.integers(2, 5))
                group_span = int(rng.integers(8, 15))
                ink = int(rng.integers(42, 65))
                for tree in range(count):
                    center_x = x + round((tree / max(1, count - 1) - .5) * group_span)
                    tree_width = int(rng.integers(3, 6))
                    tree_height = int(rng.integers(7, 14))
                    for shift in (-width, 0, width):
                        if (tree + layer) % 3:
                            crowns.polygon((
                                (center_x + shift, top),
                                (center_x + shift - tree_width, top + tree_height),
                                (center_x + shift + tree_width, top + tree_height),
                            ), fill=ink)
                        else:
                            crowns.ellipse((
                                center_x + shift - tree_width, top,
                                center_x + shift + tree_width, top + tree_height,
                            ), fill=ink)
            x += max(5, round(step * rng.uniform(.68, 1.15)))
    crown_groups = ImageChops.multiply(forest, _wrap_blur(crown_groups, .9))
    base.paste(Image.new("RGB", base.size, (30, 69, 52)), (0, 0), crown_groups)
    crown_group_light = ImageChops.multiply(forest, ImageChops.offset(crown_groups, -1, -2))
    crown_group_light = crown_group_light.point(lambda value: round(value * .18))
    base.paste(Image.new("RGB", base.size, (173, 179, 112)), (0, 0), crown_group_light)

    forest_edge = forest.filter(ImageFilter.FIND_EDGES)
    crown_light = ImageChops.multiply(forest, ImageChops.offset(forest_edge, -1, -2))
    crown_light = _wrap_blur(crown_light, 1.1).point(lambda value: round(value * .1))
    base.paste(Image.new("RGB", base.size, (189, 185, 126)), (0, 0), crown_light)


def _paint_surface_blooms(base: Image.Image, masks, pigment_field: Image.Image) -> None:
    """Give broad land surfaces transparent, connected watercolor blooms."""
    tones = {
        SemanticClass.OPEN_GRASSLAND: ((85, 105, 70), (222, 211, 158)),
        SemanticClass.ROCK: ((91, 86, 80), (224, 215, 198)),
        SemanticClass.UNKNOWN_TERRAIN: ((76, 96, 78), (216, 211, 170)),
    }
    shadow_field = pigment_field.point(lambda value: max(0, min(38, (139 - value))))
    light_field = pigment_field.point(lambda value: max(0, min(27, (value - 126))))
    for semantic, (shadow_color, light_color) in tones.items():
        surface = Image.new("L", base.size)
        for layer in _LAYERS:
            mask = masks.get((semantic, layer))
            if mask is not None:
                surface = ImageChops.lighter(surface, mask)
        if not surface.getbbox():
            continue
        shadow = ImageChops.multiply(surface, shadow_field)
        light = ImageChops.multiply(surface, ImageChops.offset(light_field, 2, -1))
        base.paste(Image.new("RGB", base.size, shadow_color), (0, 0), shadow)
        base.paste(Image.new("RGB", base.size, light_color), (0, 0), light)


def _building_runs(geometry: PanoramaGeometry, width: int, height: int):
    resolution = geometry.config.angular_resolution_degrees
    for building in geometry.buildings:
        ordered = sorted(building.samples, key=lambda sample: sample.azimuth_degrees)
        if not ordered:
            continue
        runs: list[list] = [[]]
        for sample in ordered:
            if runs[-1] and sample.azimuth_degrees - runs[-1][-1].azimuth_degrees > resolution * 2.2:
                runs.append([])
            runs[-1].append(sample)
        if len(runs) > 1 and runs[0][0].azimuth_degrees < 2 and runs[-1][-1].azimuth_degrees > 358:
            joined = runs[-1] + [sample.model_copy(update={"azimuth_degrees": sample.azimuth_degrees + 360}) for sample in runs[0]]
            runs = [joined, *runs[1:-1]]
        for run in runs:
            if len(run) < 2:
                continue
            walls = [(sample.azimuth_degrees / 360 * width, _angle_y(sample.eaves_angle_degrees, geometry, height)) for sample in run]
            walls.extend((sample.azimuth_degrees / 360 * width, _angle_y(sample.lower_angle_degrees, geometry, height)) for sample in reversed(run))
            roof = [(sample.azimuth_degrees / 360 * width, _angle_y(sample.upper_angle_degrees, geometry, height)) for sample in run]
            roof.extend((sample.azimuth_degrees / 360 * width, _angle_y(sample.eaves_angle_degrees, geometry, height)) for sample in reversed(run))
            yield building, run, walls, roof


def _paint_buildings(base: Image.Image, geometry: PanoramaGeometry, seed: int,
                     pigment_field: Image.Image) -> None:
    width, height = base.size
    overlay = Image.new("RGBA", base.size)
    draw = ImageDraw.Draw(overlay)
    for index, (_building, samples, walls, roof) in enumerate(_building_runs(geometry, width, height)):
        distance = float(np.median([sample.distance_meters for sample in samples]))
        haze = .04 if distance < 120 else .28 if distance < 1_500 else .62
        rng = np.random.default_rng(seed + index * 31)
        wall_base = _mix((181, 139, 105), (196, 160, 119), float(rng.uniform(0, .32)))
        wall = _mix(wall_base, (215, 220, 207), haze)
        roof_color = _mix((132, 91, 72), (205, 211, 201), haze)
        alpha = 210 if distance < 500 else 165 if distance < 2_000 else 92
        # TLM/OSM often supplies a reliable footprint but no roof model. A
        # shallow, conservative wash roof makes it readable as a house without
        # claiming an exact architectural form or storey count.
        top = roof[:len(samples)]
        eaves = list(reversed(roof[len(samples):]))
        if top and max(abs(upper[1] - lower[1]) for upper, lower in zip(top, eaves)) < 1:
            wall_bottom = list(reversed(walls[len(samples):]))
            wall_height = float(np.median([abs(upper[1] - lower[1]) for upper, lower in zip(eaves, wall_bottom)]))
            roof_height = min(height * .026, max(1.5, wall_height * .24))
            count = max(1, len(top) - 1)
            top = [
                (point[0], point[1] - roof_height * (1 - abs(index / count * 2 - 1)))
                for index, point in enumerate(eaves)
            ]
            roof = [*top, *reversed(eaves)]
        for horizontal in (-width, 0, width):
            shifted_walls = [(x + horizontal, y) for x, y in walls]
            shifted_roof = [(x + horizontal, y) for x, y in roof]
            draw.polygon(shifted_walls, fill=(*wall, alpha))
            draw.polygon(shifted_roof, fill=(*roof_color, alpha), outline=(*_mix(roof_color, (67, 78, 69), .32), min(195, alpha + 10)), width=max(1, width // 2048))
            draw.line(shifted_walls[:len(samples)], fill=(*_mix(wall, (70, 79, 69), .25), min(130, alpha)), width=max(1, width // 2700))
            draw.line(shifted_walls[len(samples):], fill=(*_mix(wall, (55, 67, 59), .32), min(105, alpha)), width=max(1, width // 2400))
            if distance < 500 and len(shifted_walls) >= 4:
                xs = [point[0] for point in shifted_walls]
                ys = [point[1] for point in shifted_walls]
                left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
                if right - left > width * .006 and bottom - top > height * .025:
                    for fraction in (.34, .7):
                        x = left + (right - left) * fraction
                        y = top + (bottom - top) * (.45 + rng.uniform(-.06, .06))
                        radius = max(1, width // 1300)
                        draw.rounded_rectangle((x - radius * 2, y - radius, x + radius * 2, y + radius), radius=radius, fill=(67, 77, 68, 48))
    softened = _wrap_blur(overlay, max(.65, width / 6200))
    base.paste(softened.convert("RGB"), (0, 0), softened.getchannel("A"))
    granulation = pigment_field.point(lambda value: max(0, min(22, 135 - value)))
    granulation = ImageChops.multiply(softened.getchannel("A"), granulation)
    base.paste(Image.new("RGB", base.size, (105, 79, 66)), (0, 0), granulation)
    ghost = ImageChops.offset(softened, 1, 1)
    ghost.putalpha(ghost.getchannel("A").point(lambda value: round(value * .16)))
    base.paste(ghost.convert("RGB"), (0, 0), ghost.getchannel("A"))


def _paint_edges(base: Image.Image, geometry: PanoramaGeometry) -> None:
    width, height = base.size
    overlay = Image.new("RGBA", base.size)
    draw = ImageDraw.Draw(overlay)
    skyline = [((index + .5) / len(geometry.columns) * width, _angle_y(column.skyline_angle_degrees, geometry, height)) for index, column in enumerate(geometry.columns)]
    for shift in (-width, 0, width):
        draw.line([(x + shift, y) for x, y in skyline], fill=(48, 73, 65, 62), width=max(1, width // 2400), joint="curve")
    runs: dict[int, list[tuple[float, float]]] = defaultdict(list)
    def paint_ridge(points: list[tuple[float, float]], layer: int, alpha: int | None = None) -> None:
        if len(points) < 6:
            return
        radius = min(7, max(1, len(points) // 24))
        padded = [points[0]] * radius + points + [points[-1]] * radius
        smoothed = [
            (point[0], sum(padded[index + offset][1] for offset in range(radius * 2 + 1)) / (radius * 2 + 1))
            for index, point in enumerate(points)
        ]
        draw.line(smoothed, fill=(61, 83, 77, alpha if alpha is not None else 96 if layer < 5 else 66),
                  width=max(1, width // 2500), joint="curve")
    for index, column in enumerate(geometry.columns):
        current = {edge.depth_layer if edge.depth_layer is not None else terrain_depth_layer(edge.distance_meters): edge
                   for edge in column.terrain_edges if edge.kind == "inner-ridge" and edge.semantic in _MOUNTAIN}
        for layer in list(runs):
            if layer not in current:
                points = runs.pop(layer)
                paint_ridge(points, layer)
        for layer, edge in current.items():
            point = ((index + .5) / len(geometry.columns) * width, _angle_y(edge.elevation_angle_degrees, geometry, height))
            previous = runs.get(layer)
            if previous and abs(previous[-1][1] - point[1]) > height * .08:
                paint_ridge(previous, layer, 62)
                runs[layer] = []
            runs.setdefault(layer, []).append(point)
    for layer, points in runs.items():
        paint_ridge(points, layer)
    base.paste(overlay.convert("RGB"), (0, 0), overlay.getchannel("A"))


def _paint_water_details(base: Image.Image, water_mask: Image.Image, seed: int,
                         broad_pigment: Image.Image) -> None:
    if not water_mask.getbbox():
        return
    width, height = base.size
    depth = _gradient((width, height), (211, 226, 219), (65, 132, 153))
    reflection_alpha = ImageChops.multiply(
        water_mask, _gradient((width, height), (62, 62, 62), (0, 0, 0)).convert("L")
    )
    base.paste(Image.new("RGB", base.size, (192, 214, 210)), (0, 0), reflection_alpha)
    depth_alpha = ImageChops.multiply(water_mask, _gradient((width, height), (0, 0, 0), (76, 76, 76)).convert("L"))
    base.paste(depth, (0, 0), depth_alpha)
    # One low-frequency, wrap-safe pigment field gives the water depth without
    # turning it into a repeated wave pattern.
    bloom = broad_pigment.point(lambda value: 7 + value * 20 // 255)
    bloom = ImageChops.multiply(water_mask, bloom)
    base.paste(Image.new("RGB", base.size, (50, 119, 143)), (0, 0), bloom)
    details = Image.new("L", base.size)
    draw = ImageDraw.Draw(details)
    rng = np.random.default_rng(seed)
    _left, top, _right, bottom = water_mask.getbbox()
    water_height = max(1, bottom - top)
    for index in range(58):
        y = int(top + water_height * (.12 + .82 * index / 57))
        start = int(rng.uniform(0, width))
        length = int(rng.uniform(width * .025, width * .1))
        end = start + length
        ink = int(rng.uniform(16, 34))
        draw.line((start, y, min(width, end), y), fill=ink, width=max(1, height // 520))
        if end > width:
            draw.line((0, y, end - width, y), fill=ink, width=max(1, height // 520))
    clipped = ImageChops.multiply(_wrap_blur(details, .45), water_mask)
    base.paste(Image.new("RGB", base.size, (242, 237, 215)), (0, 0), clipped)
    shoreline = water_mask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(.65))
    shoreline = shoreline.point(lambda value: round(value * .26))
    base.paste(Image.new("RGB", base.size, (50, 94, 103)), (0, 0), shoreline)


def render_panorama_webp(geometry: PanoramaGeometry, width: int = 4096, height: int = 1024,
                          season: str = "summer") -> bytes:
    """Paint a complete, wrap-safe circle as an opaque watercolor WebP."""
    if width < 360 or height < 180:
        raise ValueError("panorama output is too small")
    if season not in SEASON_PALETTES:
        raise ValueError("invalid season")
    # The paint raster is deliberately softer than the delivery raster. This
    # keeps watercolor edges organic and bounds per-request CPU/RAM, while the
    # final 4096px WebP remains crisp at the UI's roughly 90° crop.
    render_width, render_height = round(width * PAINT_SCALE), round(height * PAINT_SCALE)
    seed = _seed(geometry.identity_key, season)
    sky_top = {"spring": (188, 211, 214), "summer": (177, 207, 213), "autumn": (196, 205, 197), "winter": (199, 211, 214)}[season]
    base = _gradient((render_width, render_height), sky_top, (244, 232, 204))
    broad_pigment = _paper_noise(render_width, render_height, seed + 17, 64)
    medium_pigment = _paper_noise(render_width, render_height, seed + 29, 22)
    pigments = (
        broad_pigment.point(lambda value: 70 + value * 180 // 255),
        medium_pigment.point(lambda value: 92 + value * 155 // 255),
    )
    canopy_field = _paper_noise(render_width, render_height, seed + 43, 30)
    _paint_sky(base, geometry, broad_pigment)
    masks = _span_masks(geometry, render_width, render_height)
    palette = SEASON_PALETTES[season]
    order = (SemanticClass.SNOW_OR_GLACIER, SemanticClass.ROCK, SemanticClass.UNKNOWN_TERRAIN,
             SemanticClass.OPEN_GRASSLAND, SemanticClass.FOREST, SemanticClass.SETTLEMENT,
             SemanticClass.WATER, SemanticClass.RIVER)
    for layer in reversed(_LAYERS):
        for semantic in order:
            mask = masks.get((semantic, layer))
            if mask is None:
                continue
            target = (192, 214, 215) if semantic in {SemanticClass.WATER, SemanticClass.RIVER} else (207, 217, 208)
            color = _mix(palette[semantic], target, _LAYER_HAZE[layer])
            _paint_wash(base, mask, color, _LAYER_OPACITY[layer], pigments)
            if layer < 3 or semantic in {SemanticClass.WATER, SemanticClass.RIVER, SemanticClass.FOREST}:
                _pool_pigment(base, mask, color, .13 if layer < 3 else .06)
    water = Image.new("L", base.size)
    for layer in _LAYERS:
        if (SemanticClass.WATER, layer) in masks:
            water = ImageChops.lighter(water, masks[(SemanticClass.WATER, layer)])
        if (SemanticClass.RIVER, layer) in masks:
            water = ImageChops.lighter(water, masks[(SemanticClass.RIVER, layer)])
    _paint_landform_relief(base, masks)
    _paint_surface_blooms(base, masks, medium_pigment)
    _paint_forest_details(base, masks, canopy_field, seed + 59)
    _paint_water_details(base, water, seed + 71, broad_pigment)
    _paint_buildings(base, geometry, seed + 113, medium_pigment)
    _paint_edges(base, geometry)

    if base.size != (width, height):
        base = base.resize((width, height), Image.Resampling.LANCZOS)
    # Paper fibres are applied once at delivery resolution so the final image
    # retains a tactile wash instead of looking like enlarged flat vectors.
    fibres = _paper_noise(width, height, seed + 211, 5)
    light_fibres = fibres.point(lambda value: max(0, value - 132) // 5)
    dark_fibres = fibres.point(lambda value: max(0, 124 - value) // 7)
    base.paste(Image.new("RGB", base.size, (239, 230, 208)), (0, 0), light_fibres)
    base.paste(Image.new("RGB", base.size, (103, 112, 96)), (0, 0), dark_fibres)
    output = io.BytesIO()
    base.save(output, format="WEBP", quality=86, method=0, exact=True)
    return output.getvalue()


def render_lightmap_webp(geometry: PanoramaGeometry, sun_azimuth_degrees: float,
                         sun_altitude_degrees: float, width: int = 2048, height: int = 512) -> bytes:
    """Approximate direct landscape light from surface aspect and occlusion."""
    image = Image.new("L", (width, height), 126 if sun_altitude_degrees > 0 else 24)
    if sun_altitude_degrees > -3:
        draw = ImageDraw.Draw(image)
        x_scale = width / len(geometry.columns)
        sun_column = geometry.columns[round((sun_azimuth_degrees % 360) / geometry.config.angular_resolution_degrees) % len(geometry.columns)]
        observer_occlusion = max(0, sun_column.skyline_angle_degrees - sun_altitude_degrees)
        sun_altitude = math.radians(max(-2, sun_altitude_degrees))
        for index, column in enumerate(geometry.columns):
            left = math.floor(index * x_scale)
            right = max(left + 1, math.ceil((index + 1) * x_scale))
            relative = math.radians(((sun_azimuth_degrees - column.azimuth_degrees + 540) % 360) - 180)
            for span in column.spans:
                top = _angle_y(span.upper_angle_degrees, geometry, height)
                bottom = _angle_y(span.lower_angle_degrees, geometry, height)
                if bottom <= top:
                    continue
                if span.semantic == SemanticClass.BUILDING:
                    facing = .5 + .5 * max(0, math.cos(relative))
                else:
                    edge = min(column.terrain_edges, key=lambda item: abs(item.distance_meters - span.distance_meters), default=None)
                    slope = math.radians(edge.slope_degrees if edge and edge.slope_degrees is not None else 0)
                    facing = max(0, math.sin(sun_altitude) * math.cos(slope) + math.cos(sun_altitude) * math.sin(slope) * math.cos(relative))
                depth_softening = min(.22, math.log10(max(10, span.distance_meters)) * .035)
                occlusion = min(.7, observer_occlusion / 18) if abs(math.degrees(relative)) < 42 else 0
                value = round(58 + 180 * max(0, min(1, facing + depth_softening - occlusion)))
                draw.rectangle((left, max(0, top), right, min(height, bottom)), fill=value)
    image = _wrap_blur(image, max(2.2, width / 700))
    output = io.BytesIO()
    image.save(output, format="WEBP", lossless=True, method=6)
    return output.getvalue()
