"""Stable categorical contract for browser panorama material textures.

The texture channels are data, not colour:

* R: logarithmic continuous distance, 0..255
* G: one exact categorical ID from ``MATERIAL_SEMANTIC_IDS``
* B: continuous surface-light response, 0..255
* A: continuous terrain coverage, where zero is sky

Categorical IDs must never be linearly interpolated or inferred from colour
ranges.  Coverage may be filtered to retain the painted watercolor fringe.
"""

from __future__ import annotations

from benchly.panorama.models import SemanticClass


MATERIAL_CONTRACT_VERSION = "rgba-depth-semantic-normal-coverage-v1"
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
}
MATERIAL_ID_TO_SEMANTIC = {value: key for key, value in MATERIAL_SEMANTIC_IDS.items()}
