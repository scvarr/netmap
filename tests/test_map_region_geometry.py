import pytest

from app.map_region_geometry import MapRegionSpatialRelation, classify_map_region_polygons


pytestmark = pytest.mark.no_database


def polygon(*coordinates: tuple[float, float]) -> list[dict[str, float]]:
    return [{"x": x, "y": y} for x, y in coordinates]


SQUARE = polygon((0, 0), (10, 0), (10, 10), (0, 10))


@pytest.mark.parametrize(
    ("first", "second", "expected"),
    [
        (SQUARE, polygon((20, 0), (30, 0), (30, 10), (20, 10)), MapRegionSpatialRelation.DISJOINT),
        (SQUARE, polygon((2, 2), (4, 2), (4, 4), (2, 4)), MapRegionSpatialRelation.A_STRICTLY_CONTAINS_B),
        (polygon((2, 2), (4, 2), (4, 4), (2, 4)), SQUARE, MapRegionSpatialRelation.B_STRICTLY_CONTAINS_A),
        (SQUARE, polygon((5, -2), (12, -2), (12, 5), (5, 5)), MapRegionSpatialRelation.CONFLICT),
        (SQUARE, polygon((-2, 5), (5, -2), (12, 5), (5, 12)), MapRegionSpatialRelation.CONFLICT),
        (SQUARE, polygon((5, 0), (7, -3), (8, -1)), MapRegionSpatialRelation.CONFLICT),
        (SQUARE, polygon((10, 10), (13, 11), (11, 13)), MapRegionSpatialRelation.CONFLICT),
        (SQUARE, polygon((3, 0), (7, 0), (7, -3), (3, -3)), MapRegionSpatialRelation.CONFLICT),
        (SQUARE, SQUARE, MapRegionSpatialRelation.CONFLICT),
        (
            polygon((0, 0), (8, 0), (8, 8), (5, 8), (5, 3), (3, 3), (3, 8), (0, 8)),
            polygon((0.5, 4), (2, 4), (2, 6), (0.5, 6)),
            MapRegionSpatialRelation.A_STRICTLY_CONTAINS_B,
        ),
    ],
)
def test_classify_map_region_polygons(first, second, expected):
    assert classify_map_region_polygons(first, second) == expected
