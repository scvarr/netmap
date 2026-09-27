"""Local geometry contract for Blueprint panel composition."""
from types import SimpleNamespace

import pytest

from app.blueprint_presentation_geometry import derive_port_geometry


pytestmark = pytest.mark.no_database


def panel(key, x, y, width=100, height=100):
    return SimpleNamespace(panel_key=key, x=x, y=y, width=width, height=height)


def slot(key, panel_key, x, y):
    return SimpleNamespace(slot_key=key, panel_key=panel_key, position_x=x, position_y=y)


def test_single_panel_attachment_uses_its_outer_edge():
    geometry = derive_port_geometry([slot("a", "one", .1, .5)], [panel("one", 0, 0)])
    assert geometry["a"]["rendered_position"] == {"x": .1, "y": .5}
    assert geometry["a"]["external_attachment"] == {"x": 0, "y": .5, "side": "LEFT"}


def test_adjacent_panels_use_full_composition_bounds():
    panels = [panel("left", 0, 0), panel("right", 100, 0)]
    geometry = derive_port_geometry([slot("a", "left", .5, .5), slot("b", "right", .5, .5)], panels)
    assert geometry["a"]["rendered_position"] == {"x": .25, "y": .5}
    assert geometry["b"]["rendered_position"] == {"x": .75, "y": .5}
    assert geometry["b"]["external_attachment"]["side"] in {"TOP", "BOTTOM", "RIGHT"}


def test_internal_seam_is_not_an_external_attachment_edge():
    panels = [panel("left", 0, 0), panel("right", 100, 0)]
    geometry = derive_port_geometry([slot("near-seam", "left", .99, .5)], panels)["near-seam"]
    assert geometry["external_attachment"]["side"] in {"TOP", "BOTTOM"}
    assert geometry["external_attachment"]["y"] in {0, 1}
