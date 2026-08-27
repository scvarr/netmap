"""Derived, presentation-only geometry for immutable Blueprint snapshots."""
from dataclasses import dataclass


@dataclass(frozen=True)
class PortGeometryInput:
    slot_key: str
    instance_id: object | None
    local_id: str
    row: int | None
    column: int | None
    layout_order: int
    face: str
    placement: tuple[float, float, float, float] | None


def fallback_placement(index: int) -> tuple[float, float, float, float]:
    """Read-only historical c.5 fallback; must match the editor."""
    return (.08 + (index % 2) * .48, .12 + (index // 2) * .28, .36, .22)


def _edge(point: tuple[float, float], face: str, body: tuple[float, float]) -> str:
    x, y = point
    width, height = body
    choices = [(x * width, "LEFT"), ((1 - x) * width, "RIGHT")]
    # FRONT bottom / REAR top is an internal divider, never an external edge.
    choices.append((y * height, "TOP") if face == "FRONT" else ((1 - y) * height, "BOTTOM"))
    return min(choices, key=lambda value: (value[0], value[1]))[1]


def derive_port_geometry(
    ports: list[PortGeometryInput], body: tuple[float, float],
) -> dict[str, dict[str, object]]:
    """Return normalized rendered and external attachment coordinates by slot key."""
    by_instance: dict[object | None, list[PortGeometryInput]] = {}
    for port in ports:
        by_instance.setdefault(port.instance_id, []).append(port)
    rendered: dict[str, tuple[float, float]] = {}
    placements: dict[object | None, tuple[float, float, float, float] | None] = {}
    for instance, items in by_instance.items():
        placement = items[0].placement
        placements[instance] = placement
        if placement is None:
            # Snapshot-only versions have no PortBlock provenance; deterministic generic readability.
            for index, item in enumerate(sorted(items, key=lambda value: (value.layout_order, value.local_id))):
                rendered[item.slot_key] = (.95, (index + .5) / len(items))
            continue
        rows = max((item.row or 1) for item in items)
        columns = {row: max((item.column or 1) for item in items if (item.row or 1) == row) for row in range(1, rows + 1)}
        x0, y0, w, h = placement
        for item in items:
            row, column = item.row or 1, item.column or 1
            rendered[item.slot_key] = (x0 + w * (column - .5) / columns[row], y0 + h * (row - .5) / rows)
    grouped: dict[tuple[object | None, str], list[PortGeometryInput]] = {}
    edges: dict[str, str] = {}
    for port in ports:
        edge = _edge(rendered[port.slot_key], port.face, body)
        edges[port.slot_key] = edge
        grouped.setdefault((port.instance_id, edge), []).append(port)
    attachments: dict[str, tuple[float, float]] = {}
    for (instance, edge), items in grouped.items():
        placement = placements[instance]
        ordered = sorted(items, key=lambda item: (
            rendered[item.slot_key][1] if edge in {"LEFT", "RIGHT"} else rendered[item.slot_key][0],
            rendered[item.slot_key][0] if edge in {"LEFT", "RIGHT"} else rendered[item.slot_key][1],
            item.layout_order, item.local_id,
        ))
        if placement is None:
            for index, item in enumerate(ordered):
                offset = (index + .5) / len(ordered)
                attachments[item.slot_key] = (0 if edge == "LEFT" else 1 if edge == "RIGHT" else offset, offset if edge in {"LEFT", "RIGHT"} else 0 if edge == "TOP" else 1)
            continue
        x0, y0, width, height = placement
        for index, item in enumerate(ordered):
            offset = (index + .5) / len(ordered)
            attachments[item.slot_key] = (
                x0 if edge == "LEFT" else x0 + width if edge == "RIGHT" else x0 + width * offset,
                y0 + height * offset if edge in {"LEFT", "RIGHT"} else y0 if edge == "TOP" else y0 + height,
            )
    return {port.slot_key: {"rendered_position": {"x": rendered[port.slot_key][0], "y": rendered[port.slot_key][1]}, "external_attachment": {"x": attachments[port.slot_key][0], "y": attachments[port.slot_key][1], "side": edges[port.slot_key]}} for port in ports}
