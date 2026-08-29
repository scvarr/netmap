import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import Cable, Connection, ConnectionPoint, InterfacePhysicalBinding
from app.physical_connections import ConnectionPointEndpoint, NetworkInterfaceEndpoint, PhysicalConnectionCatalog
from app.repository import CanonicalRepository, ConnectionMemberInput


def points(repository: CanonicalRepository) -> tuple[ConnectionPoint, ConnectionPoint]:
    left = repository.add_connection_point(repository.add_physical_object().id, 1)
    right = repository.add_connection_point(repository.add_physical_object().id, 1)
    return left, right


def owned_interface(repository: CanonicalRepository) -> uuid.UUID:
    interface = repository.add_network_interface()
    owner = repository.add_physical_object()
    repository.add_network_interface_physical_owner(interface.id, owner.id)
    return interface.id


def test_cable_connection_uniqueness_is_a_database_constraint():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        left, right = points(repository)
        connection, _ = repository.add_connection(left.id, right.id, 1, [ConnectionMemberInput(1, 1, 1)])
        session.add(Cable(connection_id=connection.id))

    with pytest.raises(IntegrityError):
        with SessionLocal.begin() as session:
            session.add(Cable(connection_id=connection.id))
            session.flush()


def test_endpoint_link_domain_rejects_invalid_or_occupied_endpoints_without_new_facts():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        left, right = points(repository)
        interface = owned_interface(repository)
        ownerless_interface = repository.add_network_interface()
        unsupported = repository.add_connection_point(repository.add_physical_object().id, 2)
        catalog = PhysicalConnectionCatalog(session)
        catalog.create_endpoint_link(ConnectionPointEndpoint(left.id), ConnectionPointEndpoint(right.id))

        with pytest.raises(ValidationError, match="already occupied"):
            catalog.create_endpoint_link(ConnectionPointEndpoint(left.id), NetworkInterfaceEndpoint(interface))
        with pytest.raises(ValidationError, match="two different endpoints"):
            catalog.create_endpoint_link(ConnectionPointEndpoint(right.id), ConnectionPointEndpoint(right.id))
        with pytest.raises(ValidationError, match="does not exist"):
            catalog.create_endpoint_link(ConnectionPointEndpoint(right.id), ConnectionPointEndpoint(uuid.uuid4()))
        with pytest.raises(ValidationError, match="cardinality=1"):
            catalog.create_endpoint_link(ConnectionPointEndpoint(right.id), ConnectionPointEndpoint(unsupported.id))
        with pytest.raises(ValidationError, match="no physical owner"):
            catalog.create_endpoint_link(ConnectionPointEndpoint(right.id), NetworkInterfaceEndpoint(ownerless_interface.id))

        assert session.scalar(select(func.count()).select_from(Connection)) == 1
        assert session.scalar(select(func.count()).select_from(Cable)) == 1
        assert session.scalar(select(func.count()).select_from(InterfacePhysicalBinding)) == 0


def test_endpoint_link_failure_rolls_back_connection_cable_and_interface_materialization(monkeypatch):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = owned_interface(repository), owned_interface(repository)

    original = CanonicalRepository.add_connection

    def fail_after_connection(self, *args, **kwargs):
        original(self, *args, **kwargs)
        raise RuntimeError("injected failure")

    monkeypatch.setattr(CanonicalRepository, "add_connection", fail_after_connection)
    with pytest.raises(RuntimeError, match="injected failure"):
        with SessionLocal.begin() as session:
            PhysicalConnectionCatalog(session).create_atomic_link(source, target)

    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 0
        assert session.scalar(select(func.count()).select_from(Cable)) == 0
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 0
        assert session.scalar(select(func.count()).select_from(InterfacePhysicalBinding)) == 0
