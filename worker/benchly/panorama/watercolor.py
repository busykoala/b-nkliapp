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
from scipy.ndimage import gaussian_filter1d, maximum_filter1d, minimum_filter, minimum_filter1d

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
PAINT_SCALE = .72


def _close_seam(image: Image.Image, width: int = 24) -> Image.Image:
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


def _heal_water_wrap_cusp(image: Image.Image, water_mask: Image.Image) -> Image.Image:
    """Remove a narrow dark 0/360 cusp left by independent water reflections.

    Matching only the two boundary pixels made the seam C0-continuous, yet
    both sides could still dip together and read as a vertical ink line.
    Blend only that tiny *water* neighbourhood from adjacent circular pigment;
    geographic shores and landforms remain untouched.
    """
    if not water_mask.getbbox():
        return image
    pixels = np.asarray(image, dtype=np.float32).copy()
    wet = np.asarray(water_mask.resize(image.size, Image.Resampling.LANCZOS), dtype=np.float32) / 255
    radius = max(5, image.width // 360)
    sample = radius + 5
    for offset in range(radius):
        nearby = (pixels[:, sample + offset] + pixels[:, -sample - offset - 1]) * .5
        amount = ((1 - offset / radius) ** 2 * wet[:, offset])[:, None]
        opposite = ((1 - offset / radius) ** 2 * wet[:, -offset - 1])[:, None]
        pixels[:, offset] = pixels[:, offset] * (1 - amount) + nearby * amount
        pixels[:, -offset - 1] = pixels[:, -offset - 1] * (1 - opposite) + nearby * opposite
    return Image.fromarray(np.rint(pixels).clip(0, 255).astype(np.uint8), "RGB")


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


def _broken_horizontal_edges(mask: Image.Image, seed: int, width: int, height: int) -> Image.Image:
    """Break continuous depth-bin rims into uneven wet-pigment passages.

    Their location remains derived from the terrain, but a uniform line all
    the way around a 360-degree image reads as a technical contour.
    """
    rim = _horizontal_edges(mask)
    pigment = _periodic_pigment(width, height, seed, (61, 23))
    gaps = pigment.point(lambda value: min(255, max(0, (value - 62) * 2)))
    return ImageChops.multiply(rim, gaps)


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
            # Pillow rectangles include their right and bottom endpoints.
            # Painting x+1 as well let a ray overwrite its neighbour and
            # exposed one-pixel semantic seams after the final scale pass.
            draws[key].rectangle((left, top, left, bottom - 1), fill=255)
    organic = _periodic_pigment(width, height, _seed(geometry.identity_key, "paint-edges"), (113, 47, 23))
    softened = {}
    for key, mask in masks.items():
        # Only loosen the rim; the interior and the recognisable landform stay
        # fixed. A real brush never stops at precisely the same contour on all
        # three watercolor passes.
        # A wet blur supplies the translucent outside fringe directly. Pillow's
        # generic rank-based MaxFilter spent more time here than the rest of
        # the painter while producing a harder, more digital dilation.
        expanded = _wrap_blur(mask, 1.85)
        outer_rim = ImageChops.subtract(expanded, mask)
        broken_rim = ImageChops.multiply(outer_rim, organic.point(lambda value: max(0, value - 92)))
        # Preserve the factual solid body and let only a translucent fringe
        # escape it. Contracting the body created map-like white contour gaps.
        loosened = ImageChops.lighter(mask, _scaled_alpha(broken_rim, .38))
        softened[key] = _wrap_blur(loosened, 2.15)
    masks = softened
    return masks


def _surface_masks(masks: dict[tuple[SemanticClass, int], Image.Image]) -> dict[SemanticClass, Image.Image]:
    """Merge quantized distance bands into continuous painterly surfaces.

    Distance bins are useful data, but painting each bin as a separate opaque
    shape exposes the polar renderer as vertical GIS strips.  An artist sees a
    lake or wooded hillside as one mass and varies its tone *inside* that mass.
    The merge also rounds only the final contour; it does not add a semantic
    class where the source geometry has none.
    """
    if not masks:
        return {}
    size = next(iter(masks.values())).size
    width, height = size
    merged: dict[SemanticClass, Image.Image] = {}
    for (semantic, _layer), mask in masks.items():
        current = merged.get(semantic)
        merged[semantic] = mask if current is None else ImageChops.lighter(current, mask)
    forest = merged.get(SemanticClass.FOREST)
    grass = merged.get(SemanticClass.OPEN_GRASSLAND)
    if forest is not None and grass is not None:
        # Narrow grassland wedges embedded in a known canopy are often a
        # coarse land-cover sector rather than a floor-to-sky clearing. Keep
        # the actual semantic data intact; only its painting is reduced to a
        # translucent dapple. Broad real clearings do not bridge and remain.
        pixels = np.asarray(forest, dtype=np.uint8)
        # A coarse land-cover sample can leave a several-degree, ruler-straight
        # meadow slit in a continuous canopy. Close only narrow contact gaps;
        # the meadow still remains as a translucent local wash below it.
        gap_radius = max(2, width // 30)
        expanded = maximum_filter1d(pixels, size=gap_radius * 2 + 1, axis=1, mode="wrap")
        closed = minimum_filter1d(expanded, size=gap_radius * 2 + 1, axis=1, mode="wrap")
        bridge = Image.fromarray(np.maximum(0, closed.astype(np.int16) - pixels).astype(np.uint8), "L")
        merged[SemanticClass.FOREST] = ImageChops.lighter(forest, bridge)
        merged[SemanticClass.OPEN_GRASSLAND] = ImageChops.subtract(
            grass, ImageChops.multiply(grass, _scaled_alpha(bridge, .84)),
        )
        # The remaining very short meadow sectors are still real land-cover
        # observations, but the polar projection must not turn them into
        # floor-to-sky searchlight beams inside a wood.
        merged[SemanticClass.OPEN_GRASSLAND] = _soften_narrow_sector_view(
            merged[SemanticClass.OPEN_GRASSLAND], max(6, width // 28), .11, .30,
        )
    rock = merged.get(SemanticClass.ROCK)
    snow = merged.get(SemanticClass.SNOW_OR_GLACIER)
    if snow is not None:
        # A few coarse snow rays crossing a whole near mountain face create a
        # ruler-straight white chute. A narrow patch remains visibly snowy at
        # its upper edge, then thins as a translucent wash on the underlying
        # mountain. Broad surveyed snowfields remain solid.
        merged[SemanticClass.SNOW_OR_GLACIER] = _soften_narrow_sector_view(
            snow, max(8, width // 36), .65, -.57,
        )
        if rock is not None:
            pixels = np.asarray(rock, dtype=np.uint8)
            radius = max(3, width // 58)
            expanded = maximum_filter1d(pixels, size=radius * 2 + 1, axis=1, mode="wrap")
            closed = minimum_filter1d(expanded, size=radius * 2 + 1, axis=1, mode="wrap")
            bridge = Image.fromarray(np.maximum(0, closed.astype(np.int16) - pixels).astype(np.uint8), "L")
            merged[SemanticClass.ROCK] = ImageChops.lighter(rock, _scaled_alpha(bridge, .82))
    for semantic in (SemanticClass.WATER, SemanticClass.RIVER):
        if semantic in merged:
            merged[semantic] = _soften_narrow_water_view(merged[semantic])
    for semantic, mask in tuple(merged.items()):
        # Forest and water source outlines are often much coarser than the
        # panorama raster.  A circular low-pass turns their staircase into a
        # loose brush contour while retaining the recognisable landform.
        if semantic == SemanticClass.FOREST:
            radius = max(4.0, width / 140)
            amount = .85
        elif semantic == SemanticClass.SNOW_OR_GLACIER:
            # Coarse snow classes sometimes switch for only a degree or two
            # of azimuth yet cover a complete mountain ray. A wider wet edge
            # keeps the real pale patch without a ruler-straight white pillar.
            radius = max(4.0, width / 85)
            amount = .95
        elif semantic in {SemanticClass.WATER, SemanticClass.RIVER}:
            radius = max(2.5, width / 220)
            amount = .82
        else:
            radius = max(2.5, width / 220)
            amount = .82
        smooth = _wrap_blur(mask, radius)
        # Image.blend keeps solid interiors but replaces square contour turns
        # with translucent wet edges instead of merely painting blur outside.
        merged[semantic] = Image.blend(mask, smooth, amount)
    return merged


def _soften_narrow_water_view(mask: Image.Image) -> Image.Image:
    """Turn short polar water slits into translucent stream/pool washes.

    A 3–8° water sector extending straight to the painting's lower edge is a
    ray-projection artifact, not a surveyed rectangular shoreline. Keep the
    measured water present, but let nearby land show through it. Real lakes
    span broad sectors and are left untouched.
    """
    return _soften_narrow_sector_view(mask, max(6, mask.width // 32), .02, .14)


def _soften_narrow_sector_view(mask: Image.Image, maximum_width: int,
                               top_opacity: float, lower_opacity: float) -> Image.Image:
    pixels = np.asarray(mask, dtype=np.uint8).copy()
    height, width = pixels.shape
    active = (pixels > 120).mean(axis=0) > .25
    if not active.any() or active.all():
        return mask
    pivot = int(np.flatnonzero(~active)[0])
    rotated = np.roll(active, -pivot)
    changes = np.diff(np.r_[0, rotated.astype(np.int8), 0])
    for begin, end in zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)):
        if end - begin >= maximum_width:
            continue
        columns = (np.arange(begin, end) + pivot) % width
        area = pixels[:, columns]
        occupied = np.flatnonzero((area > 80).any(axis=1))
        if occupied.size < height * .18:
            continue
        top, bottom = int(occupied[0]), int(occupied[-1])
        distance = np.clip((np.arange(height) - top) / max(1, bottom - top), 0, 1)
        opacity = top_opacity + lower_opacity * distance ** .78
        pixels[:, columns] = np.rint(area * opacity[:, None]).astype(np.uint8)
    return Image.fromarray(pixels, "L")


def _paint_depth_atmosphere(base: Image.Image, semantic: SemanticClass, surface: Image.Image,
                            masks: dict[tuple[SemanticClass, int], Image.Image]) -> None:
    """Model aerial perspective continuously without exposing depth bins."""
    width, height = base.size
    field = np.zeros((height, width), dtype=np.float32)
    weight = np.zeros((height, width), dtype=np.float32)
    for layer in _LAYERS:
        mask = masks.get((semantic, layer))
        if mask is None:
            continue
        alpha = np.asarray(mask, dtype=np.float32) / 255
        # The visible spans should barely overlap.  Max keeps the farthest
        # contribution at a soft rim instead of summing it into a dark stripe.
        field = np.maximum(field, alpha * (_LAYER_HAZE[layer] ** .82))
        weight = np.maximum(weight, alpha)
    if not weight.any():
        return
    haze = Image.fromarray(np.rint(field * 255).clip(0, 255).astype(np.uint8), "L")
    # A broad, wrap-safe blend is the essential difference between atmospheric
    # depth and a colour-coded range map.
    haze = _wrap_blur(haze, max(6.0, width / (48 if semantic == SemanticClass.FOREST else 110)))
    # Distance still cools the wash, but it must not erase every chromatic
    # fold into the same grey-green computer plane.
    haze = ImageChops.multiply(surface, haze).point(lambda value: round(value * .95))
    target = (195, 211, 222) if semantic in _MOUNTAIN else (209, 221, 221)
    base.paste(Image.new("RGB", base.size, target), (0, 0), haze)
    # Nearby faces retain warm, granular paint against the cool distant wash.
    # The broad glaze follows actual near-depth spans but never draws their
    # hard angular sides as outlines.
    if semantic in _MOUNTAIN:
        near = Image.new("L", base.size)
        for layer in (0, 1, 2):
            sample = masks.get((semantic, layer))
            if sample is not None:
                near = ImageChops.lighter(near, sample)
        if near.getbbox():
            near = ImageChops.multiply(surface, _wrap_blur(near, max(6.0, width / (55 if semantic == SemanticClass.FOREST else 120))))
            tint = (82, 110, 73) if semantic == SemanticClass.FOREST else (124, 105, 83)
            base.paste(Image.new("RGB", base.size, tint), (0, 0), _scaled_alpha(near, .21 if semantic == SemanticClass.FOREST else .12))


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
        factor = opacity * ((.53, .51, .39)[pass_index])
        alpha = alpha.point(lambda value, factor=factor: round(value * factor))
        base.paste(layer, (0, 0), alpha)


def _painted_skyline(geometry: PanoramaGeometry, width: int, height: int) -> np.ndarray:
    raw = np.array([
        _angle_y(
            geometry.columns[min(len(geometry.columns) - 1, int((x + .5) * len(geometry.columns) / width))].skyline_angle_degrees,
            geometry,
            height,
        ) for x in range(width)
    ], dtype=np.float32)
    radius = max(3, width // 190)
    offsets = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-.5 * (offsets / max(1, radius / 2.8)) ** 2)
    kernel /= kernel.sum()
    extended = np.concatenate((raw[-radius:], raw, raw[:radius]))
    smooth = np.convolve(extended, kernel, mode="same")[radius:-radius]
    # Keep summits and valleys recognisable while taking the right angles out
    # of quantized source steps.
    return raw * .08 + smooth * .92


def _sky_mask(geometry: PanoramaGeometry, width: int, height: int) -> Image.Image:
    mask = Image.new("L", (width, height))
    skyline = [(x, float(y)) for x, y in enumerate(_painted_skyline(geometry, width, height))]
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
    for layer in _LAYERS:
        for semantic in _MOUNTAIN:
            mask = masks.get((semantic, layer))
            if mask is not None:
                combined = ImageChops.lighter(combined, mask)
    if not combined.getbbox():
        return
    # Pool pigment at the landform silhouette, never at every semantic
    # boundary inside it. The latter drew a dark green halo around forests.
    edges = _horizontal_edges(combined)
    shadow = ImageChops.multiply(combined, ImageChops.offset(edges, max(1, width // 1800), 3))
    shadow = _wrap_blur(shadow, 1.45).point(lambda value: round(value * .10))
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
        # Pillow's rank filter walked the full raster in Python/C for each
        # distance layer (~one second per Bänkli). The equivalent SciPy
        # erosion is both faster and circular at the 0°/360° seam.
        inner = Image.fromarray(minimum_filter(
            np.asarray(layer_mask, dtype=np.uint8), size=9, mode=("nearest", "wrap"),
        ), "L")
        rim = ImageChops.subtract(layer_mask, inner).filter(ImageFilter.GaussianBlur(1.2))
        strength = .17 if layer < 3 else .10
        base.paste(Image.new("RGB", base.size, _LAYER_SHADOWS[layer]), (0, 0), _scaled_alpha(rim, strength))


def _paint_layered_valleys(base: Image.Image, masks) -> None:
    """Glaze broad turning planes from measured near/far terrain intervals.

    Only horizontal landform rims are used. A broad wet blur and soft inward
    pool create overlapping hill bodies without drawing polar depth-bin sides.
    """
    width, height = base.size
    for layer in reversed(_LAYERS):
        mass = Image.new("L", base.size)
        for semantic in _MOUNTAIN:
            mask = masks.get((semantic, layer))
            if mask is not None:
                mass = ImageChops.lighter(mass, mask)
        if not mass.getbbox():
            continue
        rim = _broken_horizontal_edges(mass, 431 + layer * 37, width, height)
        reach = max(3, round(height * (.039 if layer < 3 else .025)))
        spread = max(8, width / (115 if layer < 3 else 145))
        underside = _wrap_blur(ImageChops.offset(rim, 0, reach), spread)
        underside = ImageChops.multiply(mass, underside)
        upper = _wrap_blur(ImageChops.offset(rim, -max(1, width // 2100), -max(2, reach // 4)), spread * .7)
        upper = ImageChops.multiply(mass, upper)
        shadow = _mix((58, 77, 75), (99, 123, 143), min(.75, layer / 8))
        light = _mix((238, 212, 158), (211, 226, 215), min(.8, layer / 8))
        base.paste(Image.new("RGB", base.size, shadow), (0, 0), _scaled_alpha(underside, 1.55 if layer < 3 else .91))
        base.paste(Image.new("RGB", base.size, light), (0, 0), _scaled_alpha(upper, .65 if layer < 3 else .38))


def _paint_mountain_facets(base: Image.Image, geometry: PanoramaGeometry, masks,
                           pigment_field: Image.Image) -> None:
    """Brush short diagonal planes below measured ridges, never radial bands."""
    width, height = base.size
    faceted = {SemanticClass.ROCK, SemanticClass.SNOW_OR_GLACIER, SemanticClass.UNKNOWN_TERRAIN}
    mountain = Image.new("L", base.size)
    for layer in _LAYERS:
        for semantic in faceted:
            mask = masks.get((semantic, layer))
            if mask is not None:
                mountain = ImageChops.lighter(mountain, mask)
    if not mountain.getbbox():
        return

    shade = Image.new("L", base.size)
    light = Image.new("L", base.size)
    shade_draw, light_draw = ImageDraw.Draw(shade), ImageDraw.Draw(light)
    columns = geometry.columns
    rng = np.random.default_rng(_seed(geometry.identity_key, "relief-planes"))
    step = max(9, width // 95)
    for x in range(0, width, step):
        column = columns[min(len(columns) - 1, round((x + .5) * len(columns) / width))]
        candidates = [edge for edge in column.terrain_edges if edge.semantic in faceted]
        if not candidates or rng.random() < .24:
            continue
        edge = max(candidates, key=lambda item: (item.relief_meters or 0, item.elevation_angle_degrees))
        layer = edge.depth_layer if edge.depth_layer is not None else terrain_depth_layer(edge.distance_meters)
        if layer > 5:
            continue
        y = _angle_y(edge.elevation_angle_degrees, geometry, height)
        slope = edge.slope_degrees or 0
        relief = max(12, edge.relief_meters or 12)
        drop = min(height * .046, max(height * .012, relief / 2600 * height))
        turn = (-1 if slope < 0 else 1) * rng.uniform(step * .38, step * .95)
        reach = rng.uniform(step * .42, step * 1.10)
        target = shade_draw if slope < 0 else light_draw
        counterplane = light_draw if slope < 0 else shade_draw
        # A finite sloping pigment plane makes the ridge turn into a hillside
        # rather than a thin contour. Its measured edge anchors it; its soft,
        # uneven end stays safely short of the next angular sector.
        target.polygon([
            (x - reach * .55, y + drop * .24),
            (x + reach * .46, y + drop * .12),
            (x + turn + reach * .23, y + drop * 1.42),
            (x + turn - reach * .51, y + drop * 1.14),
        ], fill=max(9, round(76 * (1 - layer * .07))))
        counterplane.polygon([
            (x + reach * .38, y + drop * .12),
            (x + reach * .88, y + drop * .30),
            (x + turn + reach * .55, y + drop * 1.30),
            (x + turn + reach * .13, y + drop * 1.13),
        ], fill=max(8, round(55 * (1 - layer * .07))))
        for fraction, ink in ((0, 43), (.34, 31), (.71, 22)):
            jitter = rng.uniform(-step * .08, step * .08)
            path = [(x - reach * .25 + jitter, y + fraction * drop),
                    (x + reach * .12 + turn * fraction, y + fraction * drop + drop * .26),
                    (x + reach * .42 + turn * fraction, y + fraction * drop + drop * .45)]
            target.line(path, fill=max(4, round(ink * (1 - layer * .085))),
                        width=max(2, round(height / 220)), joint="curve")
    shade = ImageChops.multiply(mountain, _wrap_blur(shade, 5.1))
    light = ImageChops.multiply(mountain, _wrap_blur(light, 5.5))
    shade = ImageChops.multiply(shade, pigment_field.point(lambda value: 105 + value * 150 // 255))
    base.paste(Image.new("RGB", base.size, (43, 63, 86)), (0, 0), _scaled_alpha(shade, 1.80))
    base.paste(Image.new("RGB", base.size, (238, 209, 145)), (0, 0), _scaled_alpha(light, 1.38))


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
    # Derivatives are measured in paint pixels: multiplying them by dozens
    # saturated nearly every hill at +/-1 and turned volume into a repeated
    # uniform blob. Keep the actual variation of each turning hillside.
    value = np.clip(slope * .9 + curvature * 3.2, -1, 1)
    shadow = Image.new("L", base.size)
    light = Image.new("L", base.size)
    shadow_draw, light_draw = ImageDraw.Draw(shadow), ImageDraw.Draw(light)
    # Place overlapping diagonal pools along turning crests.  Finite pools
    # wrap around a hill like brush washes; a value broadcast down the entire
    # ray inevitably reads as a vertical database column.
    step = max(12, width // 85)
    for x in range(0, width, step):
        strength = abs(float(value[x]))
        if strength < .08:
            continue
        center_y = float(skyline[x] + height * (.10 + .08 * strength))
        radius_x = width * (.022 + .035 * strength)
        radius_y = height * (.075 + .11 * strength)
        slant = (-1 if slope[x] < 0 else 1) * radius_x * .22
        polygon = [
            (x - radius_x, center_y - radius_y * .35),
            (x + slant, center_y - radius_y),
            (x + radius_x, center_y + radius_y * .25),
            (x - slant, center_y + radius_y),
        ]
        target = shadow_draw if value[x] > 0 else light_draw
        ink = round((32 if value[x] > 0 else 24) + strength * (70 if value[x] > 0 else 53))
        for wrap in (-width, 0, width):
            target.polygon([(px + wrap, py) for px, py in polygon], fill=ink)
    shadow = ImageChops.multiply(terrain, _wrap_blur(shadow, width / 105))
    light = ImageChops.multiply(terrain, _wrap_blur(light, width / 115))
    base.paste(Image.new("RGB", base.size, (42, 63, 87)), (0, 0), _scaled_alpha(shadow, 1.72))
    base.paste(Image.new("RGB", base.size, (240, 207, 142)), (0, 0), _scaled_alpha(light, 1.48))


def _paint_measured_slope_volume(base: Image.Image, geometry: PanoramaGeometry,
                                 surfaces: dict[SemanticClass, Image.Image]) -> None:
    """Glaze broad cool/warm planes from visible terrain slope, not column art.

    The polar rays are factual but individually narrow; averaging the slope
    field across both image axes turns their stepped measurements into hill
    *bodies*. This is neutral painting volume, not a claim about today's sun.
    """
    width, height = base.size
    terrain = Image.new("L", base.size)
    # A forest semantic is a canopy mass, not a measured bare-ground slope.
    # Applying radial ALTI gradients to it produced pale vertical columns
    # instead of trees; its depth belongs to the forest brushwork below.
    volume_semantics = _MOUNTAIN - {SemanticClass.FOREST}
    for semantic in volume_semantics:
        mask = surfaces.get(semantic)
        if mask is not None:
            terrain = ImageChops.lighter(terrain, mask)
    if not terrain.getbbox():
        return
    values = np.full((height, width), 128, dtype=np.uint8)
    count = len(geometry.columns)
    for x in range(width):
        column = geometry.columns[min(count - 1, int((x + .5) * count / width))]
        for span in column.spans:
            if span.semantic not in volume_semantics:
                continue
            top = max(0, min(height, _angle_y(span.upper_angle_degrees, geometry, height)))
            bottom = max(0, min(height, _angle_y(span.lower_angle_degrees, geometry, height)))
            if bottom <= top:
                continue
            edge = min(column.terrain_edges, key=lambda item: abs(item.distance_meters - span.distance_meters), default=None)
            slope = edge.slope_degrees if edge and edge.slope_degrees is not None else 0
            # Let the measured incline describe a finite visible *plane* near
            # its crest, not a full-height radial stripe down to the observer.
            reach = min(bottom, top + max(8, round((bottom - top) * .54)))
            values[top:reach, x] = round(128 + max(-65, min(65, slope)) * 1.55)
    field = np.asarray(_wrap_blur(Image.fromarray(values, "L"), max(7, width / 145)), dtype=np.float32)
    cool = Image.fromarray(np.rint(np.clip((128 - field) * 2.8, 0, 135)).astype(np.uint8), "L")
    warm = Image.fromarray(np.rint(np.clip((field - 128) * 1.9, 0, 95)).astype(np.uint8), "L")
    cool = ImageChops.multiply(terrain, cool)
    warm = ImageChops.multiply(terrain, warm)
    base.paste(Image.new("RGB", base.size, (69, 84, 104)), (0, 0), cool)
    rock = surfaces.get(SemanticClass.ROCK)
    if rock is not None:
        rock_warm = ImageChops.multiply(warm, rock)
        warm = ImageChops.subtract(warm, rock_warm)
        base.paste(Image.new("RGB", base.size, (211, 213, 205)), (0, 0), rock_warm)
    base.paste(Image.new("RGB", base.size, (231, 206, 154)), (0, 0), warm)


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
                          artist_field: Image.Image, seed: int, near_masks=None) -> None:
    """Add clustered canopy mass only where geographic forest is visible."""
    forest = Image.new("L", base.size)
    for layer in _LAYERS:
        mask = masks.get((SemanticClass.FOREST, layer))
        if mask is not None:
            forest = ImageChops.lighter(forest, mask)
    if not forest.getbbox():
        return
    width, height = base.size
    forest = Image.blend(forest, _wrap_blur(forest, max(2.2, width / 340)), .78)
    rng = np.random.default_rng(seed)

    # Woodland cover is geographically known, but its raster silhouette is a
    # bare terrain ray. Lay an uneven crown edge immediately above that ray;
    # otherwise a distant wood reads as a flat-topped green building. Keep the
    # brush inside mapped forest azimuths, not on neighbouring hills or water.
    pixels = np.asarray(forest, dtype=np.uint8)
    crest = Image.new("L", base.size)
    crest_draw = ImageDraw.Draw(crest)
    # A correlated brush-pressure field bends the continuous tree line. A
    # fixed row of circles looked like procedural buttons on the hillside.
    pressure = rng.normal(0, 1, width).astype(np.float32)
    radius = max(9, width // 115)
    offsets = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-.5 * (offsets / max(1, radius / 2.7)) ** 2)
    kernel /= kernel.sum()
    pressure = np.convolve(np.concatenate((pressure[-radius:], pressure, pressure[:radius])),
                           kernel, mode="same")[radius:-radius]
    pressure /= max(.01, float(np.max(np.abs(pressure))))
    side = max(3, width // 500)
    for x in range(width):
        visible = np.flatnonzero(pixels[:, x] > 120)
        if not visible.size:
            continue
        top = int(visible[0])
        # Require woodland on both sides of the dab. This prevents a crown
        # from bridging a genuine clearing or spilling into an adjacent lake.
        if not np.any(pixels[:, (x - side) % width] > 120) or not np.any(pixels[:, (x + side) % width] > 120):
            continue
        lift = round(height * (.016 + .013 * (1 + pressure[x])))
        crest_draw.line((x, max(0, top - lift), x, top + 3), fill=125, width=1)
    crown_fringe = _wrap_blur(crest, max(.8, width / 3300))
    crown_fringe = ImageChops.subtract(crown_fringe, forest)
    base.paste(Image.new("RGB", base.size, (92, 132, 91)), (0, 0), crown_fringe)

    # The land-cover class is one continuous woodland, but the visible depth
    # intervals are not one flat green plane. Glaze the more distant canopies
    # cool and the foreground warm through very broad, circular wet edges.
    # Individual polar interval borders remain invisible in the painting.
    if near_masks:
        distant = Image.new("L", base.size)
        nearby = Image.new("L", base.size)
        for layer in _LAYERS:
            measured = near_masks.get((SemanticClass.FOREST, layer))
            if measured is None:
                continue
            if layer >= 2:
                distant = ImageChops.lighter(distant, measured)
            elif layer == 0:
                nearby = ImageChops.lighter(nearby, measured)
        if distant.getbbox():
            distance_glaze = ImageChops.multiply(forest, _wrap_blur(distant, max(22.0, width / 62)))
            base.paste(Image.new("RGB", base.size, (132, 165, 189)), (0, 0), _scaled_alpha(distance_glaze, .46))
        if nearby.getbbox():
            near_glaze = ImageChops.multiply(forest, _wrap_blur(nearby, max(18.0, width / 88)))
            # The warm ground reflected through close crowns is broken by
            # watercolor pigment instead of laid as an opaque olive stripe.
            warm = ImageChops.multiply(near_glaze, artist_field)
            base.paste(Image.new("RGB", base.size, (172, 171, 101)), (0, 0), _scaled_alpha(warm, .28))

    downward = np.clip((np.arange(height, dtype=np.float32) / height - .38) / .58, 0, 1)
    grounding = Image.fromarray(np.rint(np.asarray(forest, dtype=np.float32) * downward[:, None] * .12).astype(np.uint8), "L")
    base.paste(Image.new("RGB", base.size, (71, 95, 58)), (0, 0), grounding)

    # Wet-on-wet value masses curl across mapped woodland. Their boundaries
    # are brushwork, not additional surveyed trees or invented landforms; the
    # forest silhouette and measured foreground trunks stay geographic.
    cool_mass = Image.new("L", base.size)
    warm_mass = Image.new("L", base.size)
    cool_draw, warm_draw = ImageDraw.Draw(cool_mass), ImageDraw.Draw(warm_mass)
    bounds = forest.getbbox()
    if bounds:
        left, top, right, bottom = bounds
        for _ in range(max(18, width // 175)):
            x = float(rng.uniform(left, right))
            y = float(rng.uniform(top + (bottom - top) * .13, bottom - (bottom - top) * .10))
            reach_x = float(rng.uniform(width * .026, width * .069))
            reach_y = float(rng.uniform(height * .055, height * .19))
            for wrap in (-width, 0, width):
                cool_draw.ellipse((x + wrap - reach_x, y - reach_y * .62,
                                   x + wrap + reach_x, y + reach_y), fill=int(rng.uniform(78, 126)))
                warm_draw.ellipse((x + wrap - reach_x * 1.25, y - reach_y * 1.22,
                                   x + wrap + reach_x * .20, y + reach_y * .20), fill=int(rng.uniform(58, 100)))
        cool = ImageChops.multiply(forest, _wrap_blur(cool_mass, max(18.0, width / 105)))
        warm = ImageChops.multiply(forest, _wrap_blur(warm_mass, max(18.0, width / 112)))
        base.paste(Image.new("RGB", base.size, (39, 70, 79)), (0, 0), _scaled_alpha(cool, .93))
        base.paste(Image.new("RGB", base.size, (214, 199, 119)), (0, 0), _scaled_alpha(warm, .70))

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
                                  fill=int(rng.uniform(32, 68)))
        apertures = ImageChops.multiply(forest, _wrap_blur(apertures, height * .018))
        base.paste(Image.new("RGB", base.size, (191, 188, 134)), (0, 0), apertures)
    # Broad connected blooms read as canopy masses without turning mapped
    # forest into a field of decorative dots or claiming individual trees.
    artist_deposits = ImageOps.invert(artist_field).point(lambda value: max(0, min(105, value - 20)))
    clusters = canopy_field.point(lambda value: max(24, min(88, 67 + 128 - value)))
    clusters = ImageChops.multiply(forest, _wrap_blur(ImageChops.lighter(clusters, artist_deposits), 1.3))
    base.paste(Image.new("RGB", base.size, (29, 82, 50)), (0, 0), clusters)
    canopy_light = canopy_field.point(lambda value: max(0, min(68, value - 112)))
    canopy_light = ImageChops.multiply(forest, _wrap_blur(ImageChops.offset(canopy_light, -3, -2), 1.5))
    base.paste(Image.new("RGB", base.size, (174, 176, 112)), (0, 0), canopy_light)

    # Irregular overlapping crown groups follow the upper edge of each real
    # forest depth mask. They make woodland legible without pretending that
    # an individual procedural crown corresponds to a surveyed tree.
    crown_groups = Image.new("L", base.size)
    crowns = ImageDraw.Draw(crown_groups)
    # Follow the merged woodland contour once. Repeating these crowns for each
    # distance band outlined the renderer's staircase rather than a tree line.
    for layer, mask in ((0, forest),):
        if not mask.getbbox():
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
    # A few brush-widths of crown fringe loosen a mapped block contour while
    # the wooded mass remains anchored in the actual forest geometry.
    crown_fringe = ImageChops.lighter(forest, _scaled_alpha(_wrap_blur(forest, 3.5), .52))
    crown_groups = ImageChops.multiply(crown_fringe, _wrap_blur(crown_groups, .65))
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
    near_masks = near_masks if near_masks is not None else masks
    for layer in (0, 1):
        mask = near_masks.get((SemanticClass.FOREST, layer))
        if mask is not None:
            near_forest = ImageChops.lighter(near_forest, mask)
    bounds = near_forest.getbbox()
    if bounds:
        # The foreground canopy is a separate, warmer value mass. A vertical
        # depth glaze alone made the mapped woodland read like a flat green
        # wall; reserve dark pigment for actual near spans and let it build
        # towards the observer rather than down every distant tree ray.
        near_ramp = np.clip((np.arange(height, dtype=np.float32) / height - .43) / .57, 0, 1) ** 1.7
        near_ramp = np.broadcast_to(np.rint(near_ramp[:, None] * 255).astype(np.uint8), (height, width))
        near_ink = ImageChops.multiply(near_forest, Image.fromarray(near_ramp, "L"))
        near_ink = ImageChops.multiply(near_ink, canopy_field.point(lambda value: 90 + value * 165 // 255))
        base.paste(Image.new("RGB", base.size, (33, 72, 51)), (0, 0), _scaled_alpha(near_ink, .34))
        pixels = np.asarray(near_forest)
        left, _top, right, _bottom = bounds
        # Nearby woodland is a connected canopy and undergrowth, not a row of
        # schematic trunks. Overlapping wet masses follow real mapped forest
        # pixels; their softened edges provide foreground scale without
        # claiming that procedural marks are surveyed individual trees.
        foliage_mass = Image.new("L", base.size)
        foliage_draw = ImageDraw.Draw(foliage_mass)
        for _ in range(max(18, width // 75)):
            x = float(rng.uniform(left, right))
            visible = np.flatnonzero(pixels[:, min(width - 1, int(x))] > 95)
            if visible.size < 12:
                continue
            top, bottom = int(visible[0]), int(visible[-1])
            y = float(rng.uniform(top + (bottom - top) * .22, bottom - (bottom - top) * .04))
            radius_x = float(rng.uniform(width * .009, width * .030))
            radius_y = float(rng.uniform(height * .025, height * .11))
            for wrap in (-width, 0, width):
                foliage_draw.ellipse((x + wrap - radius_x, y - radius_y,
                                      x + wrap + radius_x, y + radius_y),
                                     fill=int(rng.uniform(34, 80)))
        foliage_mass = ImageChops.multiply(near_forest, _wrap_blur(foliage_mass, max(9, width / 185)))
        base.paste(Image.new("RGB", base.size, (35, 76, 54)), (0, 0), _scaled_alpha(foliage_mass, .58))
        highlights = ImageChops.multiply(near_forest, ImageChops.offset(foliage_mass, -5, -7))
        base.paste(Image.new("RGB", base.size, (183, 182, 118)), (0, 0), _scaled_alpha(highlights, .22))

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


def _paint_forest_relief(base: Image.Image, geometry: PanoramaGeometry,
                         forest: Image.Image) -> None:
    """Restore the hill's turning planes after foliage has been washed on."""
    if not forest.getbbox():
        return
    width, height = base.size
    crest = _painted_skyline(geometry, width, height)
    # The projected woodland silhouette is sampled ray by ray. Taking its
    # unsmoothed derivative created a vertical light/dark stripe at each ray
    # discontinuity. Brush-scale circular smoothing yields actual turning
    # hill *planes*, while the factual silhouette itself stays untouched.
    painted_crest = gaussian_filter1d(crest, sigma=max(12, width / 85), mode="wrap")
    slope = np.gradient(painted_crest)
    curvature = np.gradient(slope)
    # This is a painter's ambient light judgement, not a second solar model.
    # The wash bends across measured landform turns and fades down each face;
    # no azimuth bin is painted as a full-height green or blue column.
    turn = np.clip(slope * 1.35 + curvature * 3.8, -.9, .9)
    y = np.arange(height, dtype=np.float32)[:, None]
    reach = np.exp(-((y - painted_crest[None, :] - height * .22) / (height * .27)) ** 2)
    face = np.asarray(forest, dtype=np.float32) / 255
    cool = Image.fromarray(np.rint(np.clip(turn, 0, 1)[None, :] * reach * face * 145).astype(np.uint8), "L")
    warm = Image.fromarray(np.rint(np.clip(-turn, 0, 1)[None, :] * reach * face * 125).astype(np.uint8), "L")
    cool = _wrap_blur(cool, max(10, width / 88))
    warm = _wrap_blur(warm, max(10, width / 95))
    cool = ImageChops.multiply(forest, cool)
    warm = ImageChops.multiply(forest, warm)
    base.paste(Image.new("RGB", base.size, (39, 66, 80)), (0, 0), cool)
    base.paste(Image.new("RGB", base.size, (201, 189, 121)), (0, 0), warm)


def _paint_surface_blooms(base: Image.Image, masks, pigment_field: Image.Image,
                          artist_field: Image.Image) -> None:
    """Give broad land surfaces transparent, connected watercolor blooms."""
    tones = {
        SemanticClass.OPEN_GRASSLAND: ((85, 105, 70), (222, 211, 158)),
        SemanticClass.ROCK: ((67, 83, 112), (210, 218, 222)),
        SemanticClass.UNKNOWN_TERRAIN: ((76, 96, 78), (216, 211, 170)),
        SemanticClass.SETTLEMENT: ((119, 91, 83), (235, 207, 162)),
    }
    artist_dark = ImageOps.invert(artist_field).point(lambda value: max(0, min(93, value - 18)))
    artist_light = artist_field.point(lambda value: max(0, min(72, value - 151)))
    shadow_field = ImageChops.lighter(pigment_field.point(lambda value: max(0, min(55, 157 - value))), artist_dark)
    light_field = ImageChops.lighter(pigment_field.point(lambda value: max(0, min(48, value - 117))), artist_light)
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
    # swissBUILDINGS/TLM footprints are sampled at roughly 0.25° even when
    # terrain rays are 0.1°. Using the terrain spacing for run continuity
    # broke one factual facade into hundreds of subpixel polygons.
    sample_gap = max(resolution * 2.2, .52)
    for building in geometry.buildings:
        ordered = sorted(building.samples, key=lambda sample: sample.azimuth_degrees)
        if not ordered:
            continue
        runs: list[list] = [[]]
        for sample in ordered:
            if runs[-1] and sample.azimuth_degrees - runs[-1][-1].azimuth_degrees > sample_gap:
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
        # A projection run can collapse to one sub-pixel x coordinate when a
        # footprint only touches two neighbouring angular rays. Outlining that
        # degenerate polygon turns a perfectly ordinary settlement into a row
        # of identical vertical fence posts. It contains no drawable facade;
        # the underlying settlement/terrain wash is the honest representation
        # until a wider run exposes a coherent building body.
        projected_width = max(x for x, _y in walls) - min(x for x, _y in walls)
        if projected_width < max(1.5, width / 1_400):
            continue
        distance = float(np.median([sample.distance_meters for sample in samples]))
        haze = .04 if distance < 120 else .28 if distance < 1_500 else .62
        rng = np.random.default_rng(seed + index * 31)
        wall_bases = ((188, 139, 106), (219, 178, 128), (183, 153, 140), (230, 201, 156), (173, 149, 126))
        wall_base = _mix(wall_bases[index % len(wall_bases)], (203, 171, 130), float(rng.uniform(0, .22)))
        # Cool aerial haze belongs around the house, not as a green facade.
        # Keep all measured wall planes in one warm plaster family.
        wall = _mix(wall_base, (228, 210, 187), haze)
        roof_color = _mix((137, 77, 65) if index % 3 else (123, 104, 97), (197, 203, 199), haze)
        # A foreground wall must occlude the woodland wash behind it. The
        # earlier translucent polygon let green terrain shine through a warm
        # plaster facade, making the house appear abruptly cut in half.
        alpha = 255 if distance < 500 else 190 if distance < 2_000 else 105
        # TLM/OSM often supplies a reliable footprint but no roof model. A
        # shallow, conservative wash roof makes it readable as a house without
        # claiming an exact architectural form or storey count.
        roof_top = roof[:len(samples)]
        eaves = list(reversed(roof[len(samples):]))
        if roof_top:
            wall_bottom = list(reversed(walls[len(samples):]))
            wall_height = float(np.median([abs(upper[1] - lower[1]) for upper, lower in zip(eaves, wall_bottom)]))
            measured_roof = max(abs(upper[1] - lower[1]) for upper, lower in zip(roof_top, eaves))
            # Retain real roof planes. Only footprint-only buildings with an
            # almost flat projected cap receive a restrained pitched wash.
            if measured_roof < max(1, wall_height * .12):
                roof_height = min(height * .045, max(2, wall_height * .28))
                count = max(1, len(roof_top) - 1)
                roof_top = [
                    (point[0], point[1] - roof_height * (1 - abs(sample_index / count * 2 - 1)))
                    for sample_index, point in enumerate(eaves)
                ]
                roof = [*roof_top, *reversed(eaves)]
        for horizontal in (-width, 0, width):
            shifted_walls = [(x + horizontal, y) for x, y in walls]
            shifted_roof = [(x + horizontal, y) for x, y in roof]
            draw.polygon(shifted_walls, fill=(*wall, alpha))
            # Two connected plaster planes add volume without inventing
            # windows or storeys, and break the computer-flat wall value.
            if len(samples) >= 4:
                split = len(samples) // 2
                near_plane = [*shifted_walls[:split + 1],
                              *shifted_walls[len(samples) + len(samples) - split - 1:]]
                if len(near_plane) >= 3:
                    draw.polygon(near_plane, fill=(*_mix(wall, (118, 112, 121), .25), min(255, alpha)))
            draw.polygon(shifted_roof, fill=(*roof_color, alpha), outline=(*_mix(roof_color, (67, 78, 69), .32), min(195, alpha + 10)), width=max(1, width // 2048))
            # Eaves and the upper roof plane reserve highlights as in a
            # watercolor architectural study; no additional house is drawn.
            draw.line([(x + horizontal, y) for x, y in roof_top],
                      fill=(*_mix(roof_color, (237, 214, 173), .46), min(175, alpha)),
                      width=max(1, width // 1900), joint="curve")
            # A second imperfect glaze sits slightly inside the same factual
            # building body and suggests sun-faded plaster and facade depth.
            if len(shifted_walls) >= 6:
                middle = len(samples) // 2
                facade_plane = [*shifted_walls[middle:len(samples)], *shifted_walls[len(samples):len(samples) + len(samples) - middle]]
                if len(facade_plane) >= 3:
                    draw.polygon(facade_plane, fill=(*_mix(wall, (124, 90, 76), .46), max(68, alpha // 2)))
            draw.line(shifted_walls[:len(samples)], fill=(*_mix(wall, (70, 79, 69), .25), min(130, alpha)), width=max(1, width // 2700))
            draw.line(shifted_walls[len(samples):], fill=(*_mix(wall, (55, 67, 59), .32), min(105, alpha)), width=max(1, width // 2400))
            if distance < 500 and len(shifted_walls) >= 4:
                xs = [point[0] for point in shifted_walls]
                ys = [point[1] for point in shifted_walls]
                left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
                if right - left > width * .006 and bottom - top > height * .025:
                    for fraction in np.linspace(.18, .82, min(5, max(2, int(projected_width / (width * .025))))):
                        x = left + (right - left) * fraction
                        y = top + (bottom - top) * (.50 + rng.uniform(-.04, .04))
                        radius = min(7, max(2, int(projected_width / 48)))
                        draw.rectangle((x - radius * 1.3, y - radius,
                                        x + radius * 1.3, y + radius * 1.45),
                                       fill=(67, 77, 68, 75))
                        draw.line((x - radius * 1.6, y - radius * 1.2, x + radius * 1.4, y - radius * 1.2),
                                  fill=(239, 207, 157, 105), width=1)
    softened = _wrap_blur(overlay, max(.65, width / 6200))
    base.paste(softened.convert("RGB"), (0, 0), softened.getchannel("A"))
    granulation = pigment_field.point(lambda value: max(0, min(38, 151 - value)))
    granulation = ImageChops.multiply(softened.getchannel("A"), granulation)
    base.paste(Image.new("RGB", base.size, (105, 79, 66)), (0, 0), granulation)
    dry_lights = pigment_field.point(lambda value: max(0, min(30, value - 169)))
    dry_lights = ImageChops.multiply(softened.getchannel("A"), dry_lights)
    base.paste(Image.new("RGB", base.size, (237, 210, 171)), (0, 0), dry_lights)
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
        columns = geometry.columns[start:min(len(skyline), start + section + 2)]
        # A dark straight terrain line through the newly brushed tree crowns
        # would reinstate the GIS silhouette beneath them.
        if any(any(span.semantic == SemanticClass.FOREST and
                   abs(span.upper_angle_degrees - column.skyline_angle_degrees) < 1.5
                   for span in column.spans) for column in columns):
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
                   for edge in column.terrain_edges if edge.kind == "inner-ridge" and edge.semantic in _MOUNTAIN
                   and edge.semantic != SemanticClass.FOREST}
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
    # Shore offsets can jump between adjacent azimuth rays; blend the depth
    # plane laterally before glazing it, instead of exposing a vertical seam.
    depth_field = _wrap_blur(Image.fromarray(local_depth, "L"), max(5, width / 185))
    depth_amount = np.asarray(depth_field, dtype=np.float32)[..., None] / 255
    shallow = np.array((185, 217, 213), dtype=np.float32)
    deep = np.array((28, 94, 148), dtype=np.float32)
    depth_rgb = np.broadcast_to(shallow, (height, width, 3)) + (deep - shallow) * depth_amount
    depth = Image.fromarray(depth_rgb.clip(0, 255).astype(np.uint8), "RGB")
    reflection_alpha = ImageChops.multiply(water_mask, ImageOps.invert(depth_field).point(lambda value: value * 70 // 255))
    base.paste(Image.new("RGB", base.size, (192, 214, 210)), (0, 0), reflection_alpha)
    depth_alpha = ImageChops.multiply(water_mask, depth_field.point(lambda value: 25 + value * 155 // 255))
    base.paste(depth, (0, 0), depth_alpha)
    # Large, translucent water planes change hue with *local* visible depth;
    # they are not a uniform repeating wave texture across the whole lake.
    plane = Image.fromarray(np.rint(np.clip(
        (np.asarray(depth_field, dtype=np.float32) / 255 - .16) * 145, 0, 92,
    )).astype(np.uint8), "L")
    plane = ImageChops.multiply(water_mask, _wrap_blur(plane, max(2, width / 320)))
    base.paste(Image.new("RGB", base.size, (27, 89, 137)), (0, 0), plane)
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
        reach = min(bottom_x - shore + 1, max(4, round(height * .23)))
        for offset in range(reach):
            source_y = max(0, shore - 1 - offset // 2)
            target_y = shore + offset
            reflected[target_y, x] = scene[source_y, x]
            reflected_alpha[target_y, x] = round(84 * (1 - offset / max(1, reach)) ** 1.4)
    reflection_image = _wrap_blur(Image.fromarray(reflected, "RGB"), max(3, width / 510))
    reflection_mask = ImageChops.multiply(
        water_mask, _wrap_blur(Image.fromarray(reflected_alpha, "L"), max(3, width / 510)),
    )
    base.paste(reflection_image, (0, 0), reflection_mask)
    # One low-frequency, wrap-safe pigment field gives the water depth without
    # turning it into a repeated wave pattern.
    # Stretch irregular blooms horizontally so pigment reads as water planes,
    # not the same texture used on a hill.
    compressed = broad_pigment.resize((max(4, width // 5), height), Image.Resampling.BICUBIC)
    water_pigment = compressed.resize((width, height), Image.Resampling.BICUBIC)
    bloom = water_pigment.point(lambda value: 9 + value * 66 // 255)
    bloom = ImageChops.multiply(water_mask, bloom)
    base.paste(Image.new("RGB", base.size, (38, 107, 143)), (0, 0), bloom)

    rng = np.random.default_rng(seed)
    details = Image.new("L", base.size)
    draw = ImageDraw.Draw(details)
    _left, top, _right, bottom = water_mask.getbbox()
    water_height = max(1, bottom - top)
    for _ in range(72):
        fraction = float(rng.uniform(.08, .96))
        y = int(top + water_height * fraction)
        start = int(rng.uniform(0, width))
        length = int(rng.uniform(width * .012, width * (.035 + fraction * .055)))
        end = start + length
        ink = int(rng.uniform(21, 53))
        bend = float(rng.uniform(-.004, .004) * water_height)
        points = [(start, y), (start + length * .43, y + bend), (end, y + bend * .28)]
        draw.line(points, fill=ink, width=max(1, height // 620), joint="curve")
        if end > width:
            draw.line((0, y + bend * .28, end - width, y + bend * .28), fill=ink // 2, width=max(1, height // 620))
    clipped = ImageChops.multiply(_wrap_blur(details, .45), water_mask)
    base.paste(Image.new("RGB", base.size, (242, 237, 215)), (0, 0), clipped)
    # A few darker, discontinuous horizontal strokes create receding water
    # planes. Their length and contrast taper towards the shore/horizon.
    dark_details = Image.new("L", base.size)
    dark_draw = ImageDraw.Draw(dark_details)
    for _ in range(51):
        fraction = float(rng.uniform(.08, .92))
        y = int(top + water_height * fraction)
        start = int(rng.uniform(0, width))
        length = int(rng.uniform(width * .008, width * (.025 + fraction * .04)))
        bend = float(rng.uniform(-.003, .003) * water_height)
        dark_draw.line([(start, y), (start + length * .52, y + bend),
                        (min(width, start + length), y + bend * .2)], fill=int(rng.uniform(25, 62)),
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
    sky_top = {"spring": (153, 195, 219), "summer": (135, 185, 218), "autumn": (153, 181, 208), "winter": (161, 187, 215)}[season]
    base = _gradient((render_width, render_height), sky_top, (248, 228, 187))
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
    surfaces = _surface_masks(masks)
    terrain_silhouette = ImageOps.invert(_sky_mask(geometry, render_width, render_height))
    surfaces = {
        semantic: ImageChops.multiply(mask, terrain_silhouette)
        for semantic, mask in surfaces.items()
    }
    palette = SEASON_PALETTES[season]
    order = (SemanticClass.SNOW_OR_GLACIER, SemanticClass.ROCK, SemanticClass.UNKNOWN_TERRAIN,
             SemanticClass.OPEN_GRASSLAND, SemanticClass.FOREST, SemanticClass.SETTLEMENT, SemanticClass.BUILDING,
             SemanticClass.WATER, SemanticClass.RIVER)
    # Paint each geographic surface as one connected watercolor mass.  Depth
    # is glazed on afterwards; rendering the eight distance bins separately
    # was the source of conspicuous vertical bands in otherwise smooth hills.
    land = terrain_silhouette
    if land.getbbox():
        ground = _mix(palette[SemanticClass.UNKNOWN_TERRAIN], palette[SemanticClass.OPEN_GRASSLAND], .46)
        _paint_wash(base, land, ground, .94, pigments)
    for semantic in order:
        mask = surfaces.get(semantic)
        if mask is None:
            continue
        color = palette[semantic]
        if semantic in {SemanticClass.WATER, SemanticClass.RIVER}:
            color = _mix(color, (174, 208, 217), .12)
        elif semantic == SemanticClass.ROCK:
            color = _mix(color, (104, 137, 169), .34)
        elif semantic in {SemanticClass.UNKNOWN_TERRAIN, SemanticClass.OPEN_GRASSLAND}:
            color = _mix(color, (181, 164, 91), .10)
        opacity = 1.08 if semantic in {SemanticClass.WATER, SemanticClass.RIVER} else (
            1.16 if semantic == SemanticClass.BUILDING else 1.46 if semantic == SemanticClass.FOREST
            else 1.09 if semantic == SemanticClass.ROCK else .75
        )
        _paint_wash(base, mask, color, opacity, pigments)
        _paint_depth_atmosphere(base, semantic, mask, masks)
        if semantic != SemanticClass.FOREST:
            _pool_pigment(base, mask, color, .055 if semantic in {
                SemanticClass.WATER, SemanticClass.RIVER,
            } else .045)
    water = Image.new("L", base.size)
    if SemanticClass.WATER in surfaces:
        water = ImageChops.lighter(water, surfaces[SemanticClass.WATER])
    if SemanticClass.RIVER in surfaces:
        water = ImageChops.lighter(water, surfaces[SemanticClass.RIVER])
    # Detail painters consume a single visual layer per semantic so they never
    # retrace the implementation's distance-band edges.
    visual_masks = {(semantic, 0): mask for semantic, mask in surfaces.items()}
    _paint_landform_relief(base, masks)
    _paint_layered_valleys(base, masks)
    _paint_ambient_volume(base, geometry, visual_masks)
    _paint_mountain_facets(base, geometry, visual_masks, medium_pigment)
    _paint_surface_blooms(base, visual_masks, medium_pigment, artist_pigment)
    _paint_land_brushwork(base, visual_masks, seed + 47)
    _paint_perspective_sweeps(base, visual_masks, seed + 53)
    _paint_forest_details(base, visual_masks, canopy_field, artist_pigment, seed + 59, masks)
    forest_surface = surfaces.get(SemanticClass.FOREST)
    if forest_surface is not None:
        _paint_forest_relief(base, geometry, forest_surface)
    _paint_measured_slope_volume(base, geometry, surfaces)
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
    base = _heal_water_wrap_cusp(base, water)
    output = io.BytesIO()
    # Slightly higher quality also keeps the lossy encoder's boundary blocks
    # visually continuous after the circular edge has been matched above.
    base.save(output, format="WEBP", quality=85, method=1, exact=True)
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
