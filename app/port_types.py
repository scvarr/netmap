"""API for the standalone user-defined port type catalog."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import PortType


class PortTypeInput(BaseModel):
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


class PortTypeDocument(PortTypeInput):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


router = APIRouter(prefix="/v1/port-types", tags=["Port types"])
DatabaseSession = Annotated[Session, Depends(get_session)]


def _get(port_type_id: uuid.UUID, session: Session) -> PortType:
    item = session.get(PortType, port_type_id)
    if item is None:
        raise HTTPException(404, "Port type not found")
    return item


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_port_types_normalized_name":
            raise HTTPException(409, "Port type name already exists") from exc
        if getattr(exc.orig, "sqlstate", None) == "23503":
            raise HTTPException(409, "Port type is in use") from exc
        raise


@router.get("")
def list_port_types(session: DatabaseSession) -> list[PortTypeDocument]:
    return list(session.scalars(select(PortType).order_by(PortType.name, PortType.id)))


@router.get("/{port_type_id}")
def get_port_type(port_type_id: uuid.UUID, session: DatabaseSession) -> PortTypeDocument:
    return _get(port_type_id, session)


@router.post("", status_code=201)
def create_port_type(query: PortTypeInput, session: DatabaseSession) -> PortTypeDocument:
    item = PortType(**query.model_dump())
    session.add(item)
    _commit(session)
    return item


@router.put("/{port_type_id}")
def update_port_type(port_type_id: uuid.UUID, query: PortTypeInput, session: DatabaseSession) -> PortTypeDocument:
    item = _get(port_type_id, session)
    for field, value in query.model_dump().items():
        setattr(item, field, value)
    _commit(session)
    return item


@router.delete("/{port_type_id}", status_code=204)
def delete_port_type(port_type_id: uuid.UUID, session: DatabaseSession) -> None:
    item = session.scalar(select(PortType).where(PortType.id == port_type_id).with_for_update())
    if item is None:
        raise HTTPException(404, "Port type not found")
    if item.is_active:
        raise HTTPException(409, "Archive the port type before deleting it")
    session.delete(item)
    _commit(session)
