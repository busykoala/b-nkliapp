"""Deterministic layered-watercolor renderer for panorama geometry."""

from __future__ import annotations

import hashlib
import html
import base64
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from benchly.panorama.models import PanoramaColumn, PanoramaGeometry, SemanticClass


PALETTE = {
    SemanticClass.WATER: "#6fadc0",
    SemanticClass.RIVER: "#69a5b8",
    SemanticClass.FOREST: "#4c795d",
    SemanticClass.OPEN_GRASSLAND: "#9aae72",
    SemanticClass.ROCK: "#968d80",
    SemanticClass.SNOW_OR_GLACIER: "#e9ece4",
    SemanticClass.SETTLEMENT: "#b19a7f",
    SemanticClass.BUILDING: "#b58b68",
    SemanticClass.UNKNOWN_TERRAIN: "#799373",
}

_DISTANCE_OPACITY = {"far": .36, "middle": .63, "near": .92}
_DISTANCE_HAZE = {"far": .66, "middle": .3, "near": .03}
_WASH_OPACITY = {"far": .045, "middle": .1, "near": .18}

_MOUNTAIN_SEMANTICS = {
    SemanticClass.SNOW_OR_GLACIER,
    SemanticClass.ROCK,
    SemanticClass.UNKNOWN_TERRAIN,
    SemanticClass.OPEN_GRASSLAND,
    SemanticClass.FOREST,
}

_TEXTURE_DIRECTORY = Path(__file__).resolve().parents[3] / "public" / "map-art" / "textures"


@lru_cache(maxsize=4)
def _texture_data_url(filename: str) -> str | None:
    """Embed the app's tiny map-watercolor assets in an offline SVG artifact."""
    path = _TEXTURE_DIRECTORY / filename
    try:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return None
    mime = "image/png" if path.suffix == ".png" else "image/webp"
    return f"data:{mime};base64,{encoded}"


def _band_color(semantic: SemanticClass, band: str) -> str:
    # swissTLM does not classify every terrain cell. Distance still gives an
    # honest visual cue: remote unknown terrain reads as an alpine ridge,
    # while nearby unknown terrain remains vegetation-toned ground.
    if semantic == SemanticClass.UNKNOWN_TERRAIN:
        return {"far": "#758b95", "middle": "#7f927f", "near": PALETTE[semantic]}[band]
    if semantic == SemanticClass.ROCK and band == "far":
        return "#7e8990"
    return PALETTE[semantic]


def _y(angle: float, minimum: float, maximum: float, height: int) -> float:
    return (maximum - angle) / (maximum - minimum) * height


def _mix(color: str, target: str, amount: float) -> str:
    source = tuple(int(color[index:index + 2], 16) for index in (1, 3, 5))
    destination = tuple(int(target[index:index + 2], 16) for index in (1, 3, 5))
    mixed = tuple(round(left + (right - left) * amount) for left, right in zip(source, destination))
    return "#" + "".join(f"{value:02x}" for value in mixed)


def _distance_band(distance_meters: float) -> str:
    if distance_meters <= 120:
        return "near"
    if distance_meters <= 1_500:
        return "middle"
    return "far"


