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
from scipy.ndimage import gaussian_filter1d, maximum_filter1d, minimum_filter

from benchly.panorama.models import BuildingProjectionSample, PanoramaColumn, PanoramaGeometry, SemanticClass, TERRAIN_DEPTH_LIMITS_METERS, VisibleSpan, terrain_depth_layer
from benchly.panorama.material import MATERIAL_SEMANTIC_IDS


SEASON_PALETTES = {
    "spring": {
        SemanticClass.WATER: (72, 157, 181), SemanticClass.RIVER: (65, 148, 175),
        SemanticClass.FOREST: (63, 121, 82), SemanticClass.OPEN_GRASSLAND: (150, 175, 101),
        SemanticClass.ROCK: (143, 137, 128), SemanticClass.SNOW_OR_GLACIER: (235, 239, 234),
        SemanticClass.SETTLEMENT: (174, 148, 119), SemanticClass.BUILDING: (181, 135, 100),
        SemanticClass.UNKNOWN_TERRAIN: (116, 142, 111),
        SemanticClass.PAVED_GROUND: (151, 150, 140),
        SemanticClass.SURFACED_GROUND: (157, 151, 138),
    },
    "summer": {
        SemanticClass.WATER: (63, 151, 179), SemanticClass.RIVER: (56, 143, 170),
        SemanticClass.FOREST: (53, 112, 75), SemanticClass.OPEN_GRASSLAND: (139, 164, 89),
        SemanticClass.ROCK: (139, 132, 122), SemanticClass.SNOW_OR_GLACIER: (233, 238, 233),
        SemanticClass.SETTLEMENT: (171, 145, 116), SemanticClass.BUILDING: (180, 132, 96),
        SemanticClass.UNKNOWN_TERRAIN: (106, 133, 103),
        SemanticClass.PAVED_GROUND: (149, 147, 137),
        SemanticClass.SURFACED_GROUND: (155, 148, 134),
    },
    "autumn": {
        SemanticClass.WATER: (70, 149, 174), SemanticClass.RIVER: (63, 140, 164),
        SemanticClass.FOREST: (75, 116, 73), SemanticClass.OPEN_GRASSLAND: (164, 154, 83),
        SemanticClass.ROCK: (145, 132, 117), SemanticClass.SNOW_OR_GLACIER: (235, 236, 228),
        SemanticClass.SETTLEMENT: (178, 139, 105), SemanticClass.BUILDING: (181, 123, 86),
        SemanticClass.UNKNOWN_TERRAIN: (126, 128, 88),
        SemanticClass.PAVED_GROUND: (154, 147, 135),
        SemanticClass.SURFACED_GROUND: (160, 146, 129),
    },
    "winter": {
        SemanticClass.WATER: (88, 149, 166), SemanticClass.RIVER: (82, 141, 158),
        SemanticClass.FOREST: (66, 99, 78), SemanticClass.OPEN_GRASSLAND: (147, 152, 118),
        SemanticClass.ROCK: (139, 137, 132), SemanticClass.SNOW_OR_GLACIER: (237, 240, 236),
        SemanticClass.SETTLEMENT: (164, 145, 124), SemanticClass.BUILDING: (172, 139, 111),
        SemanticClass.UNKNOWN_TERRAIN: (119, 132, 116),
        SemanticClass.PAVED_GROUND: (145, 148, 145),
        SemanticClass.SURFACED_GROUND: (152, 149, 142),
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


def _painting_seed(geometry: PanoramaGeometry, salt: str = "") -> int:
    """Keep a place's pigment stable across cache/metadata corrections.

    Cache identities still bind all geometry and software inputs. Their hashes
    must not shuffle the paper washes when only orientation/provenance changes.
    """
    return _seed(f"{geometry.latitude:.7f},{geometry.longitude:.7f}", salt)


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
def _brush_source(kind: str, width: int, height: int) -> Image.Image:
    name = "foliage-masses-pigment.png" if kind == "foliage" else f"{kind}-pigment.png"
    source = Image.open(Path(__file__).with_name("assets") / name).convert("L")
    texture = ImageOps.autocontrast(source, cutoff=0 if kind == "watercolor" else 1)
    texture = texture.resize((width, height), Image.Resampling.LANCZOS)
    if kind == "foliage":
        # The repeated foliage study is made periodic globally below. A narrow
        # averaged strip here would itself repeat as a visible canopy band.
        return texture
    return _close_seam(texture, max(12, width // (180 if kind == "watercolor" else 120)))


def _periodic_brush_component(values: np.ndarray) -> np.ndarray:
    """Remove the study's boundary drift without feathering a repeated strip.

    Independent NumPy implementation of the boundary Poisson formulation in
    Moisan, Periodic plus Smooth Image Decomposition (2011), equations 11/14–16:
    https://helios2.mi.parisdescartes.fr/~moisan/papers/2009-11r.pdf
    This operates on paint vocabulary only, never source terrain or coverage.
    """
    pixels = np.asarray(values, dtype=np.float64)
    height, width = pixels.shape
    boundary = np.zeros_like(pixels)
    vertical = pixels[-1] - pixels[0]
    horizontal = pixels[:, -1] - pixels[:, 0]
    boundary[0] += vertical
    boundary[-1] -= vertical
    boundary[:, 0] += horizontal
    boundary[:, -1] -= horizontal
    denominator = (2 * np.cos(2 * np.pi * np.arange(height)[:, None] / height)
                   + 2 * np.cos(2 * np.pi * np.arange(width // 2 + 1)[None, :] / width) - 4)
    denominator[0, 0] = 1
    spectrum = np.fft.rfft2(boundary) / denominator
    spectrum[0, 0] = 0  # Zero-mean correction preserves the study's mean wash.
    return pixels - np.fft.irfft2(spectrum, s=pixels.shape)


@lru_cache(maxsize=8)
def _periodic_foliage_source(width: int, height: int) -> np.ndarray:
    values = _periodic_brush_component(np.asarray(_brush_source("foliage", width, height)))
    return np.clip(values, 0, 255).astype(np.float32)


def _sample_periodic_brush(values: np.ndarray, sx: np.ndarray, sy: np.ndarray) -> np.ndarray:
    """Bilinearly sample pixel coordinates, including last-to-first neighbours."""
    height, width = values.shape
    x0, y0 = np.floor(sx).astype(np.int32), np.floor(sy).astype(np.int32)
    x1, y1 = (x0 + 1) % width, (y0 + 1) % height
    dx, dy = sx - x0, sy - y0
    # Even floating-point modulo can round a tiny negative address to the
    # exact image size. Wrap integer neighbours after retaining the fractions.
    x0, y0 = x0 % width, y0 % height
    return ((values[y0, x0] * (1 - dx) + values[y0, x1] * dx) * (1 - dy)
            + (values[y1, x0] * (1 - dx) + values[y1, x1] * dx) * dy)


@lru_cache(maxsize=8)
def _brush_study(kind: str, width: int, height: int, seed: int) -> Image.Image:
    """Sample brush vocabulary at a place-specific phase and quieter scale.

    The source study describes marks, not geographical features. Stretching
    one panel over every panorama made its largest motifs identical. Circular
    coordinates, unequal distortion and smaller marks retain its hand-painted
    character without moving any geographic or material boundary. The seed is
    independent of season, cache metadata and visibility ordering.
    """
    periodic = kind == "foliage"
    if periodic:
        values = _periodic_foliage_source(width, height)
    else:
        source = _brush_source(kind, width, height)
        source = _close_seam(source.transpose(Image.Transpose.TRANSPOSE),
                             max(4, height // 40)).transpose(Image.Transpose.TRANSPOSE)
        values = np.asarray(source, dtype=np.float32)
    # Evaluate each one-dimensional oscillation once, then broadcast the
    # coordinates. This preserves float32 samples without repeating every
    # trigonometric operation across the entire raster.
    x = np.arange(width, dtype=np.float32)[None, :]
    y = np.arange(height, dtype=np.float32)[:, None]
    u, v = x / max(1, width - 1), y / max(1, height - 1)
    phase = (seed % 100003) / 100003 * math.tau
    phase_y = ((seed // 100003) % 100003) / 100003
    # Canopy loads need a smaller angular scale than rock planes and broad
    # paper washes; large unbroken pigment patches looked like peeling paint.
    cycles = 9 if kind == "foliage" else 3
    sx = ((cycles*u + phase/math.tau + .08*np.sin(math.tau*3*u + phase)
           + .09*np.sin(math.tau*v + phase)) % 1) * (width if periodic else width - 1)
    sy = ((cycles*v + phase_y + .09*np.cos(math.tau*u + phase)
           + .06*np.sin(math.tau*2*v + phase)) % 1) * (height if periodic else height - 1)
    if periodic:
        sampled = _sample_periodic_brush(values, sx, sy)
    else:
        x0, y0 = np.floor(sx).astype(np.int32), np.floor(sy).astype(np.int32)
        x1, y1 = np.minimum(width-1, x0+1), np.minimum(height-1, y0+1)
        dx, dy = sx-x0, sy-y0
        sampled = ((values[y0,x0]*(1-dx) + values[y0,x1]*dx)*(1-dy)
                   + (values[y1,x0]*(1-dx) + values[y1,x1]*dx)*dy)
    field = _close_seam(Image.fromarray(np.rint(sampled).clip(0,255).astype(np.uint8)),
                         max(2, width // 360))
    return Image.blend(Image.new("L", field.size, 128), field,
                       .53 if kind == "watercolor" else .67)


def _artist_pigment(width: int, height: int, seed: int = 0) -> Image.Image:
    return _brush_study("watercolor", width, height, seed)


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
    skyline = _painted_skyline(geometry, width, height)
    for left in range(width):
        index = min(column_count - 1, math.floor((left + .5) * column_count / width))
        column = geometry.columns[index]
        for span in column.spans:
            if span.semantic == SemanticClass.BUILDING or span.semantic not in SEASON_PALETTES["summer"]:
                continue
            top = max(0, min(height, round((maximum_angle - span.upper_angle_degrees) * angle_scale)))
            if abs(span.upper_angle_degrees - column.skyline_angle_degrees) < .08:
                top = max(0, min(height, round(float(skyline[left]))))
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
    organic = _periodic_pigment(width, height, _painting_seed(geometry, "paint-edges"), (113, 47, 23))
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
        # Depth intervals are disjoint before their wet edge is filtered.
        # Their continuous coverages therefore add: taking the maximum of
        # two half-covered rims left a dark/transparent seam *inside* one lake.
        merged[semantic] = mask if current is None else ImageChops.add(current, mask)
    # Source classification now retains the measured material transitions.
    # Do not bridge clearings or fade narrow water/snow sectors: their angular
    # width says nothing about whether the surveyed surface is genuine.
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
        elif semantic in {SemanticClass.PAVED_GROUND, SemanticClass.SURFACED_GROUND}:
            # Retain narrow surveyed routes and straight kerbs, with only a
            # restrained wet edge. No generic width or paving pattern is added.
            radius = max(.65, width / 1800)
            amount = .35
        else:
            radius = max(2.5, width / 220)
            amount = .82
        smooth = _wrap_blur(mask, radius)
        # Image.blend keeps solid interiors but replaces square contour turns
        # with translucent wet edges instead of merely painting blur outside.
        merged[semantic] = Image.blend(mask, smooth, amount)
    return merged


def _continuous_depth_haze(geometry: PanoramaGeometry, width: int, height: int) -> Image.Image:
    """Aerial perspective from actual distances, with no quantized range bands."""
    values = np.zeros((height, width), dtype=np.float32)
    coverage = np.zeros_like(values)
    for x in range(width):
        column = geometry.columns[min(len(geometry.columns) - 1, int((x + .5) * len(geometry.columns) / width))]
        for span in column.spans:
            top = max(0, min(height, _angle_y(span.upper_angle_degrees, geometry, height)))
            bottom = max(0, min(height, _angle_y(span.lower_angle_degrees, geometry, height)))
            if bottom > top:
                # Deliberate aerial perspective is also a compositional cue:
                # distant categorical patches must not compete with near brush
                # masses. Keep metres continuous, but quiet the several-km
                # hills before their narrow mapped sectors read as tonal bars.
                values[top:bottom, x] = .72 * (1 - math.exp(-span.distance_meters / 5500))
                coverage[top:bottom, x] = 1
    # Normalised filtering avoids dragging sky's zero distance into the ridge.
    # Only a brush-width transition is shared across adjacent measured spans.
    from scipy.ndimage import gaussian_filter
    sigma = (1.5, max(.6, width / 360 * .18))
    weights = gaussian_filter(coverage, sigma=sigma, mode=("nearest", "wrap"))
    values = gaussian_filter(values, sigma=sigma, mode=("nearest", "wrap"))
    values = np.divide(values, weights, out=np.zeros_like(values), where=weights > .001)
    return Image.fromarray(np.rint(values * 255).clip(0, 255).astype(np.uint8), "L")


def _paint_depth_atmosphere(base: Image.Image, semantic: SemanticClass, surface: Image.Image,
                            depth_haze: Image.Image) -> None:
    """Keep near and far masses distinct before laying on material marks."""
    haze = ImageChops.multiply(surface, depth_haze)
    target = (195, 211, 222) if semantic in _MOUNTAIN else (209, 221, 221)
    base.paste(Image.new("RGB", base.size, target), (0, 0), haze)
    if semantic in _MOUNTAIN:
        near = depth_haze.point(lambda value: max(0, round(52 * (1 - value / 32))))
        near = ImageChops.multiply(surface, near)
        tint = (67, 92, 67) if semantic == SemanticClass.FOREST else (124, 105, 83)
        base.paste(Image.new("RGB", base.size, tint), (0, 0), near)


def _paint_distant_atmosphere(base: Image.Image, surfaces: dict[SemanticClass, Image.Image],
                               depth_haze: Image.Image, season: str) -> None:
    """Quiet distant marks after their detail passes, retaining near accents.

    The early aerial wash was repeatedly repainted by later material texture.
    This final transparent glaze keeps that texture subordinate in the distance.
    It changes colour, never geographic coverage or categorical material IDs.
    """
    land = Image.new("L", base.size)
    for semantic in _MOUNTAIN - {SemanticClass.SNOW_OR_GLACIER}:
        mask = surfaces.get(semantic)
        if mask is not None:
            # Adjacent filtered coverages add; maximum would create a lighter
            # glaze at internal class boundaries and expose another seam.
            land = ImageChops.add(land, mask)
    distance = np.asarray(depth_haze, dtype=np.float32) / 255
    amount = np.clip((distance - .18) / .5, 0, 1) * .58
    alpha = ImageChops.multiply(land, Image.fromarray(np.rint(amount * 255).astype(np.uint8), "L"))
    color = {"spring": (193,207,196), "summer": (190,207,207),
             "autumn": (198,205,194), "winter": (190,203,214)}[season]
    base.paste(Image.new("RGB", base.size, color), (0, 0), alpha)


def _gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    y = np.linspace(0, 1, height, dtype=np.float32)[:, None, None]
    first, second = np.array(top, dtype=np.float32), np.array(bottom, dtype=np.float32)
    rgb = np.broadcast_to(first + (second - first) * y, (height, width, 3)).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def _paint_wash(base: Image.Image, mask: Image.Image, color: tuple[int, int, int], opacity: float,
                pigments: tuple[Image.Image, ...], *, displace: bool = True) -> None:
    if not mask.getbbox():
        return
    # Three imperfect registrations mimic separate hand-laid washes. The pale
    # final pass leaves breathing paper rather than producing a digital fill.
    shifts = ((-3, 2), (2, -1), (0, 0)) if displace else ((0, 0),) * 3
    for pass_index, shift in enumerate(shifts):
        if pass_index == 0:
            tint = _mix(color, (45, 61, 56), .18)
        elif pass_index == 1:
            tint = _mix(color, (250, 239, 213), .12)
        else:
            tint = color
        layer = Image.new("RGB", base.size, tint)
        pigment = pigments[min(pass_index, len(pigments) - 1)]
        alpha = ImageChops.multiply(mask, pigment)
        if shift != (0, 0):
            alpha = ImageChops.offset(alpha, shift[0], shift[1])
        factor = opacity * ((.53, .51, .39)[pass_index])
        alpha = alpha.point(lambda value, factor=factor: round(value * factor))
        base.paste(layer, (0, 0), alpha)


def _painted_skyline(geometry: PanoramaGeometry, width: int, height: int) -> np.ndarray:
    """Shared angular contour for paint and coverage, independent of raster size.

    Interpolate measured natural angles before rasterisation. Keep architectural
    discontinuities exact: rounding every angle to a pixel, then blurring only
    the painting, left a staircase in the separately rendered material mask.
    This sub-degree brush edge cannot repair coarse source terrain; that needs
    resampling in the geographic pipeline, not an invented landscape contour.
    """
    columns = geometry.columns
    count = len(columns)
    positions = (np.arange(width) + .5) * count / width
    nearest = np.minimum(count - 1, positions.astype(int))
    angles = np.array([column.skyline_angle_degrees for column in columns], dtype=np.float64)
    continuous = np.interp(positions, np.arange(count), angles, period=count)
    smooth = gaussian_filter1d(continuous, max(.15, width / 360 * .3), mode="wrap")
    building = np.array([
        any(span.semantic == SemanticClass.BUILDING
            and abs(span.upper_angle_degrees - column.skyline_angle_degrees) < .08
            for span in column.spans) for column in columns
    ], dtype=bool)
    # Never let a tall building pull a neighbouring natural horizon upward.
    protected = maximum_filter1d(building.astype(np.uint8), size=3, mode="wrap")[nearest] > 0
    contour = np.where(protected, angles[nearest], smooth)
    maximum = geometry.config.maximum_elevation_angle
    scale = height / (maximum - geometry.config.minimum_elevation_angle)
    return (maximum - contour) * scale


def _sky_mask(geometry: PanoramaGeometry, width: int, height: int) -> Image.Image:
    mask = Image.new("L", (width, height))
    skyline = [(x, float(y)) for x, y in enumerate(_painted_skyline(geometry, width, height))]
    ImageDraw.Draw(mask).polygon([(0, 0), (width, 0), *reversed(skyline)], fill=255)
    # A skyline describes the upper envelope, not every occupied angle below
    # it. Preserve explicit gaps between visible surfaces: an elevated roof
    # must not acquire a green wall from the broad ground underwash. Use the
    # same source-column registration as the discrete material/coverage field.
    gaps: dict[int, list[tuple[float, float]]] = {}
    for index, column in enumerate(geometry.columns):
        spans = sorted(column.spans, key=lambda span: span.lower_angle_degrees)
        if not spans:
            continue
        upper = spans[0].upper_angle_degrees
        for span in spans[1:]:
            if span.lower_angle_degrees > upper + 1e-5:
                gaps.setdefault(index, []).append((upper, span.lower_angle_degrees))
            upper = max(upper, span.upper_angle_degrees)
    if gaps:
        draw = ImageDraw.Draw(mask)
        count = len(geometry.columns)
        maximum = geometry.config.maximum_elevation_angle
        angle_scale = height / (maximum - geometry.config.minimum_elevation_angle)
        for x in range(width):
            index = min(count - 1, int((x + .5) * count / width))
            coverage: dict[int, float] = {}
            for lower, upper in gaps.get(index, ()):
                top = max(0.0, (maximum - upper) * angle_scale)
                bottom = min(float(height), (maximum - lower) * angle_scale)
                # Match continuous material coverage. Rounding both limits
                # can turn a microscopic source gap into an opaque pinhole.
                for y in range(math.floor(top), math.ceil(bottom)):
                    overlap = max(0.0, min(bottom, y + 1) - max(top, y))
                    coverage[y] = coverage.get(y, 0.0) + overlap
            for y, amount in coverage.items():
                value = max(mask.getpixel((x, y)), round(min(1.0, amount) * 255))
                draw.point((x, y), fill=value)
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
    rng = np.random.default_rng(_painting_seed(geometry, "sky-brush"))
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
    rng = np.random.default_rng(_painting_seed(geometry, "relief-planes"))
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
    # Measured ground planes can explain their own turns. Keep the stronger
    # profile-derived wash on canopy and on older capsules without normals.
    measured_ground = any(
        span.surface_normal is not None and span.semantic in _MOUNTAIN - {SemanticClass.FOREST}
        for column in geometry.columns for span in column.spans
    )
    before = base.copy() if measured_ground else None
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
    if before is not None:
        ground = Image.new("L", base.size)
        for (semantic, _layer), mask in masks.items():
            if semantic in _MOUNTAIN - {SemanticClass.FOREST}:
                ground = ImageChops.lighter(ground, mask)
        base.paste(Image.blend(before, base, .45), (0, 0), ground)


def _fixed_slope_pigment_field(geometry: PanoramaGeometry, width: int, height: int) -> np.ndarray:
    """Smooth measured orientation into a neutral, two-sided studio wash.

    The fixed east/north direction models painted planes consistently around
    the circle. It is an artistic wash, separate from the actual solar LUT.
    Older capsules retain the conservative radial-slope approximation.
    """
    from scipy.ndimage import gaussian_filter

    volume_semantics = _MOUNTAIN - {SemanticClass.FOREST}
    values = np.zeros((height, width), dtype=np.float32)
    coverage = np.zeros_like(values)
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
            if span.surface_normal is not None:
                east, north, _up = span.surface_normal
                tone = 65 * (-.6 * east + .8 * north)
                reach = bottom
            else:
                edge = min(column.terrain_edges, key=lambda item: abs(item.distance_meters - span.distance_meters), default=None)
                slope = edge.slope_degrees if edge and edge.slope_degrees is not None else 0
                tone = max(-65, min(65, slope)) * 1.55
                reach = min(bottom, top + max(8, round((bottom - top) * .54)))
            values[top:reach, x] = tone
            coverage[top:reach, x] = 1
    sigma = (max(2, height / 170), max(4, width / 330))
    weights = gaussian_filter(coverage, sigma=sigma, mode=("nearest", "wrap"))
    values = gaussian_filter(values, sigma=sigma, mode=("nearest", "wrap"))
    # Sky, water and canopy have no ground normal here. Normalised filtering
    # prevents their zero values from inserting a false plane at the boundary.
    return 128 + np.divide(values, weights, out=np.zeros_like(values), where=weights > .001)


def _ground_orientation_brush(values: np.ndarray, coverage: np.ndarray,
                              distance: np.ndarray, elevation_range: float) -> np.ndarray:
    """Resolve close planes with a range-aware, circular studio brush.

    A 0.75 m apparent footprint softens near DEM facets. The existing angular
    minimum is retained at distance: a smaller minimum exposed vertical blocks
    in the Platta pilot. Filter the continuous scale coordinate too, so a source
    span boundary cannot abruptly select a different brush. Semantic coverage
    is only used for normalisation here; categorical material IDs are untouched.
    """
    from scipy.ndimage import gaussian_filter, uniform_filter

    height, width = values.shape
    minimum = max(4, width / 330)
    levels = [minimum * 3 ** index for index in range(3)]
    sigma = np.clip(.75 / np.maximum(1, distance) * width / (2 * math.pi), minimum, levels[-1])
    position = np.log(sigma / minimum) / math.log(3)
    smooth_sigma = (max(2, height / 340), minimum * .5)
    weight = gaussian_filter(coverage, sigma=smooth_sigma, mode=("nearest", "wrap"))
    position = np.divide(
        gaussian_filter(position * coverage, sigma=smooth_sigma, mode=("nearest", "wrap")),
        weight, out=np.zeros_like(position), where=weight > .001,
    )
    result = np.zeros_like(values)
    vertical_factor = height * 360 / (width * elevation_range)
    for index, scale in enumerate(levels):
        kernel = (max(3, round(2 * scale * vertical_factor * .7)) | 1, round(2 * scale) | 1)
        value, weight = values.copy(), coverage.copy()
        for _ in range(3):
            value = uniform_filter(value, size=kernel, mode=("nearest", "wrap"))
            weight = uniform_filter(weight, size=kernel, mode=("nearest", "wrap"))
        smoothed = np.divide(value, weight, out=np.zeros_like(value), where=weight > .001)
        result += smoothed * np.clip(1 - np.abs(position - index), 0, 1)
    return 128 + result * 1.35


def _slope_pigment_field(geometry: PanoramaGeometry, width: int, height: int) -> np.ndarray:
    """Paint measured ground turns; retain the conservative legacy wash."""
    semantics = _MOUNTAIN - {SemanticClass.FOREST}
    if not any(span.surface_normal is not None and span.semantic in semantics
               for column in geometry.columns for span in column.spans):
        return _fixed_slope_pigment_field(geometry, width, height)
    values = np.zeros((height, width), dtype=np.float32)
    coverage = np.zeros_like(values)
    distance = np.ones_like(values)
    legacy = None
    count = len(geometry.columns)
    for x in range(width):
        column = geometry.columns[min(count - 1, int((x + .5) * count / width))]
        for span in column.spans:
            if span.semantic not in semantics:
                continue
            top = max(0, min(height, _angle_y(span.upper_angle_degrees, geometry, height)))
            bottom = max(0, min(height, _angle_y(span.lower_angle_degrees, geometry, height)))
            if bottom <= top:
                continue
            if span.surface_normal is None:
                if legacy is None:
                    legacy = _fixed_slope_pigment_field(geometry, width, height) - 128
                values[top:bottom, x] = legacy[top:bottom, x]
            else:
                east, north, _up = span.surface_normal
                values[top:bottom, x] = 65 * (-.6 * east + .8 * north)
            coverage[top:bottom, x] = 1
            distance[top:bottom, x] = max(1, span.distance_meters)
    return _ground_orientation_brush(values, coverage, distance,
                                     geometry.config.maximum_elevation_angle - geometry.config.minimum_elevation_angle)


def _paint_measured_slope_volume(base: Image.Image, geometry: PanoramaGeometry,
                                 surfaces: dict[SemanticClass, Image.Image]) -> None:
    """Glaze broad cool/warm ground planes without shading canopy as bare DEM."""
    terrain = Image.new("L", base.size)
    for semantic in _MOUNTAIN - {SemanticClass.FOREST}:
        mask = surfaces.get(semantic)
        if mask is not None:
            terrain = ImageChops.lighter(terrain, mask)
    if not terrain.getbbox():
        return
    field = _slope_pigment_field(geometry, *base.size)
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


def _paint_land_brushwork(base: Image.Image, geometry: PanoramaGeometry, masks, seed: int) -> None:
    """Sparse ground gestures follow measured orientation and continuous range.

    These are paint marks inside factual coverage, not field boundaries. The
    former two uniform hatch passes obscured recession and also marked canopy.
    A constant-range tangent on the measured ground plane provides direction;
    distance controls its scale and ink instead of the vertical screen position.
    """
    width, height = base.size
    rng = np.random.default_rng(seed)
    elevation_range = geometry.config.maximum_elevation_angle - geometry.config.minimum_elevation_angle
    vertical_factor = height * 360 / (width * elevation_range)
    recipes = (
        (SemanticClass.OPEN_GRASSLAND, (80, 104, 69), 150),
        (SemanticClass.UNKNOWN_TERRAIN, (89, 103, 79), 110),
        (SemanticClass.SETTLEMENT, (119, 97, 80), 55),
    )
    for semantic, color, count in recipes:
        surface = Image.new("L", base.size)
        for layer in _LAYERS:
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
            if surface.getpixel((x, y)) < 180:
                continue
            column = geometry.columns[min(len(geometry.columns) - 1,
                                          int((x + .5) * len(geometry.columns) / width))]
            altitude = geometry.config.maximum_elevation_angle - y / height * elevation_range
            span = next((item for item in column.spans if item.semantic == semantic
                         and item.lower_angle_degrees <= altitude <= item.upper_angle_degrees), None)
            if span is None or span.distance_meters > 4000:
                continue
            near = math.exp(-span.distance_meters / 1500)
            length = width * rng.uniform(.004, .022) * math.sqrt(near)
            slant = 0.0  # legacy capsules without a measured normal stay quiet
            if span.surface_normal is not None:
                east, north, up = span.surface_normal
                azimuth = math.radians(column.azimuth_degrees)
                # d(elevation)/d(azimuth) includes the angular projection's
                # cos²(elevation), not just the plane's world-space gradient.
                slant = ((east * math.cos(azimuth) - north * math.sin(azimuth))
                         / max(.15, up) * math.cos(math.radians(altitude)) ** 2 * vertical_factor)
            dy = max(-.7, min(.7, slant)) * length
            ink = round(rng.uniform(16, 48) * (.25 + .75 * near))
            thickness = max(1, round(width / 720 * (.4 + .6 * near)))
            bend = rng.uniform(-1.5, 1.5)
            # Reuse the entire stroke, including bend, at every wrap. Drawing
            # independently jittered copies makes a discontinuity at north.
            for wrap in (-width, 0, width):
                draw.line([(x + wrap, y), (x + wrap + length * .48, y + dy * .52 + bend),
                           (x + wrap + length, y + dy)], fill=ink, width=thickness, joint="curve")
        strokes = ImageChops.multiply(surface, _wrap_blur(strokes, .85))
        base.paste(Image.new("RGB", base.size, color), (0, 0), strokes)


def _ground_plane_range(distance: float, upper: float, normal: tuple[float, float, float],
                        azimuth: float, altitude: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Intersect viewing rays with the tangent plane at a span's sampled top.

    Visible terrain spans extend to the new sample's elevation angle. Anchoring
    at their angular midpoint instead would slide the pigment between samples.
    Angles here are radians and distance is horizontal, as in the capsule.
    """
    east, north, up = normal
    radial = east * np.sin(azimuth) + north * np.cos(azimuth)
    constant = distance * (radial + up * np.tan(upper))
    denominator = radial + up * np.tan(altitude)
    with np.errstate(divide="ignore", invalid="ignore"):
        radius = constant / denominator
        derivative = -constant * up / np.cos(altitude) ** 2 / denominator ** 2
    return radius, derivative


def _ground_pigment_noise(x: np.ndarray, y: np.ndarray, seed: int) -> np.ndarray:
    """Continuous place-seeded pigment in surface metres, not mapped objects."""
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

    def corner(dx, dy):
        value = np.sin((ix + dx) * 127.1 + (iy + dy) * 311.7 + seed * .017) * 43758.5453123
        return value - np.floor(value)

    return ((corner(0, 0) * (1 - fx) + corner(1, 0) * fx) * (1 - fy)
            + (corner(0, 1) * (1 - fx) + corner(1, 1) * fx) * fy) * 2 - 1


def _projected_ground_coordinates(geometry: PanoramaGeometry, width: int, height: int
                                  ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Local tangent coordinates for paint marks, preserving factual coverage.

    A tangent is approximate on curved terrain. Reject unstable intersections
    rather than extend a plane arbitrarily or imply a new geographic feature.
    Forest and rock keep their separate brush vocabulary.
    """
    east = np.zeros((height, width), np.float32)
    north, coverage, footprint = np.zeros_like(east), np.zeros_like(east), np.ones_like(east)
    elevation_range = geometry.config.maximum_elevation_angle - geometry.config.minimum_elevation_angle
    heights = np.deg2rad(geometry.config.maximum_elevation_angle
                        - (np.arange(height) + .5) / height * elevation_range)
    angle_step = math.radians(elevation_range / height)
    semantics = {SemanticClass.OPEN_GRASSLAND, SemanticClass.UNKNOWN_TERRAIN, SemanticClass.SETTLEMENT}
    for x in range(width):
        column = geometry.columns[min(len(geometry.columns) - 1,
                                      int((x + .5) * len(geometry.columns) / width))]
        azimuth = math.radians((x + .5) * 360 / width)
        for span in column.spans:
            if (span.semantic not in semantics or span.surface_normal is None
                    or span.surface_normal[2] < .15 or span.distance_meters > 2000):
                continue
            top = max(0, min(height, _angle_y(span.upper_angle_degrees, geometry, height)))
            bottom = max(0, min(height, _angle_y(span.lower_angle_degrees, geometry, height)))
            if bottom <= top:
                continue
            radius, derivative = _ground_plane_range(
                span.distance_meters, math.radians(span.upper_angle_degrees),
                span.surface_normal, azimuth, heights[top:bottom],
            )
            valid = (np.isfinite(radius) & np.isfinite(derivative)
                     & (radius >= max(.3, span.distance_meters * .25))
                     & (radius <= span.distance_meters * 4))
            radius, derivative = np.where(valid, radius, 0), np.where(valid, derivative, 0)
            east[top:bottom, x] = radius * math.sin(azimuth)
            north[top:bottom, x] = radius * math.cos(azimuth)
            coverage[top:bottom, x] = valid
            footprint[top:bottom, x] = np.maximum(radius * 2 * math.pi / width,
                                                  np.abs(derivative) * angle_step)
    # Include coordinate jumps between approximate source planes, not only
    # each plane's analytic derivative. Otherwise fine pigment can alias there.
    jump = np.zeros_like(footprint)
    for axis in (0, 1):
        for direction in (-1, 1):
            e, n = np.roll(east, direction, axis), np.roll(north, direction, axis)
            valid = coverage * np.roll(coverage, direction, axis)
            if axis == 0:
                valid[0 if direction == 1 else -1] = 0
            jump = np.maximum(jump, np.hypot(e - east, n - north) * valid)
    return east, north, coverage, np.maximum(footprint, jump)


def _paint_ground_brushwork(base: Image.Image, geometry: PanoramaGeometry, masks, seed: int) -> None:
    """Let restrained pigment recede on measured ground instead of the screen.

    These marks assert neither grass blades nor paths, paving or field borders.
    Older capsules without eligible normals retain their previous gestures.
    """
    semantics = {SemanticClass.OPEN_GRASSLAND, SemanticClass.UNKNOWN_TERRAIN, SemanticClass.SETTLEMENT}
    if not any(span.semantic in semantics and span.surface_normal is not None
               for column in geometry.columns for span in column.spans):
        _paint_land_brushwork(base, geometry, masks, seed)
        return
    east, north, coverage, footprint = _projected_ground_coordinates(geometry, *base.size)
    field = np.zeros_like(east)
    for scale, weight in ((1.2, .5), (.3, .35), (.075, .15)):
        field += (_ground_pigment_noise(east / scale, north / scale, int(seed % 10007))
                  * weight * np.clip(scale / (3 * np.maximum(.001, footprint)), 0, 1))
    allowed = Image.new("L", base.size)
    for (semantic, _layer), mask in masks.items():
        if semantic in semantics:
            allowed = ImageChops.lighter(allowed, mask)
    for sign, color in ((-1, (85, 99, 72)), (1, (218, 203, 158))):
        alpha = Image.fromarray(np.rint(np.clip(sign * field, 0, 1) * coverage * 75).astype(np.uint8), "L")
        base.paste(Image.new("RGB", base.size, color), (0, 0),
                   ImageChops.multiply(allowed, _wrap_blur(alpha, .65)))


def _foliage_pigment(width: int, height: int, seed: int = 0) -> Image.Image:
    """Brush vocabulary, not asserted tree positions or geographic features."""
    return _brush_study("foliage", width, height, seed)


def _paint_forest_details(base: Image.Image, masks,
                          depth_haze: Image.Image, brush_seed: int = 0) -> None:
    """Glaze connected foliage brush shapes inside the measured forest only.

    The painted material study supplies lost-and-found edges and unequal groups;
    no crown is inserted outside geographic coverage. Its luminance modulates
    existing seasonal colours rather than replacing the scene with a green tile.
    Continuous measured distance quietens the marks in the far woodland.
    """
    forest = Image.new("L", base.size)
    for (semantic, _layer), mask in masks.items():
        if semantic == SemanticClass.FOREST:
            forest = ImageChops.lighter(forest, mask)
    if not forest.getbbox():
        return
    field = np.asarray(_foliage_pigment(*base.size, brush_seed), dtype=np.float32)
    distance = np.asarray(depth_haze, dtype=np.float32) / 255
    nearness = np.clip(1 - distance / .56, .08, 1)
    coverage = np.asarray(forest, dtype=np.float32) / 255
    # Shape contrast replaces uniformly distributed ellipse stamps. A broad
    # soft glaze supports a smaller number of decisive broken brush edges.
    # Broad canopy loads remain subordinate to the measured turning planes.
    # A full-strength brush study reads as a printed pattern on the hillside.
    dark = np.clip((139 - field) * 1.05, 0, 132) * (.12 + .88 * nearness) * coverage * .55
    light = np.clip((field - 116) * .83, 0, 102) * (.18 + .82 * nearness) * coverage * .55
    shadow = Image.fromarray(np.rint(dark).astype(np.uint8), "L")
    lights = Image.fromarray(np.rint(light).astype(np.uint8), "L")
    base.paste(Image.new("RGB", base.size, (31, 63, 54)), (0, 0), shadow)
    base.paste(Image.new("RGB", base.size, (175, 180, 119)), (0, 0), lights)


def _rock_pigment(width: int, height: int, seed: int = 0) -> Image.Image:
    # Measured exposed planes provide form; the scanned vocabulary contributes
    # subordinate variation rather than a high-contrast fracture stencil.
    return Image.blend(Image.new("L", (width, height), 128),
                       _brush_study("rock", width, height, seed), .65)


def _paint_rock_details(base: Image.Image, masks, depth_haze: Image.Image, brush_seed: int = 0) -> None:
    """Directional brush planes remain entirely inside mapped exposed rock."""
    rock = Image.new("L", base.size)
    for (semantic, _layer), mask in masks.items():
        if semantic == SemanticClass.ROCK:
            rock = ImageChops.lighter(rock, mask)
    if not rock.getbbox():
        return
    field = np.asarray(_rock_pigment(*base.size, brush_seed), dtype=np.float32)
    nearness = np.clip(1 - np.asarray(depth_haze, dtype=np.float32) / 255 / .56, .08, 1)
    strength = (.12 + .88 * nearness) * np.asarray(rock, dtype=np.float32) / 255
    shade = Image.fromarray(np.rint(np.clip((139 - field) * 1.05, 0, 135) * strength).astype(np.uint8), "L")
    light = Image.fromarray(np.rint(np.clip((field - 110) * 1.15, 0, 150) * strength).astype(np.uint8), "L")
    base.paste(Image.new("RGB", base.size, (72, 85, 103)), (0, 0), shade)
    base.paste(Image.new("RGB", base.size, (226, 220, 202)), (0, 0), light)


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
        drawable = []
        for run in runs:
            # Test the source support before splitting visible intervals into
            # narrow strips. A footprint merely touching one angular ray is
            # still degenerate; expanding it would invent a vertical post.
            support_width = (run[-1].azimuth_degrees - run[0].azimuth_degrees) / 360 * width
            if len(run) < 2 or support_width < max(1.5, width / 1_400):
                continue
            distance = float(np.median([sample.distance_meters for sample in run]))
            bearings = sorted({sample.azimuth_degrees for sample in run})
            if len(bearings) == len(run):
                drawable.append((run, distance))
                continue
            # An occluder can split the SAME facade into disjoint vertical
            # intervals at one heading. Joining those samples into a single
            # polygon crosses the occluded area and loses visible wall pieces.
            # Rasterise the measured intervals independently, retaining the
            # original angular bounds and the shared source-identity palette.
            step = float(np.median(np.diff(bearings)))
            for sample in run:
                drawable.append(([
                    sample.model_copy(update={"azimuth_degrees": max(bearings[0], sample.azimuth_degrees - step / 2)}),
                    sample.model_copy(update={"azimuth_degrees": min(bearings[-1], sample.azimuth_degrees + step / 2)}),
                ], distance))
        for run, distance in drawable:
            walls = [(sample.azimuth_degrees / 360 * width,
                      _angle_y(sample.upper_angle_degrees if sample.roof_intervals is not None else sample.eaves_angle_degrees, geometry, height)) for sample in run]
            walls.extend((sample.azimuth_degrees / 360 * width, _angle_y(sample.lower_angle_degrees, geometry, height)) for sample in reversed(run))
            roof = [(sample.azimuth_degrees / 360 * width, _angle_y(sample.upper_angle_degrees, geometry, height)) for sample in run]
            roof.extend((sample.azimuth_degrees / 360 * width, _angle_y(sample.eaves_angle_degrees, geometry, height)) for sample in reversed(run))
            yield building, run, walls, roof, distance


def _architecture_wash(overlay: Image.Image, broad: Image.Image,
                       pigment: Image.Image, brush: Image.Image | None = None) -> Image.Image:
    """Float warm and cool pigment through measured, opaque building planes.

    These are paint deposits, never holes/windows or changes to the footprint.
    In particular, lifting pigment reveals warm paper colour rather than the
    green terrain behind a nearby wall. Distant masses receive quieter washes.
    All fields are circular and shared across visibility runs of one building.
    """
    bounds = overlay.getbbox()
    if bounds is None:
        return overlay.copy()
    # Skip empty sky instead of allocating float fields for the entire sphere.
    # Cropping the shared fields retains their global angular registration.
    pixels = np.asarray(overlay.crop(bounds), dtype=np.float32).copy()
    wet = np.asarray(broad.crop(bounds), dtype=np.float32) / 255
    dry = np.asarray(pigment.crop(bounds), dtype=np.float32) / 255
    brush_values = np.asarray((brush if brush is not None else pigment).crop(bounds), dtype=np.float32) / 255
    # The broad wet field supplies connected washes; the actual pigment study
    # breaks their edges and reserves small dry-paper lights. Gaussian clouds
    # alone read as an airbrush laid over a flat model.
    wet = wet * .88 + brush_values * .12
    strength = np.clip((pixels[..., 3] - 80) / 175, .15, 1)
    lift = (np.clip((wet - .36) * .85, 0, .36) + np.clip((brush_values - .5) * .7, 0, .12)) * strength
    pool = np.clip((.57 - wet) * .65, 0, .23) * strength
    broken = (np.clip((.49 - dry) * .12, 0, .12) + np.clip((.5 - brush_values) * .2, 0, .14)) * strength
    rgb = pixels[..., :3]
    rgb += (np.array((248, 233, 204)) - rgb) * lift[..., None]
    rgb += (np.array((101, 108, 125)) - rgb) * pool[..., None]
    rgb += (np.array((164, 104, 73)) - rgb) * broken[..., None]
    painted = overlay.copy()
    painted.paste(Image.fromarray(np.rint(pixels).clip(0, 255).astype(np.uint8), "RGBA"), bounds)
    return painted


def _soften_architecture(overlay: Image.Image, radius: float) -> Image.Image:
    # Straight-alpha RGBA blur mixes transparent black into the RGB channels;
    # pasting it through alpha then creates a dark double-multiplied outline.
    # Diffuse associated colour instead, preserving the pigment at wet edges.
    return _wrap_blur(overlay.convert("RGBa"), radius).convert("RGBA")


def _architecture_glaze_normals(faces: list[list[BuildingProjectionSample]]) -> list[float | None]:
    """Group paint across tiny notches without changing their measured geometry.

    A short return between parallel walls need not carry a separate full-height
    dark stripe. Major face changes retain their source orientation. These are
    wash groupings, never substitute normals for lighting or roof projection.
    """
    normals = [face[0].facade_normal_degrees for face in faces]
    for index in range(1, len(faces) - 1):
        first, last = faces[index][0], faces[index][-1]
        first_bearing, last_bearing = map(math.radians, (first.azimuth_degrees, last.azimuth_degrees))
        length = math.hypot(
            last.distance_meters * math.sin(last_bearing) - first.distance_meters * math.sin(first_bearing),
            last.distance_meters * math.cos(last_bearing) - first.distance_meters * math.cos(first_bearing),
        )
        previous, following = normals[index - 1], normals[index + 1]
        if (length < .75 and previous is not None and following is not None
                and abs((previous - following + 180) % 360 - 180) < 5):
            normals[index] = previous
    return normals


def _architecture_registration(geometry: PanoramaGeometry, width: int, height: int
                               ) -> tuple[np.ndarray, np.ndarray]:
    """Register loose paint edges consistently across colour, coverage and light.

    Source footprints and projection remain unchanged. This is a small, static
    brush registration in angular space, strongest on broad nearby walls. Its
    broad, slow gestures loosen long wall and roof edges. Small marks stay
    subordinate so openings do not ripple like a distorted stencil. Smooth the
    support over a broad angular margin: increasing a tightly masked field
    compresses corners instead of producing a painter's continuous stroke.
    Integer horizontal frequencies wrap at north. Seasons and sunlight must
    never move these edges independently of the material field.
    """
    from scipy.ndimage import gaussian_filter

    support = np.zeros((height, width), dtype=np.float32)
    count = len(geometry.columns)
    minimum = geometry.config.minimum_elevation_angle
    maximum = geometry.config.maximum_elevation_angle
    for x in range(width):
        column = geometry.columns[min(count - 1, int((x + .5) * count / width))]
        for span in column.spans:
            if span.semantic != SemanticClass.BUILDING:
                continue
            top = max(0, _angle_y(span.upper_angle_degrees, geometry, height))
            bottom = min(height, _angle_y(span.lower_angle_degrees, geometry, height))
            angular_height = span.upper_angle_degrees - span.lower_angle_degrees
            load = min(1, angular_height / 6) * max(0, 1 - span.distance_meters / 1200)
            support[top:bottom, x] = np.maximum(support[top:bottom, x], load)
    support = gaussian_filter(support, sigma=(max(.6, height / 70), max(.6, width / 200)),
                              mode=("nearest", "wrap"))
    phase = (_painting_seed(geometry, "architecture-registration") % 65536) / 65536 * 2 * math.pi
    x = (np.arange(width, dtype=np.float32)[None, :] + .5) / width * 2 * math.pi
    y = np.radians(maximum - (np.arange(height, dtype=np.float32)[:, None] + .5) / height * (maximum - minimum))
    dx = (.82 * np.sin(7 * x + 7 * y + phase)
          + .15 * np.sin(29 * x - 31 * y + 1.7 * phase)
          + .03 * np.sin(89 * x + 139 * y + .4 * phase))
    dy = (.82 * np.sin(13 * x - 17 * y + 1.2 * phase)
          + .15 * np.sin(47 * x + 37 * y + .3 * phase)
          + .03 * np.sin(107 * x - 71 * y + 1.8 * phase))
    return (dx * support * 8 * width / 4096,
            dy * support * 8 * height / (maximum - minimum) * 360 / 4096)


def _register_architecture(pixels: np.ndarray, geometry: PanoramaGeometry,
                           *, material: bool = False) -> np.ndarray:
    """Sample continuous channels separately from categorical material IDs."""
    height, width = pixels.shape[:2]
    dx, dy = _architecture_registration(geometry, width, height)
    if not np.any(dx) and not np.any(dy):
        return pixels.copy()
    # float32 modulo can round a tiny negative coordinate to width itself.
    # Compute the wrapped address in float64 before converting to an index.
    x = (np.arange(width, dtype=np.float64)[None, :] + dx) % width
    y = np.clip(np.arange(height, dtype=np.float64)[:, None] + dy, 0, height - 1)
    x0, y0 = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    x1, y1 = (x0 + 1) % width, np.minimum(y0 + 1, height - 1)
    tx, ty = (x - x0).astype(np.float32)[..., None], (y - y0).astype(np.float32)[..., None]
    # float64 can also round sub-ulp negative coordinates to width.
    x0 %= width
    values = pixels[..., None] if pixels.ndim == 2 else pixels
    result = ((values[y0, x0] * (1 - tx) + values[y0, x1] * tx) * (1 - ty)
              + (values[y1, x0] * (1 - tx) + values[y1, x1] * tx) * ty)
    result = np.rint(result).clip(0, 255).astype(np.uint8)
    if material:
        nearest_x = np.floor(x + .5).astype(np.int32) % width
        nearest_y = np.minimum(np.floor(y + .5).astype(np.int32), height - 1)
        result[..., 1] = values[nearest_y, nearest_x, 1]
    return result[..., 0] if pixels.ndim == 2 else result


def _architecture_wall_masks(geometry: PanoramaGeometry, size: tuple[int, int],
                             object_ids: set[str]) -> dict[str, Image.Image]:
    """Reserve visible walls while excluding measured roof passages.

    Only requested solids allocate a wall raster. Other nearby roof intervals
    still clip the reserves, so a glaze cannot recolour an overlapping roof.
    These masks constrain pigment only; they never replace the material map.
    """
    width, height = size
    walls: dict[str, Image.Image] = {}
    roofs = Image.new("L", size)
    roof_draw = ImageDraw.Draw(roofs)
    for building, samples, wall, roof, distance in _building_runs(geometry, width, height):
        if distance >= 1400:
            continue
        if building.object_id in object_ids and building.object_id not in walls:
            walls[building.object_id] = Image.new("L", size)
        mask = walls.get(building.object_id)
        wall_draw = ImageDraw.Draw(mask) if mask is not None else None
        for horizontal in (-width, 0, width):
            if wall_draw is not None:
                wall_draw.polygon([(x + horizontal, y) for x, y in wall], fill=255)
            if all(sample.roof_intervals is None for sample in samples):
                roof_draw.polygon([(x + horizontal, y) for x, y in roof], fill=255)
                continue
            for index, sample in enumerate(samples):
                azimuth = sample.azimuth_degrees
                left = (samples[index - 1].azimuth_degrees + azimuth) / 2 if index else azimuth
                right = (azimuth + samples[index + 1].azimuth_degrees) / 2 if index + 1 < len(samples) else azimuth
                x0 = math.floor(left / 360 * width + horizontal)
                x1 = math.ceil(right / 360 * width + horizontal) - 1
                for lower, upper in sample.roof_intervals or ():
                    y0 = _angle_y(upper, geometry, height)
                    y1 = _angle_y(lower, geometry, height) - 1
                    if x1 >= x0 and y1 >= y0:
                        roof_draw.rectangle((x0, y0, x1, y1), fill=255)
    return {object_id: ImageChops.subtract(mask, roofs) for object_id, mask in walls.items()}


def _paint_architecture_planes(base: Image.Image, geometry: PanoramaGeometry,
                                pigment: Image.Image, brush: Image.Image | None = None,
                                strength: float = .55) -> None:
    """Lay broad translucent brush passages across the measured wall planes.

    Paint shares world tangent/height coordinates across polygon fragments.
    Rounded, grouped normals organise a wash, not solar lighting or geometry.
    Reading frozen RGB prevents overlapping sample polygons from glazing one
    boundary twice. The reserve/pool changes pigment only: no openings, ledges,
    physical shadows, opacity or source dimensions are introduced.
    """
    width, height = base.size
    scale = width / 4096
    groups: dict[tuple[str, int], list[float]] = {}
    patches = []
    for building, samples, _wall, _roof, distance in _building_runs(geometry, width, height):
        if distance > 1000 or max(s.upper_angle_degrees - s.lower_angle_degrees for s in samples) < 3:
            continue
        faces = []
        start = 0
        for cursor in range(1, len(samples) + 1):
            if cursor == len(samples) or (samples[cursor].facade_index, samples[cursor].facade_part_index) != (samples[start].facade_index, samples[start].facade_part_index):
                faces.append(samples[start:min(len(samples), cursor + 1)])
                start = cursor
        for face, glaze_normal in zip(faces, _architecture_glaze_normals(faces)):
            if len(face) < 2 or glaze_normal is None:
                continue
            normal = round(glaze_normal / 5) * 5 % 360
            key = (building.object_id, normal)
            tangent = [s.distance_meters * math.sin(math.radians(s.azimuth_degrees - normal)) for s in face]
            elevations = [s.distance_meters * math.tan(math.radians(angle)) for s in face
                          for angle in (s.lower_angle_degrees, s.upper_angle_degrees)]
            bounds = groups.setdefault(key, [min(tangent), max(tangent), min(elevations), max(elevations)])
            bounds[:] = [min(bounds[0], min(tangent)), max(bounds[1], max(tangent)),
                         min(bounds[2], min(elevations)), max(bounds[3], max(elevations))]
            patches.append((key, normal, face, distance))
    patches = [patch for patch in patches if groups[patch[0]][1] - groups[patch[0]][0] >= 3]
    if not patches or strength == 0:
        return
    wall_masks = _architecture_wall_masks(geometry, base.size, {key[0] for key, *_ in patches})
    source = np.asarray(base, dtype=np.float32)
    rgb = source.copy()
    dry = np.asarray(brush if brush is not None else pigment, dtype=np.float32) / 255
    maximum = geometry.config.maximum_elevation_angle
    minimum = geometry.config.minimum_elevation_angle
    for key, normal, face, distance in patches:
        phase = _seed(str(key), "source-plane-brush") % 65536 / 65536 * 2 * math.pi
        for horizontal in (-width, 0, width):
            xs = np.array([s.azimuth_degrees / 360 * width + horizontal for s in face])
            top = np.array([_angle_y(s.upper_angle_degrees, geometry, height) for s in face])
            bottom = np.array([_angle_y(s.lower_angle_degrees, geometry, height) for s in face])
            left = max(0, math.floor(float(xs.min())))
            right = min(width, math.floor(float(xs.max())) + 1)
            upper = max(0, int(top.min()))
            lower = min(height, int(bottom.max()) + 1)
            if right - left < 12 * scale or lower - upper < 18 * scale:
                continue
            box = (left, upper, right, lower)
            mask = Image.new("L", (right - left, lower - upper))
            points = list(zip(xs - left, top - upper)) + list(zip(xs[::-1] - left, bottom[::-1] - upper))
            ImageDraw.Draw(mask).polygon(points, fill=255)
            coverage = np.asarray(ImageChops.multiply(mask, wall_masks[key[0]].crop(box)), dtype=np.float32) / 255
            if not coverage.any():
                continue
            x = np.arange(left, right, dtype=np.float32) + .5
            y = (np.arange(upper, lower, dtype=np.float32) + .5)[:, None]
            distances = np.interp(x, xs, [s.distance_meters for s in face])
            tangent = distances * np.sin(np.radians((x - horizontal) / width * 360 - normal))
            u = (tangent - groups[key][0]) / (groups[key][1] - groups[key][0])
            elevation = distances[None, :] * np.tan(np.radians(maximum - y / height * (maximum - minimum)))
            v = np.clip((groups[key][3] - elevation) / max(1, groups[key][3] - groups[key][2]), 0, 1)
            center = .42 + .10 * math.sin(phase) + .16 * (u[None, :] - .5) + .035 * np.sin(7 * u[None, :] + phase)
            half = .68 + .08 * np.sin(4 * u[None, :] + .5 * phase)
            feather = np.clip(1 - np.abs(v - center) / half, 0, 1)
            reserve = feather * feather * (3 - 2 * feather) * (.86 + .14 * np.sin(3 * v + phase))
            pressure = np.clip(.85 + (dry[upper:lower, left:right] - .5) * .4, .65, 1)
            amount = strength * max(.2, 1 - distance / 1400) * pressure
            target = source[upper:lower, left:right]
            lift = reserve * amount * .65
            pool = (1 - reserve) * amount * .18 * (.35 + .65 * v)
            painted = target + (np.array((248, 233, 204)) - target) * lift[..., None]
            painted += (np.array((104, 108, 122)) - painted) * pool[..., None]
            rgb[upper:lower, left:right] = np.where(
                coverage[..., None] > 0,
                target + (painted - target) * coverage[..., None],
                rgb[upper:lower, left:right],
            )
    base.paste(Image.fromarray(np.rint(rgb).clip(0, 255).astype(np.uint8), "RGB"))


def _paint_buildings(base: Image.Image, geometry: PanoramaGeometry, seed: int,
                     pigment_field: Image.Image, broad_pigment: Image.Image | None = None,
                     brush_pigment: Image.Image | None = None) -> None:
    width, height = base.size
    overlay = Image.new("RGBA", base.size)
    draw = ImageDraw.Draw(overlay)
    accents = Image.new("RGBA", base.size)
    ink = ImageDraw.Draw(accents)
    for _building, samples, walls, roof, distance in _building_runs(geometry, width, height):
        haze = .04 if distance < 120 else .28 if distance < 1_500 else .62
        # Visibility changes and a north-wrap split must not recolour a house.
        # Palette variation belongs to its source identity, not run ordering.
        building_seed = _seed(_building.object_id, "building-palette")
        rng = np.random.default_rng(seed + building_seed)
        wall_bases = ((188, 139, 106), (219, 178, 128), (183, 153, 140), (230, 201, 156), (173, 149, 126))
        wall_base = _mix(wall_bases[building_seed % len(wall_bases)], (203, 171, 130), float(rng.uniform(0, .22)))
        # Cool aerial haze belongs around the house, not as a green facade.
        # Keep all measured wall planes in one warm plaster family.
        wall = _mix(wall_base, (228, 210, 187), haze)
        roof_color = _mix((137, 77, 65) if building_seed % 3 else (123, 104, 97), (197, 203, 199), haze)
        # A foreground wall must occlude the woodland wash behind it. The
        # earlier translucent polygon let green terrain shine through a warm
        # plaster facade, making the house appear abruptly cut in half.
        alpha = 255 if distance < 500 else 190 if distance < 2_000 else 105
        # Unknown roofs stay at their measured eaves. No generic pitch,
        # openings or floor count is inferred from a building's screen size.
        roof_top = roof[:len(samples)]
        faces = []
        start = 0
        for cursor in range(1, len(samples) + 1):
            if cursor == len(samples) or (samples[cursor].facade_index, samples[cursor].facade_part_index) != (samples[start].facade_index, samples[start].facade_part_index):
                stop = min(len(samples), cursor + 1)
                faces.append(samples[start:stop])
                start = cursor
        glaze_normals = _architecture_glaze_normals(faces)
        for horizontal in (-width, 0, width):
            shifted_walls = [(x + horizontal, y) for x, y in walls]
            shifted_roof = [(x + horizontal, y) for x, y in roof]
            draw.polygon(shifted_walls, fill=(*wall, alpha))
            for face_number, face in enumerate(faces):
                normal = face[0].facade_normal_degrees
                if normal is None or len(face) < 2:
                    continue
                # A neutral diffuse study of the actual footprint faces; no
                # invented split down the middle of every facade.
                turning = .14 + .14 * math.cos(math.radians(normal - 315))
                tone = _mix(wall, (101, 103, 108), turning * (1 - haze * .65))
                if _building.orientation_degrees is not None:
                    alignment = math.sin(math.radians(glaze_normals[face_number] - _building.orientation_degrees))
                    strength = 1 - haze
                    tone = _mix(tone, (171, 170, 168), .30 * max(0, alignment) * strength)
                    tone = _mix(tone, (248, 232, 204), .32 * max(0, -alignment) * strength)
                part_index = face[0].facade_part_index
                part = _building.facade_parts[part_index] if part_index is not None else None
                if part is not None:
                    # These colour planes follow independently mapped house
                    # boundaries; they are not decorative cuts in one facade.
                    accent = wall_bases[(_seed(_building.object_id, "unit-washes") + part_index) % len(wall_bases)]
                    tone = _mix(tone, _mix(accent, (228,210,187), haze), .58 * max(0, 1 - distance / 2000))
                points = [(sample.azimuth_degrees / 360 * width + horizontal,
                           _angle_y(sample.upper_angle_degrees if sample.roof_intervals is not None else sample.eaves_angle_degrees, geometry, height)) for sample in face]
                points += [(sample.azimuth_degrees / 360 * width + horizontal,
                            _angle_y(sample.lower_angle_degrees, geometry, height)) for sample in reversed(face)]
                draw.polygon(points, fill=(*tone, alpha))
                # Storey rhythm uses explicit above-ground OSM levels only.
                # Equal spacing is a restrained illustrative scale cue, not
                # evidence of measured floor ledges or window positions.
                # Experimental schema-4 review capsules stored GWR totals as
                # levels; do not infer facade divisions from those capsules.
                levels = part.levels if part is not None else _building.levels
                levels_source = part.levels_source if part is not None else _building.levels_source
                if (levels and levels > 1 and distance < 500
                        and not (levels_source or "").startswith("BFS-GWR:")):
                    for level in range(1, levels):
                        fraction = level / levels
                        line = [(sample.azimuth_degrees / 360 * width + horizontal,
                                 _angle_y(sample.lower_angle_degrees + fraction *
                                          (sample.eaves_angle_degrees - sample.lower_angle_degrees), geometry, height))
                                for sample in face]
                        ink.line(line, fill=(*_mix(tone, (97, 92, 88), .24), min(40, alpha)), width=1)
                # Selective drawing follows an actual change of wall plane.
                # A broken shadow accent articulates the corner without
                # tracing every house like a uniformly outlined model.
                if turning > .17 and distance < 1_500 and face[0] is not samples[0]:
                    ink.line((points[0], points[-1]),
                             fill=(*_mix(tone, (83, 87, 103), .32), round(65 * (1 - haze))),
                             width=max(1, width // 2400))
            if all(sample.roof_intervals is None for sample in samples):
                # Older capsules contain only the envelope; keep their
                # historical rendering without claiming measured roof coverage.
                draw.polygon(shifted_roof, fill=(*roof_color, alpha))
                ink.line(shifted_roof + shifted_roof[:1], fill=(*_mix(roof_color, (67, 78, 69), .32), min(70, alpha)), width=max(1, width // 2048))
            else:
                # Paint the actual union of projected roof triangles. Extending
                # one polygon from the nearest eave to a rear wing's ridge
                # falsely coloured intervening setback walls as steep roofing.
                for cursor, sample in enumerate(samples):
                    azimuth = sample.azimuth_degrees
                    left = (samples[cursor - 1].azimuth_degrees + azimuth) / 2 if cursor else azimuth
                    right = (azimuth + samples[cursor + 1].azimuth_degrees) / 2 if cursor + 1 < len(samples) else azimuth
                    x0, x1 = math.floor(left / 360 * width + horizontal), math.ceil(right / 360 * width + horizontal) - 1
                    if x1 < x0:
                        continue
                    intervals = sample.roof_intervals
                    if intervals is None:
                        intervals = ((sample.eaves_angle_degrees, sample.upper_angle_degrees),)
                    for lower, upper in intervals:
                        y0, y1 = _angle_y(upper, geometry, height), _angle_y(lower, geometry, height) - 1
                        if y1 >= y0:
                            draw.rectangle((x0, y0, x1, y1), fill=(*roof_color, alpha))
            # Eaves and the upper roof plane reserve highlights as in a
            # watercolor architectural study; no additional house is drawn.
            ink.line([(x + horizontal, y) for x, y in roof_top],
                      fill=(*_mix(roof_color, (237, 214, 173), .46), min(110, alpha)),
                      width=max(1, width // 1900), joint="curve")
            ink.line(shifted_walls[:len(samples)], fill=(*_mix(wall, (70, 79, 69), .25), min(50, alpha)), width=max(1, width // 2700))
            ink.line(shifted_walls[len(samples):], fill=(*_mix(wall, (55, 67, 59), .32), min(30, alpha)), width=max(1, width // 2400))
    broad = broad_pigment if broad_pigment is not None else _wrap_blur(pigment_field, max(2, width / 100))
    overlay = _architecture_wash(overlay, broad, pigment_field, brush_pigment)
    # Ink load fades in and out along the real edges. Compositing it over the
    # opaque underwash also avoids cutting transparent grooves through walls.
    load = pigment_field.point(lambda value: max(0, min(255, (value - 132) * 4)))
    accents.putalpha(ImageChops.multiply(accents.getchannel("A"), load))
    overlay = Image.alpha_composite(overlay, accents)
    softened = _soften_architecture(overlay, max(1.05, width / 3000))
    base.paste(softened.convert("RGB"), (0, 0), softened.getchannel("A"))
    granulation = pigment_field.point(lambda value: max(0, min(14, (151 - value) // 3)))
    granulation = ImageChops.multiply(softened.getchannel("A"), granulation)
    base.paste(Image.new("RGB", base.size, (105, 79, 66)), (0, 0), granulation)
    dry_lights = pigment_field.point(lambda value: max(0, min(12, (value - 169) // 3)))
    dry_lights = ImageChops.multiply(softened.getchannel("A"), dry_lights)
    base.paste(Image.new("RGB", base.size, (237, 210, 171)), (0, 0), dry_lights)
    from benchly.panorama.facades import paint_referenced_facades
    paint_referenced_facades(base, geometry, pigment_field, brush_pigment)
    _paint_architecture_planes(base, geometry, pigment_field, brush_pigment)


def _terrain_occlusion_ridges(column: PanoramaColumn) -> dict[int, VisibleSpan]:
    """Reserve inner ink for a visible depth break, not a distance shell.

    Compacted TerrainEdges also describe semantic and sampling boundaries.
    Joining one per depth band inks parallel contours across a continuous hill.
    The full visible spans retain the range on both sides of an overlap, and
    float32 angular bounds instead of the older float16 edge approximation.
    A depth jump is conservative evidence for an accent, not proof of a cliff.
    """
    selected: dict[int, tuple[float, VisibleSpan]] = {}
    for near, far in zip(column.spans, column.spans[1:]):
        if near.semantic not in _MOUNTAIN - {SemanticClass.FOREST} or far.semantic not in _MOUNTAIN:
            continue
        if abs(near.upper_angle_degrees - far.lower_angle_degrees) > 1e-4:
            continue
        ratio = far.distance_meters / near.distance_meters
        if ratio < 1.35 or far.distance_meters - near.distance_meters < 30:
            continue
        # Sparse samples of one measured plane are still one plane. A normal
        # agreement within five degrees does not warrant a drawn inner ridge.
        if near.surface_normal is not None and far.surface_normal is not None:
            agreement = sum(a * b for a, b in zip(near.surface_normal, far.surface_normal))
            if agreement >= math.cos(math.radians(5)):
                continue
        layer = terrain_depth_layer(near.distance_meters)
        if layer not in selected or ratio > selected[layer][0]:
            selected[layer] = (ratio, near)
    return {layer: span for layer, (_ratio, span) in selected.items()}


def _paint_edges(base: Image.Image, geometry: PanoramaGeometry, natural_land: Image.Image) -> None:
    width, height = base.size
    overlay = Image.new("RGBA", base.size)
    draw = ImageDraw.Draw(overlay)
    contour = _painted_skyline(geometry, len(geometry.columns), height)
    skyline = [((index + .5) / len(geometry.columns) * width, float(contour[index])) for index in range(len(geometry.columns))]
    rng = np.random.default_rng(_painting_seed(geometry, "broken-drawing"))
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
            draw.line(section_points, fill=(54, 73, 82, alpha if alpha is not None else 26 if layer < 5 else 14),
                      width=max(1, width // 2500), joint="curve")
    for index, column in enumerate(geometry.columns):
        current = _terrain_occlusion_ridges(column)
        for layer in list(runs):
            if layer not in current:
                points = runs.pop(layer)
                paint_ridge(points, layer)
        for layer, edge in current.items():
            point = ((index + .5) / len(geometry.columns) * width, _angle_y(edge.upper_angle_degrees, geometry, height))
            previous = runs.get(layer)
            # A depth-layer label is not a connected physical ridge. When its
            # selected sample switches across adjacent rays, joining the two
            # heights inks a vertical scratch through an otherwise quiet hill.
            # Break that accent rather than changing the factual wash/contour.
            if previous and abs(previous[-1][1] - point[1]) > max(1.5, 3 * (point[0] - previous[-1][0])):
                paint_ridge(previous, layer, 28)
                runs[layer] = []
            runs.setdefault(layer, []).append(point)
    for layer, points in runs.items():
        paint_ridge(points, layer)
    # A smoothed inner ridge can cross a lake or a facade between sampled
    # columns. Those strokes describe land; clip them to its actual ownership
    # rather than drawing a vertical ink scratch through the water plane.
    ink = ImageChops.multiply(overlay.getchannel("A"), natural_land)
    base.paste(overlay.convert("RGB"), (0, 0), ink)


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
    seed = _painting_seed(geometry, season)
    brush_seed = _painting_seed(geometry, "brush-vocabulary")
    sky_top = {"spring": (153, 195, 219), "summer": (135, 185, 218), "autumn": (153, 181, 208), "winter": (161, 187, 215)}[season]
    base = _gradient((render_width, render_height), sky_top, (248, 228, 187))
    artist_pigment = _artist_pigment(render_width, render_height, brush_seed)
    broad_pigment = _periodic_pigment(render_width, render_height, seed + 17, (190, 91, 43))
    medium_pigment = _periodic_pigment(render_width, render_height, seed + 29, (74, 31, 17))
    fine_pigment = _paper_noise(render_width, render_height, seed + 37, 9)
    pigments = (
        broad_pigment.point(lambda value: 56 + value * 192 // 255),
        medium_pigment.point(lambda value: 78 + value * 168 // 255),
        ImageChops.multiply(fine_pigment, artist_pigment).point(lambda value: 86 + value * 160 // 255),
    )
    _paint_sky(base, geometry, broad_pigment, artist_pigment)
    masks = _span_masks(geometry, render_width, render_height)
    surfaces = _surface_masks(masks)
    terrain_silhouette = ImageOps.invert(_sky_mask(geometry, render_width, render_height))
    surfaces = {
        semantic: ImageChops.multiply(mask, terrain_silhouette)
        for semantic, mask in surfaces.items()
    }
    palette = SEASON_PALETTES[season]
    depth_haze = _continuous_depth_haze(geometry, render_width, render_height)
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
        _paint_depth_atmosphere(base, semantic, mask, depth_haze)
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
    _paint_ground_brushwork(base, geometry, visual_masks, seed + 47)
    _paint_forest_details(base, visual_masks, depth_haze, brush_seed + 37)
    forest_surface = surfaces.get(SemanticClass.FOREST)
    if forest_surface is not None:
        _paint_forest_relief(base, geometry, forest_surface)
    _paint_measured_slope_volume(base, geometry, surfaces)
    _paint_rock_details(base, visual_masks, depth_haze, brush_seed + 71)
    _paint_distant_atmosphere(base, surfaces, depth_haze, season)
    for semantic in (SemanticClass.SURFACED_GROUND, SemanticClass.PAVED_GROUND):
        paved = surfaces.get(semantic)
        if paved is None:
            continue
        # Natural wet edges and subsequent foliage glazes otherwise repaint
        # narrow mapped paving green. Lay its quiet wash after those glazes,
        # using the same surveyed coverage. Displaced registrations can move
        # a thin route by its entire width, so keep these pigment passes on
        # the measured surface. Water shores and buildings still paint over it.
        # A neutral earth/grey wash suggests a connecting ground plane. The
        # uncertain-finish class receives no asphalt grain or paving pattern.
        color = palette[semantic]
        _paint_wash(base, paved, color, 1.16, pigments, displace=False)
        _paint_depth_atmosphere(base, semantic, paved, depth_haze)
        _pool_pigment(base, paved, color, .045)
    _paint_water_details(base, water, seed + 71, broad_pigment)
    _paint_buildings(base, geometry, seed + 113, medium_pigment, broad_pigment, artist_pigment)
    natural_land = Image.new("L", base.size)
    for semantic in _MOUNTAIN:
        if semantic in surfaces:
            natural_land = ImageChops.lighter(natural_land, surfaces[semantic])
    _paint_edges(base, geometry, natural_land)

    if base.size != (width, height):
        base = base.resize((width, height), Image.Resampling.LANCZOS)
    # Paper fibres are applied once at delivery resolution so the final image
    # retains a tactile wash instead of looking like enlarged flat vectors.
    fibres = ImageChops.multiply(_paper_noise(width, height, seed + 211, 5), _artist_pigment(width, height, brush_seed))
    light_fibres = fibres.point(lambda value: max(0, value - 128) // 5)
    dark_fibres = fibres.point(lambda value: max(0, 119 - value) // 5)
    base.paste(Image.new("RGB", base.size, (239, 230, 208)), (0, 0), light_fibres)
    base.paste(Image.new("RGB", base.size, (103, 112, 96)), (0, 0), dark_fibres)
    base = Image.fromarray(_register_architecture(np.asarray(base), geometry), "RGB")
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
    packed = np.zeros((height, width, 4), dtype=np.uint8)
    minimum, maximum = geometry.config.minimum_elevation_angle, geometry.config.maximum_elevation_angle
    count = len(geometry.columns)
    skyline = _painted_skyline(geometry, width, height)
    for x in range(width):
        column = geometry.columns[min(count - 1, int((x + .5) * count / width))]
        prepared = []
        for span in column.spans:
            top = max(0.0, min(float(height), (maximum - span.upper_angle_degrees) / (maximum - minimum) * height))
            if span.semantic != SemanticClass.BUILDING and abs(span.upper_angle_degrees - column.skyline_angle_degrees) < .08:
                top = max(0.0, min(float(height), float(skyline[x])))
            bottom = max(0.0, min(float(height), (maximum - span.lower_angle_degrees) / (maximum - minimum) * height))
            if bottom <= top:
                continue
            depth = round(max(0, min(1, math.log1p(span.distance_meters) / math.log1p(150_000))) * 255)
            edge = min(column.terrain_edges, key=lambda item: abs(item.distance_meters - span.distance_meters), default=None)
            slope = edge.slope_degrees if edge and edge.slope_degrees is not None else 0
            if span.surface_normal is not None:
                length = math.sqrt(sum(value * value for value in span.surface_normal))
                slope = math.degrees(math.acos(max(0, min(1, span.surface_normal[2] / length))))
            normal = round(max(0, min(1, .5 + slope / 180)) * 255)
            prepared.append((top, bottom, span, depth, normal))
        if not prepared:
            continue
        first_row = max(0, math.floor(min(item[0] for item in prepared)))
        last_row = min(height, math.ceil(max(item[1] for item in prepared)))
        for y in range(first_row, last_row):
            overlaps = [
                (max(0.0, min(bottom, y + 1) - max(top, y)), span, depth, normal)
                for top, bottom, span, depth, normal in prepared
            ]
            overlaps = [item for item in overlaps if item[0] > 0]
            if not overlaps:
                continue
            center = y + .5
            centered = [
                (overlap, span, depth, normal)
                for overlap, span, depth, normal in overlaps
                if any(candidate[2] is span and candidate[0] <= center < candidate[1] for candidate in prepared)
            ]
            owner = centered[0] if centered else max(overlaps, key=lambda item: item[0])
            coverage = min(1.0, sum(item[0] for item in overlaps))
            _overlap, span, depth, normal = owner
            packed[y, x] = (depth, MATERIAL_SEMANTIC_IDS[span.semantic], normal, round(coverage * 255))
    packed = _register_architecture(packed, geometry, material=True)
    packed[:, -1] = packed[:, 0]
    from benchly.panorama.material import pack_material_transport
    image = Image.fromarray(pack_material_transport(packed), "RGB")
    output = io.BytesIO()
    image.save(output, format="WEBP", lossless=True, method=6, exact=True)
    return output.getvalue()


def _visible_front_wall(
    span: VisibleSpan, profiles: list[tuple[str, BuildingProjectionSample]],
) -> tuple[BuildingProjectionSample | None, list[tuple[float, float]]]:
    """Bind only a uniquely identified, visible front wall to its measured aspect.

    Capsules through schema 11 omit span object IDs. Their clipped profiles
    still retain column, range and angular extent. A coincident unknown
    profile is an ambiguity too; never choose by source order or proximity.
    """
    candidates = [profile for owner, profile in profiles
                  if (span.object_id is None or owner == span.object_id)
                  and abs(profile.distance_meters - span.distance_meters) <= max(.01, span.distance_meters * 1e-6)
                  and min(span.upper_angle_degrees, profile.upper_angle_degrees, profile.eaves_angle_degrees)
                      > max(span.lower_angle_degrees, profile.lower_angle_degrees)]
    if len(candidates) != 1 or candidates[0].facade_normal_degrees is None:
        return None, []
    profile = candidates[0]
    lower = max(span.lower_angle_degrees, profile.lower_angle_degrees)
    upper = min(span.upper_angle_degrees, profile.upper_angle_degrees, profile.eaves_angle_degrees)
    intervals = [(lower, upper)]
    # A front-wall normal says nothing about roof planes or higher setback
    # walls. Those portions retain their previous lighting approximation.
    for roof_lower, roof_upper in profile.roof_intervals or ():
        intervals = [piece for lo, hi in intervals
                     for piece in [(lo, min(hi, roof_lower)), (max(lo, roof_upper), hi)]
                     if piece[1] > piece[0]]
    return profile, intervals


def render_lightmap_webp(geometry: PanoramaGeometry, sun_azimuth_degrees: float,
                         sun_altitude_degrees: float, width: int = 2048, height: int = 512,
                         *, use_surface_normals: bool = True) -> bytes:
    """Approximate direct landscape light from surface aspect and occlusion."""
    image = Image.new("L", (width, height), 126 if sun_altitude_degrees > 0 else 24)
    if sun_altitude_degrees > -3:
        measured_facades: dict[int, list[tuple[str, BuildingProjectionSample]]] = defaultdict(list)
        if use_surface_normals:
            resolution = 360 / len(geometry.columns)
            for building in geometry.buildings:
                for profile in building.samples:
                    index = round(profile.azimuth_degrees / resolution) % len(geometry.columns)
                    measured_facades[index].append((building.object_id, profile))
        draw = ImageDraw.Draw(image)
        x_scale = width / len(geometry.columns)
        sun_column = geometry.columns[round((sun_azimuth_degrees % 360) / geometry.config.angular_resolution_degrees) % len(geometry.columns)]
        observer_occlusion = max(0, sun_column.skyline_angle_degrees - sun_altitude_degrees)
        sun_altitude = math.radians(max(-2, sun_altitude_degrees))
        sun_bearing = math.radians(sun_azimuth_degrees)
        sun_direction = (math.cos(sun_altitude) * math.sin(sun_bearing),
                         math.cos(sun_altitude) * math.cos(sun_bearing), math.sin(sun_altitude))
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
                elif use_surface_normals and span.surface_normal is not None:
                    normal = span.surface_normal
                    length = math.sqrt(sum(value * value for value in normal))
                    facing = max(0, sum(value * sun for value, sun in zip(normal, sun_direction)) / length)
                else:
                    # Older capsules retain their historical approximation;
                    # a selected ridge's radial incline is not a 3-D normal.
                    edge = min(column.terrain_edges, key=lambda item: abs(item.distance_meters - span.distance_meters), default=None)
                    slope = math.radians(edge.slope_degrees if edge and edge.slope_degrees is not None else 0)
                    facing = max(0, math.sin(sun_altitude) * math.cos(slope) + math.cos(sun_altitude) * math.sin(slope) * math.cos(relative))
                depth_softening = min(.22, math.log10(max(10, span.distance_meters)) * .035)
                occlusion = min(.7, observer_occlusion / 18) if abs(math.degrees(relative)) < 42 else 0
                value = round(58 + 180 * max(0, min(1, facing + depth_softening - occlusion)))
                draw.rectangle((left, max(0, top), right, min(height, bottom)), fill=value)
                if span.semantic == SemanticClass.BUILDING:
                    profile, intervals = _visible_front_wall(span, measured_facades.get(index, []))
                    if profile is None:
                        continue
                    wall_facing = max(0, math.cos(sun_altitude) * math.cos(
                        math.radians(profile.facade_normal_degrees - sun_azimuth_degrees)))
                    wall_value = round(58 + 180 * max(0, min(1, wall_facing + depth_softening - occlusion)))
                    for lower, upper in intervals:
                        y0 = max(0, math.ceil(_angle_y(upper, geometry, height) - .5))
                        y1 = min(height - 1, math.floor(_angle_y(lower, geometry, height) - .5))
                        if y1 >= y0:
                            draw.rectangle((left, y0, right, y1), fill=wall_value)
    image = _wrap_blur(image, max(2.2, width / 700))
    image = Image.fromarray(_register_architecture(np.asarray(image), geometry), "L")
    output = io.BytesIO()
    image.save(output, format="WEBP", lossless=True, method=6)
    return output.getvalue()
