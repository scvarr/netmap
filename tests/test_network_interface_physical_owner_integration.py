import uuid

import pytest
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import NetworkInterface, NetworkInterfacePhysicalOwner, PhysicalObject
from app.repository import CanonicalRepository


def test_add_network_interface_physical_owner_and_read_record():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        physical_object = repository.add_physical_object()
        interface = repository.add_network_interface()
        relation = repository.add_network_interface_physical_owner(
            interface.id, physical_object.id
        )

        records = repository.get_network_interface_physical_owners()
        assert len(records) == 1
        assert records[0].owner_relation_id == relation.id
        assert records[0].interface_id == interface.id
        assert records[0].physical_object_id == physical_object.id


def test_duplicate_physical_owner_for_interface_is_rejected():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_physical_object()
        second = repository.add_physical_object()
        interface = repository.add_network_interface()
        repository.add_network_interface_physical_owner(interface.id, first.id)

        with pytest.raises(ValidationError):
            repository.add_network_interface_physical_owner(interface.id, second.id)


@pytest.mark.parametrize("missing_side", ["interface", "physical_object"])
def test_dangling_physical_owner_reference_is_rejected_on_write(missing_side):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        physical_object_id = (
            uuid.uuid4()
            if missing_side == "physical_object"
            else repository.add_physical_object().id
        )
        interface_id = (
            uuid.uuid4()
            if missing_side == "interface"
            else repository.add_network_interface().id
        )

        with pytest.raises(ValidationError):
            repository.add_network_interface_physical_owner(
                interface_id, physical_object_id
            )


def test_deleting_network_interface_cascades_physical_owner():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        physical_object = repository.add_physical_object()
        interface = repository.add_network_interface()
        relation = repository.add_network_interface_physical_owner(
            interface.id, physical_object.id
        )
        relation_id = relation.id
        session.execute(delete(NetworkInterface).where(NetworkInterface.id == interface.id))
        session.flush()
        session.expire_all()

        assert session.get(NetworkInterfacePhysicalOwner, relation_id) is None


def test_deleting_owned_physical_object_is_restricted():
    session = SessionLocal()
    try:
        repository = CanonicalRepository(session)
        physical_object = repository.add_physical_object()
        interface = repository.add_network_interface()
        repository.add_network_interface_physical_owner(interface.id, physical_object.id)
        session.flush()

        with pytest.raises(IntegrityError):
            session.execute(
                delete(PhysicalObject).where(PhysicalObject.id == physical_object.id)
            )
            session.flush()
        session.rollback()
    finally:
        session.close()


def test_owner_relation_has_no_workspace_id_column():
    assert "workspace_id" not in NetworkInterfacePhysicalOwner.__table__.columns
    assert sessionless_column_names() == {"id", "interface_id", "physical_object_id"}


def sessionless_column_names() -> set[str]:
    return {column.name for column in NetworkInterfacePhysicalOwner.__table__.columns}