def _render_columns_svg(geometry: PanoramaGeometry, columns: tuple[PanoramaColumn, ...], width: int, height: int,
                        description: str) -> str:
    if width < 360 or height < 180:
        raise ValueError("panorama output is too small")
    x_scale = width / len(columns)
    minimum = geometry.config.minimum_elevation_angle
    maximum = geometry.config.maximum_elevation_angle
    seed = int(hashlib.sha256(geometry.identity_key.encode()).hexdigest()[:8], 16) % 997
    paths: dict[tuple[SemanticClass, str], list[str]] = defaultdict(list)
    skyline: list[str] = []
    forest_marks: list[str] = []
    water_marks: list[str] = []
    building_roofs: list[str] = []
    building_foundations: list[str] = []
    building_windows: list[str] = []
    building_edges: list[str] = []
    building_faces: list[tuple[str, float, float, float, float, str]] = []
    mountain_ridges: dict[str, list[str]] = defaultdict(list)
    mountain_contours: dict[str, list[str]] = defaultdict(list)
    mark_stride = max(3, round(13 / max(x_scale, .01)))

    for index, column in enumerate(columns):
        x0, x1 = index * x_scale, (index + 1) * x_scale + .22
        center = (x0 + x1) / 2
        skyline.append(f"{'M' if index == 0 else 'L'}{center:.2f} {_y(column.skyline_angle_degrees, minimum, maximum, height):.2f}")
        for span_index, span in enumerate(column.spans):
            top = _y(span.upper_angle_degrees, minimum, maximum, height)
            bottom = _y(span.lower_angle_degrees, minimum, maximum, height)
            band = _distance_band(span.distance_meters)
            command = f"M{center:.2f} {top:.2f}V{bottom:.2f}"
            paths[(span.semantic, band)].append(command)
            if (span_index == len(column.spans) - 2 and span.semantic in _MOUNTAIN_SEMANTICS
                    and band in {"far", "middle"}):
                mountain_contours[band].append(f"M{x0:.2f} {top:.2f}H{x1:.2f}")
        if not column.spans:
            continue
        visible = column.spans[-1]
        top = _y(visible.upper_angle_degrees, minimum, maximum, height)
        bottom = _y(visible.lower_angle_degrees, minimum, maximum, height)
        band = _distance_band(visible.distance_meters)
        if visible.semantic in _MOUNTAIN_SEMANTICS and band in {"far", "middle"}:
            mountain_ridges[band].append(f"M{x0:.2f} {top:.2f}H{x1:.2f}")
        if visible.semantic == SemanticClass.BUILDING:
            building_faces.append((visible.object_id or "building", x0, x1, top, bottom, band))
            building_roofs.append(f"M{x0:.2f} {top:.2f}H{x1:.2f}")
            building_foundations.append(f"M{x0:.2f} {bottom:.2f}H{x1:.2f}")
            window_stride = mark_stride * 3
            if band in {"near", "middle"} and bottom - top > 18 and index % window_stride == seed % window_stride:
                window_width = max(3.2, x_scale * 4.5)
                window_height = max(3.8, min(7.5, (bottom - top) * .11))
                window_top = top + min(14, (bottom - top) * .34)
                building_windows.append(
                    f"M{center - window_width / 2:.2f} {window_top:.2f}h{window_width:.2f}v{window_height:.2f}h-{window_width:.2f}Z"
                )
            continue
        building_faces.append(("", x0, x1, top, bottom, band))
        if index % mark_stride:
            continue
        if visible.semantic == SemanticClass.FOREST:
            size = (2.2 + (index + seed) % 5 * .42) * ({"far": .65, "middle": .82, "near": 1}[band])
            forest_marks.append(
                f"M{center - size:.2f} {top + size:.2f}Q{center:.2f} {top - size:.2f} {center + size:.2f} {top + size:.2f}M{center:.2f} {top + size * .4:.2f}v{size * 1.5:.2f}"
            )
        elif (visible.semantic in {SemanticClass.WATER, SemanticClass.RIVER}
              and bottom - top > 2 and index % (mark_stride * 4) == 0):
            depth = .22 + ((index + seed) % 4) * .16
            length = 9 + (index + seed) % 17 + depth * 15
            first_level = top + (bottom - top) * depth
            water_marks.append(
                f"M{center - length:.2f} {first_level:.2f}h{length * 2:.2f}"
            )

    roof_washes: list[str] = []
    run: list[tuple[str, float, float, float, float, str]] = []
    for face in building_faces + [("", 0, 0, 0, 0, "")]:
        if run and face[0] != run[-1][0]:
            start, end = run[0][1], run[-1][2]
            if end - start >= max(8, x_scale * 5):
                ridge = min(item[3] for item in run)
                foot = max(item[4] for item in run)
                eave = min(foot - 1, ridge + min(26, max(7, (foot - ridge) * .22)))
                center = (start + end) / 2
                roof_washes.append(
                    f"M{start:.2f} {eave:.2f}L{center:.2f} {ridge:.2f}L{end:.2f} {eave:.2f}Z"
                )
                if start > x_scale:
                    building_edges.append(f"M{start:.2f} {eave:.2f}V{foot:.2f}")
                if end < width - x_scale:
                    building_edges.append(f"M{end:.2f} {eave:.2f}V{foot:.2f}")
            run = []
        if face[0]:
            run.append(face)

    water_texture = _texture_data_url("water.webp")
    mountain_texture = _texture_data_url("mountain.webp")
    building_texture = _texture_data_url("building-roof-terracotta.png")
    paper_texture = _texture_data_url("paper.webp")
    water_pattern_width = width / 10
    mountain_pattern_width = width / 15
    building_pattern_width = width / 40
    paper_pattern_width = width / 16

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img">',
        f"<title>{html.escape(description)}</title>",
        "<defs>",
        '<linearGradient id="sky" x2="0" y2="1"><stop stop-color="#c9dadd"/><stop offset=".46" stop-color="#dce2d4"/><stop offset=".77" stop-color="#efe1c4"/><stop offset="1" stop-color="#f4e8cd"/></linearGradient>',
        '<linearGradient id="depth-wash" x2="0" y2="1"><stop offset=".44" stop-color="#345747" stop-opacity="0"/><stop offset=".72" stop-color="#345747" stop-opacity=".035"/><stop offset="1" stop-color="#29483c" stop-opacity=".19"/></linearGradient>',
        f'<linearGradient id="water-depth" x1="0" y1="{height * .42:.1f}" x2="0" y2="{height:.1f}" gradientUnits="userSpaceOnUse"><stop stop-color="#edf0dd" stop-opacity=".34"/><stop offset=".38" stop-color="#4098aa" stop-opacity=".11"/><stop offset="1" stop-color="#176f82" stop-opacity=".55"/></linearGradient>',
        f'<filter id="pigment-edge" x="-1%" y="-2%" width="102%" height="104%"><feTurbulence type="fractalNoise" baseFrequency=".002 .045" numOctaves="2" seed="{seed}" result="grain"/><feDisplacementMap in="SourceGraphic" in2="grain" scale="2.6" xChannelSelector="R" yChannelSelector="B"/></filter>',
        # These compact vector patterns echo the watercolor textures of the
        # main map while keeping the panorama self-contained and cacheable.
        f'<pattern id="water-pigment" width="{water_pattern_width:.2f}" height="124" patternUnits="userSpaceOnUse">'
        + (f'<image href="{water_texture}" width="{water_pattern_width:.2f}" height="{water_pattern_width:.2f}" opacity=".5" preserveAspectRatio="xMidYMid slice"/>' if water_texture else '')
        + f'<path d="M12 58Q{water_pattern_width * .25:.1f} 54 {water_pattern_width * .48:.1f} 59T{water_pattern_width - 15:.1f} 55" fill="none" stroke="#f8efd2" stroke-opacity=".22" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="45 22 13 31"/>'
        '</pattern>',
        f'<pattern id="mountain-pigment" width="{mountain_pattern_width:.2f}" height="170" patternUnits="userSpaceOnUse">'
        + (f'<image href="{mountain_texture}" width="{mountain_pattern_width:.2f}" height="{mountain_pattern_width:.2f}" opacity=".68" preserveAspectRatio="xMidYMid slice"/>' if mountain_texture else '')
        + f'<path d="M-20 62Q{mountain_pattern_width * .14:.1f} 39 {mountain_pattern_width * .36:.1f} 64T{mountain_pattern_width * .75:.1f} 55T{mountain_pattern_width + 20:.1f} 67" fill="none" stroke="#f1e5ca" stroke-opacity=".16" stroke-width="8" stroke-linecap="round"/>'
        '</pattern>',
        f'<pattern id="building-pigment" width="{building_pattern_width:.2f}" height="72" patternUnits="userSpaceOnUse">'
        + (f'<image href="{building_texture}" width="{building_pattern_width:.2f}" height="{building_pattern_width:.2f}" opacity=".58" preserveAspectRatio="xMidYMid slice"/>' if building_texture else '')
        + f'<path d="M7 30L{building_pattern_width * .38:.1f} 24M{building_pattern_width * .54:.1f} 62L{building_pattern_width - 10:.1f} 54" stroke="#f4dfbe" stroke-opacity=".2" stroke-width="3" stroke-linecap="round"/>'
        '</pattern>',
        f'<pattern id="paper-pigment" width="{paper_pattern_width:.2f}" height="{paper_pattern_width:.2f}" patternUnits="userSpaceOnUse">'
        + (f'<image href="{paper_texture}" width="{paper_pattern_width:.2f}" height="{paper_pattern_width:.2f}" opacity=".7"/>' if paper_texture else f'<rect width="{paper_pattern_width:.2f}" height="{paper_pattern_width:.2f}" fill="#f2e8d2"/>')
        + '</pattern>',
        f'<pattern id="sand-pigment" width="{paper_pattern_width:.2f}" height="128" patternUnits="userSpaceOnUse">'
        + (f'<image href="{paper_texture}" width="{paper_pattern_width:.2f}" height="{paper_pattern_width:.2f}" opacity=".78"/>' if paper_texture else f'<rect width="{paper_pattern_width:.2f}" height="128" fill="#ead9b2"/>')
        + f'<path d="M-20 44Q{paper_pattern_width * .15:.1f} 29 {paper_pattern_width * .35:.1f} 47T{paper_pattern_width * .74:.1f} 41T{paper_pattern_width + 20:.1f} 48" fill="none" stroke="#ae9366" stroke-opacity=".1" stroke-width="12" stroke-linecap="round"/>'
        + '</pattern>',
    ]
    for semantic in PALETTE:
        identifier = semantic.value.replace("_", "-")
        for band in ("far", "middle", "near"):
            band_color = _band_color(semantic, band)
            hazed = _mix(band_color, "#d8dfd5", _DISTANCE_HAZE[band])
            light = _mix(hazed, "#f4ead5", .3 if band == "far" else .22)
            dark = _mix(hazed, "#2f4d40", .05 if band == "far" else .17 if band == "middle" else .3)
            parts.append(
                f'<linearGradient id="paint-{identifier}-{band}" x2="0" y2="1"><stop stop-color="{light}"/><stop offset=".56" stop-color="{hazed}"/><stop offset="1" stop-color="{dark}"/></linearGradient>'
            )
    for (semantic, band), commands in paths.items():
        identifier = semantic.value.replace("_", "-")
        parts.append(f'<path id="shape-{identifier}-{band}" d="{"".join(commands)}" fill="none"/>')
    parts.extend((
        "</defs>",
        f'<rect width="{width}" height="{height}" fill="#f5ead3"/>',
        f'<rect width="{width}" height="{height}" fill="url(#sky)"/>',
    ))

    order = (
        SemanticClass.SNOW_OR_GLACIER, SemanticClass.ROCK, SemanticClass.UNKNOWN_TERRAIN,
        SemanticClass.OPEN_GRASSLAND, SemanticClass.FOREST, SemanticClass.SETTLEMENT,
        SemanticClass.WATER, SemanticClass.RIVER, SemanticClass.BUILDING,
    )
    # Keep the full-width washes unfiltered. Raster effects at the 0°/360°
    # boundary cannot sample the opposite image edge and therefore reveal the
    # otherwise continuous panorama when the image is tiled in the browser.
    for band in ("far", "middle", "near"):
        parts.append(f'<g opacity="{_WASH_OPACITY[band]}">')
        for semantic in order:
            commands = paths.get((semantic, band))
            if commands:
                identifier = semantic.value.replace("_", "-")
                parts.append(f'<use href="#shape-{identifier}-{band}" stroke="{_band_color(semantic, band)}" stroke-width="{x_scale + 3.8:.2f}" stroke-linecap="round"/>')
        parts.append("</g>")
    parts.append("<g>")
    for band in ("far", "middle", "near"):
        for semantic in order:
            commands = paths.get((semantic, band))
            if not commands:
                continue
            identifier = semantic.value.replace("_", "-")
            parts.append(
                f'<use href="#shape-{identifier}-{band}" stroke="url(#paint-{identifier}-{band})" stroke-width="{x_scale + .36:.2f}" opacity="{_DISTANCE_OPACITY[band]}"/>'
            )
            if semantic in {SemanticClass.WATER, SemanticClass.RIVER}:
                parts.append(f'<use href="#shape-{identifier}-{band}" stroke="url(#water-depth)" stroke-width="{x_scale + .38:.2f}"/>')
                parts.append(f'<use href="#shape-{identifier}-{band}" stroke="url(#water-pigment)" stroke-width="{x_scale + .38:.2f}" opacity="{.42 if band == "near" else .3}"/>')
            elif semantic == SemanticClass.BUILDING:
                parts.append(f'<use href="#shape-{identifier}-{band}" stroke="url(#building-pigment)" stroke-width="{x_scale + .38:.2f}" opacity="{.24 if band == "near" else .13}"/>')
            elif semantic in _MOUNTAIN_SEMANTICS and band in {"far", "middle"}:
                parts.append(f'<use href="#shape-{identifier}-{band}" stroke="url(#mountain-pigment)" stroke-width="{x_scale + .38:.2f}" opacity="{.62 if band == "middle" else .45}"/>')
    parts.append("</g>")
    parts.append(f'<rect width="{width}" height="{height}" fill="url(#depth-wash)"/>')
    if skyline:
        line = "".join(skyline)
        parts.append(f'<path d="{line}" fill="none" stroke="#435d50" stroke-opacity=".1" stroke-width="2.6"/>')
        parts.append(f'<path d="{line}" fill="none" stroke="#425a4d" stroke-opacity=".24" stroke-width=".62" stroke-linecap="round" stroke-linejoin="round"/>')
    for band, commands in mountain_ridges.items():
        ridge = "".join(commands)
        opacity = .2 if band == "middle" else .11
        parts.append(f'<path d="{ridge}" fill="none" stroke="#596963" stroke-opacity="{opacity}" stroke-width="1.4" stroke-linecap="round"/>')
    for band, commands in mountain_contours.items():
        contour = "".join(commands)
        opacity = .34 if band == "middle" else .21
        parts.append(f'<path d="{contour}" fill="none" stroke="#f1e3c5" stroke-opacity=".14" stroke-width="3.4" stroke-linecap="round"/>')
        parts.append(f'<path d="{contour}" fill="none" stroke="#52645f" stroke-opacity="{opacity}" stroke-width=".76" stroke-linecap="round"/>')
    if forest_marks:
        parts.append(f'<g id="forest-cues"><path d="{"".join(forest_marks)}" fill="none" stroke="#365f49" stroke-opacity=".31" stroke-width="1.15" stroke-linecap="round"/></g>')
    if water_marks:
        parts.append(f'<g id="water-cues"><path d="{"".join(water_marks)}" fill="none" stroke="#f7efd2" stroke-opacity=".74" stroke-width="1.65" stroke-linecap="round"/></g>')
    if building_roofs:
        if roof_washes:
            parts.append(f'<path d="{"".join(roof_washes)}" fill="url(#building-pigment)" fill-opacity=".78" stroke="#765448" stroke-opacity=".56" stroke-width="1.15" stroke-linejoin="round" filter="url(#pigment-edge)"/>')
        parts.append(f'<g id="building-cues"><path d="{"".join(building_roofs)}" fill="none" stroke="#765b48" stroke-opacity=".54" stroke-width="1.7" stroke-linecap="round"/>')
        parts.append(f'<path d="{"".join(building_foundations)}" fill="none" stroke="#4e5b4d" stroke-opacity=".18" stroke-width="1.05"/>')
        if building_edges:
            parts.append(f'<path d="{"".join(building_edges)}" fill="none" stroke="#705f50" stroke-opacity=".28" stroke-width=".9"/>')
        if building_windows:
            parts.append(f'<path d="{"".join(building_windows)}" fill="#53706b" fill-opacity=".42" stroke="#f1dfba" stroke-opacity=".3" stroke-width=".55"/>')
        parts.append("</g>")
    parts.extend((
        f'<path id="bench-ground" d="M0 {height * .81:.1f}Q{width * .12:.1f} {height * .775:.1f} {width * .25:.1f} {height * .815:.1f}T{width * .5:.1f} {height * .79:.1f}T{width * .75:.1f} {height * .82:.1f}T{width:.1f} {height * .795:.1f}V{height}H0Z" fill="#d1bb8d" fill-opacity=".76" stroke="#b39b70" stroke-opacity=".22" stroke-width="3"/>',
        f'<path d="M0 {height * .81:.1f}Q{width * .12:.1f} {height * .775:.1f} {width * .25:.1f} {height * .815:.1f}T{width * .5:.1f} {height * .79:.1f}T{width * .75:.1f} {height * .82:.1f}T{width:.1f} {height * .795:.1f}V{height}H0Z" fill="url(#sand-pigment)" fill-opacity=".34"/>',
        f'<path d="M0 {height * .865:.1f}Q{width * .19:.1f} {height * .83:.1f} {width * .4:.1f} {height * .89:.1f}T{width * .78:.1f} {height * .85:.1f}T{width:.1f} {height * .88:.1f}V{height}H0Z" fill="#efe0ba" fill-opacity=".19"/>',
        f'<path d="M0 {height * .92:.1f}Q{width * .23:.1f} {height * .86:.1f} {width * .48:.1f} {height * .94:.1f}T{width:.1f} {height * .9:.1f}V{height}H0Z" fill="#725f46" opacity=".055"/>',
        f'<rect width="{width}" height="{height}" fill="url(#paper-pigment)" opacity=".16" style="mix-blend-mode:multiply"/>',
        "</svg>",
    ))
    return "".join(parts)


def render_panorama_svg(geometry: PanoramaGeometry, width: int = 3600, height: int = 900) -> str:
    """Paint the complete circle; crop/rotation stays a cheap presentation concern."""
    return _render_columns_svg(
        geometry, geometry.columns, width, height,
        "Calculated 360 degree landscape panorama; not a photograph",
    )


def render_view_svg(geometry: PanoramaGeometry, center_azimuth_degrees: float, horizontal_fov_degrees: float,
                    width: int = 1600, height: int = 720) -> str:
    """Cheap wrap-safe view used for previews and non-interactive fallbacks."""
    if not 0 < horizontal_fov_degrees <= 180:
        raise ValueError("field of view must be between 0 and 180 degrees")
    resolution = geometry.config.angular_resolution_degrees
    count = max(2, round(horizontal_fov_degrees / resolution))
    center = round((center_azimuth_degrees % 360) / resolution) % len(geometry.columns)
    start = center - count // 2
    columns = tuple(geometry.columns[index % len(geometry.columns)] for index in range(start, start + count))
    return _render_columns_svg(
        geometry, columns, width, height,
        f"Calculated landscape view centered at {center_azimuth_degrees % 360:.1f} degrees; not a photograph",
    )
