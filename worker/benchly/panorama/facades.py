"""Reference-led facade marks projected onto visible measured wall planes.

No geographic detail is inferred here: every observed shape and plane arrives with
photographic provenance. Terrain/building occlusion and roof ownership remain
authoritative, including partial visibility of a single aggregated solid.
"""
from __future__ import annotations

import hashlib
import math

import numpy as np
from PIL import Image, ImageFilter

from benchly.panorama.models import FacadeMark, FacadeReference, PanoramaGeometry, ProjectedBuilding


def _mark_mask(reference: FacadeReference, mark: FacadeMark, u, v, margin=0):
    """Project an observed opening, preserving its shape in the wall plane.

    A round arch's cap is circular in metres. Screen-space circles would
    ignore the oblique face and turn differently across the panorama seam.
    Bounds remain approximate photographic readings, never guessed features.
    """
    left, bottom, right, top = mark.bounds
    left, bottom = max(0, left - margin), max(0, bottom - margin)
    right, top = min(1, right + margin), min(1, top + margin)
    x = (u[None, :] - left) / (right - left) * 2 - 1
    y = (v - bottom) / (top - bottom)
    mask = (np.abs(x) <= 1) & (y >= 0) & (y <= 1)
    if mark.shape == "ellipse":
        mask &= x * x + (2 * y - 1) ** 2 <= 1
    elif mark.shape == "round-arch":
        wall_width = math.dist(reference.start[:2], reference.end[:2])
        height_a = reference.start[3] - reference.start[2]
        height_b = reference.end[3] - reference.end[2]
        wall_height = height_a + u * (height_b - height_a)
        rise = np.minimum(1, (right - left) * wall_width / (2 * (top - bottom) * wall_height))
        cap_y = np.maximum(0, (y - 1 + rise[None, :]) / rise[None, :])
        mask &= x * x + cap_y * cap_y <= 1
    return mask


def facade_coordinates(reference: FacadeReference, geometry: PanoramaGeometry,
                       building: ProjectedBuilding, width: int, height: int):
    """Return visible wall UV coordinates in a bounded raster region, or None."""
    ax, ay, ground_a, eaves_a = reference.start
    bx, by, ground_b, eaves_b = reference.end
    sx, sy = bx - ax, by - ay
    numerator = ax * sy - ay * sx
    # Right normal (sy,-sx) must face the observer. A photo of the outside
    # never becomes openings on the back or the opposite side of the solid.
    if numerator >= -1e-8:
        return None
    bearings = (np.arange(width, dtype=np.float64) + .5) / width * 2 * math.pi
    dx, dy = np.sin(bearings), np.cos(bearings)
    denominator = dx * sy - dy * sx
    distance = np.full(width, np.nan)
    u = np.full(width, np.nan)
    valid_ray = np.abs(denominator) > 1e-9
    np.divide(numerator, denominator, out=distance, where=valid_ray)
    np.divide(ax * dy - ay * dx, denominator, out=u, where=valid_ray)
    valid = valid_ray & (distance > 0) & (u >= 0) & (u <= 1)
    xs = np.flatnonzero(valid)
    if not len(xs):
        return None
    # Keep both pieces of a north-facing, wrap-crossing wall. Fancy indexing
    # avoids allocating a full-width field for a small reference face.
    d, face_u = distance[xs], u[xs]
    ground = ground_a + face_u * (ground_b - ground_a)
    eaves = eaves_a + face_u * (eaves_b - eaves_a)
    config = geometry.config
    angles = config.maximum_elevation_angle - (np.arange(height) + .5) / height * (
        config.maximum_elevation_angle - config.minimum_elevation_angle)
    v = (geometry.eye_elevation_meters + np.tan(np.radians(angles))[:, None] * d[None, :] - ground) / (eaves - ground)
    visible = (v >= 0) & (v <= 1)
    profiles = {}
    count = len(geometry.columns)
    resolution = 360 / count
    for sample in building.samples:
        index = round(sample.azimuth_degrees / resolution) % count
        profiles.setdefault(index, []).append(sample)
    for cursor, x in enumerate(xs):
        index = round((x + .5) / width * count) % count
        ownership = np.zeros(height, dtype=bool)
        for sample in profiles.get(index, ()):
            # An annex of this same solid can be in front of the reference
            # plane. Object ID alone is insufficient evidence of ownership.
            if abs(sample.distance_meters - d[cursor]) > max(.35, min(.5, .002 * d[cursor])):
                continue
            wall = (angles >= sample.lower_angle_degrees) & (angles <= sample.upper_angle_degrees)
            if sample.roof_intervals is None:
                wall &= angles <= sample.eaves_angle_degrees
            else:
                for lower, upper in sample.roof_intervals:
                    wall &= ~((angles >= lower) & (angles <= upper))
            ownership |= wall
        visible[:, cursor] &= ownership
    if not visible.any():
        return None
    return xs, face_u, v, visible


