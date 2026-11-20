"""Physical catalogs and template assignment validation."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, field_validator
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_session
from app.errors import ValidationError
from app.models import (
    BaseTemplateCandidate, BaseTemplateDraft, BuiltInEndpointDefinition, CableType,
    ConnectorType, ModuleEndpointDefinition, ModuleTemplateCandidate, ModuleTemplateDraft, PortType,
)

Medium = Literal["COPPER", "FIBER"]
StructuralLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255, pattern=r"^[^\x00\r\n]+$")]
DatabaseSession = Annotated[Session, Depends(get_session)]


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
    connector_type_id: uuid.UUID | None = None

    @field_validator("members")
    @classmethod
    def unique_members(cls, members):
        if len({label.casefold() for label in members}) != len(members):
            raise ValueError("Member designations must be unique")
        return members


class PortTypeInput(CatalogInput, PortStructure):
    pass


class ConnectorTypeInput(CatalogInput):
    mating_profile: StructuralLabel
    termination: Literal["PLUG", "SOCKET"]


class CableTypeInput(CatalogInput):
    medium: Medium
    construction: StructuralLabel


class CatalogDocument(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class PortTypeDocument(PortTypeInput, CatalogDocument):
    cardinality: int


class ConnectorTypeDocument(ConnectorTypeInput, CatalogDocument):
    pass


class CableTypeDocument(CableTypeInput, CatalogDocument):
    pass


SNAPSHOT_SECTIONS = (
    (BaseTemplateDraft, "slots"), (BaseTemplateCandidate, "slots"),
    (ModuleTemplateDraft, "endpoints"), (ModuleTemplateCandidate, "endpoints"),
)


def validate_port_type_assignments(session, endpoints, previous=()):
    retained = {(endpoint["key"], endpoint["port_type_id"]) for endpoint in previous}
    ids = {uuid.UUID(endpoint["port_type_id"]) for endpoint in endpoints}
    if not ids:
        return
    # This lock also covers the structural check and holds until commit.
    types = {item.id: item for item in session.scalars(
        select(PortType).where(PortType.id.in_(ids)).order_by(PortType.id)
        .with_for_update(read=True).execution_options(populate_existing=True)
    )}
    if ids != types.keys():
        raise ValidationError("Port type not found")
    for endpoint in endpoints:
        item = types[uuid.UUID(endpoint["port_type_id"])]
        if not item.is_active and (endpoint["key"], endpoint["port_type_id"]) not in retained:
            raise ValidationError("An archived port type cannot be newly assigned")
        if endpoint["kind"] == "NETWORK_PORT" and item.cardinality != 1:
            raise ValidationError("NETWORK_PORT requires a single-member port type")
        if "cardinality" in endpoint and endpoint["cardinality"] != item.cardinality:
            raise ValidationError("Endpoint cardinality must match its port type")


def _port_type_usage(item_id):
    # One snapshot covers transitions between authoring stages and revisions.
    return (
        select(model.id).where(model.port_type_id == item_id).exists()
        for model in (BuiltInEndpointDefinition, ModuleEndpointDefinition)
    ), (
        select(model.id).where(model.definition.contains({section: [{"port_type_id": str(item_id)}]})).exists()
        for model, section in SNAPSHOT_SECTIONS
    )


def _used(session, model, item_id):
    if model is PortType:
        revisions, snapshots = _port_type_usage(item_id)
        return session.scalar(select(or_(*revisions, *snapshots)))
    if model is ConnectorType:
        return session.scalar(select(select(PortType.id).where(PortType.connector_type_id == item_id).exists()))
    return False


def _validate_connector(session, connector_id):
    if connector_id is None:
        return
    connector = session.scalar(select(ConnectorType).where(ConnectorType.id == connector_id)
                               .with_for_update(read=True).execution_options(populate_existing=True))
    if connector is None:
        raise HTTPException(422, "Connector type not found")
    if not connector.is_active:
        raise HTTPException(409, "An archived connector type cannot be newly assigned")


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
        if model is PortType:
            _validate_connector(session, query.connector_type_id)
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
            if model is PortType and query.connector_type_id != item.connector_type_id:
                _validate_connector(session, query.connector_type_id)
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
router.include_router(catalog_router("connector-types", "Connector types", ConnectorType, ConnectorTypeInput, ConnectorTypeDocument, ("mating_profile", "termination")))
router.include_router(catalog_router("cable-types", "Cable types", CableType, CableTypeInput, CableTypeDocument, ("medium", "construction")))
