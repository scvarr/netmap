"""Explicit catalog entry for physical link fixtures."""

import uuid

from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import CableType
from app.schemas import CableSpecification


def copper_cable_spec() -> CableSpecification:
    cable_type_id = uuid.UUID("9eaafe72-efc2-43f4-a4a6-185447ab31e5")
    with SessionLocal.begin() as session:
        session.execute(insert(CableType).values(
            id=cable_type_id, name="Test twisted pair", color="#336699", is_active=True,
            medium="COPPER", construction="TWISTED_PAIR",
        ).on_conflict_do_nothing(index_elements=["id"]))
    return CableSpecification(cable_type_id=cable_type_id)


def copper_cable_fields() -> dict:
    return copper_cable_spec().model_dump(mode="json")