def paint_referenced_facades(base: Image.Image, geometry: PanoramaGeometry,
                            pigment: Image.Image, brush_pigment: Image.Image | None = None) -> None:
    """Keep quiet plaster planes, then place only observed, resolvable marks."""
    width, height = base.size
    wall_colors = {"chalk": (223, 215, 189), "rose": (196, 148, 131), "ochre": (211, 179, 119)}
    paper = np.asarray(pigment, dtype=np.float32) / 255
    # Share the landscape's registered brush field. Vary deposited pigment,
    # never the measured openings, their photographic shapes or wall ownership.
    brush = np.asarray(brush_pigment if brush_pigment is not None else pigment,
                       dtype=np.float32) / 255
    for building in geometry.buildings:
        for reference in building.facade_references:
            coordinates = facade_coordinates(reference, geometry, building, width, height)
            if coordinates is None:
                continue
            xs, u, v, visible = coordinates
            rgb = np.array(base, dtype=np.float32)
            local = rgb[:, xs].copy()
            # A thin plaster glaze leaves the underlying warm/cool wash alive.
            strength = (.30 + paper[:, xs] * .08) * visible
            color = np.asarray(wall_colors[reference.wall_tone], dtype=np.float32)
            local += (color - local) * strength[..., None]

            def glaze(mask, color, opacity):
                nonlocal local
                # Softness is in pixel space, not angular space. Reassemble
                # the north boundary first so the two ends blur as neighbours.
                field = np.zeros((height, width), dtype=np.uint8)
                field[:, xs] = np.rint(mask * 255).astype(np.uint8)
                padded = np.concatenate((field[:, -3:], field, field[:, :3]), axis=1)
                blurred = np.asarray(Image.fromarray(padded, "L").filter(ImageFilter.GaussianBlur(.60)))[:, 3:-3]
                alpha = blurred[:, xs] / 255 * visible * opacity * (.54 + .92 * brush[:, xs])
                local += (np.asarray(color) - local) * alpha[..., None]

            for mark in reference.marks:
                opening = _mark_mask(reference, mark, u, v) & visible
                # Do not grow a subpixel distant opening into a legibility
                # token; it must occupy actual visible image area.
                if np.count_nonzero(opening) < 3:
                    continue
                if mark.kind == "band":
                    glaze(opening, (235, 226, 201), .50)
                else:
                    # A filled dark stamp makes every observed opening equally
                    # emphatic. Let a thin wash vary within the same measured
                    # shape and lose selected margins into the plaster. The
                    # source identity fixes pigment load; no opening is moved,
                    # added, rounded off or enlarged for legibility.
                    identity = f"{reference.reference_id}|{mark.kind}|{mark.bounds}"
                    phase = int.from_bytes(hashlib.sha256(identity.encode()).digest()[:4], "little") / 2**32 * math.tau
                    load = (.75 + .20 * np.sin(math.tau * (.61 * u[None, :] + .37 * v) + phase)
                            + .10 * (brush[:, xs] - .5))
                    left, bottom, right, top = mark.bounds
                    edge = np.minimum(
                        np.minimum((u[None, :] - left) / (right - left),
                                   (right - u[None, :]) / (right - left)),
                        np.minimum((v - bottom) / (top - bottom),
                                   (top - v) / (top - bottom)))
                    edge = np.clip(1 - edge / .16, 0, 1)
                    load *= 1 - edge * (.18 + .18 * np.sin(
                        math.tau * (1.8 * u[None, :] + .8 * v) + phase))
                    frame = _mark_mask(reference, mark, u, v, .007) & visible
                    glaze(frame, (230, 220, 196), .27)
                    glaze(opening * load, (62, 70, 67) if mark.kind == "opening" else (70, 65, 57), .55)
            rgb[:, xs] = np.clip(local, 0, 255)
            base.paste(Image.fromarray(np.rint(rgb).astype(np.uint8), "RGB"))
