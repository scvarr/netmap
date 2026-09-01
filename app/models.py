import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import CIDR, INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Location(Base):
    """Canonical physical place, independent from all SavedMap presentation state."""

    __tablename__ = "locations"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("type IS NULL OR char_length(btrim(type)) > 0", name="type_not_blank"),
        CheckConstraint("parent_location_id IS NULL OR parent_location_id <> id", name="parent_not_self"),
        Index("ix_locations_parent_location_id", "parent_location_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    parent_location_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True
    )
    parent: Mapped["Location | None"] = relationship(
        back_populates="children", remote_side="Location.id"
    )
    children: Mapped[list["Location"]] = relationship(
        back_populates="parent", passive_deletes=True
    )
    physical_objects: Mapped[list["PhysicalObject"]] = relationship(
        back_populates="location", passive_deletes=True
    )
    map_regions: Mapped[list["MapRegion"]] = relationship(
        back_populates="location", passive_deletes=True
    )


class PhysicalObject(Base):
    __tablename__ = "physical_objects"
    __table_args__ = (Index("ix_physical_objects_location_id", "location_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True
    )
    location: Mapped[Location | None] = relationship(back_populates="physical_objects")
    connection_points: Mapped[list["ConnectionPoint"]] = relationship(back_populates="physical_object")
    network_interface_owners: Mapped[list["NetworkInterfacePhysicalOwner"]] = relationship(
        back_populates="physical_object"
    )
    map_placements: Mapped[list["MapPlacement"]] = relationship(
        back_populates="physical_object", passive_deletes=True
    )


class SavedMap(Base):
    """Presentation scope in the application's current implicit workspace."""

    __tablename__ = "saved_maps"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        UniqueConstraint("name", name="uq_saved_maps_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    placements: Mapped[list["MapPlacement"]] = relationship(
        back_populates="saved_map", cascade="all, delete-orphan", passive_deletes=True
    )
    cable_routes: Mapped[list["MapCableRoute"]] = relationship(
        back_populates="saved_map", cascade="all, delete-orphan", passive_deletes=True
    )
    regions: Mapped[list["MapRegion"]] = relationship(
        back_populates="saved_map", cascade="all, delete-orphan", passive_deletes=True
    )
    text_annotations: Mapped[list["MapTextAnnotation"]] = relationship(
        back_populates="saved_map", cascade="all, delete-orphan", passive_deletes=True
    )


class MapPlacement(Base):
    """Membership of one canonical PhysicalObject in one SavedMap."""

    __tablename__ = "map_placements"
    __table_args__ = (
        UniqueConstraint("map_id", "physical_object_id", name="uq_map_placements_map_object"),
        Index("ix_map_placements_physical_object_id", "physical_object_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    map_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("saved_maps.id", ondelete="CASCADE"), nullable=False
    )
    physical_object_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("physical_objects.id", ondelete="CASCADE"), nullable=False
    )
    view_positions: Mapped[list["MapViewPosition"]] = relationship(
        back_populates="placement", cascade="all, delete-orphan", passive_deletes=True
    )
    saved_map: Mapped[SavedMap] = relationship(back_populates="placements")
    physical_object: Mapped[PhysicalObject] = relationship(back_populates="map_placements")


class MapViewKey(StrEnum):
    PHYSICAL = "L1/PHYSICAL_OBJECT"
    LOGICAL = "L2/DEVICE"


class MapViewPosition(Base):
    """Presentation coordinates and lock state for one SavedMap membership in one network view."""

    __tablename__ = "map_view_positions"
    __table_args__ = (
        UniqueConstraint("placement_id", "view_key", name="uq_map_view_positions_placement_view"),
        CheckConstraint(
            "view_key IN ('L1/PHYSICAL_OBJECT', 'L2/DEVICE')",
            name="map_view_positions_view_key_valid",
        ),
        CheckConstraint(
            "display_width IS NULL OR (view_key = 'L1/PHYSICAL_OBJECT' AND display_width > 0)",
            name="map_view_positions_display_width_physical_positive",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    placement_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("map_placements.id", ondelete="CASCADE"), nullable=False
    )
    view_key: Mapped[MapViewKey] = mapped_column(String(32), nullable=False)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    locked: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    # Per-map/view presentation size. NULL deliberately preserves historical
    # positions; readers apply the deterministic L1 display default.
    display_width: Mapped[float | None] = mapped_column(Float, nullable=True)
    placement: Mapped[MapPlacement] = relationship(back_populates="view_positions")


class MapCableRoute(Base):
    """SavedMap-owned Physical/L1 cable route geometry, never canonical topology."""

    __tablename__ = "map_cable_routes"
    __table_args__ = (
        UniqueConstraint("map_id", "cable_id", "view_key", name="uq_map_cable_routes_map_cable_view"),
        CheckConstraint("view_key = 'L1/PHYSICAL_OBJECT'", name="map_cable_routes_view_key_physical_only"),
        Index("ix_map_cable_routes_cable_id", "cable_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    map_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("saved_maps.id", ondelete="CASCADE"), nullable=False)
    cable_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cables.id", ondelete="CASCADE"), nullable=False)
    view_key: Mapped[MapViewKey] = mapped_column(String(32), nullable=False)
    waypoints: Mapped[list[dict[str, float]]] = mapped_column(JSONB, nullable=False, default=list)
    saved_map: Mapped[SavedMap] = relationship(back_populates="cable_routes")
    cable: Mapped["Cable"] = relationship(back_populates="map_routes")


class MapRegion(Base):
    """SavedMap-owned Physical/L1 polygon presentation, never topology evidence."""

    __tablename__ = "map_regions"
    __table_args__ = (
        CheckConstraint("char_length(btrim(label)) > 0", name="label_not_blank"),
        CheckConstraint("fill_color ~ '^#[0-9A-Fa-f]{6}$'", name="fill_color_hex"),
        CheckConstraint("fill_opacity >= 0 AND fill_opacity <= 1", name="fill_opacity_range"),
        CheckConstraint("stroke_color ~ '^#[0-9A-Fa-f]{6}$'", name="stroke_color_hex"),
        CheckConstraint("stroke_width >= 0", name="stroke_width_nonnegative"),
        CheckConstraint("stroke_style IN ('solid', 'dashed', 'dotted')", name="stroke_style_valid"),
        CheckConstraint("label_color IS NULL OR label_color ~ '^#[0-9A-Fa-f]{6}$'", name="label_color_hex"),
        Index("ix_map_regions_map_z_order", "map_id", "z_order"),
        Index("ix_map_regions_location_id", "location_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    map_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("saved_maps.id", ondelete="CASCADE"), nullable=False)
    # Presentation assistance only. This is never containment or topology evidence.
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    points: Mapped[list[dict[str, float]]] = mapped_column(JSONB, nullable=False)
    label_position: Mapped[dict[str, float] | None] = mapped_column(JSONB, nullable=True)
    fill_color: Mapped[str] = mapped_column(String(7), nullable=False)
    fill_opacity: Mapped[float] = mapped_column(Float, nullable=False)
    stroke_color: Mapped[str] = mapped_column(String(7), nullable=False)
    stroke_width: Mapped[float] = mapped_column(Float, nullable=False)
    stroke_style: Mapped[str] = mapped_column(String(16), nullable=False)
    label_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    z_order: Mapped[int] = mapped_column(Integer, nullable=False)
    saved_map: Mapped[SavedMap] = relationship(back_populates="regions")
    location: Mapped[Location | None] = relationship(back_populates="map_regions")


class MapTextAnnotation(Base):
    """SavedMap-owned Physical/L1 text presentation, never topology evidence."""

    __tablename__ = "map_text_annotations"
    __table_args__ = (
        CheckConstraint("char_length(btrim(text)) > 0", name="text_not_blank"),
        CheckConstraint("text_color ~ '^#[0-9A-Fa-f]{6}$'", name="text_color_hex"),
        CheckConstraint("font_size > 0", name="font_size_positive"),
        Index("ix_map_text_annotations_map_id", "map_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    map_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("saved_maps.id", ondelete="CASCADE"), nullable=False)
    text: Mapped[str] = mapped_column(String(2000), nullable=False)
    position: Mapped[dict[str, float]] = mapped_column(JSONB, nullable=False)
    text_color: Mapped[str] = mapped_column(String(7), nullable=False)
    font_size: Mapped[float] = mapped_column(Float, nullable=False)
    saved_map: Mapped[SavedMap] = relationship(back_populates="text_annotations")


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
    cable: Mapped["Cable | None"] = relationship(
        back_populates="connection", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )


class Cable(Base):
    """Optional identity for one point-to-point canonical Connection."""

    __tablename__ = "cables"
    __table_args__ = (
        UniqueConstraint("connection_id", name="uq_cables_connection"),
        Index("ix_cables_connection_id", "connection_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connections.id", ondelete="CASCADE"), nullable=False
    )
    # Mutable user-facing metadata.  It is deliberately not identity or topology.
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    connection: Mapped[Connection] = relationship(back_populates="cable")
    map_routes: Mapped[list[MapCableRoute]] = relationship(
        back_populates="cable", cascade="all, delete-orphan", passive_deletes=True
    )


class CableLabelSettings(Base):
    """The one application-wide policy record for Cable labels."""

    __tablename__ = "cable_label_settings"
    __table_args__ = (CheckConstraint("id = 1", name="cable_label_settings_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    unique_labels: Mapped[bool] = mapped_column(nullable=False, server_default="false")


class CableLabelTemplate(Base):
    """Persisted generator rule; changing it never rewrites Cable labels."""

    __tablename__ = "cable_label_templates"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="cable_label_template_name_not_blank"),
        CheckConstraint("char_length(btrim(pattern)) > 0", name="cable_label_template_pattern_not_blank"),
        CheckConstraint("start_at >= 0", name="cable_label_template_start_at_nonnegative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    pattern: Mapped[str] = mapped_column(String(255), nullable=False)
    start_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class CableLabelHistory(Base):
    """Domain history for mutable Cable labels, not topology identity or audit."""

    __tablename__ = "cable_label_history"
    __table_args__ = (
        Index("ix_cable_label_history_label", "label"),
        Index("ix_cable_label_history_cable_id", "cable_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    # No foreign key: history must survive the Cable's canonical deletion.
    cable_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
    realizations_down: Mapped[list["NetworkInterfaceRealization"]] = relationship(
        foreign_keys="NetworkInterfaceRealization.upper_interface_id",
        back_populates="upper_interface",
    )
    realizations_up: Mapped[list["NetworkInterfaceRealization"]] = relationship(
        foreign_keys="NetworkInterfaceRealization.lower_interface_id",
        back_populates="lower_interface",
    )
    l2_bindings: Mapped[list["L2Binding"]] = relationship(back_populates="interface")
    l3_bindings: Mapped[list["L3Binding"]] = relationship(back_populates="interface")
    physical_owner: Mapped["NetworkInterfacePhysicalOwner | None"] = relationship(
        back_populates="interface", uselist=False, cascade="all, delete-orphan"
    )


class NetworkInterfacePhysicalOwner(Base):
    __tablename__ = "network_interface_physical_owners"
    __table_args__ = (
        UniqueConstraint("interface_id", name="uq_network_interface_physical_owners_interface"),
        Index("ix_network_interface_physical_owners_physical_object_id", "physical_object_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interface_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("network_interfaces.id", ondelete="CASCADE"), nullable=False
    )
    physical_object_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("physical_objects.id", ondelete="RESTRICT"), nullable=False
    )
    interface: Mapped[NetworkInterface] = relationship(back_populates="physical_owner")
    physical_object: Mapped[PhysicalObject] = relationship(
        back_populates="network_interface_owners"
    )


class EntityMetadata(Base):
    """Bounded metadata materialization for display aliases and object class."""

    __tablename__ = "entity_metadata"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(physical_object_id, network_interface_id, connection_point_id) = 1",
            name="exactly_one_entity",
        ),
        CheckConstraint(
            "key = 'alias.display' OR "
            "(key = 'class' AND physical_object_id IS NOT NULL)",
            name="supported_key_target",
        ),
        CheckConstraint("char_length(btrim(value)) > 0", name="value_not_blank"),
        UniqueConstraint(
            "physical_object_id", "key", name="uq_entity_metadata_physical_object_key"
        ),
        UniqueConstraint(
            "network_interface_id", "key", name="uq_entity_metadata_network_interface_key"
        ),
        UniqueConstraint(
            "connection_point_id", "key", name="uq_entity_metadata_connection_point_key"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    physical_object_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("physical_objects.id", ondelete="CASCADE"), nullable=True
    )
    network_interface_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("network_interfaces.id", ondelete="CASCADE"), nullable=True
    )
    connection_point_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("connection_points.id", ondelete="CASCADE"), nullable=True
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)


class ObjectBlueprint(Base):
    """Authoring record; it is not a canonical topology fact."""

    __tablename__ = "object_blueprints"
    __table_args__ = (CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class PortBlock(Base):
    """Library-owned authoring record; never a canonical topology fact."""

    __tablename__ = "port_blocks"
    __table_args__ = (CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class PortBlockVersion(Base):
    """Immutable ordered/layout snapshot of one PortBlock's network ports."""

    __tablename__ = "port_block_versions"
    __table_args__ = (
        CheckConstraint("version_number >= 1", name="version_number_positive"),
        UniqueConstraint("port_block_id", "version_number", name="uq_port_block_versions_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    port_block_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("port_blocks.id", ondelete="RESTRICT"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)


class PortBlockPort(Base):
    """One exact port in an immutable PortBlockVersion snapshot."""

    __tablename__ = "port_block_ports"
    __table_args__ = (
        CheckConstraint("char_length(btrim(local_id)) > 0", name="local_id_not_blank"),
        CheckConstraint("char_length(btrim(display_label)) > 0", name="display_label_not_blank"),
        CheckConstraint("kind IN ('CONNECTION_POINT', 'NETWORK_PORT')", name="kind_supported"),
        CheckConstraint("row >= 1 AND row <= 2", name="row_supported"),
        CheckConstraint("layout_column >= 1", name="column_positive"),
        CheckConstraint("layout_order >= 1", name="layout_order_positive"),
        UniqueConstraint("port_block_version_id", "local_id", name="uq_port_block_ports_local_id"),
        UniqueConstraint("port_block_version_id", "row", "layout_column", name="uq_port_block_ports_position"),
        UniqueConstraint("port_block_version_id", "layout_order", name="uq_port_block_ports_layout_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    port_block_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("port_block_versions.id", ondelete="RESTRICT"), nullable=False
    )
    local_id: Mapped[str] = mapped_column(String(255), nullable=False)
    display_label: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    row: Mapped[int] = mapped_column(Integer, nullable=False)
    layout_column: Mapped[int] = mapped_column(Integer, nullable=False)
    layout_order: Mapped[int] = mapped_column(Integer, nullable=False)


class ObjectBlueprintVersion(Base):
    __tablename__ = "object_blueprint_versions"
    __table_args__ = (
        CheckConstraint("version_number >= 1", name="version_number_positive"),
        CheckConstraint("body_kind = 'RECTANGLE'", name="rectangle_only"),
        CheckConstraint("width > 0", name="width_positive"),
        CheckConstraint("height > 0", name="height_positive"),
        CheckConstraint("fill_color IS NULL OR fill_color ~ '^#[0-9A-Fa-f]{6}$'", name="fill_color_hex"),
        UniqueConstraint("blueprint_id", "version_number", name="uq_object_blueprint_versions_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blueprint_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("object_blueprints.id", ondelete="RESTRICT"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    default_physical_object_class: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)
    height: Mapped[float] = mapped_column(Float, nullable=False)
    fill_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    authoring_recipe: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # NULL identifies pre-composition immutable snapshots. New authoring always
    # writes PORT_BLOCKS_V1, even when its composition contains no instances.
    composition_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)


class BlueprintPortBlockInstance(Base):
    """Exact Port Block version provenance for one composed Blueprint instance."""
    __tablename__ = "blueprint_port_block_instances"
    __table_args__ = (
        CheckConstraint("char_length(btrim(instance_key)) > 0", name="instance_key_not_blank"),
        UniqueConstraint("blueprint_version_id", "instance_key", name="uq_blueprint_block_instance_key"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blueprint_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("object_blueprint_versions.id", ondelete="RESTRICT"), nullable=False)
    port_block_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("port_block_versions.id", ondelete="RESTRICT"), nullable=False)
    instance_key: Mapped[str] = mapped_column(String(255), nullable=False)
    # NULL is immutable pre-face provenance. New composition authoring must set a face.
    face: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # NULL is immutable pre-L1S.6c.5 provenance. This is face-local presentation
    # geometry only: it must never affect slot identity or runtime attachment anchors.
    placement_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    placement_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    placement_width: Mapped[float | None] = mapped_column(Float, nullable=True)
    placement_height: Mapped[float | None] = mapped_column(Float, nullable=True)


class BlueprintEndpointSlot(Base):
    __tablename__ = "blueprint_endpoint_slots"
    __table_args__ = (
        CheckConstraint("char_length(btrim(slot_key)) > 0", name="slot_key_not_blank"),
        CheckConstraint("char_length(btrim(display_name)) > 0", name="display_name_not_blank"),
        CheckConstraint("kind IN ('CONNECTION_POINT', 'NETWORK_PORT')", name="kind_supported"),
        UniqueConstraint("blueprint_version_id", "slot_key", name="uq_blueprint_endpoint_slots_key"),
        UniqueConstraint("port_block_instance_id", "port_block_local_id", name="uq_blueprint_slot_block_local_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blueprint_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("object_blueprint_versions.id", ondelete="RESTRICT"), nullable=False
    )
    slot_key: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    port_block_instance_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("blueprint_port_block_instances.id", ondelete="RESTRICT"), nullable=True)
    port_block_local_id: Mapped[str | None] = mapped_column(String(255), nullable=True)


class BlueprintInternalLink(Base):
    __tablename__ = "blueprint_internal_links"
    __table_args__ = (
        CheckConstraint("slot_a_id <> slot_b_id", name="distinct_slots"),
        UniqueConstraint("blueprint_version_id", "slot_a_id", "slot_b_id", name="uq_blueprint_internal_links_unordered"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blueprint_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("object_blueprint_versions.id", ondelete="RESTRICT"), nullable=False
    )
    slot_a_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("blueprint_endpoint_slots.id", ondelete="RESTRICT"), nullable=False
    )
    slot_b_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("blueprint_endpoint_slots.id", ondelete="RESTRICT"), nullable=False
    )


class BlueprintInstance(Base):
    __tablename__ = "blueprint_instances"
    __table_args__ = (UniqueConstraint("physical_object_id", name="uq_blueprint_instances_physical_object"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blueprint_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("object_blueprint_versions.id", ondelete="RESTRICT"), nullable=False
    )
    physical_object_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("physical_objects.id", ondelete="RESTRICT"), nullable=False
    )


class BlueprintInstanceSlot(Base):
    __tablename__ = "blueprint_instance_slots"
    __table_args__ = (
        UniqueConstraint("blueprint_instance_id", "blueprint_slot_id", name="uq_blueprint_instance_slots_slot"),
        UniqueConstraint("connection_point_id", name="uq_blueprint_instance_slots_connection_point"),
        UniqueConstraint("network_interface_id", name="uq_blueprint_instance_slots_network_interface"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blueprint_instance_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("blueprint_instances.id", ondelete="RESTRICT"), nullable=False
    )
    blueprint_slot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("blueprint_endpoint_slots.id", ondelete="RESTRICT"), nullable=False
    )
    connection_point_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connection_points.id", ondelete="RESTRICT"), nullable=False
    )
    network_interface_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("network_interfaces.id", ondelete="RESTRICT"), nullable=True
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


class NetworkInterfaceRealization(Base):
    __tablename__ = "network_interface_realizations"
    __table_args__ = (
        CheckConstraint("upper_interface_id <> lower_interface_id", name="distinct_interfaces"),
        UniqueConstraint(
            "upper_interface_id",
            "lower_interface_id",
            name="uq_interface_realization_upper_lower",
        ),
        Index("ix_interface_realizations_upper_id", "upper_interface_id"),
        Index("ix_interface_realizations_lower_id", "lower_interface_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    upper_interface_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("network_interfaces.id", ondelete="RESTRICT"), nullable=False
    )
    lower_interface_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("network_interfaces.id", ondelete="RESTRICT"), nullable=False
    )
    upper_interface: Mapped[NetworkInterface] = relationship(
        foreign_keys=[upper_interface_id], back_populates="realizations_down"
    )
    lower_interface: Mapped[NetworkInterface] = relationship(
        foreign_keys=[lower_interface_id], back_populates="realizations_up"
    )


class L2ForwardingContext(Base):
    __tablename__ = "l2_forwarding_contexts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bindings: Mapped[list["L2Binding"]] = relationship(back_populates="forwarding_context")


class L2Binding(Base):
    __tablename__ = "l2_bindings"
    __table_args__ = (
        UniqueConstraint(
            "interface_id", "forwarding_context_id", name="uq_l2_bindings_interface_context"
        ),
        Index("ix_l2_bindings_interface_id", "interface_id"),
        Index("ix_l2_bindings_context_id", "forwarding_context_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interface_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("network_interfaces.id", ondelete="RESTRICT"), nullable=False
    )
    forwarding_context_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("l2_forwarding_contexts.id", ondelete="RESTRICT"), nullable=False
    )
    interface: Mapped[NetworkInterface] = relationship(back_populates="l2_bindings")
    forwarding_context: Mapped[L2ForwardingContext] = relationship(back_populates="bindings")
    ingress_rules: Mapped[list["L2IngressRule"]] = relationship(
        back_populates="binding", cascade="all, delete-orphan"
    )
    egress_rule: Mapped["L2EgressRule | None"] = relationship(
        back_populates="binding", cascade="all, delete-orphan"
    )


class L2IngressRule(Base):
    __tablename__ = "l2_ingress_rules"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(exact_stack) = 'array'", name="exact_stack_array"),
        Index("ix_l2_ingress_rules_binding_id", "binding_id"),
        Index("ix_l2_ingress_rules_exact_stack", "exact_stack", postgresql_using="hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    binding_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("l2_bindings.id", ondelete="CASCADE"), nullable=False
    )
    exact_stack: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False)
    binding: Mapped[L2Binding] = relationship(back_populates="ingress_rules")


class L2EgressRule(Base):
    __tablename__ = "l2_egress_rules"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(emit_stack) = 'array'", name="emit_stack_array"),
        UniqueConstraint("binding_id", name="uq_l2_egress_rules_binding"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    binding_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("l2_bindings.id", ondelete="CASCADE"), nullable=False
    )
    emit_stack: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False)
    binding: Mapped[L2Binding] = relationship(back_populates="egress_rule")


class RoutingContext(Base):
    __tablename__ = "routing_contexts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    l3_bindings: Mapped[list["L3Binding"]] = relationship(back_populates="routing_context")
    routing_tables: Mapped[list["RoutingTable"]] = relationship(
        back_populates="routing_context"
    )


class L3Binding(Base):
    __tablename__ = "l3_bindings"
    __table_args__ = (
        UniqueConstraint(
            "interface_id", "routing_context_id", name="uq_l3_bindings_interface_context"
        ),
        Index("ix_l3_bindings_interface_id", "interface_id"),
        Index("ix_l3_bindings_context_id", "routing_context_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interface_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("network_interfaces.id", ondelete="RESTRICT"), nullable=False
    )
    routing_context_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("routing_contexts.id", ondelete="RESTRICT"), nullable=False
    )
    interface: Mapped[NetworkInterface] = relationship(back_populates="l3_bindings")
    routing_context: Mapped[RoutingContext] = relationship(back_populates="l3_bindings")
    route_next_hops: Mapped[list["RouteNextHop"]] = relationship(
        back_populates="egress_l3_binding"
    )
    interface_addresses: Mapped[list["InterfaceAddress"]] = relationship(
        back_populates="l3_binding", cascade="all, delete-orphan"
    )


class InterfaceAddress(Base):
    __tablename__ = "interface_addresses"
    __table_args__ = (
        CheckConstraint(
            "(family(address) = 4 AND prefix_length BETWEEN 0 AND 32) OR "
            "(family(address) = 6 AND prefix_length BETWEEN 0 AND 128)",
            name="prefix_length_matches_family",
        ),
        Index("ix_interface_addresses_l3_binding_id", "l3_binding_id"),
        Index("ix_interface_addresses_address", "address"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    l3_binding_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("l3_bindings.id", ondelete="CASCADE"), nullable=False
    )
    address: Mapped[str] = mapped_column(INET, nullable=False)
    prefix_length: Mapped[int] = mapped_column(Integer, nullable=False)
    l3_binding: Mapped[L3Binding] = relationship(back_populates="interface_addresses")


class RoutingTable(Base):
    __tablename__ = "routing_tables"
    __table_args__ = (
        CheckConstraint(
            "address_family IN ('IPv4', 'IPv6')", name="address_family_valid"
        ),
        CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name="configured_completeness_valid",
        ),
        Index("ix_routing_tables_context_id", "routing_context_id"),
        Index("ix_routing_tables_context_family", "routing_context_id", "address_family"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    routing_context_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("routing_contexts.id", ondelete="RESTRICT"), nullable=False
    )
    address_family: Mapped[str] = mapped_column(String(4), nullable=False)
    configured_completeness: Mapped[str] = mapped_column(String(8), nullable=False)
    routing_context: Mapped[RoutingContext] = relationship(back_populates="routing_tables")
    routes: Mapped[list["Route"]] = relationship(
        back_populates="routing_table", cascade="all, delete-orphan"
    )


class RoutingPolicy(Base):
    __tablename__ = "routing_policies"
    __table_args__ = (
        CheckConstraint(
            "jsonb_typeof(default_selection) = 'object'",
            name="default_selection_object",
        ),
        CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name="configured_completeness_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    default_selection: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False
    )
    configured_completeness: Mapped[str] = mapped_column(String(8), nullable=False)
    rules: Mapped[list["RoutingPolicyRule"]] = relationship(
        back_populates="policy", cascade="all, delete-orphan"
    )


class RoutingPolicyRule(Base):
    __tablename__ = "routing_policy_rules"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(predicate) = 'object'", name="predicate_object"),
        CheckConstraint("jsonb_typeof(action) = 'object'", name="action_object"),
        UniqueConstraint(
            "policy_id", "order_key", name="uq_routing_policy_rules_policy_order"
        ),
        Index("ix_routing_policy_rules_policy_id", "policy_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("routing_policies.id", ondelete="CASCADE"), nullable=False
    )
    order_key: Mapped[int] = mapped_column(Integer, nullable=False)
    predicate: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    action: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    policy: Mapped[RoutingPolicy] = relationship(back_populates="rules")


class Route(Base):
    __tablename__ = "routes"
    __table_args__ = (
        CheckConstraint(
            "disposition IN ('FORWARD', 'LOCAL', 'DISCARD')", name="disposition_valid"
        ),
        Index("ix_routes_table_id", "routing_table_id"),
        Index("ix_routes_destination_prefix", "destination_prefix"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    routing_table_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("routing_tables.id", ondelete="CASCADE"), nullable=False
    )
    destination_prefix: Mapped[str] = mapped_column(CIDR, nullable=False)
    disposition: Mapped[str] = mapped_column(String(7), nullable=False)
    routing_table: Mapped[RoutingTable] = relationship(back_populates="routes")
    next_hops: Mapped[list["RouteNextHop"]] = relationship(
        back_populates="route", cascade="all, delete-orphan"
    )


class RouteNextHop(Base):
    __tablename__ = "route_next_hops"
    __table_args__ = (
        CheckConstraint(
            "gateway_address IS NOT NULL OR egress_l3_binding_id IS NOT NULL",
            name="gateway_or_egress_required",
        ),
        Index("ix_route_next_hops_route_id", "route_id"),
        Index("ix_route_next_hops_egress_binding_id", "egress_l3_binding_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    route_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), nullable=False
    )
    gateway_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    egress_l3_binding_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("l3_bindings.id", ondelete="RESTRICT"), nullable=True
    )
    route: Mapped[Route] = relationship(back_populates="next_hops")
    egress_l3_binding: Mapped[L3Binding | None] = relationship(
        back_populates="route_next_hops"
    )


class SecurityPolicy(Base):
    __tablename__ = "security_policies"
    __table_args__ = (
        CheckConstraint(
            "default_action IN ('PERMIT', 'DROP', 'REJECT')",
            name="default_action_valid",
        ),
        CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name="configured_completeness_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    default_action: Mapped[str] = mapped_column(String(6), nullable=False)
    configured_completeness: Mapped[str] = mapped_column(String(8), nullable=False)
    rules: Mapped[list["SecurityRule"]] = relationship(
        back_populates="policy", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["SecurityPolicyAttachment"]] = relationship(
        back_populates="policy", cascade="all, delete-orphan"
    )


class SecurityRule(Base):
    __tablename__ = "security_rules"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(predicate) = 'object'", name="predicate_object"),
        CheckConstraint(
            "action IN ('PERMIT', 'DROP', 'REJECT')", name="action_valid"
        ),
        UniqueConstraint("policy_id", "order_key", name="uq_security_rules_policy_order"),
        Index("ix_security_rules_policy_id", "policy_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("security_policies.id", ondelete="CASCADE"), nullable=False
    )
    order_key: Mapped[int] = mapped_column(Integer, nullable=False)
    predicate: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    action: Mapped[str] = mapped_column(String(6), nullable=False)
    policy: Mapped[SecurityPolicy] = relationship(back_populates="rules")


class SecurityPolicyAttachment(Base):
    __tablename__ = "security_policy_attachments"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(scope) = 'object'", name="scope_object"),
        Index("ix_security_policy_attachments_policy_id", "policy_id"),
        Index("ix_security_policy_attachments_stage_order", "stage_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("security_policies.id", ondelete="CASCADE"), nullable=False
    )
    stage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    scope: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    policy: Mapped[SecurityPolicy] = relationship(back_populates="attachments")


class NATPolicy(Base):
    __tablename__ = "nat_policies"
    __table_args__ = (
        CheckConstraint(
            "jsonb_typeof(default_transform) = 'object'",
            name="default_transform_object",
        ),
        CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name="configured_completeness_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    default_transform: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False
    )
    configured_completeness: Mapped[str] = mapped_column(String(8), nullable=False)
    rules: Mapped[list["NATRule"]] = relationship(
        back_populates="policy", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["NATPolicyAttachment"]] = relationship(
        back_populates="policy", cascade="all, delete-orphan"
    )


class NATPool(Base):
    __tablename__ = "nat_pools"
    __table_args__ = (
        CheckConstraint(
            "jsonb_typeof(address_ranges) = 'array'",
            name="address_ranges_array",
        ),
        CheckConstraint(
            "jsonb_typeof(port_ranges) = 'array'",
            name="port_ranges_array",
        ),
        CheckConstraint(
            "jsonb_array_length(address_ranges) + jsonb_array_length(port_ranges) > 0",
            name="ranges_not_empty",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    address_ranges: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB, nullable=False
    )
    port_ranges: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB, nullable=False
    )


class NATRule(Base):
    __tablename__ = "nat_rules"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(predicate) = 'object'", name="predicate_object"),
        CheckConstraint("jsonb_typeof(transform) = 'object'", name="transform_object"),
        UniqueConstraint("policy_id", "order_key", name="uq_nat_rules_policy_order"),
        Index("ix_nat_rules_policy_id", "policy_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("nat_policies.id", ondelete="CASCADE"), nullable=False
    )
    order_key: Mapped[int] = mapped_column(Integer, nullable=False)
    predicate: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    transform: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    policy: Mapped[NATPolicy] = relationship(back_populates="rules")


class NATPolicyAttachment(Base):
    __tablename__ = "nat_policy_attachments"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(scope) = 'object'", name="scope_object"),
        Index("ix_nat_policy_attachments_policy_id", "policy_id"),
        Index("ix_nat_policy_attachments_local_stage_order", "local_stage_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("nat_policies.id", ondelete="CASCADE"), nullable=False
    )
    local_stage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    scope: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    policy: Mapped[NATPolicy] = relationship(back_populates="attachments")


class PacketProcessingPlan(Base):
    __tablename__ = "packet_processing_plans"
    __table_args__ = (
        CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name="configured_completeness_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    configured_completeness: Mapped[str] = mapped_column(String(8), nullable=False)


class ProcessingStage(Base):
    __tablename__ = "processing_stages"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(payload) = 'object'", name="payload_object"),
        Index("ix_processing_stages_plan_id", "plan_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("packet_processing_plans.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)


class ProcessingTransition(Base):
    __tablename__ = "processing_transitions"
    __table_args__ = (
        UniqueConstraint(
            "from_stage_id",
            "outcome",
            name="uq_processing_transitions_stage_outcome",
        ),
        Index("ix_processing_transitions_plan_id", "plan_id"),
        Index("ix_processing_transitions_from_stage_id", "from_stage_id"),
        Index("ix_processing_transitions_to_stage_id", "to_stage_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("packet_processing_plans.id", ondelete="CASCADE"), nullable=False
    )
    from_stage_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("processing_stages.id", ondelete="CASCADE"), nullable=False
    )
    outcome: Mapped[str] = mapped_column(String(32), nullable=False)
    to_stage_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("processing_stages.id", ondelete="CASCADE"), nullable=False
    )


class ProcessingEntryPoint(Base):
    __tablename__ = "processing_entry_points"
    __table_args__ = (
        UniqueConstraint(
            "plan_id",
            "traffic_class",
            name="uq_processing_entry_points_plan_traffic_class",
        ),
        Index("ix_processing_entry_points_plan_id", "plan_id"),
        Index("ix_processing_entry_points_stage_id", "stage_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("packet_processing_plans.id", ondelete="CASCADE"), nullable=False
    )
    traffic_class: Mapped[str] = mapped_column(String(12), nullable=False)
    stage_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("processing_stages.id", ondelete="CASCADE"), nullable=False
    )


class PacketProcessingPlanAttachmentSet(Base):
    __tablename__ = "packet_processing_plan_attachment_sets"
    __table_args__ = (
        CheckConstraint(
            "traffic_class IN ('TRANSIT', 'LOCAL_INPUT', 'LOCAL_OUTPUT')",
            name="traffic_class_valid",
        ),
        CheckConstraint(
            "configured_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')",
            name="configured_completeness_valid",
        ),
        UniqueConstraint(
            "routing_context_id",
            "traffic_class",
            name="uq_plan_attachment_sets_context_traffic_class",
        ),
        Index("ix_plan_attachment_sets_routing_context_id", "routing_context_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    routing_context_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("routing_contexts.id", ondelete="RESTRICT"), nullable=False
    )
    traffic_class: Mapped[str] = mapped_column(String(12), nullable=False)
    configured_completeness: Mapped[str] = mapped_column(String(8), nullable=False)


class PacketProcessingPlanAttachment(Base):
    __tablename__ = "packet_processing_plan_attachments"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(scope) = 'object'", name="scope_object"),
        Index("ix_plan_attachments_attachment_set_id", "attachment_set_id"),
        Index("ix_plan_attachments_plan_id", "plan_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    attachment_set_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("packet_processing_plan_attachment_sets.id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("packet_processing_plans.id", ondelete="RESTRICT"), nullable=False
    )
    scope: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
