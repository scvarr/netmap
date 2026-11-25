"""Physical catalogs and template assignment validation."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, field_validator
from sqlalchemy import cast, or_, select
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_session
from app.errors import ValidationError
from app.models import (
    BaseTemplateCandidate, BaseTemplateDraft, BuiltInEndpointDefinition,
    ModuleBay, ModuleBayType, ModuleEndpointDefinition, ModulePortType, ModuleTemplateCandidate,
    ModuleTemplateDraft, ModuleTemplateRevision, PortType, PortTypeCompatibility,
)

Medium = Literal["COPPER", "FIBER"]
CompatibilityMode = Literal["SAME_TYPE", "MATRIX", "UNDEFINED"]
StructuralLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255, pattern=r"^[^\x00\r\n]+$")]
DatabaseSession = Annotated[Session, Depends(get_session)]


def supports_transceiver_termination(medium: str, cardinality: int) -> bool:
    return cardinality == 1 or (medium == "FIBER" and cardinality == 2)


class CatalogInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=255)]
    description: str | None = None
    color: Annotated[str, Field(pattern=r"^#[0-9A-F]{6}$")]
    is_active: StrictBool = True

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("color", mode="before")
    @classmethod
    def normalize_color(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("name", "description")
    @classmethod
    def reject_null_byte(cls, value):
        if value is not None and "\x00" in value:
            raise ValueError("NUL characters are not allowed")
        return value


class PortStructure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    medium: Medium
    members: Annotated[list[StructuralLabel], Field(min_length=1)]
    @field_validator("members")
    @classmethod
    def unique_members(cls, members):
        if len({label.casefold() for label in members}) != len(members):
            raise ValueError("Member designations must be unique")
        return members


class PortTypeInput(CatalogInput, PortStructure):
    compatibility_mode: CompatibilityMode = "UNDEFINED"


class MountTypeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=255)]
    is_active: StrictBool = True

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        if not value.strip() or "\x00" in value:
            raise ValueError("A module port type name must be nonblank and contain no NUL characters")
        return value


class CatalogDocument(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class PortTypeDocument(PortTypeInput, CatalogDocument):
    cardinality: int


class MountTypeDocument(MountTypeInput, CatalogDocument):
    pass


SNAPSHOT_SECTIONS = (
    (BaseTemplateDraft, "slots"), (BaseTemplateCandidate, "slots"),
    (ModuleTemplateDraft, "endpoints"), (ModuleTemplateCandidate, "endpoints"),
)


def validate_port_type_assignments(session, endpoints, previous=(), *, transceiver=None):
    retained = {(endpoint["key"], endpoint["port_type_id"]) for endpoint in previous}
    ids = {uuid.UUID(endpoint["port_type_id"]) for endpoint in endpoints}
    if not ids:
        return {}
    # This lock also covers the structural check and holds until commit.
    types = {item.id: item for item in session.scalars(
        select(PortType).where(PortType.id.in_(ids)).order_by(PortType.id)
        .with_for_update(read=True).execution_options(populate_existing=True)
    )}
    if ids != types.keys():
        raise ValidationError("Port type not found")
    for endpoint in endpoints:
        item = types[uuid.UUID(endpoint["port_type_id"])]
        if transceiver is not None:
            fiber_type = transceiver.get("fiber_type")
            if (item.medium == "FIBER" and fiber_type not in ("SM", "MM")
                    or item.medium == "COPPER" and fiber_type is not None):
                raise ValidationError(
                    "Выберите SM или MM для оптической модели. Для медной модели режим не задаётся.",
                    {"reason": "TRANSCEIVER_FIBER_MODE"},
                )
        if not item.is_active and (endpoint["key"], endpoint["port_type_id"]) not in retained:
            raise ValidationError("An archived port type cannot be newly assigned")
        if endpoint["kind"] == "NETWORK_PORT" and item.cardinality != 1:
            raise ValidationError("NETWORK_PORT requires a single-member port type")
        if "cardinality" in endpoint and endpoint["cardinality"] != item.cardinality:
            raise ValidationError("Endpoint cardinality must match its port type")
    return {str(identifier): item.cardinality for identifier, item in types.items()}


def _port_type_usage(item_id):
    # One snapshot covers transitions between authoring stages and revisions.
    return (
        select(model.id).where(model.port_type_id == item_id).exists()
        for model in (BuiltInEndpointDefinition, ModuleEndpointDefinition)
    ), (
        select(model.id).where(model.definition.contains({section: [{"port_type_id": str(item_id)}]})).exists()
        for model, section in SNAPSHOT_SECTIONS
    )


def _mount_type_usage(field, item_id):
    key = str(item_id)
    for model in (ModuleBay, ModuleTemplateRevision):
        yield select(model.id).where(getattr(model, field) == item_id).exists()
    yield select(ModuleTemplateRevision.id).where(
        ModuleTemplateRevision.module_places.contains([{field: key}])
    ).exists()
    for model in (BaseTemplateDraft, BaseTemplateCandidate):
        yield select(model.id).where(model.definition.contains({"bays": [{field: key}]})).exists()
    for model in (ModuleTemplateDraft, ModuleTemplateCandidate):
        yield select(model.id).where(or_(
            model.definition.contains({field: key}),
            model.definition.contains({"module_places": [{field: key}]}),
        )).exists()
    for model in (BaseTemplateCandidate, ModuleTemplateCandidate):
        # The path also covers reasons and snapshots nested in object/installation impacts.
        yield select(model.id).where(
            model.result.path_exists(cast(f'$.**.{field} ? (@ == "{key}")', JSONPATH)),
        ).exists()


def _used(session, model, item_id):
    if model in (ModulePortType, ModuleBayType):
        field = "module_port_type_id" if model is ModulePortType else "module_bay_type_id"
        return session.scalar(select(or_(*_mount_type_usage(field, item_id))))
    revisions, snapshots = _port_type_usage(item_id)
    return session.scalar(select(or_(*revisions, *snapshots)))


def _commit(session):
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        code = getattr(exc.orig, "sqlstate", None)
        if code == "23505":
            raise HTTPException(409, "Catalog type name already exists") from exc
        if code == "23503":
            raise HTTPException(409, "Catalog type is in use") from exc
        raise


def catalog_router(path, tag, model, payload, document, structural_fields):
    router = APIRouter(prefix=f"/v1/{path}", tags=[tag])

    def get(item_id, session, *, lock=False):
        statement = select(model).where(model.id == item_id)
        item = session.scalar(statement.with_for_update() if lock else statement)
        if item is None:
            raise HTTPException(404, "Catalog type not found")
        return item

    @router.get("", response_model=list[document], name=f"list_{path}")
    def list_items(session: DatabaseSession):
        return list(session.scalars(select(model).order_by(model.name, model.id)))

    @router.get("/{item_id}", response_model=document, name=f"get_{path}")
    def get_item(item_id: uuid.UUID, session: DatabaseSession):
        return get(item_id, session)

    @router.post("", status_code=201, response_model=document, name=f"create_{path}")
    def create_item(query: payload, session: DatabaseSession):
        item = model(**query.model_dump())
        session.add(item)
        _commit(session)
        return item

    @router.put("/{item_id}", response_model=document, name=f"update_{path}")
    def update_item(item_id: uuid.UUID, query: payload, session: DatabaseSession):
        item = get(item_id, session, lock=True)
        if any(getattr(item, field) != getattr(query, field) for field in structural_fields):
            if _used(session, model, item_id):
                raise HTTPException(409, "Catalog type structure is in use")
        for field, value in query.model_dump().items():
            setattr(item, field, value)
        _commit(session)
        return item

    @router.delete("/{item_id}", status_code=204, name=f"delete_{path}")
    def delete_item(item_id: uuid.UUID, session: DatabaseSession):
        item = get(item_id, session, lock=True)
        if item.is_active:
            raise HTTPException(409, "Archive the catalog type before deleting it")
        if _used(session, model, item_id):
            raise HTTPException(409, "Catalog type is in use")
        session.delete(item)
        _commit(session)

    return router


router = APIRouter()
router.include_router(catalog_router("port-types", "Port types", PortType, PortTypeInput, PortTypeDocument, PortStructure.model_fields))

router.include_router(catalog_router("module-port-types", "Module port types", ModulePortType, MountTypeInput, MountTypeDocument, ()))

router.include_router(catalog_router("module-bay-types", "Module bay types", ModuleBayType, MountTypeInput, MountTypeDocument, ()))


class CompatibilityPairDocument(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    port_type_a_id: uuid.UUID
    port_type_b_id: uuid.UUID


class CompatibilityPairInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allowed: StrictBool


@router.get("/v1/port-type-compatibilities", response_model=list[CompatibilityPairDocument])
def list_compatibility_pairs(session: DatabaseSession):
    return list(session.scalars(select(PortTypeCompatibility).order_by(
        PortTypeCompatibility.port_type_a_id, PortTypeCompatibility.port_type_b_id,
    )))


@router.put("/v1/port-type-compatibilities/{first_id}/{second_id}", status_code=204)
def set_compatibility_pair(first_id: uuid.UUID, second_id: uuid.UUID,
                           query: CompatibilityPairInput, session: DatabaseSession):
    ids = sorted({first_id, second_id})
    # Serialize both directions and exclude verification while the rule changes.
    types = list(session.scalars(select(PortType).where(PortType.id.in_(ids))
                                 .order_by(PortType.id).with_for_update()))
    if len(types) != len(ids):
        raise HTTPException(404, "Port type not found")
    if query.allowed and (any(port.compatibility_mode != "MATRIX" for port in types)
                          or types[0].medium != types[-1].medium):
        raise HTTPException(422, "An allowed pair needs two matrix types of the same medium")

    key = (ids[0], ids[-1])
    pair = session.get(PortTypeCompatibility, key)
    if query.allowed and pair is None:
        session.add(PortTypeCompatibility(port_type_a_id=key[0], port_type_b_id=key[1]))
    elif not query.allowed and pair is not None:
        session.delete(pair)
    _commit(session)
