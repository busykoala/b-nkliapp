"""Stable categorical contract for browser panorama material textures.

The canonical channels are data, not colour:

* R: logarithmic continuous distance, 0..255
* G: one exact categorical ID from ``MATERIAL_SEMANTIC_IDS``
* B: continuous surface-light response, 0..255
* A: continuous terrain coverage, where zero is sky

Categorical IDs must never be linearly interpolated or inferred from colour
ranges. Coverage may be filtered to retain the painted watercolor fringe.

Transport v2 stores opaque RGB facts above a separate opaque coverage plane,
followed by a version footer. Browser image/canvas alpha premultiplication
otherwise changes small categorical IDs at fractional-coverage pixels.
"""

from __future__ import annotations

from benchly.panorama.models import SemanticClass


MATERIAL_CONTRACT_VERSION = "opaque-facts-and-coverage-planes-v2"
MATERIAL_TRANSPORT_FOOTER = ((66, 78, 75), (77, 65, 84), (2, 0, 0))


def pack_material_transport(canonical):
    """Keep every fact and all eight coverage bits exact through image decoding."""
    import numpy as np

    height, width, channels = canonical.shape
    if width < 3 or height < 1 or channels != 4 or canonical.dtype != np.uint8:
        raise ValueError("Material transport requires uint8 RGBA data at least three pixels wide")
    packed = np.zeros((height * 2 + 1, width, 3), dtype=np.uint8)
    packed[:height] = canonical[..., :3]
    packed[height:height * 2, :, 0] = canonical[..., 3]
    packed[-1, :3] = MATERIAL_TRANSPORT_FOOTER
    return packed


def unpack_material_transport(pixels):
    """Decode v2 for audits; retain the older canonical RGBA representation."""
    import numpy as np

    height, width = pixels.shape[:2]
    tagged = width >= 3 and np.array_equal(pixels[-1, :2, :3], MATERIAL_TRANSPORT_FOOTER[:2])
    if tagged:
        if height < 3 or height % 2 != 1 or not np.array_equal(pixels[-1, :3, :3], MATERIAL_TRANSPORT_FOOTER):
            raise ValueError("Unsupported or malformed material transport")
        rows = (height - 1) // 2
        canonical = np.empty((rows, width, 4), dtype=np.uint8)
        canonical[..., :3] = pixels[:rows, :, :3]
        canonical[..., 3] = pixels[rows:rows * 2, :, 0]
        return canonical
    if pixels.shape[2] != 4:
        raise ValueError("Legacy material requires RGBA pixels")
    return pixels
MATERIAL_SEMANTIC_IDS = {
    SemanticClass.SKY: 0,
    SemanticClass.WATER: 1,
    SemanticClass.RIVER: 2,
    SemanticClass.FOREST: 3,
    SemanticClass.OPEN_GRASSLAND: 4,
    SemanticClass.ROCK: 5,
    SemanticClass.SNOW_OR_GLACIER: 6,
    SemanticClass.SETTLEMENT: 7,
    SemanticClass.BUILDING: 8,
    SemanticClass.UNKNOWN_TERRAIN: 9,
    SemanticClass.PAVED_GROUND: 10,
    SemanticClass.SURFACED_GROUND: 11,
}
MATERIAL_ID_TO_SEMANTIC = {value: key for key, value in MATERIAL_SEMANTIC_IDS.items()}
