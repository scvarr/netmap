"""Presentation-only Location boundary anchors for saved Cable routes."""

from __future__ import annotations

import uuid

from app.errors import ValidationError


def _inside(point: dict, frame: dict) -> bool:
    return frame["x"] < point["x"] < frame["x"] + frame["width"] and frame["y"] < point["y"] < frame["y"] + frame["height"]


def _on_boundary(point: dict, frame: dict) -> bool:
    left, top = frame["x"], frame["y"]
    right, bottom = left + frame["width"], top + frame["height"]
    near = lambda a, b: abs(a - b) <= 1e-7
    return ((near(point["x"], left) or near(point["x"], right)) and top <= point["y"] <= bottom or
            (near(point["y"], top) or near(point["y"], bottom)) and left <= point["x"] <= right)


def _project(location_id: uuid.UUID, frame: dict, point: dict) -> dict:
    left, top = frame["x"], frame["y"]
    right, bottom = left + frame["width"], top + frame["height"]
    candidates = [
        ("top", max(left, min(right, point["x"])), top, (max(left, min(right, point["x"])) - left) / frame["width"]),
        ("right", right, max(top, min(bottom, point["y"])), (max(top, min(bottom, point["y"])) - top) / frame["height"]),
        ("bottom", max(left, min(right, point["x"])), bottom, (max(left, min(right, point["x"])) - left) / frame["width"]),
        ("left", left, max(top, min(bottom, point["y"])), (max(top, min(bottom, point["y"])) - top) / frame["height"]),
    ]
    edge, x, y, offset = min(candidates, key=lambda item: (item[1] - point["x"]) ** 2 + (item[2] - point["y"]) ** 2)
    return {"x": x, "y": y, "anchor": {"location_id": str(location_id), "edge": edge, "offset": offset}}


def _resolve(point: dict, location_id: uuid.UUID, frame: dict) -> dict:
    anchor = point.get("anchor")
    if not anchor or str(anchor["location_id"]) != str(location_id):
        return dict(point)
    edge, offset = anchor["edge"], anchor["offset"]
    return {**point,
            "x": frame["x"] if edge == "left" else frame["x"] + frame["width"] if edge == "right" else frame["x"] + frame["width"] * offset,
            "y": frame["y"] if edge == "top" else frame["y"] + frame["height"] if edge == "bottom" else frame["y"] + frame["height"] * offset}


def normalize_boundary_route(
    location_id: uuid.UUID, frame: dict, source: dict, waypoints: list[dict], target: dict,
) -> tuple[list[dict], int]:
    """Prefer this Location's explicit splitter; materialize only for legacy routes."""
    explicit = [index for index, point in enumerate(waypoints)
                if point.get("anchor", {}).get("location_id") == str(location_id)]
    if len(explicit) > 1:
        raise ValidationError("Boundary route cannot be split unambiguously", {})
    resolved = [_resolve(point, location_id, frame) for point in waypoints]
    if explicit:
        return resolved, explicit[0]
    points = [source, *resolved, target]
    result: list[dict] = []
    for index, (start, end) in enumerate(zip(points, points[1:])):
        dx, dy = end["x"] - start["x"], end["y"] - start["y"]
        parameters = []
        for x in (frame["x"], frame["x"] + frame["width"]):
            if dx:
                t = (x - start["x"]) / dx
                y = start["y"] + t * dy
                if 0 < t < 1 and frame["y"] <= y <= frame["y"] + frame["height"]: parameters.append(t)
        for y in (frame["y"], frame["y"] + frame["height"]):
            if dy:
                t = (y - start["y"]) / dy
                x = start["x"] + t * dx
                if 0 < t < 1 and frame["x"] <= x <= frame["x"] + frame["width"]: parameters.append(t)
        ordered = sorted(parameters)
        unique = [t for position, t in enumerate(ordered) if position == 0 or abs(t - ordered[position - 1]) > 1e-9]
        for t in unique:
            before = {"x": start["x"] + dx * max(0, t - 1e-6), "y": start["y"] + dy * max(0, t - 1e-6)}
            after = {"x": start["x"] + dx * min(1, t + 1e-6), "y": start["y"] + dy * min(1, t + 1e-6)}
            if _inside(before, frame) != _inside(after, frame):
                result.append(_project(location_id, frame, {"x": start["x"] + dx * t, "y": start["y"] + dy * t}))
        if index >= len(resolved):
            continue
        waypoint = resolved[index]
        if waypoint.get("anchor"):
            result.append(waypoint)
            continue
        following = points[index + 2]
        if (_on_boundary(waypoint, frame) and _inside(start, frame) != _inside(following, frame)
                and not _on_boundary(start, frame) and not _on_boundary(following, frame)):
            result.append(_project(location_id, frame, waypoint))
        else:
            result.append(waypoint)
    anchors = [index for index, point in enumerate(result) if point.get("anchor", {}).get("location_id") == str(location_id)]
    if not anchors:
        raise ValidationError("Boundary Cable route does not cross LocationFrame", {})
    if len(anchors) > 1:
        raise ValidationError("Boundary route cannot be split unambiguously", {})
    return result, anchors[0]
