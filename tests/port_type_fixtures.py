"""Explicit catalog entry for hardware authoring test payloads."""

import uuid

from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import PortType


def ensure_port_type_id() -> str:
    port_type_id = uuid.UUID("7d1e1583-8f0a-47c4-b8fb-69e0ec322311")
    with SessionLocal.begin() as session:
        session.execute(insert(PortType).values(
            id=port_type_id, name="Test hardware port", color="#336699", is_active=True,
        ).on_conflict_do_nothing(index_elements=["id"]))
    return str(port_type_id)
