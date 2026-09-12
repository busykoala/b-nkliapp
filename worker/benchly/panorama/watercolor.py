"""Deterministic flat-watercolor Phase-B renderer for panorama geometry."""

from __future__ import annotations

import hashlib
import html

from benchly.panorama.models import PanoramaColumn, PanoramaGeometry, SemanticClass


PALETTE = {
    SemanticClass.WATER: "#8fb8bd",
    SemanticClass.RIVER: "#88adb2",
    SemanticClass.FOREST: "#58765f",
    SemanticClass.OPEN_GRASSLAND: "#9aab78",
    SemanticClass.ROCK: "#8f8b82",
    SemanticClass.SNOW_OR_GLACIER: "#e8e8df",
    SemanticClass.SETTLEMENT: "#b39d82",
    SemanticClass.BUILDING: "#c4aa87",
    SemanticClass.UNKNOWN_TERRAIN: "#85937a",
}


def _y(angle: float, minimum: float, maximum: float, height: int) -> float:
    return (maximum - angle) / (maximum - minimum) * height


def _render_columns_svg(geometry: PanoramaGeometry, columns: tuple[PanoramaColumn, ...], width: int, height: int,
                        description: str) -> str:
    if width < 360 or height < 180:
        raise ValueError("panorama output is too small")
    x_scale = width / len(columns)
    minimum = geometry.config.minimum_elevation_angle
    maximum = geometry.config.maximum_elevation_angle
    seed = int(hashlib.sha256(geometry.identity_key.encode()).hexdigest()[:8], 16) % 997
    paths: dict[SemanticClass, list[str]] = {semantic: [] for semantic in PALETTE}
    building_paths: list[str] = []
    for index, column in enumerate(columns):
        x0, x1 = index * x_scale, (index + 1) * x_scale + .15
        for span in column.spans:
            top = _y(span.upper_angle_degrees, minimum, maximum, height)
            bottom = _y(span.lower_angle_degrees, minimum, maximum, height)
            command = f"M{x0:.2f} {top:.2f}H{x1:.2f}V{bottom:.2f}H{x0:.2f}Z"
            if span.semantic == SemanticClass.BUILDING:
                building_paths.append(command)
            elif span.semantic in paths:
                paths[span.semantic].append(command)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img">',
        f"<title>{html.escape(description)}</title>",
        "<defs>",
        f'<filter id="wash"><feTurbulence type="fractalNoise" baseFrequency=".012 .08" numOctaves="2" seed="{seed}" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2"/><feGaussianBlur stdDeviation=".22"/></filter>',
        f'<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="3" seed="{seed + 1}"/><feColorMatrix values="0 0 0 0 .35 0 0 0 0 .30 0 0 0 0 .22 0 0 0 .08 0"/></filter>',
        '<linearGradient id="sky" x2="0" y2="1"><stop stop-color="#d9e3dd"/><stop offset=".63" stop-color="#eee5cf"/><stop offset="1" stop-color="#f5eddc"/></linearGradient>',
        "</defs>",
        f'<rect width="{width}" height="{height}" fill="#f5eedf"/>',
        f'<rect width="{width}" height="{height}" fill="url(#sky)" opacity=".78"/>',
        '<g filter="url(#wash)" opacity=".92">',
    ]
    # Far/cool classes first. The visibility result already removes anything
    # hidden by nearer terrain; ordering here only controls pigment overlap.
    order = (SemanticClass.SNOW_OR_GLACIER, SemanticClass.ROCK, SemanticClass.UNKNOWN_TERRAIN,
             SemanticClass.OPEN_GRASSLAND, SemanticClass.FOREST, SemanticClass.SETTLEMENT,
             SemanticClass.WATER, SemanticClass.RIVER)
    for semantic in order:
        if paths[semantic]:
            parts.append(f'<path d="{"".join(paths[semantic])}" fill="{PALETTE[semantic]}"/>')
    if building_paths:
        parts.append(f'<path d="{"".join(building_paths)}" fill="{PALETTE[SemanticClass.BUILDING]}" stroke="#765f4c" stroke-opacity=".22" stroke-width=".45"/>')
    parts.extend(("</g>", f'<rect width="{width}" height="{height}" filter="url(#paper)" opacity=".28"/>', "</svg>"))
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
