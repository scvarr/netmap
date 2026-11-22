"""Configuration presentation in normalized coordinates of the owning panel."""
import math


def initial_layout(bay, geometry, orientation, panel, places=()):
    if bay.get("kind") == "LOGICAL":
        keys = sorted(p["bay_key"] for p in places
                      if p["kind"] == "LOGICAL" and p["panel_key"] == bay["panel_key"])
        index = keys.index(bay["bay_key"])
        columns = min(len(keys), max(1, math.ceil(math.sqrt(len(keys) * panel["width"] / panel["height"]))))
        rows = math.ceil(len(keys) / columns)
        # A transient initial-fit region, never a logical place rectangle.
        bay = {**bay, "x": (index % columns) / columns, "y": (index // columns) / rows,
               "width": 1 / columns, "height": 1 / rows}
    width, height = geometry["width"], geometry["height"]
    if orientation == "VERTICAL":
        width, height = height, width
    if bay["width"] is None:
        # A point anchors the initial module body. Use the existing default
        # 30% fit region and keep the body on-panel even at an edge anchor.
        scale = min(.3 * panel["width"] / width, .3 * panel["height"] / height)
        w, h = width * scale / panel["width"], height * scale / panel["height"]
        return {"panel_key": bay["panel_key"], "x": max(0, min(1 - w, bay["x"] - w / 2)),
                "y": max(0, min(1 - h, bay["y"] - h / 2)), "width": w, "height": h}
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


def nested_place(place, panel_key):
    return {**place, "bay_key": place["key"], "panel_key": panel_key, "kind": "PLACED",
            "width": place.get("width"), "height": place.get("height")}


def compose_layout(parent_layout, parent_turns, local_layout):
    x, y, width, height = (local_layout[k] for k in ("x", "y", "width", "height"))
    if parent_turns == 1:
        x, y, width, height = 1 - y - height, x, height, width
    elif parent_turns == 2:
        x, y = 1 - x - width, 1 - y - height
    elif parent_turns == 3:
        x, y, width, height = y, 1 - x - width, height, width
    return {"panel_key": parent_layout["panel_key"], "x": parent_layout["x"] + x * parent_layout["width"],
            "y": parent_layout["y"] + y * parent_layout["height"], "width": width * parent_layout["width"],
            "height": height * parent_layout["height"]}
