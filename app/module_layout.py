"""Configuration presentation in normalized coordinates of the owning panel."""
import math


def initial_layout(bay, geometry, orientation, panel):
    width, height = geometry["width"], geometry["height"]
    if orientation == "VERTICAL":
        width, height = height, width
    scale = min(bay["width"] * panel["width"] / width, bay["height"] * panel["height"] / height)
    w, h = width * scale / panel["width"], height * scale / panel["height"]
    return {"panel_key": bay["panel_key"], "x": bay["x"] + (bay["width"] - w) / 2,
            "y": bay["y"] + (bay["height"] - h) / 2, "width": w, "height": h}


def validate_layout(layout, panel_key):
    if not isinstance(layout, dict) or set(layout) != {"panel_key", "x", "y", "width", "height"}:
        raise ValueError("Incomplete module layout")
    if layout["panel_key"] != panel_key:
        raise ValueError("Module layout belongs to another panel")
    if any(type(layout[k]) not in (int, float) or not math.isfinite(layout[k]) for k in ("x", "y", "width", "height")):
        raise ValueError("Invalid module layout coordinates")
    if not (0 <= layout["x"] < 1 and 0 <= layout["y"] < 1 and layout["width"] > 0 and layout["height"] > 0
            and layout["x"] + layout["width"] <= 1 + 1e-12 and layout["y"] + layout["height"] <= 1 + 1e-12):
        raise ValueError("Module layout exceeds panel")


def endpoint_position(layout, position, orientation):
    x, y = position["x"], position["y"]
    if orientation == "VERTICAL":
        x, y = 1 - y, x
    return layout["x"] + x * layout["width"], layout["y"] + y * layout["height"]
