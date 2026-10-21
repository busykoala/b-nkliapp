"""Architectural paint can vary without exposing terrain or adding geometry."""
import numpy as np
from PIL import Image

from benchly.panorama.watercolor import _architecture_wash, _soften_architecture


def test_wash_lifts_to_paper_and_preserves_opaque_nearby_wall():
    overlay = Image.new("RGBA", (128, 64), (186, 148, 113, 255))
    field = Image.fromarray(np.tile(np.linspace(0, 255, 128).astype("uint8"), (64, 1)))
    original = overlay.tobytes()
    painted = np.array(_architecture_wash(overlay, field, field))
    assert overlay.tobytes() == original
    assert np.all(painted[..., 3] == 255)
    assert painted[:, -1, :3].mean() > painted[:, 0, :3].mean() + 15
    # A washed wall keeps its warm family, including its cool pigment pools.
    assert np.all(painted[..., 0] > painted[..., 1])


def test_transparent_background_and_circular_boundary_are_preserved():
    overlay = Image.new("RGBA", (128, 64), (186, 148, 113, 0))
    overlay.paste((186, 148, 113, 255), (0, 20, 128, 40))
    values = np.tile((128 + 80 * np.cos(np.linspace(0, 2 * np.pi, 128))).astype("uint8"), (64, 1))
    values[:, -1] = values[:, 0]
    painted = np.array(_architecture_wash(overlay, Image.fromarray(values), Image.fromarray(values)))
    np.testing.assert_array_equal(painted[..., 3], np.array(overlay)[..., 3])
    np.testing.assert_array_equal(painted[:, 0], painted[:, -1])


def test_wet_edge_keeps_pigment_colour_instead_of_transparent_black_outline():
    overlay = Image.new("RGBA", (128, 64))
    overlay.paste((200, 170, 140, 255), (30, 15, 90, 50))
    softened = np.array(_soften_architecture(overlay, 1.5))
    fringe = (softened[..., 3] > 40) & (softened[..., 3] < 200)
    assert fringe.any()
    assert np.max(np.abs(softened[fringe, :3].astype(int) - (200, 170, 140))) < 6
