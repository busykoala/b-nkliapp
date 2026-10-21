"""A foreground occluder must not join two visible pieces of a rear wall."""
import io

import numpy as np
from PIL import Image, ImageDraw
import pytest

from benchly.panorama.models import (
    BuildingProjectionSample, GeometryIdentity, PanoramaConfig, ProjectedBuilding,
    SemanticClass, TerrainRay, TerrainSample, VisibleSpan,
)
from benchly.panorama.material import unpack_material_transport
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import (
    _angle_y, _building_runs, _paint_buildings, _painted_skyline, _sky_mask,
    _wrap_blur, render_material_webp,
)


def geometry():
    config = PanoramaConfig(angular_resolution_degrees=1,
                            minimum_elevation_angle=-20, maximum_elevation_angle=40)
    identity = GeometryIdentity(latitude=47, longitude=8, ground_elevation_meters=500,
                                terrain_version="fixture", semantic_version="fixture",
                                building_version="fixture", angular_resolution_degrees=1)
    rays = [TerrainRay(azimuth_degrees=bearing, samples=(TerrainSample(
        distance_meters=100, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND,
        source="fixture"),)) for bearing in range(360)]
    return build_panorama_geometry(identity, rays, config=config)


def split_wall(g, start):
    samples = tuple(BuildingProjectionSample(
        azimuth_degrees=(start + step / 2) % 360,
        lower_angle_degrees=lower, eaves_angle_degrees=upper,
        upper_angle_degrees=upper, distance_meters=119 + step / 20,
        facade_index=0, facade_normal_degrees=90, roof_intervals=(),
    ) for step in range(41) for lower, upper in [(-10, 4), (8, 20)])
    return g.model_copy(update={"buildings": (ProjectedBuilding(
        object_id="rear-wall", source="fixture", confidence=1, samples=samples),)})


@pytest.mark.parametrize("start", [85, 350])
def test_disjoint_wall_keeps_both_visible_pieces_and_the_occluded_gap(start):
    g = split_wall(geometry(), start)
    before = g.model_dump()
    background = (129, 180, 220)
    canvas = Image.new("RGB", (1440, 360), background)
    _paint_buildings(canvas, g, 7, Image.new("L", canvas.size, 128))
    x = round(((start + 10) % 360) / 360 * canvas.width)
    assert canvas.getpixel((x, _angle_y(6, g, canvas.height))) == background
    for angle in (0, 16):
        red, green, blue = canvas.getpixel((x, _angle_y(angle, g, canvas.height)))
        assert red > green > blue
    assert g.model_dump() == before
    if start == 350:
        # One physical facade crosses north. Both pieces and the void retain
        # the same appearance on either side of the circular boundary.
        pixels = np.asarray(canvas)
        for angle in (0, 6, 16):
            row = _angle_y(angle, g, canvas.height)
            assert np.max(abs(pixels[row, 0].astype(int) - pixels[row, -1])) <= 2


def test_fragment_strips_keep_source_bounds_and_one_distance_treatment():
    g = split_wall(geometry(), 85)
    runs = list(_building_runs(g, 1440, 360))
    assert len(runs) > 1
    assert all(85 <= sample.azimuth_degrees <= 105
               for _, samples, _, _, _ in runs for sample in samples)
    # 119..121m straddles the haze cutoff. Splitting visibility must not
    # introduce a new hard colour division within this single source run.
    assert {distance for _, _, _, _, distance in runs} == {120}
    assert len({sample.distance_meters for _, samples, _, _, _ in runs
                for sample in samples}) > 1


def test_sky_below_an_elevated_roof_agrees_with_material_coverage():
    g = geometry()
    ground = VisibleSpan(lower_angle_degrees=-20, upper_angle_degrees=0,
                         distance_meters=100, semantic=SemanticClass.OPEN_GRASSLAND,
                         source="fixture", confidence=1)
    roof = VisibleSpan(lower_angle_degrees=10, upper_angle_degrees=15,
                       distance_meters=10, semantic=SemanticClass.BUILDING,
                       source="fixture", confidence=1, object_id="open-roof")
    g = g.model_copy(update={"columns": tuple(column.model_copy(update={
        "spans": (ground, roof), "skyline_angle_degrees": 15,
    }) for column in g.columns)})
    mask = _sky_mask(g, 720, 360)
    material = unpack_material_transport(np.asarray(
        Image.open(io.BytesIO(render_material_webp(g, 720, 360)))))
    for angle, sky in [(-10, False), (5, True), (12, False), (25, True)]:
        y = _angle_y(angle, g, mask.height)
        assert (mask.getpixel((0, y)) > 250) == sky
        assert (material[y, 0, 3] == 0) == sky
        assert mask.getpixel((0, y)) == mask.getpixel((719, y))


def test_continuous_land_keeps_the_existing_painted_contour_exactly():
    g = geometry()
    old = Image.new("L", (720, 360))
    contour = [(x, float(y)) for x, y in enumerate(_painted_skyline(g, 720, 360))]
    ImageDraw.Draw(old).polygon([(0, 0), (720, 0), *reversed(contour)], fill=255)
    assert _sky_mask(g, 720, 360).tobytes() == _wrap_blur(old, 1.2).tobytes()


def test_subpixel_gap_does_not_become_an_opaque_sky_pinhole():
    g = geometry()
    # Straddle a rounding boundary: the opening occupies less than one
    # hundredth of a raster row, even though its rounded endpoints differ.
    ground = VisibleSpan(lower_angle_degrees=-20, upper_angle_degrees=5.9166667,
                         distance_meters=100, semantic=SemanticClass.OPEN_GRASSLAND,
                         source="fixture", confidence=1)
    roof = VisibleSpan(lower_angle_degrees=5.918, upper_angle_degrees=15,
                       distance_meters=10, semantic=SemanticClass.BUILDING,
                       source="fixture", confidence=1, object_id="open-roof")
    g = g.model_copy(update={"columns": tuple(column.model_copy(update={
        "spans": (ground, roof), "skyline_angle_degrees": 15,
    }) for column in g.columns)})
    mask = np.asarray(_sky_mask(g, 720, 360))
    assert mask[200:210].max() <= 3
