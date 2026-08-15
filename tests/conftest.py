import pytest
from sqlalchemy import delete

from app.database import SessionLocal
from app.models import (
    Connection,
    ConnectionMember,
    ConnectionPoint,
    InterfacePhysicalBinding,
    NetworkInterface,
    NetworkInterfaceRealization,
    PhysicalObject,
    L2Binding,
    L2EgressRule,
    L2ForwardingContext,
    L2IngressRule,
)


@pytest.fixture(autouse=True)
def clean_database():
    with SessionLocal.begin() as session:
        session.execute(delete(L2EgressRule))
        session.execute(delete(L2IngressRule))
        session.execute(delete(L2Binding))
        session.execute(delete(L2ForwardingContext))
        session.execute(delete(NetworkInterfaceRealization))
        session.execute(delete(InterfacePhysicalBinding))
        session.execute(delete(NetworkInterface))
        session.execute(delete(ConnectionMember))
        session.execute(delete(Connection))
        session.execute(delete(ConnectionPoint))
        session.execute(delete(PhysicalObject))
    yield
