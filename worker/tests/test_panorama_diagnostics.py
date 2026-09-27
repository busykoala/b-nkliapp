from __future__ import annotations

import numpy as np
from PIL import Image

from benchly.panorama.diagnostics import _semantic_image, selected_ray
from benchly.panorama.material import MATERIAL_SEMANTIC_IDS
from benchly.panorama.models import SemanticClass
from test_panorama_generation import fixture_geometry


def test_selected_ray_reports_real_span_owner_or_sky():
    geometry = fixture_geometry()
    index, owner = selected_ray(geometry, 0, geometry.columns[0].skyline_angle_degrees - .1)
    assert index == 0
    assert owner is not None
    assert owner.semantic == SemanticClass.ROCK
    _index, sky = selected_ray(geometry, 0, geometry.columns[0].skyline_angle_degrees + 1)
    assert sky is None


def test_semantic_false_colour_never_invents_class_between_adjacent_ids():
    packed = np.zeros((1, 2, 4), dtype=np.uint8)
    packed[..., 3] = 255
    packed[0, 0, 1] = MATERIAL_SEMANTIC_IDS[SemanticClass.FOREST]
    packed[0, 1, 1] = MATERIAL_SEMANTIC_IDS[SemanticClass.BUILDING]
    rendered = np.asarray(_semantic_image(Image.fromarray(packed, "RGBA")))
    colours = {tuple(value) for value in rendered.reshape(-1, 3)}
    assert colours == {
        (40, 91, 63),
        (166, 86, 61),
    }
