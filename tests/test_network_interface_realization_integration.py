import pytest
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import NetworkInterfaceRealization
from app.repository import CanonicalRepository


def create_interfaces(count):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        return [repository.add_network_interface().id for _ in range(count)]


def test_one_lower_can_be_used_by_multiple_uppers_with_list_lookups():
    upper_a_id, upper_b_id, lower_id = create_interfaces(3)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        relations = [
            repository.add_network_interface_realization(upper_a_id, lower_id),
            repository.add_network_interface_realization(upper_b_id, lower_id),
        ]
        relation_ids = {relation.id for relation in relations}

    with SessionLocal() as session:
        repository = CanonicalRepository(session)
        down = repository.get_realizations_down([upper_a_id, upper_b_id])
        up = repository.get_realizations_up([lower_id])

    assert len(down[upper_a_id]) == 1
    assert len(down[upper_b_id]) == 1
    assert {relation.realization_id for relation in up[lower_id]} == relation_ids
    assert len(up[lower_id]) == 2


def test_duplicate_realization_is_postgresql_constraint():
    upper_id, lower_id = create_interfaces(2)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_network_interface_realization(upper_id, lower_id)

    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            session.add(
                NetworkInterfaceRealization(
                    upper_interface_id=upper_id,
                    lower_interface_id=lower_id,
                )
            )
    assert error.value.orig.diag.constraint_name == "uq_interface_realization_upper_lower"


def test_self_realization_is_validation_error():
    interface_id = create_interfaces(1)[0]
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        with pytest.raises(ValidationError) as error:
            repository.add_network_interface_realization(interface_id, interface_id)
    assert error.value.code == "VALIDATION_ERROR"


def test_repository_rejects_realization_cycle():
    interface_a_id, interface_b_id, interface_c_id = create_interfaces(3)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_network_interface_realization(interface_a_id, interface_b_id)
        repository.add_network_interface_realization(interface_b_id, interface_c_id)
        with pytest.raises(ValidationError) as error:
            repository.add_network_interface_realization(interface_c_id, interface_a_id)
    assert error.value.code == "VALIDATION_ERROR"
    assert "cycle" in error.value.message
