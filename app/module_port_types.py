"""Catalog references for transceiver ports and module bays."""

from uuid import UUID

from sqlalchemy import select

from app.errors import ValidationError
from app.models import ModuleBayType, ModulePortType


MOUNT_CATALOGS = {
    "MODULE_PORT": ("module_port_type_id", ModulePortType),
    "MODULE_BAY": ("module_bay_type_id", ModuleBayType),
}
MOUNT_FIELDS = ("mount_kind", "module_port_type_id", "module_bay_type_id")


def mount_identity(mount):
    kind = mount["mount_kind"]
    field, _ = MOUNT_CATALOGS[kind]
    return kind, str(mount[field])


def mount_document(kind, type_id):
    field, _ = MOUNT_CATALOGS[kind]
    return {"mount_kind": kind, field: str(type_id)}


def row_mount(row):
    field, _ = MOUNT_CATALOGS[row.mount_kind]
    return mount_document(row.mount_kind, getattr(row, field))


def base_assignments(definition):
    return {(bay["bay_key"], *mount_identity(bay)) for bay in definition.get("bays", ())}


def module_assignments(definition):
    return {
        (None, *mount_identity(definition)),
        *((place["key"], *mount_identity(place)) for place in definition.get("module_places", ())),
    }


def validate_mount_types(session, assignments, previous=()):
    for kind, (_, model) in MOUNT_CATALOGS.items():
        selected = {(key, type_id) for key, mount_kind, type_id in assignments if mount_kind == kind}
        ids = {UUID(type_id) for _, type_id in selected}
        if not ids:
            continue
        types = {item.id: item for item in session.scalars(
            select(model).where(model.id.in_(ids)).order_by(model.id)
            .with_for_update(read=True).execution_options(populate_existing=True)
        )}
        if ids != types.keys():
            raise ValidationError("Type not found in the matching mount catalog")
        if any(not types[UUID(type_id)].is_active and (key, kind, type_id) not in previous
               for key, type_id in selected):
            raise ValidationError("An archived mount type cannot be newly assigned")


def result_mounts(result, impact_section):
    for entry in (result, *result[impact_section]):
        for change in entry["changes"]:
            for side in ("before", "after"):
                snapshot = change.get(side)
                if snapshot is None:
                    continue
                if change["section"] == "bays":
                    yield {key: snapshot[key] for key in MOUNT_FIELDS if key in snapshot} if isinstance(snapshot, dict) else snapshot
                elif change["section"] == "module_places":
                    yield {key: snapshot[key] for key in MOUNT_FIELDS if key in snapshot}
                elif change["section"] == "properties" and change["key"] == "mount":
                    yield snapshot
        for reason in entry.get("reasons", ()):
            if reason.get("mount") is not None:
                yield reason["mount"]
