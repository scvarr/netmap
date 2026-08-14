import pytest
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.errors import ModelError, ValidationError
from app.models import InterfacePhysicalBinding
from app.repository import CanonicalRepository, PointMember


def create_interface_and_points(point_count=2, cardinality=1):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        points = []
        for _ in range(point_count):
            physical_object = repository.add_physical_object()
            points.append(repository.add_connection_point(physical_object.id, cardinality))
        return interface.id, [point.id for point in points]


def test_multiple_bindings_and_reverse_lookups_preserve_candidate_lists():
    interface_id, point_ids = create_interface_and_points()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        bindings = [
            repository.add_interface_physical_binding(interface_id, point_id, 1)
            for point_id in point_ids
        ]
        expected_binding_ids = {binding.id for binding in bindings}

    with SessionLocal() as session:
        repository = CanonicalRepository(session)
        by_interface = repository.get_physical_bindings_by_interface([interface_id])
        addresses = [PointMember(point_id, 1) for point_id in point_ids]
        reverse = repository.get_interfaces_by_point_members(addresses)

    assert {binding.binding_id for binding in by_interface[interface_id]} == expected_binding_ids
    assert len(by_interface[interface_id]) == 2
    assert all(len(reverse[address]) == 1 for address in addresses)
    assert {
        reverse[address][0].binding_id for address in addresses
    } == expected_binding_ids


def test_duplicate_direct_binding_for_point_member_is_postgresql_constraint():
    first_interface_id, point_ids = create_interface_and_points(point_count=1)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        second_interface = repository.add_network_interface()
        repository.add_interface_physical_binding(first_interface_id, point_ids[0], 1)
        second_interface_id = second_interface.id

    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            session.add(
                InterfacePhysicalBinding(
                    interface_id=second_interface_id,
                    point_id=point_ids[0],
                    point_member=1,
                )
            )
    assert error.value.orig.diag.constraint_name == "uq_physical_binding_point_member"


def test_binding_member_must_be_positive_postgresql_constraint():
    interface_id, point_ids = create_interface_and_points(point_count=1)
    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            session.add(
                InterfacePhysicalBinding(
                    interface_id=interface_id,
                    point_id=point_ids[0],
                    point_member=0,
                )
            )
    assert error.value.orig.diag.constraint_name.endswith(
        "ck_interface_physical_bindings_point_member_positive"
    )


def test_binding_above_point_cardinality_is_validation_error():
    interface_id, point_ids = create_interface_and_points(point_count=1, cardinality=1)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        with pytest.raises(ValidationError) as error:
            repository.add_interface_physical_binding(interface_id, point_ids[0], 2)
    assert error.value.code == "VALIDATION_ERROR"
    assert error.value.details["cardinality"] == 1


def test_corrupt_binding_is_model_error_on_reverse_read_boundary():
    interface_id, point_ids = create_interface_and_points(point_count=1, cardinality=1)
    with SessionLocal.begin() as session:
        binding = InterfacePhysicalBinding(
            interface_id=interface_id,
            point_id=point_ids[0],
            point_member=2,
        )
        session.add(binding)
        session.flush()
        binding_id = binding.id

    with SessionLocal() as session:
        repository = CanonicalRepository(session)
        with pytest.raises(ModelError) as error:
            repository.get_interfaces_by_point_members([PointMember(point_ids[0], 2)])
    assert error.value.code == "MODEL_ERROR"
    assert error.value.details["binding_id"] == str(binding_id)
