import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PhysicalObject(Base):
    __tablename__ = "physical_objects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_points: Mapped[list["ConnectionPoint"]] = relationship(back_populates="physical_object")


class ConnectionPoint(Base):
    __tablename__ = "connection_points"
    __table_args__ = (
        CheckConstraint("cardinality >= 1", name="cardinality_positive"),
        Index("ix_connection_points_physical_object_id", "physical_object_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    physical_object_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("physical_objects.id", ondelete="RESTRICT"), nullable=False
    )
    cardinality: Mapped[int] = mapped_column(Integer, nullable=False)
    physical_object: Mapped[PhysicalObject] = relationship(back_populates="connection_points")


class Connection(Base):
    __tablename__ = "connections"
    __table_args__ = (
        CheckConstraint("cardinality >= 1", name="cardinality_positive"),
        CheckConstraint("point_a_id <> point_b_id", name="distinct_points"),
        Index("ix_connections_point_a_id", "point_a_id"),
        Index("ix_connections_point_b_id", "point_b_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    point_a_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connection_points.id", ondelete="RESTRICT"), nullable=False
    )
    point_b_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connection_points.id", ondelete="RESTRICT"), nullable=False
    )
    cardinality: Mapped[int] = mapped_column(Integer, nullable=False)
    members: Mapped[list["ConnectionMember"]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )


class ConnectionMember(Base):
    __tablename__ = "connection_members"
    __table_args__ = (
        CheckConstraint("index >= 1", name="index_positive"),
        CheckConstraint("point_a_member >= 1", name="a_positive"),
        CheckConstraint("point_b_member >= 1", name="b_positive"),
        UniqueConstraint("connection_id", "index", name="uq_connection_members_index"),
        UniqueConstraint("connection_id", "point_a_member", name="uq_connection_members_a"),
        UniqueConstraint("connection_id", "point_b_member", name="uq_connection_members_b"),
        Index("ix_connection_members_connection_id", "connection_id"),
        Index("ix_connection_members_a_member", "point_a_member"),
        Index("ix_connection_members_b_member", "point_b_member"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connections.id", ondelete="CASCADE"), nullable=False
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    point_a_member: Mapped[int] = mapped_column(Integer, nullable=False)
    point_b_member: Mapped[int] = mapped_column(Integer, nullable=False)
    connection: Mapped[Connection] = relationship(back_populates="members")


class NetworkInterface(Base):
    __tablename__ = "network_interfaces"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    physical_bindings: Mapped[list["InterfacePhysicalBinding"]] = relationship(
        back_populates="interface"
    )


class InterfacePhysicalBinding(Base):
    __tablename__ = "interface_physical_bindings"
    __table_args__ = (
        CheckConstraint("point_member >= 1", name="point_member_positive"),
        UniqueConstraint("point_id", "point_member", name="uq_physical_binding_point_member"),
        Index("ix_physical_bindings_interface_id", "interface_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interface_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("network_interfaces.id", ondelete="RESTRICT"), nullable=False
    )
    point_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connection_points.id", ondelete="RESTRICT"), nullable=False
    )
    point_member: Mapped[int] = mapped_column(Integer, nullable=False)
    interface: Mapped[NetworkInterface] = relationship(back_populates="physical_bindings")
