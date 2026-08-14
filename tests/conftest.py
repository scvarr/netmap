import pytest
from sqlalchemy import delete

from app.database import SessionLocal
from app.models import (
    Connection,
    ConnectionMember,
    ConnectionPoint,
    InterfacePhysicalBinding,
    NetworkInterface,
    PhysicalObject,
)


@pytest.fixture(autouse=True)
def clean_database():
    with SessionLocal.begin() as session:
        session.execute(delete(InterfacePhysicalBinding))
        session.execute(delete(NetworkInterface))
        session.execute(delete(ConnectionMember))
        session.execute(delete(Connection))
        session.execute(delete(ConnectionPoint))
        session.execute(delete(PhysicalObject))
    yield
