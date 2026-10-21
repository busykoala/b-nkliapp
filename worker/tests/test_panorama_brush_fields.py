"""Material brush vocabulary is circular, quiet and specific to each place."""
from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from benchly.panorama.watercolor import _brush_source, _brush_study, _painting_seed


@pytest.mark.parametrize("kind", ["watercolor", "foliage", "rock"])
def test_brush_field_is_deterministic_circular_and_does_not_mutate_its_source(kind):
    source = np.array(_brush_source(kind,720,240))
    first = np.array(_brush_study(kind,720,240,92813))
    np.testing.assert_array_equal(first,np.array(_brush_study(kind,720,240,92813)))
    np.testing.assert_array_equal(first[:,0],first[:,-1])
    np.testing.assert_array_equal(source,np.array(_brush_source(kind,720,240)))
    assert first.dtype == np.uint8 and first.shape == (240,720)
    assert np.std(first) > 5  # retain purposeful brush variation, not a flat tint
    assert np.std(first) < np.std(source)  # keep it subordinate to the forms


@pytest.mark.parametrize("kind", ["watercolor", "foliage", "rock"])
def test_place_changes_marks_but_cache_and_season_metadata_do_not(kind):
    place = SimpleNamespace(latitude=47.1234567,longitude=8.7654321,identity_key="old",season="summer")
    seed = _painting_seed(place,"brush-vocabulary")
    first = np.array(_brush_study(kind,720,240,seed),dtype=np.int16)
    place.identity_key,place.season = "corrected-capsule","winter"
    assert _painting_seed(place,"brush-vocabulary") == seed
    place.latitude += .02
    second = np.array(_brush_study(kind,720,240,_painting_seed(place,"brush-vocabulary")),dtype=np.int16)
    assert np.abs(first-second).mean() > 3
