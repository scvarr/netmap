"""Derived geometry for a composition of axis-aligned Blueprint panels."""


def composition_bounds(panels):
    left = min(panel.x for panel in panels)
    top = min(panel.y for panel in panels)
    right = max(panel.x + panel.width for panel in panels)
    bottom = max(panel.y + panel.height for panel in panels)
    return left, top, right, bottom


def _outside_segments(panel, panels, side):
    """Subtract neighboring occupied intervals from one panel edge."""
    vertical = side in ("LEFT", "RIGHT")
    coordinate = panel.x if side == "LEFT" else panel.x + panel.width if side == "RIGHT" else panel.y if side == "TOP" else panel.y + panel.height
    start = panel.y if vertical else panel.x
    end = start + (panel.height if vertical else panel.width)
    covered = []
    for other in panels:
        if other is panel:
            continue
        if vertical:
            across = other.x < coordinate <= other.x + other.width if side == "LEFT" else other.x <= coordinate < other.x + other.width
            overlap = (other.y, other.y + other.height)
        else:
            across = other.y < coordinate <= other.y + other.height if side == "TOP" else other.y <= coordinate < other.y + other.height
            overlap = (other.x, other.x + other.width)
        if across:
            covered.append((max(start, overlap[0]), min(end, overlap[1])))
    segments = [(start, end)]
    for lo, hi in covered:
        if lo >= hi:
            continue
        segments = [(a, min(b, lo)) for a, b in segments if a < lo] + [(max(a, hi), b) for a, b in segments if b > hi]
    return [(coordinate, a, b) for a, b in segments if a < b]


def derive_port_geometry(slots, panels) -> dict[str, dict[str, object]]:
    """Attach each slot to the nearest exposed edge of the full composition."""
    panels = tuple(panels)
    by_key = {panel.panel_key: panel for panel in panels}
    left, top, right, bottom = composition_bounds(panels)
    width, height = right - left, bottom - top
    boundary = [(side, *segment) for panel in panels for side in ("LEFT", "RIGHT", "TOP", "BOTTOM") for segment in _outside_segments(panel, panels, side)]
    result = {}
    for slot in slots:
        panel = by_key[slot.panel_key]
        x = panel.x + panel.width * slot.position_x
        y = panel.y + panel.height * slot.position_y
        candidates = []
        for side, coordinate, start, end in boundary:
            along = y if side in ("LEFT", "RIGHT") else x
            nearest = max(start, min(along, end))
            ax, ay = (coordinate, nearest) if side in ("LEFT", "RIGHT") else (nearest, coordinate)
            candidates.append(((x - ax) ** 2 + (y - ay) ** 2, side, ax, ay))
        _, side, ax, ay = min(candidates)
        result[slot.slot_key] = {
            "panel_local_position": {"x": slot.position_x, "y": slot.position_y},
            "rendered_position": {"x": (x - left) / width, "y": (y - top) / height},
            "external_attachment": {"x": (ax - left) / width, "y": (ay - top) / height, "side": side},
        }
    return result
