"""Derived presentation geometry for direct Blueprint endpoint slots."""


def derive_port_geometry(slots, body: tuple[float, float]) -> dict[str, dict[str, object]]:
    """Place cables on the outer perimeter of the complete two-face object."""
    width, height = body
    result = {}
    for slot in slots:
        x, y, face = slot.position_x, slot.position_y, slot.face
        candidates = [
            (x * width, "LEFT"),
            ((1 - x) * width, "RIGHT"),
            (y * height, "TOP") if face == "FRONT" else ((1 - y) * height, "BOTTOM"),
        ]
        side = min(candidates, key=lambda item: (item[0], item[1]))[1]
        attachment = {
            "LEFT": (0, y), "RIGHT": (1, y),
            "TOP": (x, 0), "BOTTOM": (x, 1),
        }[side]
        result[slot.slot_key] = {
            "rendered_position": {"x": x, "y": y},
            "external_attachment": {"x": attachment[0], "y": attachment[1], "side": side},
        }
    return result
