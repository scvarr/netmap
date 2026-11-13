"""Three-zone map presentation; keep constants in sync with blueprintDisplaySize.ts."""
from app.errors import ValidationError

NAME_ZONE_WIDTH = 72
CABLE_ZONE_WIDTH = 20


def object_frame_dimensions(panels, centres, display_width=None):
    composition_width = max(p.x + p.width for p in panels) - min(p.x for p in panels)
    composition_height = max(p.y + p.height for p in panels) - min(p.y for p in panels)
    minimum = max(32, *(12 * composition_width / p.height for p in panels))
    for index, (x, y) in enumerate(centres):
        for ox, oy in centres[index + 1:]:
            distance = max(abs(x - ox), abs(y - oy))
            if distance == 0:
                raise ValidationError("Coincident map ports", {})
            minimum = max(minimum, 10 * composition_width / distance)
    if minimum > 960:
        raise ValidationError("Unsupported map port geometry", {})
    width = max(display_width if display_width is not None else 240, minimum)
    return width + NAME_ZONE_WIDTH + CABLE_ZONE_WIDTH, width * composition_height / composition_width
