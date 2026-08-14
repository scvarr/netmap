import uuid
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, aliased

from app.errors import ModelError, ValidationError
from app.models import Connection, ConnectionMember, ConnectionPoint, PhysicalObject


@dataclass(frozen=True)
class PointMember:
    point_id: uuid.UUID
    member_index: int


@dataclass(frozen=True)
class ConnectionMemberInput:
    index: int
    point_a_member: int
    point_b_member: int


@dataclass(frozen=True)
class L1AdjacencyEdge:
    peer_point_id: uuid.UUID
    peer_member: int
    connection_id: uuid.UUID
    connection_member_id: uuid.UUID


class CanonicalRepository:
    """Canonical reads and fixture writes needed by the M1.1 L1 slice."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def add_physical_object(self, object_id: uuid.UUID | None = None) -> PhysicalObject:
        physical_object = PhysicalObject(id=object_id or uuid.uuid4())
        self.session.add(physical_object)
        self.session.flush()
        return physical_object

    def add_connection_point(
        self,
        physical_object_id: uuid.UUID,
        cardinality: int,
        point_id: uuid.UUID | None = None,
    ) -> ConnectionPoint:
        if cardinality < 1:
            raise ValidationError("ConnectionPoint cardinality must be at least 1")
        if self.session.get(PhysicalObject, physical_object_id) is None:
            raise ValidationError(
                "PhysicalObject does not exist", {"physical_object_id": str(physical_object_id)}
            )
        point = ConnectionPoint(
            id=point_id or uuid.uuid4(),
            physical_object_id=physical_object_id,
            cardinality=cardinality,
        )
        self.session.add(point)
        self.session.flush()
        return point

    def add_connection(
        self,
        point_a_id: uuid.UUID,
        point_b_id: uuid.UUID,
        cardinality: int,
        members: list[ConnectionMemberInput],
        connection_id: uuid.UUID | None = None,
    ) -> tuple[Connection, list[ConnectionMember]]:
        if point_a_id == point_b_id:
            raise ValidationError("A Connection must join two distinct ConnectionPoints")
        if cardinality < 1 or cardinality != len(members):
            raise ValidationError(
                "Connection cardinality must equal its ConnectionMember count",
                {"cardinality": cardinality, "member_count": len(members)},
            )

        points = {
            point.id: point
            for point in self.session.scalars(
                select(ConnectionPoint).where(ConnectionPoint.id.in_([point_a_id, point_b_id]))
            )
        }
        if len(points) != 2:
            raise ValidationError("Both ConnectionPoints must exist")

        indexes = [member.index for member in members]
        a_members = [member.point_a_member for member in members]
        b_members = [member.point_b_member for member in members]
        if len(set(indexes)) != len(indexes):
            raise ValidationError("ConnectionMember indexes must be unique")
        if len(set(a_members)) != len(a_members) or len(set(b_members)) != len(b_members):
            raise ValidationError("Connection mapping must be one-to-one within a Connection")

        for member in members:
            if member.index < 1:
                raise ValidationError("ConnectionMember index must be at least 1")
            self._validate_index(member.point_a_member, points[point_a_id], "point_a_member")
            self._validate_index(member.point_b_member, points[point_b_id], "point_b_member")

        connection = Connection(
            id=connection_id or uuid.uuid4(),
            point_a_id=point_a_id,
            point_b_id=point_b_id,
            cardinality=cardinality,
        )
        self.session.add(connection)
        self.session.flush()

        stored_members = [
            ConnectionMember(
                connection_id=connection.id,
                index=member.index,
                point_a_member=member.point_a_member,
                point_b_member=member.point_b_member,
            )
            for member in members
        ]
        self.session.add_all(stored_members)
        self.session.flush()
        return connection, stored_members

    def validate_point_member(self, address: PointMember) -> None:
        point = self.session.get(ConnectionPoint, address.point_id)
        if point is None:
            raise ValidationError(
                "ConnectionPoint does not exist", {"point_id": str(address.point_id)}
            )
        self._validate_index(address.member_index, point, "member_index")

    def get_l1_adjacency(
        self, addresses: list[PointMember]
    ) -> dict[PointMember, list[L1AdjacencyEdge]]:
        result = {address: [] for address in addresses}
        if not addresses:
            return result

        point_a = aliased(ConnectionPoint)
        point_b = aliased(ConnectionPoint)
        conditions = []
        for address in addresses:
            conditions.extend(
                [
                    (Connection.point_a_id == address.point_id)
                    & (ConnectionMember.point_a_member == address.member_index),
                    (Connection.point_b_id == address.point_id)
                    & (ConnectionMember.point_b_member == address.member_index),
                ]
            )

        rows = self.session.execute(
            select(Connection, ConnectionMember, point_a.cardinality, point_b.cardinality)
            .join(ConnectionMember, ConnectionMember.connection_id == Connection.id)
            .join(point_a, point_a.id == Connection.point_a_id)
            .join(point_b, point_b.id == Connection.point_b_id)
            .where(or_(*conditions))
        ).all()

        for connection, member, cardinality_a, cardinality_b in rows:
            if member.point_a_member > cardinality_a or member.point_b_member > cardinality_b:
                raise ModelError(
                    "ConnectionMember refers to a member above ConnectionPoint cardinality",
                    {"connection_member_id": str(member.id)},
                )
            a_address = PointMember(connection.point_a_id, member.point_a_member)
            b_address = PointMember(connection.point_b_id, member.point_b_member)
            if a_address in result:
                result[a_address].append(
                    L1AdjacencyEdge(
                        b_address.point_id,
                        b_address.member_index,
                        connection.id,
                        member.id,
                    )
                )
            if b_address in result:
                result[b_address].append(
                    L1AdjacencyEdge(
                        a_address.point_id,
                        a_address.member_index,
                        connection.id,
                        member.id,
                    )
                )
        return result

    @staticmethod
    def _validate_index(member_index: int, point: ConnectionPoint, field: str) -> None:
        if member_index < 1 or member_index > point.cardinality:
            raise ValidationError(
                f"{field} is outside ConnectionPoint cardinality",
                {
                    "point_id": str(point.id),
                    "member_index": member_index,
                    "cardinality": point.cardinality,
                },
            )

