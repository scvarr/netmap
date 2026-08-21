import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import CIDR, INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PhysicalObject(Base):
    __tablename__ = "physical_objects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_points: Mapped[list["ConnectionPoint"]] = relationship(back_populates="physical_object")
    network_interface_owners: Mapped[list["NetworkInterfacePhysicalOwner"]] = relationship(
        back_populates="physical_object"
    )


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
