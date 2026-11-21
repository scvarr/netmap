"""References to the user-defined module port type catalog."""

from uuid import UUID

from sqlalchemy import select

from app.errors import ValidationError
from app.models import ModulePortType


def base_assignments(definition):
    return {(bay["bay_key"], bay["module_port_type_id"]) for bay in definition.get("bays", ())}


def module_assignments(definition):
    return {
        (None, definition["module_port_type_id"]),
        *((port["key"], port["module_port_type_id"]) for port in definition.get("module_ports", ())),
    }


def validate_module_port_types(session, assignments, previous=()):
    ids = {UUID(type_id) for _, type_id in assignments}
    if not ids:
        return
    types = {item.id: item for item in session.scalars(
        select(ModulePortType).where(ModulePortType.id.in_(ids)).order_by(ModulePortType.id)
        .with_for_update(read=True).execution_options(populate_existing=True)
    )}
    if ids != types.keys():
        raise ValidationError("Module port type not found")
    if any(not types[UUID(type_id)].is_active and (key, type_id) not in previous
           for key, type_id in assignments):
        raise ValidationError("An archived module port type cannot be newly assigned")


def result_type_references(result, impact_section):
    impacts = result[impact_section]
    for entry in (result, *impacts):
        for change in entry["changes"]:
            for side in ("before", "after"):
                snapshot = change.get(side)
                if change["section"] in ("bays", "module_ports") and snapshot is not None:
                    yield snapshot.get("module_port_type_id") if isinstance(snapshot, dict) else None
                elif change["section"] == "properties" and change["key"] == "module_port_type_id":
                    yield snapshot
        for reason in entry.get("reasons", ()):
            if reason.get("module_port_type_id") is not None:
                yield reason["module_port_type_id"]
