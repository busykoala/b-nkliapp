"""Periodic paint removes study joins while preserving other vocabularies."""
import hashlib

import numpy as np
import pytest

from benchly.panorama.watercolor import (
    _brush_study,
    _periodic_brush_component,
    _sample_periodic_brush,
)


def test_periodic_component_solves_affine_boundary_drift_without_mutating_source():
    y, x = np.indices((96, 128))
    values = 80 + x * .5 + y * .3
    original = values.copy()
    result = _periodic_brush_component(values)
    expected = values.mean() + (.5 / 128) * (x - x.mean()) + (.3 / 96) * (y - y.mean())
    np.testing.assert_allclose(result, expected, atol=1e-10)
    np.testing.assert_array_equal(values, original)
    assert abs(result.mean() - values.mean()) < 1e-10
    assert np.std(result) < np.std(values) / 50


def test_periodic_component_keeps_constant_and_already_matching_borders():
    constant = np.full((64, 96), 123.)
    np.testing.assert_array_equal(_periodic_brush_component(constant), constant)
    y, x = np.indices((65, 97))
    motif = 128 + 25 * np.cos(2 * np.pi * x / 96) + 17 * np.cos(4 * np.pi * y / 64)
    np.testing.assert_allclose(_periodic_brush_component(motif), motif, atol=1e-10)


def test_periodic_sampler_interpolates_last_and_first_pixels_on_both_axes():
    values = np.array([[20., 60.], [100., 140.]])
    result = _sample_periodic_brush(values, np.array([1.5]), np.array([1.5]))
    np.testing.assert_array_equal(result, [80.])


def test_periodic_sampler_is_continuous_through_a_repeated_boundary():
    values = np.array([[20., 60.], [100., 140.]])
    near_wrap = _sample_periodic_brush(values, np.array([1.99999, 0., .00001]),
                                     np.array([1.99999, 0., .00001]))
    np.testing.assert_allclose(near_wrap, 20., atol=.002)


@pytest.mark.parametrize("kind,expected", [
    ("watercolor", "c111f5899c7553985856b8dc3149e229fde876647e21d73cb6bc40e4b7d2d996"),
    ("rock", "f6bc24de2373e8ccc7303c67d8a785ace3a79973262af0c70d24a8bd55618183"),
])
def test_foliage_join_fix_preserves_other_material_vocabulary(kind, expected):
    assert hashlib.sha256(_brush_study(kind, 720, 240, 92813).tobytes()).hexdigest() == expected
