import uuid

from app.device_catalog import DeviceCatalog
from app.repository import ConnectionPointRecord, PhysicalConnectionMemberRecord


def simple_cable_members(
    catalog: DeviceCatalog,
    candidates: set[uuid.UUID],
    all_points: tuple[ConnectionPointRecord, ...],
    connection_members: tuple[PhysicalConnectionMemberRecord, ...],
) -> dict[uuid.UUID, tuple[PhysicalConnectionMemberRecord, ...]]:
    """Recognise exactly the cable shape used by L1 projection continuations."""
    classes = catalog.physical_object_classes(list(candidates))
    points_by_object: dict[uuid.UUID, set[uuid.UUID]] = {}
    for point in all_points:
        points_by_object.setdefault(point.physical_object_id, set()).add(point.point_id)
    simple: dict[uuid.UUID, tuple[PhysicalConnectionMemberRecord, ...]] = {}
    for cable_id in candidates:
        if classes.get(cable_id) is None or classes[cable_id].value != "cable":
            continue
        cable_points = points_by_object.get(cable_id, set())
        incident = [
            member for member in connection_members
            if cable_id in (member.object_a_id, member.object_b_id)
            and member.object_a_id != member.object_b_id
        ]
        neighbors = [
            member.object_b_id if member.object_a_id == cable_id else member.object_a_id
            for member in incident
        ]
        incident_points = {
            member.point_a_id if member.object_a_id == cable_id else member.point_b_id
            for member in incident
        }
        if (
            len(cable_points) == 2
            and len(incident) == 2
            and len({member.connection_id for member in incident}) == 2
            and len(set(neighbors)) == 2
            and incident_points == cable_points
        ):
            simple[cable_id] = tuple(incident)
    return simple
