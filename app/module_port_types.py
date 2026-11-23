"""Catalog references for transceiver ports and module bays."""

from uuid import UUID

from sqlalchemy import select

from app.errors import ModelError, ValidationError
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


def validate_module_authoring(definition):
    places = definition.get("module_places", ())
    if any(place["mount_kind"] == "MODULE_BAY" for place in places):
        raise ValidationError("Шаблон модуля не может содержать отсеки для плат",
                              {"reason": "NESTED_MODULE_BAY_FORBIDDEN"})
    if definition["mount_kind"] == "MODULE_PORT" and places:
        raise ValidationError("Шаблон трансивера не может содержать дочерние посадочные места",
                              {"reason": "TRANSCEIVER_CHILD_PLACES_FORBIDDEN"})


def validate_transceiver_authoring(definition, source=None):
    if source and source.get("transceiver") is not None and definition.get("transceiver") is None:
        raise ValidationError("Опубликованное определение трансивера требует физического окончания",
                              {"reason": "TRANSCEIVER_SPECIFICATIONS_REQUIRED"})
    if definition["mount_kind"] != "MODULE_PORT" or definition.get("transceiver") is not None:
        return
    if source and source["mount_kind"] == "MODULE_PORT" and source.get("transceiver") is None:
        retained = {(e["key"], e["kind"], e["port_type_id"]) for e in source["endpoints"]}
        if all((e["key"], e["kind"], e["port_type_id"]) in retained for e in definition["endpoints"]):
            return
    if definition["endpoints"]:
        raise ValidationError("Для физического окончания трансивера требуется определение его характеристик",
                              {"reason": "TRANSCEIVER_SPECIFICATIONS_REQUIRED"})


def validate_nested_installation(parent_mount_kind, place_mount_kind, *, parent_is_root):
    if not parent_is_root or parent_mount_kind != "MODULE_BAY" or place_mount_kind != "MODULE_PORT":
        raise ModelError("Вложенная установка допустима только для трансивера в порту платы, установленной в базовый отсек",
                         {"reason": "UNSUPPORTED_NESTED_MODULE_INSTALLATION"})


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
