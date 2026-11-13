from types import SimpleNamespace
import pytest
from app.object_frame_geometry import object_frame_dimensions


@pytest.mark.parametrize("count", [48, 52])
@pytest.mark.parametrize("saved_width", [40, 240, 480, 960])
def test_three_zone_density_and_saved_width(count, saved_width):
    columns = count // 2
    panels = [SimpleNamespace(x=0, y=0, width=480, height=44)]
    centres = [(480 * (i % columns + .5) / columns, 44 * (.25 if i < columns else .75)) for i in range(count)]
    width, height = object_frame_dimensions(panels, centres, saved_width)
    composition = max(saved_width, columns * 10)
    assert width == pytest.approx(composition + 92)
    assert height == pytest.approx(composition * 44 / 480)


def test_offset_panels_and_default_width():
    panels = [SimpleNamespace(x=-10, y=7, width=480, height=44), SimpleNamespace(x=-10, y=51, width=480, height=44)]
    assert object_frame_dimensions(panels, [], None) == (332, 44)
