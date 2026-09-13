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
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

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
_LAYER_HAZE = (.01, .045, .105, .19, .29, .41, .53, .63)
_LAYER_OPACITY = (.94, .92, .89, .85, .80, .74, .68, .62)
_LAYER_SHADOWS = (
    (54, 80, 61), (65, 88, 69), (72, 91, 78), (73, 91, 94),
    (82, 100, 115), (101, 118, 132), (122, 137, 148), (139, 151, 158),
)
_MOUNTAIN = {
    SemanticClass.SNOW_OR_GLACIER, SemanticClass.ROCK, SemanticClass.UNKNOWN_TERRAIN,
    SemanticClass.OPEN_GRASSLAND, SemanticClass.FOREST,
}
# Paint below delivery resolution so adjacent pigment marks merge like wet
# watercolor, but retain enough resolution for roofs and real inner ridges.
PAINT_SCALE = .58


def _close_seam(image: Image.Image, width: int = 12) -> Image.Image:
    """Make the circular texture C0-continuous without a visible feather band."""
    pixels = np.asarray(image).astype(np.float32)
    # Geographic columns already meet at adjacent 359.9/0.0 degrees. Ease only
    # a few samples towards their shared boundary value: this gives the lossy
    # WebP encoder similar context on either side, while avoiding the broad
    # feather strip that used to look like a vertical shadow in the scene.
    feather = max(1, min(width, image.width // 24))
    edge = (pixels[:, 0] + pixels[:, -1]) / 2
    for offset in range(feather):
        amount = (1 - offset / feather) ** 2
        pixels[:, offset] = pixels[:, offset] * (1 - amount) + edge * amount
        pixels[:, -1 - offset] = pixels[:, -1 - offset] * (1 - amount) + edge * amount
    pixels[:, 0] = edge
    pixels[:, -1] = edge
    return Image.fromarray(np.rint(pixels).clip(0, 255).astype(np.uint8), image.mode)


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


def _periodic_pigment(width: int, height: int, seed: int, scales: tuple[int, ...]) -> Image.Image:
    """Low-frequency, circular pigment blooms without a visible repeat tile."""
    rng = np.random.default_rng(seed)
    field = np.zeros((height, width), dtype=np.float32)
    for index, scale in enumerate(scales):
        cell_width = max(5, math.ceil(width / scale))
        cell_height = max(4, math.ceil(height / scale))
        coarse = rng.normal(128, 38, (cell_height, cell_width)).clip(28, 228).astype(np.uint8)
        coarse[:, -1] = coarse[:, 0]
        layer = Image.fromarray(coarse, "L").resize((width, height), Image.Resampling.BICUBIC)
        layer = _wrap_blur(layer, max(.5, scale / 34))
        field += np.asarray(layer, dtype=np.float32) * (1 / (index + 1) ** .62)
    field -= field.min()
    maximum = float(field.max())
    if maximum:
        field *= 255 / maximum
    pixels = field.astype(np.uint8)
    pixels[:, -1] = pixels[:, 0]
    return Image.fromarray(pixels, "L")


def _scaled_alpha(mask: Image.Image, amount: float) -> Image.Image:
    return mask.point(lambda value: max(0, min(255, round(value * amount))))


def _horizontal_edges(mask: Image.Image) -> Image.Image:
    """Return surface rims without exposing radial depth-bin side walls."""
    pixels = np.asarray(mask, dtype=np.int16)
    edges = np.zeros_like(pixels, dtype=np.uint8)
    difference = np.abs(np.diff(pixels, axis=0)).clip(0, 255).astype(np.uint8)
    edges[1:] = difference
    return Image.fromarray(edges, "L")


@lru_cache(maxsize=8)
def _artist_pigment(width: int, height: int) -> Image.Image:
    """Resize the checked-in real-watercolor material into a circular field."""
    source = Image.open(Path(__file__).with_name("assets") / "watercolor-pigment.png").convert("L")
    texture = ImageOps.autocontrast(source).resize((width, height), Image.Resampling.LANCZOS)
    return _close_seam(texture, max(12, width // 180))


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
    organic = _periodic_pigment(width, height, _seed(geometry.identity_key, "paint-edges"), (113, 47, 23))
    softened = {}
    for key, mask in masks.items():
        # Only loosen the rim; the interior and the recognisable landform stay
        # fixed. A real brush never stops at precisely the same contour on all
        # three watercolor passes.
        expanded = mask.filter(ImageFilter.MaxFilter(5))
        outer_rim = ImageChops.subtract(expanded, mask)
        broken_rim = ImageChops.multiply(outer_rim, organic.point(lambda value: max(0, value - 92)))
        # Preserve the factual solid body and let only a translucent fringe
        # escape it. Contracting the body created map-like white contour gaps.
        loosened = ImageChops.lighter(mask, _scaled_alpha(broken_rim, .38))
        softened[key] = _wrap_blur(loosened, 2.15)
    masks = softened
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
    # Three imperfect registrations mimic separate hand-laid washes. The pale
    # final pass leaves breathing paper rather than producing a digital fill.
    for pass_index, shift in enumerate(((-3, 2), (2, -1), (0, 0))):
        if pass_index == 0:
            tint = _mix(color, (45, 61, 56), .18)
        elif pass_index == 1:
            tint = _mix(color, (250, 239, 213), .12)
        else:
            tint = color
        layer = Image.new("RGB", base.size, tint)
        pigment = pigments[min(pass_index, len(pigments) - 1)]
        alpha = ImageChops.multiply(mask, pigment)
        alpha = ImageChops.offset(alpha, shift[0], shift[1])
        factor = opacity * ((.42, .46, .31)[pass_index])
        alpha = alpha.point(lambda value, factor=factor: round(value * factor))
        base.paste(layer, (0, 0), alpha)


def _sky_mask(geometry: PanoramaGeometry, width: int, height: int) -> Image.Image:
    mask = Image.new("L", (width, height))
    skyline = [((index + .5) / len(geometry.columns) * width,
                _angle_y(column.skyline_angle_degrees, geometry, height)) for index, column in enumerate(geometry.columns)]
    ImageDraw.Draw(mask).polygon([(0, 0), (width, 0), *reversed(skyline)], fill=255)
    return _wrap_blur(mask, 1.2)


def _paint_sky(base: Image.Image, geometry: PanoramaGeometry, broad_pigment: Image.Image,
               artist_pigment: Image.Image) -> None:
    width, height = base.size
    mask = _sky_mask(geometry, width, height)
    cool = broad_pigment.point(lambda value: 5 + value * 25 // 255)
    warm = _gradient((width, height), (0, 0, 0), (255, 255, 255)).convert("L")
    cool = ImageChops.multiply(cool, mask)
    warm = ImageChops.multiply(warm.point(lambda value: value * 18 // 255), mask)
    base.paste(Image.new("RGB", base.size, (128, 177, 188)), (0, 0), cool)
    base.paste(Image.new("RGB", base.size, (238, 198, 139)), (0, 0), warm)

    # Long, translucent brush-loads are constrained to the factual sky. They
    # add the slight direction and overlaps seen in a hand-painted wash without
    # inventing clouds (live cloud fields are composed by the browser).
    strokes = Image.new("L", base.size)
    draw = ImageDraw.Draw(strokes)
    rng = np.random.default_rng(_seed(geometry.identity_key, "sky-brush"))
    for _ in range(32):
        y = int(rng.uniform(height * .04, height * .68))
        x = int(rng.uniform(-width * .15, width))
        length = int(rng.uniform(width * .035, width * .20))
        thickness = max(1, int(rng.uniform(height * .006, height * .025)))
        draw.line((x, y, x + length, y + rng.uniform(-2, 2)), fill=int(rng.uniform(7, 17)), width=thickness)
    strokes = ImageChops.multiply(mask, _wrap_blur(strokes, 2.8))
    base.paste(Image.new("RGB", base.size, (103, 154, 177)), (0, 0), strokes)

    deposits = ImageOps.invert(artist_pigment).point(lambda value: max(0, (value - 35) // 4))
    upper = _gradient((width, height), (255, 255, 255), (0, 0, 0)).convert("L")
    deposits = ImageChops.multiply(mask, ImageChops.multiply(deposits, upper))
    base.paste(Image.new("RGB", base.size, (73, 130, 169)), (0, 0), deposits)
    violet = ImageChops.offset(deposits, width // 37, height // 29)
    base.paste(Image.new("RGB", base.size, (130, 121, 157)), (0, 0), _scaled_alpha(violet, .26))

    # A sky in a landscape watercolor is a composition, not untouched paper.
    # These broad wet-on-wet passages remain abstract (live weather supplies
    # actual cloud information) but give the upper air temperature, movement
    # and the deliberately uneven brush loading visible in hand-painted skies.
    passages = Image.new("L", base.size)
    passage_draw = ImageDraw.Draw(passages)
    for _ in range(19):
        center_x = int(rng.uniform(-width * .12, width * 1.12))
        center_y = int(rng.uniform(height * .03, height * .47))
        radius_x = int(rng.uniform(width * .035, width * .15))
        radius_y = int(rng.uniform(height * .012, height * .065))
        passage_draw.ellipse((center_x - radius_x, center_y - radius_y,
                              center_x + radius_x, center_y + radius_y),
                             fill=int(rng.uniform(9, 25)))
    passages = ImageChops.multiply(mask, _wrap_blur(passages, height * .018))
    base.paste(Image.new("RGB", base.size, (78, 143, 178)), (0, 0), passages)
    warm_passages = ImageChops.offset(passages, width // 29, height // 18)
    warm_passages = ImageChops.multiply(mask, _scaled_alpha(warm_passages, .42))
    base.paste(Image.new("RGB", base.size, (242, 207, 151)), (0, 0), warm_passages)


def _pool_pigment(base: Image.Image, mask: Image.Image, color: tuple[int, int, int], strength: float) -> None:
    """Collect a restrained pigment edge at factual surface boundaries."""
    width, height = base.size
    edge = _horizontal_edges(mask).filter(ImageFilter.GaussianBlur(.7))
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
                edges = ImageChops.lighter(edges, _horizontal_edges(mask))
    if not combined.getbbox():
        return
    shadow = ImageChops.multiply(combined, ImageChops.offset(edges, max(1, width // 1800), 3))
    shadow = _wrap_blur(shadow, 1.45).point(lambda value: round(value * .18))
    highlight = ImageChops.multiply(combined, ImageChops.offset(edges, -max(1, width // 2300), -2))
    highlight = _wrap_blur(highlight, 1.4).point(lambda value: round(value * .025))
    base.paste(Image.new("RGB", base.size, (68, 84, 72)), (0, 0), shadow)
    base.paste(Image.new("RGB", base.size, (235, 230, 207)), (0, 0), highlight)

    # Depth breaks are painted as successively cooler transparent rims. This
    # makes overlapping hills and valleys legible before any live sunlight is
    # applied, like an artist reserving aerial perspective in the first wash.
    for layer in reversed(_LAYERS):
        layer_mask = Image.new("L", base.size)
        for semantic in _MOUNTAIN:
            mask = masks.get((semantic, layer))
            if mask is not None:
                layer_mask = ImageChops.lighter(layer_mask, mask)
        if not layer_mask.getbbox():
            continue
        inner = layer_mask.filter(ImageFilter.MinFilter(9))
        rim = ImageChops.subtract(layer_mask, inner).filter(ImageFilter.GaussianBlur(1.2))
        strength = .17 if layer < 3 else .10
        base.paste(Image.new("RGB", base.size, _LAYER_SHADOWS[layer]), (0, 0), _scaled_alpha(rim, strength))


def _paint_mountain_facets(base: Image.Image, geometry: PanoramaGeometry, masks,
                           pigment_field: Image.Image) -> None:
    """Lay broken, factual relief planes below real ridges and steep slopes."""
    width, height = base.size
    mountain = Image.new("L", base.size)
    for layer in _LAYERS:
        for semantic in _MOUNTAIN:
            mask = masks.get((semantic, layer))
            if mask is not None:
                mountain = ImageChops.lighter(mountain, mask)
    if not mountain.getbbox():
        return

    shade = Image.new("L", base.size)
    light = Image.new("L", base.size)
    shade_draw, light_draw = ImageDraw.Draw(shade), ImageDraw.Draw(light)
    column_count = len(geometry.columns)
    rng = np.random.default_rng(_seed(geometry.identity_key, "relief-planes"))
    # Broad planes under the true skyline establish readable mountain volume
    # even where a source lacks dense per-slope classifications.
    cursor = 0
    while cursor < column_count:
        length = min(column_count - cursor, int(rng.integers(28, 105)))
        group = geometry.columns[cursor:cursor + length]
        if len(group) < 4:
            break
        top = [((cursor + index + .5) / column_count * width,
                _angle_y(column.skyline_angle_degrees, geometry, height))
               for index, column in enumerate(group)]
        amplitude = rng.uniform(height * .035, height * .14)
        lower = [(x + rng.uniform(-2, 2), y + amplitude * rng.uniform(.72, 1.18)) for x, y in reversed(top)]
        fall = top[-1][1] - top[0][1]
        target = shade_draw if fall > 0 else light_draw
        target.polygon([*top, *lower], fill=int(rng.uniform(17, 39)))
        cursor += max(8, length - int(rng.integers(4, 14)))
    # Build short planes from contiguous real ridges. Each polygon follows its
    # measured upper edge; only the loose lower brush boundary is expressive.
    for layer in _LAYERS:
        run: list[tuple[float, float, float, float]] = []
        def flush(points: list[tuple[float, float, float, float]]) -> None:
            if len(points) < 8:
                return
            cursor = 0
            while cursor < len(points) - 4:
                length = min(len(points) - cursor, int(rng.integers(13, 48)))
                group = points[cursor:cursor + length]
                if len(group) < 4:
                    break
                relief = np.median([point[3] for point in group])
                drop = min(height * .17, max(height * .018, 4 + relief / 1050 * height))
                top = [(point[0], point[1]) for point in group]
                direction = group[-1][1] - group[0][1]
                lower = [(point[0] + rng.uniform(-2, 2), point[1] + drop * rng.uniform(.68, 1.12)) for point in reversed(group)]
                slope = np.median([point[2] for point in group])
                target = shade_draw if (direction > 0) ^ (slope < 0) else light_draw
                target.polygon([*top, *lower], fill=int(rng.uniform(34, 73)))
                cursor += max(5, length - int(rng.integers(2, 7)))
        for index, column in enumerate(geometry.columns):
            candidates = [edge for edge in column.terrain_edges
                          if edge.semantic in _MOUNTAIN
                          and (edge.depth_layer if edge.depth_layer is not None else terrain_depth_layer(edge.distance_meters)) == layer]
            if not candidates:
                flush(run)
                run = []
                continue
            edge = max(candidates, key=lambda item: (item.relief_meters or 0, item.elevation_angle_degrees))
            run.append(((index + .5) / column_count * width,
                        _angle_y(edge.elevation_angle_degrees, geometry, height),
                        edge.slope_degrees or 0, edge.relief_meters or 18))
        flush(run)
    shade = ImageChops.multiply(mountain, _wrap_blur(shade, .75))
    light = ImageChops.multiply(mountain, _wrap_blur(light, 1.0))
    shade = ImageChops.multiply(shade, pigment_field.point(lambda value: 105 + value * 150 // 255))
    base.paste(Image.new("RGB", base.size, (43, 63, 86)), (0, 0), _scaled_alpha(shade, 1.72))
    base.paste(Image.new("RGB", base.size, (221, 199, 145)), (0, 0), _scaled_alpha(light, .96))


def _paint_ambient_volume(base: Image.Image, geometry: PanoramaGeometry, masks) -> None:
    """Round hills from their true profile with broad, non-solar studio washes."""
    width, height = base.size
    terrain = Image.new("L", base.size)
    for (semantic, _layer), mask in masks.items():
        if semantic not in {SemanticClass.WATER, SemanticClass.RIVER}:
            terrain = ImageChops.lighter(terrain, mask)
    if not terrain.getbbox():
        return
    skyline = np.array([
        _angle_y(geometry.columns[min(len(geometry.columns) - 1, int((x + .5) * len(geometry.columns) / width))].skyline_angle_degrees,
                 geometry, height)
        for x in range(width)
    ], dtype=np.float32)
    # Circular smoothing preserves the 0/360 join. Profile derivatives then
    # act like an artist's cool shadow / warm reflected-light judgement.
    radius = max(8, width // 150)
    extended = np.concatenate((skyline[-radius:], skyline, skyline[:radius]))
    kernel_x = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-(kernel_x / max(1, radius / 2.4)) ** 2 / 2)
    kernel /= kernel.sum()
    smooth = np.convolve(extended, kernel, mode="same")[radius:-radius]
    slope = np.gradient(smooth)
    curvature = np.gradient(slope)
    value = np.clip(slope * 58 + curvature * 105, -1, 1)
    shadow_line = np.clip(value, 0, 1) * 78
    light_line = np.clip(-value, 0, 1) * 62
    vertical = np.arange(height, dtype=np.float32)[:, None]
    below_profile = np.maximum(0, vertical - skyline[None, :])
    # A fold begins at the crest and dissolves down the slope. Broadcasting
    # one value through the whole column produced the tell-tale vertical bars
    # of a depth map rather than the turning plane of a painted hill.
    falloff = .18 + .82 * np.exp(-below_profile / max(1, height * .21))
    shadow = Image.fromarray(np.rint(shadow_line[None, :] * falloff).clip(0, 255).astype(np.uint8), "L")
    light = Image.fromarray(np.rint(light_line[None, :] * falloff).clip(0, 255).astype(np.uint8), "L")
    shadow = ImageChops.multiply(terrain, _wrap_blur(shadow, width / 210))
    light = ImageChops.multiply(terrain, _wrap_blur(light, width / 240))
    base.paste(Image.new("RGB", base.size, (42, 63, 87)), (0, 0), shadow)
    base.paste(Image.new("RGB", base.size, (240, 207, 142)), (0, 0), light)


def _paint_perspective_sweeps(base: Image.Image, masks, seed: int) -> None:
    """Loose directional brushwork grows broader towards the observer."""
    width, height = base.size
    terrain = Image.new("L", base.size)
    for (semantic, _layer), mask in masks.items():
        if semantic not in {SemanticClass.WATER, SemanticClass.RIVER}:
            terrain = ImageChops.lighter(terrain, mask)
    if not terrain.getbbox():
        return
    rng = np.random.default_rng(seed)
    dark = Image.new("L", base.size)
    light = Image.new("L", base.size)
    dark_draw, light_draw = ImageDraw.Draw(dark), ImageDraw.Draw(light)
    for _ in range(180):
        y = int(rng.uniform(height * .40, height * .98))
        perspective = max(.05, (y / height - .35) / .65)
        x = int(rng.uniform(-width * .04, width))
        length = int(width * rng.uniform(.004, .026) * (.35 + perspective))
        bend = rng.uniform(-3, 3) * perspective
        target = dark_draw if rng.random() < .58 else light_draw
        target.line((x, y, x + length * .52, y + bend, x + length, y + bend * .35),
                    fill=int(rng.uniform(5, 18)), width=max(1, round(1 + perspective * 2)))
    dark = ImageChops.multiply(terrain, _wrap_blur(dark, .32))
    light = ImageChops.multiply(terrain, _wrap_blur(light, .42))
    base.paste(Image.new("RGB", base.size, (65, 78, 58)), (0, 0), dark)
    base.paste(Image.new("RGB", base.size, (232, 211, 151)), (0, 0), light)


def _paint_land_brushwork(base: Image.Image, masks, seed: int) -> None:
    """Dry-brush marks clipped to mapped meadows, rock and settlement."""
    width, height = base.size
    rng = np.random.default_rng(seed)
    recipes = (
        (SemanticClass.OPEN_GRASSLAND, (72, 115, 58), 860, 2.3),
        (SemanticClass.UNKNOWN_TERRAIN, (79, 101, 68), 620, 3.0),
        (SemanticClass.ROCK, (78, 82, 91), 480, 1.7),
        (SemanticClass.SETTLEMENT, (132, 91, 69), 260, 3.5),
    )
    for semantic, color, count, slant in recipes:
        surface = Image.new("L", base.size)
        for layer in range(min(5, len(_LAYERS))):
            mask = masks.get((semantic, layer))
            if mask is not None:
                surface = ImageChops.lighter(surface, mask)
        bounds = surface.getbbox()
        if not bounds:
            continue
        strokes = Image.new("L", base.size)
        draw = ImageDraw.Draw(strokes)
        left, top, right, bottom = bounds
        for _ in range(count):
            x = int(rng.uniform(left, right))
            y = int(rng.uniform(top, bottom))
            length = rng.uniform(width * .002, width * .011)
            # Nearly horizontal field marks and steeper rock hatching remain
            # subordinate to the actual landform mask.
            dy = rng.uniform(-slant, slant) if semantic != SemanticClass.ROCK else rng.uniform(2, 9)
            draw.line((x, y, x + length, y + dy), fill=int(rng.uniform(29, 76)),
                      width=max(1, width // 2300))
        strokes = ImageChops.multiply(surface, _wrap_blur(strokes, .28))
        base.paste(Image.new("RGB", base.size, color), (0, 0), strokes)


def _paint_forest_details(base: Image.Image, masks, canopy_field: Image.Image,
                          artist_field: Image.Image, seed: int) -> None:
    """Add clustered canopy mass only where geographic forest is visible."""
    forest = Image.new("L", base.size)
    for layer in _LAYERS:
        mask = masks.get((SemanticClass.FOREST, layer))
        if mask is not None:
            forest = ImageChops.lighter(forest, mask)
    if not forest.getbbox():
        return
    width, height = base.size
    rng = np.random.default_rng(seed)

    # Pale, overlapping apertures separate foreground foliage from the cool
    # woodland behind it. They are expressive light within a mapped forest
    # mass, not assertions that a surveyed clearing exists at an exact point.
    apertures = Image.new("L", base.size)
    aperture_draw = ImageDraw.Draw(apertures)
    bounds = forest.getbbox()
    if bounds:
        left, top, right, bottom = bounds
        for _ in range(max(10, width // 180)):
            center_x = int(rng.uniform(left, right))
            center_y = int(rng.uniform(top, bottom))
            radius_x = int(rng.uniform(width * .018, width * .060))
            radius_y = int(rng.uniform(height * .022, height * .085))
            aperture_draw.ellipse((center_x - radius_x, center_y - radius_y,
                                   center_x + radius_x, center_y + radius_y),
                                  fill=int(rng.uniform(12, 31)))
        apertures = ImageChops.multiply(forest, _wrap_blur(apertures, height * .018))
        base.paste(Image.new("RGB", base.size, (191, 188, 134)), (0, 0), apertures)
    # Broad connected blooms read as canopy masses without turning mapped
    # forest into a field of decorative dots or claiming individual trees.
    artist_deposits = ImageOps.invert(artist_field).point(lambda value: max(0, min(105, value - 20)))
    clusters = canopy_field.point(lambda value: max(8, min(48, 32 + 128 - value)))
    clusters = ImageChops.multiply(forest, _wrap_blur(ImageChops.lighter(clusters, artist_deposits), 1.3))
    base.paste(Image.new("RGB", base.size, (29, 82, 50)), (0, 0), clusters)
    canopy_light = canopy_field.point(lambda value: max(0, min(34, value - 119)))
    canopy_light = ImageChops.multiply(forest, _wrap_blur(ImageChops.offset(canopy_light, -3, -2), 1.5))
    base.paste(Image.new("RGB", base.size, (174, 176, 112)), (0, 0), canopy_light)

    # Irregular overlapping crown groups follow the upper edge of each real
    # forest depth mask. They make woodland legible without pretending that
    # an individual procedural crown corresponds to a surveyed tree.
    crown_groups = Image.new("L", base.size)
    crowns = ImageDraw.Draw(crown_groups)
    for layer in _LAYERS:
        mask = masks.get((SemanticClass.FOREST, layer))
        if mask is None or not mask.getbbox():
            continue
        pixels = np.asarray(mask)
        left, _top, right, _bottom = mask.getbbox()
        step = 20 + layer * 9
        x = left + int(rng.integers(0, step))
        while x < right:
            vertical = np.flatnonzero(pixels[:, min(width - 1, x)] > 110)
            if vertical.size and rng.random() < .48:
                top = int(vertical[0])
                count = int(rng.integers(2, 5))
                group_span = int(rng.integers(8, 15))
                ink = int(rng.integers(42, 65))
                for tree in range(count):
                    center_x = x + round((tree / max(1, count - 1) - .5) * group_span)
                    tree_width = max(1, int(rng.integers(3, 7) / (1 + layer * .13)))
                    tree_height = max(3, int(rng.integers(8, 17) / (1 + layer * .12)))
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
    crown_groups = ImageChops.multiply(forest, _wrap_blur(crown_groups, .65))
    base.paste(Image.new("RGB", base.size, (22, 78, 46)), (0, 0), _scaled_alpha(crown_groups, 1.08))
    crown_group_light = ImageChops.multiply(forest, ImageChops.offset(crown_groups, -1, -2))
    crown_group_light = crown_group_light.point(lambda value: round(value * .18))
    base.paste(Image.new("RGB", base.size, (173, 179, 112)), (0, 0), crown_group_light)

    forest_edge = _horizontal_edges(forest)
    crown_light = ImageChops.multiply(forest, ImageChops.offset(forest_edge, -1, -2))
    crown_light = _wrap_blur(crown_light, 1.1).point(lambda value: round(value * .1))
    base.paste(Image.new("RGB", base.size, (189, 185, 126)), (0, 0), crown_light)

    # Broken side-of-brush touches inside the connected woodland mass give it
    # the lively, layered foliage of watercolor without placing surveyed
    # individual trees. Marks become smaller and quieter with depth.
    foliage = Image.new("L", base.size)
    foliage_draw = ImageDraw.Draw(foliage)
    bounds = forest.getbbox()
    if bounds:
        left, top, right, bottom = bounds
        for _ in range(min(2200, max(280, width * 5 // 4))):
            x = int(rng.uniform(left, right))
            y = int(rng.uniform(top, bottom))
            radius_x = int(rng.uniform(1.2, max(2.2, width / 720)))
            radius_y = int(rng.uniform(1.0, max(2.0, height / 145)))
            foliage_draw.ellipse((x - radius_x, y - radius_y, x + radius_x, y + radius_y),
                                 fill=int(rng.uniform(13, 43)))
        foliage = ImageChops.multiply(forest, _wrap_blur(foliage, .35))
        base.paste(Image.new("RGB", base.size, (24, 74, 49)), (0, 0), foliage)
        flecks = ImageChops.multiply(forest, ImageChops.offset(foliage, -2, -2))
        base.paste(Image.new("RGB", base.size, (194, 188, 102)), (0, 0), _scaled_alpha(flecks, .45))

    near_forest = Image.new("L", base.size)
    for layer in (0, 1):
        mask = masks.get((SemanticClass.FOREST, layer))
        if mask is not None:
            near_forest = ImageChops.lighter(near_forest, mask)
    bounds = near_forest.getbbox()
    if bounds:
        trunks = Image.new("L", base.size)
        branches = Image.new("L", base.size)
        trunk_draw, branch_draw = ImageDraw.Draw(trunks), ImageDraw.Draw(branches)
        pixels = np.asarray(near_forest)
        left, _top, right, _bottom = bounds
        crown_accents = Image.new("L", base.size)
        crown_draw = ImageDraw.Draw(crown_accents)
        for tree_index in range(max(10, width // 165)):
            x = int(rng.uniform(left, right))
            visible = np.flatnonzero(pixels[:, min(width - 1, x)] > 95)
            if visible.size < 8:
                continue
            top, bottom = int(visible[0]), int(visible[-1])
            length = (bottom - top) * rng.uniform(.30, .72)
            foot = bottom - (bottom - top) * rng.uniform(.02, .18)
            crown = max(top, foot - length)
            lean = rng.uniform(-11, 11)
            ink = int(rng.uniform(128, 205))
            center_points = []
            for segment in range(8):
                fraction = segment / 7
                center_points.append((x + lean * fraction + rng.uniform(-1.8, 1.8),
                                      foot - length * fraction))
            foot_width = rng.uniform(3.5, 8.5)
            left_edge = []
            right_edge = []
            for segment, (point_x, point_y) in enumerate(center_points):
                fraction = segment / max(1, len(center_points) - 1)
                half_width = foot_width * (1 - fraction * .76)
                left_edge.append((point_x - half_width + rng.uniform(-.8, .8), point_y))
                right_edge.append((point_x + half_width + rng.uniform(-.8, .8), point_y))
            trunk_draw.polygon([*left_edge, *reversed(right_edge)], fill=ink)
            for fraction in (.32, .47, .61, .74, .84):
                branch_x = x + lean * fraction
                branch_y = foot - length * fraction
                reach = rng.uniform(11, 30) * (-1 if rng.random() < .5 else 1)
                branch_draw.line((branch_x, branch_y, branch_x + reach * .65, branch_y - rng.uniform(2, 6),
                                  branch_x + reach, branch_y - rng.uniform(5, 13)),
                                 fill=min(235, int(ink * 1.04)), width=max(1, width // 1150), joint="curve")
                if fraction > .6:
                    fork = reach * rng.uniform(.48, .78)
                    branch_draw.line((branch_x + reach * .58, branch_y - 5,
                                      branch_x + fork, branch_y - rng.uniform(12, 24)),
                                     fill=min(220, ink), width=max(1, width // 1700))
                    for _ in range(int(rng.integers(2, 5))):
                        foliage_x = branch_x + reach * rng.uniform(.48, 1.08)
                        foliage_y = branch_y - rng.uniform(5, 20)
                        foliage_rx = rng.uniform(8, 22)
                        foliage_ry = rng.uniform(4, 14)
                        crown_draw.ellipse((foliage_x - foliage_rx, foliage_y - foliage_ry,
                                            foliage_x + foliage_rx, foliage_y + foliage_ry),
                                           fill=int(rng.uniform(32, 76)))
            # Several broken touches form one irregular crown; a single oval
            # reads as a computer icon rather than foliage laid by a brush.
            crown_radius = max(18, int(rng.uniform(28, 55)))
            for dab in range(int(rng.integers(11, 19))):
                dab_x = center_points[-1][0] + rng.normal(0, crown_radius * .58)
                dab_y = crown + rng.normal(0, crown_radius * .35)
                dab_rx = crown_radius * rng.uniform(.32, .78)
                dab_ry = crown_radius * rng.uniform(.20, .56)
                crown_draw.ellipse((dab_x - dab_rx, dab_y - dab_ry,
                                    dab_x + dab_rx, dab_y + dab_ry),
                                   fill=int(rng.uniform(57, 112)))
        trunks = ImageChops.multiply(near_forest, _wrap_blur(trunks, .38))
        branches = ImageChops.multiply(near_forest, _wrap_blur(branches, .25))
        crown_accents = ImageChops.multiply(near_forest, _wrap_blur(crown_accents, 1.2))
        base.paste(Image.new("RGB", base.size, (70, 63, 45)), (0, 0), trunks)
        base.paste(Image.new("RGB", base.size, (54, 67, 42)), (0, 0), branches)
        base.paste(Image.new("RGB", base.size, (25, 86, 48)), (0, 0), crown_accents)
        crown_shadow = ImageChops.multiply(near_forest, ImageChops.offset(crown_accents, 3, 3))
        crown_highlight = ImageChops.multiply(near_forest, ImageChops.offset(crown_accents, -4, -3))
        base.paste(Image.new("RGB", base.size, (30, 66, 46)), (0, 0), _scaled_alpha(crown_shadow, .36))
        base.paste(Image.new("RGB", base.size, (175, 169, 86)), (0, 0), _scaled_alpha(crown_highlight, .22))
        trunk_glints = ImageChops.multiply(near_forest, ImageChops.offset(trunks, -1, 0))
        base.paste(Image.new("RGB", base.size, (177, 145, 91)), (0, 0), _scaled_alpha(trunk_glints, .27))

        # A broken, earthy lower wash anchors nearby woodland and stops a
        # full-frame forest from reading as a single upright green curtain.
        forest_floor = Image.new("L", base.size)
        floor_draw = ImageDraw.Draw(forest_floor)
        for _ in range(max(30, width // 45)):
            x = int(rng.uniform(left, right))
            visible = np.flatnonzero(pixels[:, min(width - 1, x)] > 95)
            if not visible.size:
                continue
            bottom = int(visible[-1])
            length = int(rng.uniform(width * .006, width * .028))
            floor_draw.line((x, bottom - rng.uniform(2, height * .045), x + length, bottom - rng.uniform(0, height * .02)),
                            fill=int(rng.uniform(14, 36)), width=max(1, height // 240))
        forest_floor = ImageChops.multiply(near_forest, _wrap_blur(forest_floor, .55))
        base.paste(Image.new("RGB", base.size, (116, 75, 48)), (0, 0), forest_floor)


def _paint_surface_blooms(base: Image.Image, masks, pigment_field: Image.Image,
                          artist_field: Image.Image) -> None:
    """Give broad land surfaces transparent, connected watercolor blooms."""
    tones = {
        SemanticClass.OPEN_GRASSLAND: ((85, 105, 70), (222, 211, 158)),
        SemanticClass.ROCK: ((91, 86, 80), (224, 215, 198)),
        SemanticClass.UNKNOWN_TERRAIN: ((76, 96, 78), (216, 211, 170)),
    }
    artist_dark = ImageOps.invert(artist_field).point(lambda value: max(0, min(64, value - 18)))
    artist_light = artist_field.point(lambda value: max(0, min(48, value - 164)))
    shadow_field = ImageChops.lighter(pigment_field.point(lambda value: max(0, min(31, 143 - value))), artist_dark)
    light_field = ImageChops.lighter(pigment_field.point(lambda value: max(0, min(25, value - 128))), artist_light)
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
        wall_bases = ((181, 126, 92), (199, 157, 107), (187, 145, 122), (211, 183, 137), (164, 139, 116))
        wall_base = _mix(wall_bases[index % len(wall_bases)], (203, 171, 130), float(rng.uniform(0, .22)))
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
            # A second imperfect glaze sits slightly inside the same factual
            # building body and suggests sun-faded plaster and facade depth.
            if len(shifted_walls) >= 6:
                middle = len(samples) // 2
                facade_plane = [*shifted_walls[middle:len(samples)], *shifted_walls[len(samples):len(samples) + len(samples) - middle]]
                if len(facade_plane) >= 3:
                    draw.polygon(facade_plane, fill=(*_mix(wall, (94, 83, 75), .32), max(18, alpha // 5)))
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
    rng = np.random.default_rng(_seed(geometry.identity_key, "broken-drawing"))
    # Broken graphite/pigment accents replace a mechanically continuous GIS
    # outline. The underlying wash still carries the exact full silhouette.
    section = max(8, len(skyline) // 95)
    for start in range(0, len(skyline), section):
        if rng.random() < .22:
            continue
        points = skyline[start:min(len(skyline), start + section + 2)]
        jitter = rng.uniform(-.8, .8)
        for shift in (-width, 0, width):
            draw.line([(x + shift, y + jitter) for x, y in points], fill=(43, 67, 69, int(rng.uniform(43, 76))),
                      width=max(1, width // 2600), joint="curve")
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
        fragment = max(6, len(smoothed) // 5)
        for start in range(0, len(smoothed), fragment):
            if rng.random() < .18:
                continue
            section_points = smoothed[start:min(len(smoothed), start + fragment + 1)]
            draw.line(section_points, fill=(54, 73, 82, alpha if alpha is not None else 54 if layer < 5 else 38),
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
    water_pixels = np.asarray(water_mask)
    local_depth = np.zeros((height, width), dtype=np.uint8)
    for x in range(width):
        visible = np.flatnonzero(water_pixels[:, x] > 60)
        if visible.size:
            top_x, bottom_x = int(visible[0]), int(visible[-1])
            local_depth[top_x:bottom_x + 1, x] = np.linspace(0, 255, bottom_x - top_x + 1).astype(np.uint8)
    depth_field = _wrap_blur(Image.fromarray(local_depth, "L"), 2.2)
    depth_amount = np.asarray(depth_field, dtype=np.float32)[..., None] / 255
    shallow = np.array((185, 217, 213), dtype=np.float32)
    deep = np.array((28, 94, 148), dtype=np.float32)
    depth_rgb = np.broadcast_to(shallow, (height, width, 3)) + (deep - shallow) * depth_amount
    depth = Image.fromarray(depth_rgb.clip(0, 255).astype(np.uint8), "RGB")
    reflection_alpha = ImageChops.multiply(water_mask, ImageOps.invert(depth_field).point(lambda value: value * 70 // 255))
    base.paste(Image.new("RGB", base.size, (192, 214, 210)), (0, 0), reflection_alpha)
    depth_alpha = ImageChops.multiply(water_mask, depth_field.point(lambda value: 25 + value * 155 // 255))
    base.paste(depth, (0, 0), depth_alpha)
    # Reflect the already-painted factual shore and landforms. The reflection
    # is deliberately loose, short and soft, but gives the lake spatial context
    # that a standalone blue gradient cannot provide.
    scene = np.asarray(base).copy()
    reflected = np.zeros_like(scene)
    reflected_alpha = np.zeros((height, width), dtype=np.uint8)
    for x in range(width):
        visible = np.flatnonzero(water_pixels[:, x] > 60)
        if not visible.size:
            continue
        shore, bottom_x = int(visible[0]), int(visible[-1])
        reach = min(bottom_x - shore + 1, max(4, round(height * .16)))
        for offset in range(reach):
            source_y = max(0, shore - 1 - offset // 3)
            target_y = shore + offset
            reflected[target_y, x] = scene[source_y, x]
            reflected_alpha[target_y, x] = round(46 * (1 - offset / max(1, reach)))
    reflection_image = Image.fromarray(reflected, "RGB").filter(ImageFilter.GaussianBlur(max(1, width / 1300)))
    reflection_mask = ImageChops.multiply(
        water_mask, _wrap_blur(Image.fromarray(reflected_alpha, "L"), 2.4),
    )
    base.paste(reflection_image, (0, 0), reflection_mask)
    # One low-frequency, wrap-safe pigment field gives the water depth without
    # turning it into a repeated wave pattern.
    # Stretch irregular blooms horizontally so pigment reads as water planes,
    # not the same texture used on a hill.
    compressed = broad_pigment.resize((max(4, width // 5), height), Image.Resampling.BICUBIC)
    water_pigment = compressed.resize((width, height), Image.Resampling.BICUBIC)
    bloom = water_pigment.point(lambda value: 5 + value * 33 // 255)
    bloom = ImageChops.multiply(water_mask, bloom)
    base.paste(Image.new("RGB", base.size, (38, 107, 143)), (0, 0), bloom)

    # Vertical reflections are sparse, broad and fade with local depth. They
    # borrow only the shoreline positions, never inventing an object.
    reflections = Image.new("L", base.size)
    reflection_draw = ImageDraw.Draw(reflections)
    rng = np.random.default_rng(seed)
    for _ in range(46):
        x = int(rng.uniform(0, width))
        visible = np.flatnonzero(water_pixels[:, x] > 80)
        if not visible.size:
            continue
        top_x = int(visible[0])
        length = int(rng.uniform(height * .015, height * .11))
        reflection_draw.line((x, top_x, x + rng.uniform(-2, 2), top_x + length),
                             fill=int(rng.uniform(7, 20)), width=int(rng.uniform(2, 7)))
    reflections = ImageChops.multiply(water_mask, _wrap_blur(reflections, 2.1))
    base.paste(Image.new("RGB", base.size, (218, 218, 187)), (0, 0), reflections)
    details = Image.new("L", base.size)
    draw = ImageDraw.Draw(details)
    _left, top, _right, bottom = water_mask.getbbox()
    water_height = max(1, bottom - top)
    for index in range(150):
        y = int(top + water_height * (.08 + .88 * index / 149))
        start = int(rng.uniform(0, width))
        length = int(rng.uniform(width * .025, width * .1))
        end = start + length
        ink = int(rng.uniform(13, 34))
        draw.line((start, y, min(width, end), y), fill=min(58, ink + 19), width=max(1, height // 520))
        if end > width:
            draw.line((0, y, end - width, y), fill=min(58, ink + 19), width=max(1, height // 520))
    clipped = ImageChops.multiply(_wrap_blur(details, .45), water_mask)
    base.paste(Image.new("RGB", base.size, (242, 237, 215)), (0, 0), clipped)
    # A few darker, discontinuous horizontal strokes create receding water
    # planes. Their length and contrast taper towards the shore/horizon.
    dark_details = Image.new("L", base.size)
    dark_draw = ImageDraw.Draw(dark_details)
    for _ in range(115):
        fraction = float(rng.uniform(.08, .92))
        y = int(top + water_height * fraction)
        start = int(rng.uniform(0, width))
        length = int(rng.uniform(width * .008, width * (.025 + fraction * .04)))
        dark_draw.line((start, y, min(width, start + length), y), fill=int(rng.uniform(17, 38)),
                       width=max(1, height // 620))
        if start + length > width:
            dark_draw.line((0, y, start + length - width, y), fill=12, width=max(1, height // 620))
    dark_details = ImageChops.multiply(_wrap_blur(dark_details, .3), water_mask)
    base.paste(Image.new("RGB", base.size, (35, 100, 128)), (0, 0), dark_details)
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
    sky_top = {"spring": (174, 208, 220), "summer": (159, 201, 219), "autumn": (181, 204, 211), "winter": (187, 208, 221)}[season]
    base = _gradient((render_width, render_height), sky_top, (244, 232, 204))
    artist_pigment = _artist_pigment(render_width, render_height)
    broad_pigment = _periodic_pigment(render_width, render_height, seed + 17, (190, 91, 43))
    medium_pigment = _periodic_pigment(render_width, render_height, seed + 29, (74, 31, 17))
    fine_pigment = _paper_noise(render_width, render_height, seed + 37, 9)
    pigments = (
        broad_pigment.point(lambda value: 56 + value * 192 // 255),
        medium_pigment.point(lambda value: 78 + value * 168 // 255),
        ImageChops.multiply(fine_pigment, artist_pigment).point(lambda value: 86 + value * 160 // 255),
    )
    canopy_field = _paper_noise(render_width, render_height, seed + 43, 30)
    _paint_sky(base, geometry, broad_pigment, artist_pigment)
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
            if semantic in {SemanticClass.WATER, SemanticClass.RIVER}:
                target = (186, 214, 222)
            elif semantic in _MOUNTAIN and layer >= 3:
                target = (145, 169, 184)
            else:
                target = (211, 216, 199)
            color = _mix(palette[semantic], target, _LAYER_HAZE[layer])
            if semantic in {SemanticClass.UNKNOWN_TERRAIN, SemanticClass.OPEN_GRASSLAND} and layer <= 1:
                color = _mix(color, (181, 164, 91), .12)
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
    _paint_ambient_volume(base, geometry, masks)
    _paint_mountain_facets(base, geometry, masks, medium_pigment)
    _paint_surface_blooms(base, masks, medium_pigment, artist_pigment)
    _paint_land_brushwork(base, masks, seed + 47)
    _paint_perspective_sweeps(base, masks, seed + 53)
    _paint_forest_details(base, masks, canopy_field, artist_pigment, seed + 59)
    _paint_water_details(base, water, seed + 71, broad_pigment)
    _paint_buildings(base, geometry, seed + 113, medium_pigment)
    _paint_edges(base, geometry)

    if base.size != (width, height):
        base = base.resize((width, height), Image.Resampling.LANCZOS)
    # Paper fibres are applied once at delivery resolution so the final image
    # retains a tactile wash instead of looking like enlarged flat vectors.
    fibres = ImageChops.multiply(_paper_noise(width, height, seed + 211, 5), _artist_pigment(width, height))
    light_fibres = fibres.point(lambda value: max(0, value - 128) // 5)
    dark_fibres = fibres.point(lambda value: max(0, 119 - value) // 5)
    base.paste(Image.new("RGB", base.size, (239, 230, 208)), (0, 0), light_fibres)
    base.paste(Image.new("RGB", base.size, (103, 112, 96)), (0, 0), dark_fibres)
    base = _close_seam(base)
    output = io.BytesIO()
    # Slightly higher quality also keeps the lossy encoder's boundary blocks
    # visually continuous after the circular edge has been matched above.
    base.save(output, format="WEBP", quality=88, method=1, exact=True)
    return output.getvalue()


def render_material_webp(geometry: PanoramaGeometry, width: int = 2048, height: int = 512) -> bytes:
    """Pack depth, semantic class and approximate surface orientation for WebGL.

    R is logarithmic distance, G is the stable semantic id and B is the
    normal/light response proxy. Sky remains zero. The mask is deliberately
    small and lossless; it accompanies the neutral base watercolor.
    """
    semantics = tuple(SemanticClass)
    semantic_ids = {semantic: round((index + 1) / len(semantics) * 255) for index, semantic in enumerate(semantics)}
    packed = np.zeros((height, width, 3), dtype=np.uint8)
    minimum, maximum = geometry.config.minimum_elevation_angle, geometry.config.maximum_elevation_angle
    count = len(geometry.columns)
    for x in range(width):
        column = geometry.columns[min(count - 1, int((x + .5) * count / width))]
        for span in column.spans:
            top = max(0, min(height, round((maximum - span.upper_angle_degrees) / (maximum - minimum) * height)))
            bottom = max(0, min(height, round((maximum - span.lower_angle_degrees) / (maximum - minimum) * height)))
            if bottom <= top:
                continue
            depth = round(max(0, min(1, math.log1p(span.distance_meters) / math.log1p(150_000))) * 255)
            edge = min(column.terrain_edges, key=lambda item: abs(item.distance_meters - span.distance_meters), default=None)
            slope = edge.slope_degrees if edge and edge.slope_degrees is not None else 0
            normal = round(max(0, min(1, .5 + slope / 180)) * 255)
            packed[top:bottom, x] = (depth, semantic_ids[span.semantic], normal)
    packed[:, -1] = packed[:, 0]
    image = Image.fromarray(packed, "RGB")
    output = io.BytesIO()
    image.save(output, format="WEBP", lossless=True, method=6)
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
