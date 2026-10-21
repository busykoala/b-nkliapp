"""Image transport must preserve facts even at nearly transparent fringes."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image
import pytest

from benchly.panorama.material import pack_material_transport, unpack_material_transport


def test_opaque_webp_roundtrip_preserves_every_coverage_byte_and_semantic_id():
    canonical = np.zeros((11, 256, 4), dtype=np.uint8)
    canonical[..., 0] = np.arange(256)
    canonical[..., 1] = np.arange(11)[:, None]
    canonical[..., 2] = np.arange(255, -1, -1)
    canonical[..., 3] = np.arange(256)
    packed = pack_material_transport(canonical)
    stream = io.BytesIO()
    Image.fromarray(packed, "RGB").save(stream, format="WEBP", lossless=True, exact=True)
    decoded = np.asarray(Image.open(io.BytesIO(stream.getvalue())).convert("RGBA"))
    # No alpha operation can discard or round the transported categorical data.
    assert decoded[..., 3].min() == 255
    np.testing.assert_array_equal(unpack_material_transport(decoded), canonical)


def test_legacy_rgba_is_retained_including_odd_height_and_fractional_coverage():
    legacy = np.zeros((5, 8, 4), dtype=np.uint8)
    legacy[..., 1] = 9
    legacy[..., 3] = np.arange(8) * 31
    assert unpack_material_transport(legacy) is legacy


def test_transport_refuses_unpaired_planes_unknown_version_and_narrow_output():
    with pytest.raises(ValueError):
        pack_material_transport(np.zeros((4, 2, 4), dtype=np.uint8))
    valid = pack_material_transport(np.zeros((4, 8, 4), dtype=np.uint8))
    with pytest.raises(ValueError):
        unpack_material_transport(valid[1:])
    valid[-1, 2, 0] = 3
    with pytest.raises(ValueError):
        unpack_material_transport(valid)
