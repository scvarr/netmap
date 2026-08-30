from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import StrEnum


Point = Mapping[str, float]


class MapRegionSpatialRelation(StrEnum):
    DISJOINT = "DISJOINT"
    A_STRICTLY_CONTAINS_B = "A_STRICTLY_CONTAINS_B"
    B_STRICTLY_CONTAINS_A = "B_STRICTLY_CONTAINS_A"
    CONFLICT = "CONFLICT"


def classify_map_region_polygons(
    first: Sequence[Point], second: Sequence[Point]
) -> MapRegionSpatialRelation:
    """Classify two individually valid simple polygons under the exact Region contract."""
    if any(
        _segments_intersect(
            first[first_index], first[(first_index + 1) % len(first)],
            second[second_index], second[(second_index + 1) % len(second)],
        )
        for first_index in range(len(first))
        for second_index in range(len(second))
    ):
        return MapRegionSpatialRelation.CONFLICT

    if _point_is_strictly_inside(first[0], second):
        return MapRegionSpatialRelation.B_STRICTLY_CONTAINS_A
    if _point_is_strictly_inside(second[0], first):
        return MapRegionSpatialRelation.A_STRICTLY_CONTAINS_B
    return MapRegionSpatialRelation.DISJOINT


def _cross(origin: Point, left: Point, right: Point) -> float:
    return (left["x"] - origin["x"]) * (right["y"] - origin["y"]) - (
        left["y"] - origin["y"]
    ) * (right["x"] - origin["x"])


def _point_on_segment(start: Point, point: Point, end: Point) -> bool:
    return _cross(start, end, point) == 0 and (
        min(start["x"], end["x"]) <= point["x"] <= max(start["x"], end["x"])
        and min(start["y"], end["y"]) <= point["y"] <= max(start["y"], end["y"])
    )


def _segments_intersect(first_start: Point, first_end: Point, second_start: Point, second_end: Point) -> bool:
    first_left = _cross(first_start, first_end, second_start)
    first_right = _cross(first_start, first_end, second_end)
    second_left = _cross(second_start, second_end, first_start)
    second_right = _cross(second_start, second_end, first_end)
    if ((first_left > 0 > first_right) or (first_left < 0 < first_right)) and (
        (second_left > 0 > second_right) or (second_left < 0 < second_right)
    ):
        return True
    return (
        _point_on_segment(first_start, second_start, first_end)
        or _point_on_segment(first_start, second_end, first_end)
        or _point_on_segment(second_start, first_start, second_end)
        or _point_on_segment(second_start, first_end, second_end)
    )


def _point_is_strictly_inside(point: Point, polygon: Sequence[Point]) -> bool:
    inside = False
    for index, start in enumerate(polygon):
        end = polygon[(index + 1) % len(polygon)]
        if _point_on_segment(start, point, end):
            return False
        if (start["y"] > point["y"]) != (end["y"] > point["y"]):
            x_intersection = start["x"] + (end["x"] - start["x"]) * (point["y"] - start["y"]) / (end["y"] - start["y"])
            if x_intersection > point["x"]:
                inside = not inside
    return inside
