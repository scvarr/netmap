"""Explicit catalog entry for hardware authoring test payloads."""

import uuid

from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import PortType


def ensure_port_type_id(cardinality=1) -> str:
    base_id = uuid.UUID("7d1e1583-8f0a-47c4-b8fb-69e0ec322311")
    port_type_id = base_id if cardinality == 1 else uuid.uuid5(base_id, str(cardinality))
    with SessionLocal.begin() as session:
        session.execute(insert(PortType).values(
            id=port_type_id, name=f"Test hardware port ({cardinality})", color="#336699", is_active=True,
            medium="COPPER", members=[str(n) for n in range(1, cardinality + 1)],
        ).on_conflict_do_nothing(index_elements=["id"]))
    return str(port_type_id)
