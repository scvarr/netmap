import pytest
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import Connection, ConnectionMember, ConnectionPoint, PhysicalObject
from app.repository import CanonicalRepository, ConnectionMemberInput


@pytest.fixture(autouse=True)
def clean_database():
    with SessionLocal.begin() as session:
        session.execute(delete(ConnectionMember))
        session.execute(delete(Connection))
        session.execute(delete(ConnectionPoint))
        session.execute(delete(PhysicalObject))
    yield


def create_points(cardinality: int = 2):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        object_a = repository.add_physical_object()
        object_b = repository.add_physical_object()
        point_a = repository.add_connection_point(object_a.id, cardinality)
        point_b = repository.add_connection_point(object_b.id, cardinality)
        return point_a.id, point_b.id


def assert_constraint(error: pytest.ExceptionInfo[IntegrityError], name: str) -> None:
    assert error.value.orig.diag.constraint_name.endswith(name)


def test_connection_point_cardinality_positive_is_postgresql_constraint():
    with SessionLocal.begin() as session:
        physical_object = PhysicalObject()
        session.add(physical_object)
        session.flush()
        physical_object_id = physical_object.id

    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            session.add(
                ConnectionPoint(
                    physical_object_id=physical_object_id,
                    cardinality=0,
                )
            )
    assert_constraint(error, "ck_connection_points_cardinality_positive")


def test_connection_cardinality_positive_is_postgresql_constraint():
    point_a_id, point_b_id = create_points()

    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            session.add(
                Connection(
                    point_a_id=point_a_id,
                    point_b_id=point_b_id,
                    cardinality=0,
                )
            )
    assert_constraint(error, "ck_connections_cardinality_positive")


@pytest.mark.parametrize(
    ("values", "constraint_name"),
    [
        ({"index": 0, "point_a_member": 1, "point_b_member": 1},
         "ck_connection_members_index_positive"),
        ({"index": 1, "point_a_member": 0, "point_b_member": 1},
         "ck_connection_members_a_positive"),
        ({"index": 1, "point_a_member": 1, "point_b_member": 0},
         "ck_connection_members_b_positive"),
    ],
)
def test_member_indexes_positive_are_postgresql_constraints(values, constraint_name):
    point_a_id, point_b_id = create_points()
    with SessionLocal.begin() as session:
        connection = Connection(
            point_a_id=point_a_id,
            point_b_id=point_b_id,
            cardinality=1,
        )
        session.add(connection)
        session.flush()
        connection_id = connection.id

    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            session.add(ConnectionMember(connection_id=connection_id, **values))
    assert_constraint(error, constraint_name)


@pytest.mark.parametrize(
    ("second_values", "constraint_name"),
    [
        ({"index": 1, "point_a_member": 2, "point_b_member": 2},
         "uq_connection_members_index"),
        ({"index": 2, "point_a_member": 1, "point_b_member": 2},
         "uq_connection_members_a"),
        ({"index": 2, "point_a_member": 2, "point_b_member": 1},
         "uq_connection_members_b"),
    ],
)
def test_mapping_uniqueness_is_postgresql_constraint(second_values, constraint_name):
    point_a_id, point_b_id = create_points()

    with pytest.raises(IntegrityError) as error:
        with SessionLocal.begin() as session:
            connection = Connection(
                point_a_id=point_a_id,
                point_b_id=point_b_id,
                cardinality=2,
            )
            session.add(connection)
            session.flush()
            session.add_all(
                [
                    ConnectionMember(
                        connection_id=connection.id,
                        index=1,
                        point_a_member=1,
                        point_b_member=1,
                    ),
                    ConnectionMember(connection_id=connection.id, **second_values),
                ]
            )
    assert_constraint(error, constraint_name)


def test_repository_rejects_member_above_connection_point_cardinality():
    point_a_id, point_b_id = create_points(cardinality=1)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        with pytest.raises(ValidationError) as error:
            repository.add_connection(
                point_a_id,
                point_b_id,
                cardinality=1,
                members=[
                    ConnectionMemberInput(index=1, point_a_member=2, point_b_member=1)
                ],
            )
    assert error.value.code == "VALIDATION_ERROR"
    assert error.value.details["cardinality"] == 1


def test_repository_rejects_connection_cardinality_member_count_mismatch():
    point_a_id, point_b_id = create_points()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        with pytest.raises(ValidationError) as error:
            repository.add_connection(
                point_a_id,
                point_b_id,
                cardinality=2,
                members=[
                    ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
                ],
            )
    assert error.value.code == "VALIDATION_ERROR"
    assert error.value.details == {"cardinality": 2, "member_count": 1}
