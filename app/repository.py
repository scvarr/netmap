import uuid
from dataclasses import dataclass
from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network, ip_address, ip_network

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.errors import ModelError, ValidationError
from app.models import (
    Connection,
    ConnectionMember,
    ConnectionPoint,
    InterfaceAddress,
    InterfacePhysicalBinding,
    NetworkInterface,
    NetworkInterfacePhysicalOwner,
    NetworkInterfaceRealization,
    NATPolicy,
    NATPolicyAttachment,
    NATPool,
    NATRule,
    PacketProcessingPlan,
    PacketProcessingPlanAttachment,
    PacketProcessingPlanAttachmentSet,
    PhysicalObject,
    ProcessingEntryPoint,
    ProcessingStage,
    ProcessingTransition,
    L2Binding,
    L2EgressRule,
    L2ForwardingContext,
    L2IngressRule,
    L3Binding,
    Route,
    RouteNextHop,
    RoutingContext,
    RoutingPolicy,
    RoutingPolicyRule,
    RoutingTable,
    SecurityPolicy,
    SecurityPolicyAttachment,
    SecurityRule,
)
from app.nat_transforms import NATTransform, normalize_nat_transform
from app.nat_pools import NATPoolRangeSet, normalize_nat_pool_ranges
from app.packet_processing_plan import (
    PacketProcessingPlanRecord,
    ProcessingEntryPointRecord,
    ProcessingStageRecord,
    ProcessingTransitionRecord,
    validate_packet_processing_plan_graph,
    validate_terminal_transition_semantics,
)
from app.packet_processing_plan_attachments import (
    PacketProcessingPlanAttachmentRecord,
    PacketProcessingPlanAttachmentSetRecord,
    normalize_packet_processing_plan_attachment_scope,
)
from app.packet_predicates import Predicate, normalize_predicate
from app.processing_stage_payloads import (
    STAGE_OUTCOMES,
    SUPPORTED_STAGE_KINDS,
    normalize_processing_stage_payload,
    processing_stage_payload_reference,
)
from app.processing_scopes import ProcessingScope, normalize_processing_scope
from app.routing_policy_actions import (
    RoutingTableSelection,
    normalize_routing_table_selection,
)
from app.routing_policy_predicates import normalize_routing_policy_predicate
from app.security_scopes import SecurityScope, normalize_security_scope


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


@dataclass(frozen=True)
class PhysicalBindingRecord:
    binding_id: uuid.UUID
    interface_id: uuid.UUID
    point_id: uuid.UUID
    point_member: int


@dataclass(frozen=True)
class NetworkInterfacePhysicalOwnerRecord:
    owner_relation_id: uuid.UUID
    interface_id: uuid.UUID
    physical_object_id: uuid.UUID


@dataclass(frozen=True)
class ConnectionPointRecord:
    point_id: uuid.UUID
    physical_object_id: uuid.UUID
    cardinality: int


@dataclass(frozen=True)
class RealizationRecord:
    realization_id: uuid.UUID
    upper_interface_id: uuid.UUID
    lower_interface_id: uuid.UUID


EncapsulationKey = tuple[tuple[str, int], ...]


@dataclass(frozen=True)
class L2BindingRecord:
    binding_id: uuid.UUID
    interface_id: uuid.UUID
    forwarding_context_id: uuid.UUID


@dataclass(frozen=True)
class L2IngressCandidate:
    rule_id: uuid.UUID
    binding_id: uuid.UUID
    interface_id: uuid.UUID
    forwarding_context_id: uuid.UUID
    exact_stack: EncapsulationKey


@dataclass(frozen=True)
class L2EgressRuleRecord:
    rule_id: uuid.UUID
    binding_id: uuid.UUID
    emit_stack: EncapsulationKey


IPAddressValue = IPv4Address | IPv6Address
IPNetworkValue = IPv4Network | IPv6Network


@dataclass(frozen=True)
class RouteNextHopInput:
    gateway_address: str | None = None
    egress_l3_binding_id: uuid.UUID | None = None
    next_hop_id: uuid.UUID | None = None


@dataclass(frozen=True)
class RoutingTableRecord:
    table_id: uuid.UUID
    routing_context_id: uuid.UUID
    address_family: str
    configured_completeness: str


@dataclass(frozen=True)
class RouteNextHopRecord:
    next_hop_id: uuid.UUID
    route_id: uuid.UUID
    gateway_address: IPAddressValue | None
    egress_l3_binding_id: uuid.UUID | None


@dataclass(frozen=True)
class RouteRecord:
    route_id: uuid.UUID
    routing_table_id: uuid.UUID
    destination_prefix: IPNetworkValue
    disposition: str
    next_hops: tuple[RouteNextHopRecord, ...]


@dataclass(frozen=True)
class SelectedRoutingTable:
    table: RoutingTableRecord
    routes: tuple[RouteRecord, ...]


@dataclass(frozen=True)
class RoutingPolicyRuleRecord:
    routing_policy_rule_id: uuid.UUID
    policy_id: uuid.UUID
    order_key: int
    predicate: Predicate
    action: RoutingTableSelection


@dataclass(frozen=True)
class RoutingPolicyRecord:
    routing_policy_id: uuid.UUID
    default_selection: RoutingTableSelection
    configured_completeness: str
    rules: tuple[RoutingPolicyRuleRecord, ...]
    routing_tables: tuple[RoutingTableRecord, ...]


@dataclass(frozen=True)
class InterfaceAddressRecord:
    interface_address_id: uuid.UUID
    l3_binding_id: uuid.UUID
    network_interface_id: uuid.UUID
    routing_context_id: uuid.UUID
    address: IPAddressValue
    prefix_length: int


@dataclass(frozen=True)
class AdjacencyIdentityView:
    egress_l3_binding_id: uuid.UUID
    egress_network_interface_id: uuid.UUID
    routing_context_id: uuid.UUID
    candidates: tuple[InterfaceAddressRecord, ...]


@dataclass(frozen=True)
class L3BindingAttachmentRecord:
    l3_binding_id: uuid.UUID
    network_interface_id: uuid.UUID
    routing_context_id: uuid.UUID


@dataclass(frozen=True)
class SecurityRuleRecord:
    security_rule_id: uuid.UUID
    policy_id: uuid.UUID
    order_key: int
    predicate: Predicate
    action: str


@dataclass(frozen=True)
class SecurityPolicyRecord:
    security_policy_id: uuid.UUID
    default_action: str
    configured_completeness: str
    rules: tuple[SecurityRuleRecord, ...]


@dataclass(frozen=True)
class SecurityPolicyAttachmentRecord:
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    stage_order: int
    scope: SecurityScope


@dataclass(frozen=True)
class NATRuleRecord:
    nat_rule_id: uuid.UUID
    policy_id: uuid.UUID
    order_key: int
    predicate: Predicate
    transform: NATTransform


@dataclass(frozen=True)
class NATPolicyRecord:
    nat_policy_id: uuid.UUID
    default_transform: NATTransform
    configured_completeness: str
    rules: tuple[NATRuleRecord, ...]


@dataclass(frozen=True)
class NATPolicyAttachmentRecord:
    attachment_id: uuid.UUID
    policy_id: uuid.UUID
    local_stage_order: int
    scope: ProcessingScope


NATPoolRecord = NATPoolRangeSet


class CanonicalRepository:
    """Canonical read boundary and minimal fixture writes for implemented slices."""

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

    def add_network_interface(
        self, interface_id: uuid.UUID | None = None
    ) -> NetworkInterface:
        interface = NetworkInterface(id=interface_id or uuid.uuid4())
        self.session.add(interface)
        self.session.flush()
        return interface

    def add_network_interface_physical_owner(
        self,
        interface_id: uuid.UUID,
        physical_object_id: uuid.UUID,
        owner_relation_id: uuid.UUID | None = None,
    ) -> NetworkInterfacePhysicalOwner:
        self.validate_network_interface(interface_id)
        if self.session.get(PhysicalObject, physical_object_id) is None:
            raise ValidationError(
                "PhysicalObject does not exist",
                {"physical_object_id": str(physical_object_id)},
            )
        existing = self.session.scalar(
            select(NetworkInterfacePhysicalOwner).where(
                NetworkInterfacePhysicalOwner.interface_id == interface_id
            )
        )
        if existing is not None:
            raise ValidationError(
                "NetworkInterface already has a physical owner",
                {
                    "interface_id": str(interface_id),
                    "existing_physical_object_id": str(existing.physical_object_id),
                },
            )
        relation = NetworkInterfacePhysicalOwner(
            id=owner_relation_id or uuid.uuid4(),
            interface_id=interface_id,
            physical_object_id=physical_object_id,
        )
        self.session.add(relation)
        self.session.flush()
        return relation

    def add_l2_forwarding_context(
        self, context_id: uuid.UUID | None = None
    ) -> L2ForwardingContext:
        context = L2ForwardingContext(id=context_id or uuid.uuid4())
        self.session.add(context)
        self.session.flush()
        return context

    def add_l2_binding(
        self,
        interface_id: uuid.UUID,
        forwarding_context_id: uuid.UUID,
        binding_id: uuid.UUID | None = None,
    ) -> L2Binding:
        self.validate_network_interface(interface_id)
        if self.session.get(L2ForwardingContext, forwarding_context_id) is None:
            raise ValidationError(
                "L2ForwardingContext does not exist",
                {"forwarding_context_id": str(forwarding_context_id)},
            )
        binding = L2Binding(
            id=binding_id or uuid.uuid4(),
            interface_id=interface_id,
            forwarding_context_id=forwarding_context_id,
        )
        self.session.add(binding)
        self.session.flush()
        return binding

    def add_l2_ingress_rule(
        self,
        binding_id: uuid.UUID,
        exact_stack: list[dict[str, object]],
        rule_id: uuid.UUID | None = None,
    ) -> L2IngressRule:
        if self.session.get(L2Binding, binding_id) is None:
            raise ValidationError("L2Binding does not exist", {"binding_id": str(binding_id)})
        stored_stack = self._stack_json(exact_stack, model_error=False)
        rule = L2IngressRule(
            id=rule_id or uuid.uuid4(), binding_id=binding_id, exact_stack=stored_stack
        )
        self.session.add(rule)
        self.session.flush()
        return rule

    def add_l2_egress_rule(
        self,
        binding_id: uuid.UUID,
        emit_stack: list[dict[str, object]],
        rule_id: uuid.UUID | None = None,
    ) -> L2EgressRule:
        if self.session.get(L2Binding, binding_id) is None:
            raise ValidationError("L2Binding does not exist", {"binding_id": str(binding_id)})
        stored_stack = self._stack_json(emit_stack, model_error=False)
        rule = L2EgressRule(
            id=rule_id or uuid.uuid4(), binding_id=binding_id, emit_stack=stored_stack
        )
        self.session.add(rule)
        self.session.flush()
        return rule

    def add_routing_context(
        self, context_id: uuid.UUID | None = None
    ) -> RoutingContext:
        context = RoutingContext(id=context_id or uuid.uuid4())
        self.session.add(context)
        self.session.flush()
        return context

    def add_l3_binding(
        self,
        interface_id: uuid.UUID,
        routing_context_id: uuid.UUID,
        binding_id: uuid.UUID | None = None,
    ) -> L3Binding:
        self.validate_network_interface(interface_id)
        self._require_routing_context(routing_context_id)
        binding = L3Binding(
            id=binding_id or uuid.uuid4(),
            interface_id=interface_id,
            routing_context_id=routing_context_id,
        )
        self.session.add(binding)
        self.session.flush()
        return binding

    def add_interface_address(
        self,
        l3_binding_id: uuid.UUID,
        address: str,
        prefix_length: int,
        interface_address_id: uuid.UUID | None = None,
    ) -> InterfaceAddress:
        if self.session.get(L3Binding, l3_binding_id) is None:
            raise ValidationError(
                "L3Binding does not exist", {"l3_binding_id": str(l3_binding_id)}
            )
        normalized = self._parse_interface_address(
            address,
            prefix_length,
            model_error=False,
            interface_address_id=interface_address_id,
        )
        assignment = InterfaceAddress(
            id=interface_address_id or uuid.uuid4(),
            l3_binding_id=l3_binding_id,
            address=str(normalized),
            prefix_length=prefix_length,
        )
        self.session.add(assignment)
        self.session.flush()
        return assignment

    def add_routing_table(
        self,
        routing_context_id: uuid.UUID,
        address_family: str,
        configured_completeness: str,
        table_id: uuid.UUID | None = None,
    ) -> RoutingTable:
        self._require_routing_context(routing_context_id)
        if address_family not in {"IPv4", "IPv6"}:
            raise ValidationError(
                "RoutingTable address_family must be IPv4 or IPv6",
                {"address_family": address_family},
            )
        if configured_completeness not in {"COMPLETE", "PARTIAL", "UNKNOWN"}:
            raise ValidationError(
                "RoutingTable configured_completeness is invalid",
                {"configured_completeness": configured_completeness},
            )
        table = RoutingTable(
            id=table_id or uuid.uuid4(),
            routing_context_id=routing_context_id,
            address_family=address_family,
            configured_completeness=configured_completeness,
        )
        self.session.add(table)
        self.session.flush()
        return table

    def add_packet_processing_plan(
        self,
        configured_completeness: str,
        plan_id: uuid.UUID | None = None,
    ) -> PacketProcessingPlan:
        self._validate_packet_processing_plan_completeness(
            configured_completeness, model_error=False
        )
        resolved_id = plan_id or uuid.uuid4()
        if self.session.get(PacketProcessingPlan, resolved_id) is not None:
            raise ValidationError(
                "PacketProcessingPlan ID already exists",
                {"packet_processing_plan_id": str(resolved_id)},
            )
        plan = PacketProcessingPlan(
            id=resolved_id,
            configured_completeness=configured_completeness,
        )
        self.session.add(plan)
        self.session.flush()
        return plan

    def add_processing_stage(
        self,
        plan_id: uuid.UUID,
        kind: str,
        payload: object,
        stage_id: uuid.UUID | None = None,
    ) -> ProcessingStage:
        self._require_packet_processing_plan(plan_id)
        resolved_id = stage_id or uuid.uuid4()
        if self.session.get(ProcessingStage, resolved_id) is not None:
            raise ValidationError(
                "ProcessingStage ID already exists",
                {"processing_stage_id": str(resolved_id)},
            )
        normalized = normalize_processing_stage_payload(
            kind,
            payload,
            model_error=False,
            reference_exists=self._processing_plan_reference_exists,
            details={"packet_processing_plan_id": str(plan_id)},
        )
        stage = ProcessingStage(
            id=resolved_id,
            plan_id=plan_id,
            kind=kind,
            payload=normalized,
        )
        self.session.add(stage)
        self.session.flush()
        return stage

    def add_processing_transition(
        self,
        plan_id: uuid.UUID,
        from_stage_id: uuid.UUID,
        outcome: str,
        to_stage_id: uuid.UUID,
        transition_id: uuid.UUID | None = None,
    ) -> ProcessingTransition:
        self._require_packet_processing_plan(plan_id)
        source = self.session.get(ProcessingStage, from_stage_id)
        target = self.session.get(ProcessingStage, to_stage_id)
        if source is None:
            raise ValidationError(
                "ProcessingTransition source stage does not exist",
                {"from_stage_id": str(from_stage_id)},
            )
        if target is None:
            raise ValidationError(
                "ProcessingTransition target stage does not exist",
                {"to_stage_id": str(to_stage_id)},
            )
        if source.plan_id != plan_id or target.plan_id != plan_id:
            raise ValidationError(
                "ProcessingTransition stages must belong to its PacketProcessingPlan",
                {
                    "packet_processing_plan_id": str(plan_id),
                    "from_stage_plan_id": str(source.plan_id),
                    "to_stage_plan_id": str(target.plan_id),
                },
            )
        if source.kind not in SUPPORTED_STAGE_KINDS:
            raise ValidationError(
                "ProcessingTransition source stage kind is unsupported",
                {"kind": source.kind},
            )
        if outcome not in STAGE_OUTCOMES[source.kind]:
            raise ValidationError(
                "ProcessingTransition outcome is invalid for source stage kind",
                {"stage_kind": source.kind, "outcome": outcome},
            )
        validate_terminal_transition_semantics(
            source_kind=source.kind,
            outcome=outcome,
            target_kind=target.kind,
            target_payload=target.payload,
            model_error=False,
            details={
                "packet_processing_plan_id": str(plan_id),
                "from_stage_id": str(source.id),
                "to_stage_id": str(target.id),
            },
        )
        if self.session.scalar(
            select(ProcessingTransition.id).where(
                ProcessingTransition.from_stage_id == from_stage_id,
                ProcessingTransition.outcome == outcome,
            )
        ) is not None:
            raise ValidationError(
                "ProcessingTransition outcome must be unique for source stage",
                {"from_stage_id": str(from_stage_id), "outcome": outcome},
            )
        resolved_id = transition_id or uuid.uuid4()
        if self.session.get(ProcessingTransition, resolved_id) is not None:
            raise ValidationError(
                "ProcessingTransition ID already exists",
                {"processing_transition_id": str(resolved_id)},
            )
        if self._processing_path_exists(plan_id, to_stage_id, from_stage_id):
            raise ValidationError(
                "ProcessingTransition would create a cycle",
                {
                    "from_stage_id": str(from_stage_id),
                    "to_stage_id": str(to_stage_id),
                },
            )
        transition = ProcessingTransition(
            id=resolved_id,
            plan_id=plan_id,
            from_stage_id=from_stage_id,
            outcome=outcome,
            to_stage_id=to_stage_id,
        )
        self.session.add(transition)
        self.session.flush()
        return transition

    def add_processing_entry_point(
        self,
        plan_id: uuid.UUID,
        traffic_class: str,
        stage_id: uuid.UUID,
        entry_point_id: uuid.UUID | None = None,
    ) -> ProcessingEntryPoint:
        self._require_packet_processing_plan(plan_id)
        if traffic_class not in {"TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"}:
            raise ValidationError(
                "ProcessingEntryPoint traffic_class is invalid",
                {"traffic_class": traffic_class},
            )
        stage = self.session.get(ProcessingStage, stage_id)
        if stage is None:
            raise ValidationError(
                "ProcessingEntryPoint stage does not exist",
                {"stage_id": str(stage_id)},
            )
        if stage.plan_id != plan_id:
            raise ValidationError(
                "ProcessingEntryPoint stage must belong to its PacketProcessingPlan",
                {
                    "packet_processing_plan_id": str(plan_id),
                    "stage_plan_id": str(stage.plan_id),
                },
            )
        if self.session.scalar(
            select(ProcessingEntryPoint.id).where(
                ProcessingEntryPoint.plan_id == plan_id,
                ProcessingEntryPoint.traffic_class == traffic_class,
            )
        ) is not None:
            raise ValidationError(
                "ProcessingEntryPoint traffic class must be unique within plan",
                {
                    "packet_processing_plan_id": str(plan_id),
                    "traffic_class": traffic_class,
                },
            )
        resolved_id = entry_point_id or uuid.uuid4()
        if self.session.get(ProcessingEntryPoint, resolved_id) is not None:
            raise ValidationError(
                "ProcessingEntryPoint ID already exists",
                {"processing_entry_point_id": str(resolved_id)},
            )
        entry = ProcessingEntryPoint(
            id=resolved_id,
            plan_id=plan_id,
            traffic_class=traffic_class,
            stage_id=stage_id,
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def add_packet_processing_plan_attachment_set(
        self,
        routing_context_id: uuid.UUID,
        traffic_class: str,
        configured_completeness: str,
        attachment_set_id: uuid.UUID | None = None,
    ) -> PacketProcessingPlanAttachmentSet:
        self._require_routing_context(routing_context_id)
        self._validate_plan_attachment_set_values(
            traffic_class, configured_completeness, model_error=False
        )
        if self.session.scalar(
            select(PacketProcessingPlanAttachmentSet.id).where(
                PacketProcessingPlanAttachmentSet.routing_context_id == routing_context_id,
                PacketProcessingPlanAttachmentSet.traffic_class == traffic_class,
            )
        ) is not None:
            raise ValidationError(
                "PacketProcessingPlanAttachmentSet selection domain must be unique",
                {"routing_context_id": str(routing_context_id), "traffic_class": traffic_class},
            )
        item = PacketProcessingPlanAttachmentSet(
            id=attachment_set_id or uuid.uuid4(),
            routing_context_id=routing_context_id,
            traffic_class=traffic_class,
            configured_completeness=configured_completeness,
        )
        self.session.add(item)
        self.session.flush()
        return item

    def add_packet_processing_plan_attachment(
        self,
        attachment_set_id: uuid.UUID,
        plan_id: uuid.UUID,
        scope: object,
        attachment_id: uuid.UUID | None = None,
    ) -> PacketProcessingPlanAttachment:
        attachment_set = self.session.get(PacketProcessingPlanAttachmentSet, attachment_set_id)
        if attachment_set is None:
            raise ValidationError(
                "PacketProcessingPlanAttachmentSet does not exist",
                {"attachment_set_id": str(attachment_set_id)},
            )
        plan = self.validate_packet_processing_plan(plan_id)
        if attachment_set.traffic_class not in {
            entry.traffic_class for entry in plan.entry_points
        }:
            raise ValidationError(
                "Attached PacketProcessingPlan lacks the required traffic-class entry",
                {"plan_id": str(plan_id), "traffic_class": attachment_set.traffic_class},
            )
        normalized = normalize_packet_processing_plan_attachment_scope(
            scope,
            model_error=False,
            entity_exists=self._processing_scope_entity_exists,
            details={"attachment_set_id": str(attachment_set_id)},
        )
        item = PacketProcessingPlanAttachment(
            id=attachment_id or uuid.uuid4(),
            attachment_set_id=attachment_set_id,
            plan_id=plan_id,
            scope=normalized,
        )
        self.session.add(item)
        self.session.flush()
        return item

    def add_routing_policy(
        self,
        default_selection: object,
        configured_completeness: str,
        policy_id: uuid.UUID | None = None,
    ) -> RoutingPolicy:
        self._validate_routing_policy_completeness(
            configured_completeness, model_error=False
        )
        normalized = normalize_routing_table_selection(
            default_selection,
            model_error=False,
            table_lookup=lambda table_id: self._get_routing_table_record(
                table_id, missing_model_error=False
            ),
        )
        policy = RoutingPolicy(
            id=policy_id or uuid.uuid4(),
            default_selection=normalized,
            configured_completeness=configured_completeness,
        )
        self.session.add(policy)
        self.session.flush()
        return policy

    def add_routing_policy_rule(
        self,
        policy_id: uuid.UUID,
        order_key: int,
        predicate: object,
        action: object,
        rule_id: uuid.UUID | None = None,
    ) -> RoutingPolicyRule:
        if self.session.get(RoutingPolicy, policy_id) is None:
            raise ValidationError(
                "RoutingPolicy does not exist",
                {"routing_policy_id": str(policy_id)},
            )
        if not isinstance(order_key, int) or isinstance(order_key, bool):
            raise ValidationError("RoutingPolicyRule order_key must be an integer")
        if self.session.scalar(
            select(RoutingPolicyRule.id).where(
                RoutingPolicyRule.policy_id == policy_id,
                RoutingPolicyRule.order_key == order_key,
            )
        ) is not None:
            raise ValidationError(
                "RoutingPolicyRule order_key must be unique within RoutingPolicy",
                {"routing_policy_id": str(policy_id), "order_key": order_key},
            )
        normalized_predicate = normalize_routing_policy_predicate(
            predicate,
            model_error=False,
            entity_exists=self._processing_scope_entity_exists,
        )
        normalized_action = normalize_routing_table_selection(
            action,
            model_error=False,
            table_lookup=lambda table_id: self._get_routing_table_record(
                table_id, missing_model_error=False
            ),
        )
        rule = RoutingPolicyRule(
            id=rule_id or uuid.uuid4(),
            policy_id=policy_id,
            order_key=order_key,
            predicate=normalized_predicate,
            action=normalized_action,
        )
        self.session.add(rule)
        self.session.flush()
        return rule

    def add_route(
        self,
        routing_table_id: uuid.UUID,
        destination_prefix: str,
        disposition: str,
        next_hops: list[RouteNextHopInput] | None = None,
        route_id: uuid.UUID | None = None,
    ) -> Route:
        table = self._require_routing_table(routing_table_id)
        if disposition not in {"FORWARD", "LOCAL", "DISCARD"}:
            raise ValidationError(
                "Route disposition is invalid", {"disposition": disposition}
            )
        normalized_prefix = self._parse_prefix(
            destination_prefix, model_error=False, entity_id=route_id
        )
        self._validate_family(
            table.address_family,
            normalized_prefix.version,
            model_error=False,
            details={"routing_table_id": str(table.id)},
        )
        provided_next_hops = next_hops or []
        if disposition == "FORWARD" and not provided_next_hops:
            raise ValidationError("FORWARD Route must have at least one RouteNextHop")
        if disposition != "FORWARD" and provided_next_hops:
            raise ValidationError(
                "Only FORWARD Route may have RouteNextHop records",
                {"disposition": disposition},
            )
        stored_route_id = route_id or uuid.uuid4()
        validated_next_hops = [
            self._validate_next_hop_input(table, item, stored_route_id)
            for item in provided_next_hops
        ]
        route = Route(
            id=stored_route_id,
            routing_table_id=routing_table_id,
            destination_prefix=str(normalized_prefix),
            disposition=disposition,
        )
        self.session.add(route)
        self.session.flush()
        for next_hop_input, gateway in validated_next_hops:
            self.session.add(
                RouteNextHop(
                    id=next_hop_input.next_hop_id or uuid.uuid4(),
                    route_id=route.id,
                    gateway_address=gateway,
                    egress_l3_binding_id=next_hop_input.egress_l3_binding_id,
                )
            )
        self.session.flush()
        return route

    def add_route_next_hop(
        self,
        route_id: uuid.UUID,
        gateway_address: str | None = None,
        egress_l3_binding_id: uuid.UUID | None = None,
        next_hop_id: uuid.UUID | None = None,
    ) -> RouteNextHop:
        route = self.session.get(Route, route_id)
        if route is None:
            raise ValidationError("Route does not exist", {"route_id": str(route_id)})
        if route.disposition != "FORWARD":
            raise ValidationError(
                "Only FORWARD Route may have RouteNextHop records",
                {"route_id": str(route_id), "disposition": route.disposition},
            )
        table = self._require_routing_table(route.routing_table_id)
        next_hop = self._add_route_next_hop(
            route,
            table,
            RouteNextHopInput(
                gateway_address=gateway_address,
                egress_l3_binding_id=egress_l3_binding_id,
                next_hop_id=next_hop_id,
            ),
        )
        self.session.flush()
        return next_hop

    def add_security_policy(
        self,
        default_action: str,
        configured_completeness: str,
        policy_id: uuid.UUID | None = None,
    ) -> SecurityPolicy:
        self._validate_security_action(default_action, model_error=False)
        self._validate_security_completeness(
            configured_completeness, model_error=False
        )
        policy = SecurityPolicy(
            id=policy_id or uuid.uuid4(),
            default_action=default_action,
            configured_completeness=configured_completeness,
        )
        self.session.add(policy)
        self.session.flush()
        return policy

    def add_security_rule(
        self,
        policy_id: uuid.UUID,
        order_key: int,
        predicate: object,
        action: str,
        rule_id: uuid.UUID | None = None,
    ) -> SecurityRule:
        if self.session.get(SecurityPolicy, policy_id) is None:
            raise ValidationError(
                "SecurityPolicy does not exist",
                {"security_policy_id": str(policy_id)},
            )
        if not isinstance(order_key, int) or isinstance(order_key, bool):
            raise ValidationError("SecurityRule order_key must be an integer")
        if self.session.scalar(
            select(SecurityRule.id).where(
                SecurityRule.policy_id == policy_id,
                SecurityRule.order_key == order_key,
            )
        ) is not None:
            raise ValidationError(
                "SecurityRule order_key must be unique within SecurityPolicy",
                {
                    "security_policy_id": str(policy_id),
                    "order_key": order_key,
                },
            )
        self._validate_security_action(action, model_error=False)
        normalized = normalize_predicate(predicate, model_error=False)
        rule = SecurityRule(
            id=rule_id or uuid.uuid4(),
            policy_id=policy_id,
            order_key=order_key,
            predicate=normalized,
            action=action,
        )
        self.session.add(rule)
        self.session.flush()
        return rule

    def add_security_policy_attachment(
        self,
        policy_id: uuid.UUID,
        stage_order: int,
        scope: object,
        attachment_id: uuid.UUID | None = None,
    ) -> SecurityPolicyAttachment:
        if self.session.get(SecurityPolicy, policy_id) is None:
            raise ValidationError(
                "SecurityPolicy does not exist",
                {"security_policy_id": str(policy_id)},
            )
        if not isinstance(stage_order, int) or isinstance(stage_order, bool):
            raise ValidationError(
                "SecurityPolicyAttachment stage_order must be an integer"
            )
        normalized = normalize_security_scope(
            scope,
            model_error=False,
            entity_exists=self._processing_scope_entity_exists,
        )
        attachment = SecurityPolicyAttachment(
            id=attachment_id or uuid.uuid4(),
            policy_id=policy_id,
            stage_order=stage_order,
            scope=normalized,
        )
        self.session.add(attachment)
        self.session.flush()
        return attachment

    def add_nat_policy(
        self,
        default_transform: object,
        configured_completeness: str,
        policy_id: uuid.UUID | None = None,
    ) -> NATPolicy:
        self._validate_nat_completeness(
            configured_completeness, model_error=False
        )
        normalized = normalize_nat_transform(
            default_transform,
            model_error=False,
            pool_lookup=lambda pool_id: self._get_nat_pool_record(
                pool_id, missing_model_error=False
            ),
        )
        policy = NATPolicy(
            id=policy_id or uuid.uuid4(),
            default_transform=normalized,
            configured_completeness=configured_completeness,
        )
        self.session.add(policy)
        self.session.flush()
        return policy

    def add_nat_rule(
        self,
        policy_id: uuid.UUID,
        order_key: int,
        predicate: object,
        transform: object,
        rule_id: uuid.UUID | None = None,
    ) -> NATRule:
        if self.session.get(NATPolicy, policy_id) is None:
            raise ValidationError(
                "NATPolicy does not exist", {"nat_policy_id": str(policy_id)}
            )
        if not isinstance(order_key, int) or isinstance(order_key, bool):
            raise ValidationError("NATRule order_key must be an integer")
        if self.session.scalar(
            select(NATRule.id).where(
                NATRule.policy_id == policy_id,
                NATRule.order_key == order_key,
            )
        ) is not None:
            raise ValidationError(
                "NATRule order_key must be unique within NATPolicy",
                {"nat_policy_id": str(policy_id), "order_key": order_key},
            )
        normalized_predicate = normalize_predicate(
            predicate, model_error=False
        )
        normalized_transform = normalize_nat_transform(
            transform,
            model_error=False,
            pool_lookup=lambda pool_id: self._get_nat_pool_record(
                pool_id, missing_model_error=False
            ),
        )
        rule = NATRule(
            id=rule_id or uuid.uuid4(),
            policy_id=policy_id,
            order_key=order_key,
            predicate=normalized_predicate,
            transform=normalized_transform,
        )
        self.session.add(rule)
        self.session.flush()
        return rule

    def add_nat_pool(
        self,
        address_ranges: object | None = None,
        port_ranges: object | None = None,
        pool_id: uuid.UUID | None = None,
    ) -> NATPool:
        normalized_addresses, normalized_ports = normalize_nat_pool_ranges(
            [] if address_ranges is None else address_ranges,
            [] if port_ranges is None else port_ranges,
            model_error=False,
        )
        pool = NATPool(
            id=pool_id or uuid.uuid4(),
            address_ranges=normalized_addresses,
            port_ranges=normalized_ports,
        )
        self.session.add(pool)
        self.session.flush()
        return pool

    def add_nat_policy_attachment(
        self,
        policy_id: uuid.UUID,
        local_stage_order: int,
        scope: object,
        attachment_id: uuid.UUID | None = None,
    ) -> NATPolicyAttachment:
        if self.session.get(NATPolicy, policy_id) is None:
            raise ValidationError(
                "NATPolicy does not exist", {"nat_policy_id": str(policy_id)}
            )
        if not isinstance(local_stage_order, int) or isinstance(
            local_stage_order, bool
        ):
            raise ValidationError(
                "NATPolicyAttachment local_stage_order must be an integer"
            )
        normalized = normalize_processing_scope(
            scope,
            model_error=False,
            entity_exists=self._processing_scope_entity_exists,
            attachment_type="NATPolicyAttachment",
        )
        attachment = NATPolicyAttachment(
            id=attachment_id or uuid.uuid4(),
            policy_id=policy_id,
            local_stage_order=local_stage_order,
            scope=normalized,
        )
        self.session.add(attachment)
        self.session.flush()
        return attachment

    def add_network_interface_realization(
        self,
        upper_interface_id: uuid.UUID,
        lower_interface_id: uuid.UUID,
        realization_id: uuid.UUID | None = None,
    ) -> NetworkInterfaceRealization:
        self.validate_network_interface(upper_interface_id)
        self.validate_network_interface(lower_interface_id)
        if upper_interface_id == lower_interface_id:
            raise ValidationError(
                "NetworkInterface realization cannot reference itself",
                {"interface_id": str(upper_interface_id)},
            )
        if self._realization_would_create_cycle(upper_interface_id, lower_interface_id):
            raise ValidationError(
                "NetworkInterface realization would create a cycle",
                {
                    "upper_interface_id": str(upper_interface_id),
                    "lower_interface_id": str(lower_interface_id),
                },
            )
        realization = NetworkInterfaceRealization(
            id=realization_id or uuid.uuid4(),
            upper_interface_id=upper_interface_id,
            lower_interface_id=lower_interface_id,
        )
        self.session.add(realization)
        self.session.flush()
        return realization

    def add_interface_physical_binding(
        self,
        interface_id: uuid.UUID,
        point_id: uuid.UUID,
        point_member: int,
        binding_id: uuid.UUID | None = None,
    ) -> InterfacePhysicalBinding:
        if self.session.get(NetworkInterface, interface_id) is None:
            raise ValidationError(
                "NetworkInterface does not exist",
                {"interface_id": str(interface_id)},
            )
        point = self.session.get(ConnectionPoint, point_id)
        if point is None:
            raise ValidationError(
                "ConnectionPoint does not exist", {"point_id": str(point_id)}
            )
        self._validate_index(point_member, point, "point_member")
        binding = InterfacePhysicalBinding(
            id=binding_id or uuid.uuid4(),
            interface_id=interface_id,
            point_id=point_id,
            point_member=point_member,
        )
        self.session.add(binding)
        self.session.flush()
        return binding

    def validate_network_interface(self, interface_id: uuid.UUID) -> None:
        if self.session.get(NetworkInterface, interface_id) is None:
            raise ValidationError(
                "NetworkInterface does not exist",
                {"interface_id": str(interface_id)},
            )

    def require_physical_objects(
        self, physical_object_ids: list[uuid.UUID]
    ) -> tuple[uuid.UUID, ...]:
        unique_ids = tuple(sorted(set(physical_object_ids), key=str))
        if not unique_ids:
            return ()
        found = set(
            self.session.scalars(
                select(PhysicalObject.id).where(PhysicalObject.id.in_(unique_ids))
            )
        )
        missing = [object_id for object_id in unique_ids if object_id not in found]
        if missing:
            raise ValidationError(
                "Projection scope refers to a missing PhysicalObject",
                {"physical_object_ids": [str(value) for value in missing]},
            )
        return unique_ids

    def get_network_interface_physical_owners(
        self, interface_ids: list[uuid.UUID] | None = None
    ) -> tuple[NetworkInterfacePhysicalOwnerRecord, ...]:
        statement = select(NetworkInterfacePhysicalOwner).order_by(
            NetworkInterfacePhysicalOwner.interface_id,
            NetworkInterfacePhysicalOwner.id,
        )
        if interface_ids is not None:
            if not interface_ids:
                return ()
            statement = statement.where(
                NetworkInterfacePhysicalOwner.interface_id.in_(interface_ids)
            )
        owners = tuple(self.session.scalars(statement))
        records: list[NetworkInterfacePhysicalOwnerRecord] = []
        seen_interfaces: set[uuid.UUID] = set()
        for owner in owners:
            if owner.interface_id in seen_interfaces:
                raise ModelError(
                    "NetworkInterface has multiple physical owners",
                    {"interface_id": str(owner.interface_id)},
                )
            seen_interfaces.add(owner.interface_id)
            if self.session.get(NetworkInterface, owner.interface_id) is None:
                raise ModelError(
                    "NetworkInterfacePhysicalOwner refers to a missing NetworkInterface",
                    {"owner_relation_id": str(owner.id)},
                )
            if self.session.get(PhysicalObject, owner.physical_object_id) is None:
                raise ModelError(
                    "NetworkInterfacePhysicalOwner refers to a missing PhysicalObject",
                    {"owner_relation_id": str(owner.id)},
                )
            records.append(
                NetworkInterfacePhysicalOwnerRecord(
                    owner_relation_id=owner.id,
                    interface_id=owner.interface_id,
                    physical_object_id=owner.physical_object_id,
                )
            )
        return tuple(records)

    def get_connection_point_records(
        self, point_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, ConnectionPointRecord]:
        unique_ids = tuple(sorted(set(point_ids), key=str))
        if not unique_ids:
            return {}
        points = tuple(
            self.session.scalars(
                select(ConnectionPoint)
                .where(ConnectionPoint.id.in_(unique_ids))
                .order_by(ConnectionPoint.id)
            )
        )
        by_id = {point.id: point for point in points}
        missing = [point_id for point_id in unique_ids if point_id not in by_id]
        if missing:
            raise ModelError(
                "L1 path refers to a missing ConnectionPoint",
                {"point_ids": [str(value) for value in missing]},
            )
        records: dict[uuid.UUID, ConnectionPointRecord] = {}
        for point in points:
            if point.cardinality < 1:
                raise ModelError(
                    "ConnectionPoint cardinality must be at least 1",
                    {"point_id": str(point.id), "cardinality": point.cardinality},
                )
            if self.session.get(PhysicalObject, point.physical_object_id) is None:
                raise ModelError(
                    "ConnectionPoint refers to a missing PhysicalObject",
                    {"point_id": str(point.id)},
                )
            records[point.id] = ConnectionPointRecord(
                point_id=point.id,
                physical_object_id=point.physical_object_id,
                cardinality=point.cardinality,
            )
        return records

    def get_physical_bindings_by_interface(
        self, interface_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[PhysicalBindingRecord]]:
        result = {interface_id: [] for interface_id in interface_ids}
        if not interface_ids:
            return result
        rows = self.session.execute(
            select(InterfacePhysicalBinding, ConnectionPoint.cardinality)
            .join(ConnectionPoint, ConnectionPoint.id == InterfacePhysicalBinding.point_id)
            .where(InterfacePhysicalBinding.interface_id.in_(interface_ids))
        ).all()
        for binding, cardinality in rows:
            self._validate_stored_binding(binding, cardinality)
            result[binding.interface_id].append(self._binding_record(binding))
        return result

    def get_realizations_down(
        self, upper_interface_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[RealizationRecord]]:
        result = {interface_id: [] for interface_id in upper_interface_ids}
        if not upper_interface_ids:
            return result
        realizations = self.session.scalars(
            select(NetworkInterfaceRealization).where(
                NetworkInterfaceRealization.upper_interface_id.in_(upper_interface_ids)
            )
        )
        for realization in realizations:
            result[realization.upper_interface_id].append(
                self._realization_record(realization)
            )
        return result

    def get_realizations_up(
        self, lower_interface_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[RealizationRecord]]:
        result = {interface_id: [] for interface_id in lower_interface_ids}
        if not lower_interface_ids:
            return result
        realizations = self.session.scalars(
            select(NetworkInterfaceRealization).where(
                NetworkInterfaceRealization.lower_interface_id.in_(lower_interface_ids)
            )
        )
        for realization in realizations:
            result[realization.lower_interface_id].append(
                self._realization_record(realization)
            )
        return result

    def get_interfaces_by_point_members(
        self, addresses: list[PointMember]
    ) -> dict[PointMember, list[PhysicalBindingRecord]]:
        result = {address: [] for address in addresses}
        if not addresses:
            return result
        conditions = [
            (InterfacePhysicalBinding.point_id == address.point_id)
            & (InterfacePhysicalBinding.point_member == address.member_index)
            for address in addresses
        ]
        rows = self.session.execute(
            select(InterfacePhysicalBinding, ConnectionPoint.cardinality)
            .join(ConnectionPoint, ConnectionPoint.id == InterfacePhysicalBinding.point_id)
            .where(or_(*conditions))
        ).all()
        for binding, cardinality in rows:
            self._validate_stored_binding(binding, cardinality)
            address = PointMember(binding.point_id, binding.point_member)
            result[address].append(self._binding_record(binding))
        return result

    def get_l2_bindings_by_interface(
        self, interface_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[L2BindingRecord]]:
        result = {interface_id: [] for interface_id in interface_ids}
        if not interface_ids:
            return result
        for binding in self.session.scalars(
            select(L2Binding).where(L2Binding.interface_id.in_(interface_ids))
        ):
            result[binding.interface_id].append(self._l2_binding_record(binding))
        return result

    def get_l3_bindings_by_interface(
        self, interface_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[L3BindingAttachmentRecord]]:
        result = {interface_id: [] for interface_id in interface_ids}
        if not interface_ids:
            return result
        for binding in self.session.scalars(
            select(L3Binding)
            .where(L3Binding.interface_id.in_(interface_ids))
            .order_by(L3Binding.interface_id, L3Binding.id)
        ):
            if self.session.get(RoutingContext, binding.routing_context_id) is None:
                raise ModelError(
                    "L3Binding refers to a missing RoutingContext",
                    {"l3_binding_id": str(binding.id)},
                )
            result[binding.interface_id].append(
                L3BindingAttachmentRecord(
                    l3_binding_id=binding.id,
                    network_interface_id=binding.interface_id,
                    routing_context_id=binding.routing_context_id,
                )
            )
        return result

    def get_l2_bindings_by_context(
        self, context_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[L2BindingRecord]]:
        result = {context_id: [] for context_id in context_ids}
        if not context_ids:
            return result
        for binding in self.session.scalars(
            select(L2Binding).where(L2Binding.forwarding_context_id.in_(context_ids))
        ):
            result[binding.forwarding_context_id].append(self._l2_binding_record(binding))
        return result

    def get_l2_ingress_exact(
        self, interface_id: uuid.UUID, stack: list[dict[str, object]]
    ) -> list[L2IngressCandidate]:
        canonical_stack = self._stack_json(stack, model_error=False)
        rows = self.session.execute(
            select(L2IngressRule, L2Binding)
            .join(L2Binding, L2Binding.id == L2IngressRule.binding_id)
            .where(
                L2Binding.interface_id == interface_id,
                L2IngressRule.exact_stack == canonical_stack,
            )
        ).all()
        return [
            L2IngressCandidate(
                rule_id=rule.id,
                binding_id=binding.id,
                interface_id=binding.interface_id,
                forwarding_context_id=binding.forwarding_context_id,
                exact_stack=self._stack_key(rule.exact_stack, rule.id, "exact_stack"),
            )
            for rule, binding in rows
        ]

    def get_l2_egress_rules(
        self, binding_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[L2EgressRuleRecord]]:
        result = {binding_id: [] for binding_id in binding_ids}
        if not binding_ids:
            return result
        for rule in self.session.scalars(
            select(L2EgressRule).where(L2EgressRule.binding_id.in_(binding_ids))
        ):
            result[rule.binding_id].append(
                L2EgressRuleRecord(
                    rule_id=rule.id,
                    binding_id=rule.binding_id,
                    emit_stack=self._stack_key(rule.emit_stack, rule.id, "emit_stack"),
                )
            )
        return result

    def addresses_by_l3_binding(
        self, l3_binding_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[InterfaceAddressRecord]]:
        result = {binding_id: [] for binding_id in l3_binding_ids}
        if not l3_binding_ids:
            return result
        bindings = {
            binding.id: binding
            for binding in self.session.scalars(
                select(L3Binding).where(L3Binding.id.in_(l3_binding_ids))
            )
        }
        missing = [binding_id for binding_id in l3_binding_ids if binding_id not in bindings]
        if missing:
            raise ValidationError(
                "L3Binding does not exist", {"l3_binding_ids": [str(item) for item in missing]}
            )
        for binding in bindings.values():
            if self.session.get(NetworkInterface, binding.interface_id) is None:
                raise ModelError(
                    "L3Binding refers to a missing NetworkInterface",
                    {"l3_binding_id": str(binding.id)},
                )
            if self.session.get(RoutingContext, binding.routing_context_id) is None:
                raise ModelError(
                    "L3Binding refers to a missing RoutingContext",
                    {"l3_binding_id": str(binding.id)},
                )
        for assignment in self.session.scalars(
            select(InterfaceAddress).where(
                InterfaceAddress.l3_binding_id.in_(l3_binding_ids)
            )
        ):
            binding = bindings[assignment.l3_binding_id]
            address = self._parse_interface_address(
                assignment.address,
                assignment.prefix_length,
                model_error=True,
                interface_address_id=assignment.id,
            )
            result[binding.id].append(
                InterfaceAddressRecord(
                    interface_address_id=assignment.id,
                    l3_binding_id=binding.id,
                    network_interface_id=binding.interface_id,
                    routing_context_id=binding.routing_context_id,
                    address=address,
                    prefix_length=assignment.prefix_length,
                )
            )
        return result

    def get_adjacency_identity_candidates(
        self,
        egress_l3_binding_id: uuid.UUID,
        neighbor_target_ip: IPAddressValue,
    ) -> AdjacencyIdentityView:
        source = self.session.get(L3Binding, egress_l3_binding_id)
        if source is None:
            raise ValidationError(
                "L3Binding does not exist",
                {"egress_l3_binding_id": str(egress_l3_binding_id)},
            )
        if self.session.get(NetworkInterface, source.interface_id) is None:
            raise ModelError(
                "Egress L3Binding refers to a missing NetworkInterface",
                {"egress_l3_binding_id": str(source.id)},
            )
        if self.session.get(RoutingContext, source.routing_context_id) is None:
            raise ModelError(
                "Egress L3Binding refers to a missing RoutingContext",
                {"egress_l3_binding_id": str(source.id)},
            )
        visible_assignments = list(
            self.session.scalars(select(InterfaceAddress))
        )
        visible_binding_ids = list(
            dict.fromkeys(
                assignment.l3_binding_id for assignment in visible_assignments
            )
        )
        addresses = self.addresses_by_l3_binding(
            visible_binding_ids
        )
        candidates = tuple(
            assignment
            for binding_id in visible_binding_ids
            for assignment in addresses[binding_id]
            if assignment.address == neighbor_target_ip
        )
        return AdjacencyIdentityView(
            egress_l3_binding_id=source.id,
            egress_network_interface_id=source.interface_id,
            routing_context_id=source.routing_context_id,
            candidates=candidates,
        )

    def get_l3_binding_attachment(
        self, l3_binding_id: uuid.UUID
    ) -> L3BindingAttachmentRecord:
        binding = self.session.get(L3Binding, l3_binding_id)
        if binding is None:
            raise ValidationError(
                "L3Binding does not exist", {"l3_binding_id": str(l3_binding_id)}
            )
        if self.session.get(NetworkInterface, binding.interface_id) is None:
            raise ModelError(
                "L3Binding refers to a missing NetworkInterface",
                {"l3_binding_id": str(binding.id)},
            )
        if self.session.get(RoutingContext, binding.routing_context_id) is None:
            raise ModelError(
                "L3Binding refers to a missing RoutingContext",
                {"l3_binding_id": str(binding.id)},
            )
        return L3BindingAttachmentRecord(
            l3_binding_id=binding.id,
            network_interface_id=binding.interface_id,
            routing_context_id=binding.routing_context_id,
        )

    def validate_routing_context(self, routing_context_id: uuid.UUID) -> None:
        self._require_routing_context(routing_context_id)

    def get_packet_processing_plan(
        self, plan_id: uuid.UUID
    ) -> PacketProcessingPlanRecord:
        return self._load_packet_processing_plan(plan_id, model_error=True)

    def get_packet_processing_plan_attachment_set(
        self, routing_context_id: uuid.UUID, traffic_class: str
    ) -> PacketProcessingPlanAttachmentSetRecord | None:
        attachment_set = self.session.scalar(
            select(PacketProcessingPlanAttachmentSet)
            .where(
                PacketProcessingPlanAttachmentSet.routing_context_id == routing_context_id,
                PacketProcessingPlanAttachmentSet.traffic_class == traffic_class,
            )
            .execution_options(populate_existing=True)
        )
        if attachment_set is None:
            return None
        self._validate_plan_attachment_set_values(
            attachment_set.traffic_class,
            attachment_set.configured_completeness,
            model_error=True,
        )
        if self.session.get(RoutingContext, attachment_set.routing_context_id) is None:
            raise ModelError(
                "PacketProcessingPlanAttachmentSet refers to a missing RoutingContext",
                {"attachment_set_id": str(attachment_set.id)},
            )
        attachments: list[PacketProcessingPlanAttachmentRecord] = []
        for attachment in self.session.scalars(
            select(PacketProcessingPlanAttachment)
            .where(PacketProcessingPlanAttachment.attachment_set_id == attachment_set.id)
            .order_by(PacketProcessingPlanAttachment.id)
            .execution_options(populate_existing=True)
        ):
            details = {"attachment_id": str(attachment.id)}
            if self.session.get(PacketProcessingPlan, attachment.plan_id) is None:
                raise ModelError(
                    "PacketProcessingPlanAttachment refers to a missing PacketProcessingPlan",
                    details,
                )
            plan = self._load_packet_processing_plan(attachment.plan_id, model_error=True)
            if attachment_set.traffic_class not in {
                entry.traffic_class for entry in plan.entry_points
            }:
                raise ModelError(
                    "Attached PacketProcessingPlan lacks the required traffic-class entry",
                    {**details, "traffic_class": attachment_set.traffic_class},
                )
            scope = normalize_packet_processing_plan_attachment_scope(
                attachment.scope,
                model_error=True,
                entity_exists=self._processing_scope_entity_exists,
                details=details,
            )
            attachments.append(
                PacketProcessingPlanAttachmentRecord(
                    attachment_id=attachment.id,
                    attachment_set_id=attachment.attachment_set_id,
                    plan_id=attachment.plan_id,
                    plan_configured_completeness=plan.configured_completeness,
                    scope=scope,
                )
            )
        return PacketProcessingPlanAttachmentSetRecord(
            attachment_set_id=attachment_set.id,
            routing_context_id=attachment_set.routing_context_id,
            traffic_class=attachment_set.traffic_class,
            configured_completeness=attachment_set.configured_completeness,
            attachments=tuple(attachments),
        )

    def validate_packet_processing_plan(
        self, plan_id: uuid.UUID
    ) -> PacketProcessingPlanRecord:
        return self._load_packet_processing_plan(plan_id, model_error=False)

    def validate_routing_policy_evaluation_context(
        self,
        *,
        routing_context_id: uuid.UUID,
        ingress_network_interface_id: uuid.UUID | None,
        ingress_l3_binding_id: uuid.UUID | None,
    ) -> None:
        self.validate_processing_evaluation_context(
            routing_context_id=routing_context_id,
            ingress_network_interface_id=ingress_network_interface_id,
            egress_network_interface_id=None,
            ingress_l3_binding_id=ingress_l3_binding_id,
            egress_l3_binding_id=None,
        )
        if ingress_l3_binding_id is None:
            return
        binding = self.session.get(L3Binding, ingress_l3_binding_id)
        assert binding is not None
        if binding.routing_context_id != routing_context_id:
            raise ValidationError(
                "Ingress L3Binding does not belong to the current RoutingContext",
                {
                    "routing_context_id": str(routing_context_id),
                    "ingress_l3_binding_id": str(ingress_l3_binding_id),
                    "binding_routing_context_id": str(binding.routing_context_id),
                },
            )

    def get_routing_policy(self, policy_id: uuid.UUID) -> RoutingPolicyRecord:
        policy = self.session.get(RoutingPolicy, policy_id)
        if policy is None:
            raise ValidationError(
                "RoutingPolicy does not exist",
                {"routing_policy_id": str(policy_id)},
            )
        policy_details = {"routing_policy_id": str(policy.id)}
        self._validate_routing_policy_completeness(
            policy.configured_completeness, model_error=True
        )
        default_selection = normalize_routing_table_selection(
            policy.default_selection,
            model_error=True,
            table_lookup=lambda table_id: self._get_routing_table_record(
                table_id, missing_model_error=True
            ),
            details={**policy_details, "selection_source": "DEFAULT"},
        )
        rules = list(
            self.session.scalars(
                select(RoutingPolicyRule)
                .where(RoutingPolicyRule.policy_id == policy_id)
                .order_by(RoutingPolicyRule.order_key)
            )
        )
        order_keys: set[int] = set()
        records: list[RoutingPolicyRuleRecord] = []
        table_ids: list[uuid.UUID] = [
            uuid.UUID(default_selection["routing_table_id"])
        ]
        for rule in rules:
            details = {
                "routing_policy_id": str(policy.id),
                "routing_policy_rule_id": str(rule.id),
            }
            if not isinstance(rule.order_key, int) or isinstance(
                rule.order_key, bool
            ):
                raise ModelError("RoutingPolicyRule order_key is invalid", details)
            if rule.order_key in order_keys:
                raise ModelError(
                    "RoutingPolicyRule order_key is duplicated within RoutingPolicy",
                    {**policy_details, "order_key": rule.order_key},
                )
            order_keys.add(rule.order_key)
            predicate = normalize_routing_policy_predicate(
                rule.predicate,
                model_error=True,
                entity_exists=self._processing_scope_entity_exists,
                details=details,
            )
            action = normalize_routing_table_selection(
                rule.action,
                model_error=True,
                table_lookup=lambda table_id: self._get_routing_table_record(
                    table_id, missing_model_error=True
                ),
                details=details,
            )
            table_ids.append(uuid.UUID(action["routing_table_id"]))
            records.append(
                RoutingPolicyRuleRecord(
                    routing_policy_rule_id=rule.id,
                    policy_id=rule.policy_id,
                    order_key=rule.order_key,
                    predicate=predicate,
                    action=action,
                )
            )
        unique_table_ids = list(dict.fromkeys(table_ids))
        return RoutingPolicyRecord(
            routing_policy_id=policy.id,
            default_selection=default_selection,
            configured_completeness=policy.configured_completeness,
            rules=tuple(records),
            routing_tables=tuple(
                self._get_routing_table_record(
                    table_id, missing_model_error=True
                )
                for table_id in unique_table_ids
            ),
        )

    def get_selected_routing_table(
        self, routing_context_id: uuid.UUID, routing_table_id: uuid.UUID
    ) -> SelectedRoutingTable:
        self._require_routing_context(routing_context_id)
        table = self.session.get(RoutingTable, routing_table_id)
        if table is None:
            raise ValidationError(
                "RoutingTable does not exist",
                {"routing_table_id": str(routing_table_id)},
            )
        if table.routing_context_id != routing_context_id:
            raise ValidationError(
                "RoutingTable does not belong to the requested RoutingContext",
                {
                    "routing_context_id": str(routing_context_id),
                    "routing_table_id": str(routing_table_id),
                    "table_routing_context_id": str(table.routing_context_id),
                },
            )
        self._validate_stored_routing_table(table)
        routes = list(
            self.session.scalars(
                select(Route).where(Route.routing_table_id == routing_table_id)
            )
        )
        next_hops_by_route: dict[uuid.UUID, list[RouteNextHop]] = {
            route.id: [] for route in routes
        }
        if routes:
            for next_hop in self.session.scalars(
                select(RouteNextHop).where(
                    RouteNextHop.route_id.in_([route.id for route in routes])
                )
            ):
                next_hops_by_route[next_hop.route_id].append(next_hop)

        records: list[RouteRecord] = []
        for route in routes:
            prefix = self._parse_prefix(
                route.destination_prefix,
                model_error=True,
                entity_id=route.id,
            )
            self._validate_family(
                table.address_family,
                prefix.version,
                model_error=True,
                details={
                    "routing_table_id": str(table.id),
                    "route_id": str(route.id),
                },
            )
            if route.disposition not in {"FORWARD", "LOCAL", "DISCARD"}:
                raise ModelError(
                    "Route has an invalid disposition",
                    {"route_id": str(route.id), "disposition": route.disposition},
                )
            stored_next_hops = next_hops_by_route[route.id]
            if route.disposition == "FORWARD" and not stored_next_hops:
                raise ModelError(
                    "FORWARD Route has no RouteNextHop",
                    {"route_id": str(route.id)},
                )
            if route.disposition != "FORWARD" and stored_next_hops:
                raise ModelError(
                    "Non-FORWARD Route has RouteNextHop records",
                    {
                        "route_id": str(route.id),
                        "disposition": route.disposition,
                    },
                )
            next_hop_records = tuple(
                self._validate_stored_next_hop(next_hop, route, table)
                for next_hop in stored_next_hops
            )
            records.append(
                RouteRecord(
                    route_id=route.id,
                    routing_table_id=route.routing_table_id,
                    destination_prefix=prefix,
                    disposition=route.disposition,
                    next_hops=next_hop_records,
                )
            )
        return SelectedRoutingTable(
            table=RoutingTableRecord(
                table_id=table.id,
                routing_context_id=table.routing_context_id,
                address_family=table.address_family,
                configured_completeness=table.configured_completeness,
            ),
            routes=tuple(records),
        )

    def get_security_policy(
        self, policy_id: uuid.UUID
    ) -> SecurityPolicyRecord:
        policy = self.session.get(SecurityPolicy, policy_id)
        if policy is None:
            raise ValidationError(
                "SecurityPolicy does not exist",
                {"security_policy_id": str(policy_id)},
            )
        self._validate_security_action(policy.default_action, model_error=True)
        self._validate_security_completeness(
            policy.configured_completeness, model_error=True
        )
        rules = list(
            self.session.scalars(
                select(SecurityRule)
                .where(SecurityRule.policy_id == policy_id)
                .order_by(SecurityRule.order_key)
            )
        )
        order_keys: set[int] = set()
        records: list[SecurityRuleRecord] = []
        for rule in rules:
            if not isinstance(rule.order_key, int) or isinstance(rule.order_key, bool):
                raise ModelError(
                    "SecurityRule order_key is invalid",
                    {"security_rule_id": str(rule.id)},
                )
            if rule.order_key in order_keys:
                raise ModelError(
                    "SecurityRule order_key is duplicated within SecurityPolicy",
                    {
                        "security_policy_id": str(policy.id),
                        "order_key": rule.order_key,
                    },
                )
            order_keys.add(rule.order_key)
            self._validate_security_action(rule.action, model_error=True)
            predicate = normalize_predicate(
                rule.predicate,
                model_error=True,
                details={"security_rule_id": str(rule.id)},
            )
            records.append(
                SecurityRuleRecord(
                    security_rule_id=rule.id,
                    policy_id=rule.policy_id,
                    order_key=rule.order_key,
                    predicate=predicate,
                    action=rule.action,
                )
            )
        return SecurityPolicyRecord(
            security_policy_id=policy.id,
            default_action=policy.default_action,
            configured_completeness=policy.configured_completeness,
            rules=tuple(records),
        )

    def get_security_policy_attachments(
        self,
    ) -> tuple[SecurityPolicyAttachmentRecord, ...]:
        attachments = list(
            self.session.scalars(
                select(SecurityPolicyAttachment).order_by(
                    SecurityPolicyAttachment.stage_order
                )
            )
        )
        return tuple(
            self._security_policy_attachment_record(attachment)
            for attachment in attachments
        )

    def get_security_policy_attachment(
        self, attachment_id: uuid.UUID
    ) -> SecurityPolicyAttachmentRecord:
        attachment = self.session.get(
            SecurityPolicyAttachment, attachment_id, populate_existing=True
        )
        if attachment is None:
            raise ValidationError(
                "SecurityPolicyAttachment does not exist",
                {"security_policy_attachment_id": str(attachment_id)},
            )
        return self._security_policy_attachment_record(attachment)

    def _security_policy_attachment_record(
        self, attachment: SecurityPolicyAttachment
    ) -> SecurityPolicyAttachmentRecord:
        details = {"security_policy_attachment_id": str(attachment.id)}
        if self.session.get(SecurityPolicy, attachment.policy_id) is None:
            raise ModelError(
                "SecurityPolicyAttachment refers to a missing SecurityPolicy",
                details,
            )
        if not isinstance(attachment.stage_order, int) or isinstance(
            attachment.stage_order, bool
        ):
            raise ModelError(
                "SecurityPolicyAttachment stage_order is invalid", details
            )
        scope = normalize_security_scope(
            attachment.scope,
            model_error=True,
            entity_exists=self._processing_scope_entity_exists,
            details=details,
        )
        return SecurityPolicyAttachmentRecord(
            attachment_id=attachment.id,
            policy_id=attachment.policy_id,
            stage_order=attachment.stage_order,
            scope=scope,
        )

    def get_nat_policy(self, policy_id: uuid.UUID) -> NATPolicyRecord:
        policy = self.session.get(NATPolicy, policy_id)
        if policy is None:
            raise ValidationError(
                "NATPolicy does not exist", {"nat_policy_id": str(policy_id)}
            )
        details = {"nat_policy_id": str(policy.id)}
        self._validate_nat_completeness(
            policy.configured_completeness, model_error=True
        )
        default_transform = normalize_nat_transform(
            policy.default_transform,
            model_error=True,
            pool_lookup=lambda pool_id: self._get_nat_pool_record(
                pool_id, missing_model_error=True
            ),
            details=details,
        )
        rules = list(
            self.session.scalars(
                select(NATRule)
                .where(NATRule.policy_id == policy_id)
                .order_by(NATRule.order_key)
            )
        )
        order_keys: set[int] = set()
        records: list[NATRuleRecord] = []
        for rule in rules:
            rule_details = {"nat_rule_id": str(rule.id)}
            if not isinstance(rule.order_key, int) or isinstance(
                rule.order_key, bool
            ):
                raise ModelError("NATRule order_key is invalid", rule_details)
            if rule.order_key in order_keys:
                raise ModelError(
                    "NATRule order_key is duplicated within NATPolicy",
                    {**details, "order_key": rule.order_key},
                )
            order_keys.add(rule.order_key)
            predicate = normalize_predicate(
                rule.predicate,
                model_error=True,
                details={"nat_rule_id": str(rule.id)},
            )
            transform = normalize_nat_transform(
                rule.transform,
                model_error=True,
                pool_lookup=lambda pool_id: self._get_nat_pool_record(
                    pool_id, missing_model_error=True
                ),
                details=rule_details,
            )
            records.append(
                NATRuleRecord(
                    nat_rule_id=rule.id,
                    policy_id=rule.policy_id,
                    order_key=rule.order_key,
                    predicate=predicate,
                    transform=transform,
                )
            )
        return NATPolicyRecord(
            nat_policy_id=policy.id,
            default_transform=default_transform,
            configured_completeness=policy.configured_completeness,
            rules=tuple(records),
        )

    def get_nat_pool(self, pool_id: uuid.UUID) -> NATPoolRecord:
        return self._get_nat_pool_record(pool_id, missing_model_error=False)

    def _get_nat_pool_record(
        self, pool_id: uuid.UUID, *, missing_model_error: bool
    ) -> NATPoolRecord:
        pool = self.session.get(NATPool, pool_id)
        if pool is None:
            error_type = ModelError if missing_model_error else ValidationError
            raise error_type("NATPool does not exist", {"nat_pool_id": str(pool_id)})
        details = {"nat_pool_id": str(pool.id)}
        address_ranges, port_ranges = normalize_nat_pool_ranges(
            pool.address_ranges,
            pool.port_ranges,
            model_error=True,
            details=details,
        )
        return NATPoolRecord(
            pool_id=pool.id,
            address_ranges=tuple(address_ranges),
            port_ranges=tuple(port_ranges),
        )

    def get_nat_policy_attachments(
        self,
    ) -> tuple[NATPolicyAttachmentRecord, ...]:
        attachments = list(
            self.session.scalars(
                select(NATPolicyAttachment).order_by(
                    NATPolicyAttachment.local_stage_order
                )
            )
        )
        return tuple(
            self._nat_policy_attachment_record(attachment)
            for attachment in attachments
        )

    def get_nat_policy_attachment(
        self, attachment_id: uuid.UUID
    ) -> NATPolicyAttachmentRecord:
        attachment = self.session.get(
            NATPolicyAttachment, attachment_id, populate_existing=True
        )
        if attachment is None:
            raise ValidationError(
                "NATPolicyAttachment does not exist",
                {"nat_policy_attachment_id": str(attachment_id)},
            )
        return self._nat_policy_attachment_record(attachment)

    def _nat_policy_attachment_record(
        self, attachment: NATPolicyAttachment
    ) -> NATPolicyAttachmentRecord:
        details = {"nat_policy_attachment_id": str(attachment.id)}
        if self.session.get(NATPolicy, attachment.policy_id) is None:
            raise ModelError(
                "NATPolicyAttachment refers to a missing NATPolicy", details
            )
        if not isinstance(attachment.local_stage_order, int) or isinstance(
            attachment.local_stage_order, bool
        ):
            raise ModelError(
                "NATPolicyAttachment local_stage_order is invalid", details
            )
        scope = normalize_processing_scope(
            attachment.scope,
            model_error=True,
            entity_exists=self._processing_scope_entity_exists,
            attachment_type="NATPolicyAttachment",
            details=details,
        )
        return NATPolicyAttachmentRecord(
            attachment_id=attachment.id,
            policy_id=attachment.policy_id,
            local_stage_order=attachment.local_stage_order,
            scope=scope,
        )

    def validate_security_evaluation_context(
        self,
        *,
        routing_context_id: uuid.UUID | None,
        ingress_network_interface_id: uuid.UUID | None,
        egress_network_interface_id: uuid.UUID | None,
        ingress_l3_binding_id: uuid.UUID | None,
        egress_l3_binding_id: uuid.UUID | None,
    ) -> None:
        self.validate_processing_evaluation_context(
            routing_context_id=routing_context_id,
            ingress_network_interface_id=ingress_network_interface_id,
            egress_network_interface_id=egress_network_interface_id,
            ingress_l3_binding_id=ingress_l3_binding_id,
            egress_l3_binding_id=egress_l3_binding_id,
        )

    def validate_processing_evaluation_context(
        self,
        *,
        routing_context_id: uuid.UUID | None,
        ingress_network_interface_id: uuid.UUID | None,
        egress_network_interface_id: uuid.UUID | None,
        ingress_l3_binding_id: uuid.UUID | None,
        egress_l3_binding_id: uuid.UUID | None,
    ) -> None:
        if routing_context_id is not None and self.session.get(
            RoutingContext, routing_context_id
        ) is None:
            raise ValidationError(
                "RoutingContext does not exist",
                {"routing_context_id": str(routing_context_id)},
            )
        for field, interface_id in (
            ("ingress_network_interface_id", ingress_network_interface_id),
            ("egress_network_interface_id", egress_network_interface_id),
        ):
            if interface_id is not None and self.session.get(
                NetworkInterface, interface_id
            ) is None:
                raise ValidationError(
                    "NetworkInterface does not exist", {field: str(interface_id)}
                )
        for direction, binding_id, interface_id in (
            ("ingress", ingress_l3_binding_id, ingress_network_interface_id),
            ("egress", egress_l3_binding_id, egress_network_interface_id),
        ):
            if binding_id is None:
                continue
            binding = self.session.get(L3Binding, binding_id)
            if binding is None:
                raise ValidationError(
                    "L3Binding does not exist",
                    {f"{direction}_l3_binding_id": str(binding_id)},
                )
            if self.session.get(NetworkInterface, binding.interface_id) is None:
                raise ModelError(
                    "L3Binding refers to a missing NetworkInterface",
                    {"l3_binding_id": str(binding.id)},
                )
            if self.session.get(RoutingContext, binding.routing_context_id) is None:
                raise ModelError(
                    "L3Binding refers to a missing RoutingContext",
                    {"l3_binding_id": str(binding.id)},
                )
            if interface_id is not None and binding.interface_id != interface_id:
                raise ValidationError(
                    "L3Binding does not belong to the supplied NetworkInterface",
                    {
                        f"{direction}_l3_binding_id": str(binding_id),
                        f"{direction}_network_interface_id": str(interface_id),
                    },
                )

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
        member_counts = (
            select(
                ConnectionMember.connection_id,
                func.count(ConnectionMember.id).label("member_count"),
            )
            .group_by(ConnectionMember.connection_id)
            .subquery()
        )
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
            select(
                Connection,
                ConnectionMember,
                point_a.cardinality,
                point_b.cardinality,
                member_counts.c.member_count,
            )
            .join(ConnectionMember, ConnectionMember.connection_id == Connection.id)
            .join(member_counts, member_counts.c.connection_id == Connection.id)
            .join(point_a, point_a.id == Connection.point_a_id)
            .join(point_b, point_b.id == Connection.point_b_id)
            .where(or_(*conditions))
        ).all()

        for connection, member, cardinality_a, cardinality_b, member_count in rows:
            if connection.cardinality != member_count:
                raise ModelError(
                    "Connection cardinality does not equal its ConnectionMember count",
                    {
                        "connection_id": str(connection.id),
                        "cardinality": connection.cardinality,
                        "member_count": member_count,
                    },
                )
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
    def _binding_record(binding: InterfacePhysicalBinding) -> PhysicalBindingRecord:
        return PhysicalBindingRecord(
            binding_id=binding.id,
            interface_id=binding.interface_id,
            point_id=binding.point_id,
            point_member=binding.point_member,
        )

    @staticmethod
    def _realization_record(
        realization: NetworkInterfaceRealization,
    ) -> RealizationRecord:
        return RealizationRecord(
            realization_id=realization.id,
            upper_interface_id=realization.upper_interface_id,
            lower_interface_id=realization.lower_interface_id,
        )

    @staticmethod
    def _l2_binding_record(binding: L2Binding) -> L2BindingRecord:
        return L2BindingRecord(
            binding_id=binding.id,
            interface_id=binding.interface_id,
            forwarding_context_id=binding.forwarding_context_id,
        )

    @classmethod
    def _stack_json(
        cls, stack: object, *, model_error: bool
    ) -> list[dict[str, object]]:
        key = cls._validate_stack(stack, model_error=model_error)
        return [{"kind": kind, "value": value} for kind, value in key]

    @classmethod
    def _stack_key(
        cls, stack: object, entity_id: uuid.UUID, field: str
    ) -> EncapsulationKey:
        try:
            return cls._validate_stack(stack, model_error=True)
        except ModelError as exc:
            exc.details.update({"entity_id": str(entity_id), "field": field})
            raise

    @staticmethod
    def _validate_stack(stack: object, *, model_error: bool) -> EncapsulationKey:
        error_type = ModelError if model_error else ValidationError
        if not isinstance(stack, list):
            raise error_type("EncapsulationStack must be an ordered array")
        labels: list[tuple[str, int]] = []
        for position, label in enumerate(stack):
            if (
                not isinstance(label, dict)
                or set(label) != {"kind", "value"}
                or not isinstance(label.get("kind"), str)
                or not label["kind"]
                or not isinstance(label.get("value"), int)
                or isinstance(label.get("value"), bool)
            ):
                raise error_type(
                    "EncapsulationStack label must contain exactly kind:string and value:integer",
                    {"position": position},
                )
            labels.append((label["kind"], label["value"]))
        return tuple(labels)

    def _realization_would_create_cycle(
        self, upper_interface_id: uuid.UUID, lower_interface_id: uuid.UUID
    ) -> bool:
        visited = {lower_interface_id}
        frontier = [lower_interface_id]
        while frontier:
            realizations = self.get_realizations_down(frontier)
            next_frontier: list[uuid.UUID] = []
            for interface_id in frontier:
                for realization in realizations[interface_id]:
                    candidate = realization.lower_interface_id
                    if candidate == upper_interface_id:
                        return True
                    if candidate not in visited:
                        visited.add(candidate)
                        next_frontier.append(candidate)
            frontier = next_frontier
        return False

    def _require_routing_context(self, context_id: uuid.UUID) -> RoutingContext:
        context = self.session.get(RoutingContext, context_id)
        if context is None:
            raise ValidationError(
                "RoutingContext does not exist",
                {"routing_context_id": str(context_id)},
            )
        return context

    def _require_routing_table(self, table_id: uuid.UUID) -> RoutingTable:
        table = self.session.get(RoutingTable, table_id)
        if table is None:
            raise ValidationError(
                "RoutingTable does not exist", {"routing_table_id": str(table_id)}
            )
        return table

    def _get_routing_table_record(
        self, table_id: uuid.UUID, *, missing_model_error: bool
    ) -> RoutingTableRecord:
        table = self.session.get(RoutingTable, table_id)
        if table is None:
            error_type = ModelError if missing_model_error else ValidationError
            raise error_type(
                "RoutingTable does not exist",
                {"routing_table_id": str(table_id)},
            )
        self._validate_stored_routing_table(table)
        if self.session.get(RoutingContext, table.routing_context_id) is None:
            raise ModelError(
                "RoutingTable refers to a missing RoutingContext",
                {
                    "routing_table_id": str(table.id),
                    "routing_context_id": str(table.routing_context_id),
                },
            )
        return RoutingTableRecord(
            table_id=table.id,
            routing_context_id=table.routing_context_id,
            address_family=table.address_family,
            configured_completeness=table.configured_completeness,
        )

    def _add_route_next_hop(
        self,
        route: Route,
        table: RoutingTable,
        next_hop_input: RouteNextHopInput,
    ) -> RouteNextHop:
        next_hop_input, gateway = self._validate_next_hop_input(
            table, next_hop_input, route.id
        )
        next_hop = RouteNextHop(
            id=next_hop_input.next_hop_id or uuid.uuid4(),
            route_id=route.id,
            gateway_address=gateway,
            egress_l3_binding_id=next_hop_input.egress_l3_binding_id,
        )
        self.session.add(next_hop)
        return next_hop

    def _validate_next_hop_input(
        self,
        table: RoutingTable,
        next_hop_input: RouteNextHopInput,
        route_id: uuid.UUID,
    ) -> tuple[RouteNextHopInput, str | None]:
        if next_hop_input.gateway_address is None and next_hop_input.egress_l3_binding_id is None:
            raise ValidationError(
                "RouteNextHop requires gateway_address and/or egress_l3_binding_id",
                {"route_id": str(route_id)},
            )
        gateway: IPAddressValue | None = None
        if next_hop_input.gateway_address is not None:
            try:
                gateway = ip_address(next_hop_input.gateway_address)
            except ValueError as exc:
                raise ValidationError(
                    "RouteNextHop gateway_address is invalid",
                    {"gateway_address": next_hop_input.gateway_address},
                ) from exc
            self._validate_family(
                table.address_family,
                gateway.version,
                model_error=False,
                details={"route_id": str(route_id)},
            )
        if next_hop_input.egress_l3_binding_id is not None:
            binding = self.session.get(L3Binding, next_hop_input.egress_l3_binding_id)
            if binding is None:
                raise ValidationError(
                    "L3Binding does not exist",
                    {
                        "egress_l3_binding_id": str(
                            next_hop_input.egress_l3_binding_id
                        )
                    },
                )
            if binding.routing_context_id != table.routing_context_id:
                raise ValidationError(
                    "RouteNextHop egress L3Binding belongs to another RoutingContext",
                    {
                        "route_id": str(route_id),
                        "egress_l3_binding_id": str(binding.id),
                        "table_routing_context_id": str(table.routing_context_id),
                        "binding_routing_context_id": str(binding.routing_context_id),
                    },
                )
        return next_hop_input, str(gateway) if gateway is not None else None

    def _validate_stored_next_hop(
        self, next_hop: RouteNextHop, route: Route, table: RoutingTable
    ) -> RouteNextHopRecord:
        if next_hop.gateway_address is None and next_hop.egress_l3_binding_id is None:
            raise ModelError(
                "RouteNextHop has neither gateway nor egress L3Binding",
                {"route_next_hop_id": str(next_hop.id)},
            )
        gateway: IPAddressValue | None = None
        if next_hop.gateway_address is not None:
            try:
                gateway = ip_address(str(next_hop.gateway_address))
            except ValueError as exc:
                raise ModelError(
                    "RouteNextHop has an invalid gateway address",
                    {"route_next_hop_id": str(next_hop.id)},
                ) from exc
            self._validate_family(
                table.address_family,
                gateway.version,
                model_error=True,
                details={
                    "route_id": str(route.id),
                    "route_next_hop_id": str(next_hop.id),
                },
            )
        if next_hop.egress_l3_binding_id is not None:
            binding = self.session.get(L3Binding, next_hop.egress_l3_binding_id)
            if binding is None:
                raise ModelError(
                    "RouteNextHop refers to a missing L3Binding",
                    {"route_next_hop_id": str(next_hop.id)},
                )
            if binding.routing_context_id != table.routing_context_id:
                raise ModelError(
                    "RouteNextHop egress L3Binding belongs to another RoutingContext",
                    {
                        "route_id": str(route.id),
                        "route_next_hop_id": str(next_hop.id),
                        "egress_l3_binding_id": str(binding.id),
                        "table_routing_context_id": str(table.routing_context_id),
                        "binding_routing_context_id": str(binding.routing_context_id),
                    },
                )
        return RouteNextHopRecord(
            next_hop_id=next_hop.id,
            route_id=next_hop.route_id,
            gateway_address=gateway,
            egress_l3_binding_id=next_hop.egress_l3_binding_id,
        )

    @staticmethod
    def _validate_stored_routing_table(table: RoutingTable) -> None:
        if table.address_family not in {"IPv4", "IPv6"}:
            raise ModelError(
                "RoutingTable has an invalid address family",
                {"routing_table_id": str(table.id), "address_family": table.address_family},
            )
        if table.configured_completeness not in {"COMPLETE", "PARTIAL", "UNKNOWN"}:
            raise ModelError(
                "RoutingTable has invalid configured completeness",
                {
                    "routing_table_id": str(table.id),
                    "configured_completeness": table.configured_completeness,
                },
            )

    @staticmethod
    def _validate_security_action(action: object, *, model_error: bool) -> None:
        if action not in {"PERMIT", "DROP", "REJECT"}:
            error_type = ModelError if model_error else ValidationError
            raise error_type(
                "Security action is invalid", {"action": action}
            )

    @staticmethod
    def _validate_security_completeness(
        completeness: object, *, model_error: bool
    ) -> None:
        if completeness not in {"COMPLETE", "PARTIAL", "UNKNOWN"}:
            error_type = ModelError if model_error else ValidationError
            raise error_type(
                "SecurityPolicy configured completeness is invalid",
                {"configured_completeness": completeness},
            )

    @staticmethod
    def _validate_nat_completeness(
        completeness: object, *, model_error: bool
    ) -> None:
        if completeness not in {"COMPLETE", "PARTIAL", "UNKNOWN"}:
            error_type = ModelError if model_error else ValidationError
            raise error_type(
                "NATPolicy configured completeness is invalid",
                {"configured_completeness": completeness},
            )

    @staticmethod
    def _validate_routing_policy_completeness(
        completeness: object, *, model_error: bool
    ) -> None:
        if completeness not in {"COMPLETE", "PARTIAL", "UNKNOWN"}:
            error_type = ModelError if model_error else ValidationError
            raise error_type(
                "RoutingPolicy configured completeness is invalid",
                {"configured_completeness": completeness},
            )

    @staticmethod
    def _validate_packet_processing_plan_completeness(
        completeness: object, *, model_error: bool
    ) -> None:
        if completeness not in {"COMPLETE", "PARTIAL", "UNKNOWN"}:
            error_type = ModelError if model_error else ValidationError
            raise error_type(
                "PacketProcessingPlan configured completeness is invalid",
                {"configured_completeness": completeness},
            )

    @staticmethod
    def _validate_plan_attachment_set_values(
        traffic_class: object, completeness: object, *, model_error: bool
    ) -> None:
        error_type = ModelError if model_error else ValidationError
        if traffic_class not in {"TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"}:
            raise error_type(
                "PacketProcessingPlanAttachmentSet traffic_class is invalid",
                {"traffic_class": traffic_class},
            )
        if completeness not in {"COMPLETE", "PARTIAL", "UNKNOWN"}:
            raise error_type(
                "PacketProcessingPlanAttachmentSet configured completeness is invalid",
                {"configured_completeness": completeness},
            )

    def _require_packet_processing_plan(
        self, plan_id: uuid.UUID
    ) -> PacketProcessingPlan:
        plan = self.session.get(PacketProcessingPlan, plan_id)
        if plan is None:
            raise ValidationError(
                "PacketProcessingPlan does not exist",
                {"packet_processing_plan_id": str(plan_id)},
            )
        return plan

    def _load_packet_processing_plan(
        self, plan_id: uuid.UUID, *, model_error: bool
    ) -> PacketProcessingPlanRecord:
        plan = self._require_packet_processing_plan(plan_id)
        self._validate_packet_processing_plan_completeness(
            plan.configured_completeness, model_error=model_error
        )
        stages: list[ProcessingStageRecord] = []
        for stage in self.session.scalars(
            select(ProcessingStage)
            .where(ProcessingStage.plan_id == plan_id)
            .order_by(ProcessingStage.id)
        ):
            details = {
                "packet_processing_plan_id": str(plan_id),
                "processing_stage_id": str(stage.id),
            }
            payload = normalize_processing_stage_payload(
                stage.kind,
                stage.payload,
                model_error=model_error,
                reference_exists=self._processing_plan_reference_exists,
                details=details,
            )
            stages.append(
                ProcessingStageRecord(
                    stage_id=stage.id,
                    plan_id=stage.plan_id,
                    kind=stage.kind,
                    payload=payload,
                    payload_reference=processing_stage_payload_reference(
                        stage.kind, payload
                    ),
                )
            )
        transitions = tuple(
            ProcessingTransitionRecord(
                transition_id=transition.id,
                plan_id=transition.plan_id,
                from_stage_id=transition.from_stage_id,
                outcome=transition.outcome,
                to_stage_id=transition.to_stage_id,
            )
            for transition in self.session.scalars(
                select(ProcessingTransition)
                .where(ProcessingTransition.plan_id == plan_id)
                .order_by(
                    ProcessingTransition.from_stage_id,
                    ProcessingTransition.outcome,
                    ProcessingTransition.id,
                )
            )
        )
        entries: list[ProcessingEntryPointRecord] = []
        for entry in self.session.scalars(
            select(ProcessingEntryPoint)
            .where(ProcessingEntryPoint.plan_id == plan_id)
            .order_by(ProcessingEntryPoint.traffic_class, ProcessingEntryPoint.id)
        ):
            if entry.traffic_class not in {
                "TRANSIT",
                "LOCAL_INPUT",
                "LOCAL_OUTPUT",
            }:
                error_type = ModelError if model_error else ValidationError
                raise error_type(
                    "ProcessingEntryPoint traffic_class is invalid",
                    {
                        "packet_processing_plan_id": str(plan_id),
                        "processing_entry_point_id": str(entry.id),
                        "traffic_class": entry.traffic_class,
                    },
                )
            entries.append(
                ProcessingEntryPointRecord(
                    entry_point_id=entry.id,
                    plan_id=entry.plan_id,
                    traffic_class=entry.traffic_class,
                    stage_id=entry.stage_id,
                )
            )
        record = PacketProcessingPlanRecord(
            plan_id=plan.id,
            configured_completeness=plan.configured_completeness,
            entry_points=tuple(entries),
            stages=tuple(stages),
            transitions=transitions,
        )
        validate_packet_processing_plan_graph(record, model_error=model_error)
        return record

    def _processing_plan_reference_exists(
        self, entity_type: str, entity_id: uuid.UUID
    ) -> bool:
        model = {
            "RoutingPolicy": RoutingPolicy,
            "SecurityPolicyAttachment": SecurityPolicyAttachment,
            "NATPolicyAttachment": NATPolicyAttachment,
        }[entity_type]
        return self.session.get(model, entity_id) is not None

    def _processing_path_exists(
        self,
        plan_id: uuid.UUID,
        start_stage_id: uuid.UUID,
        target_stage_id: uuid.UUID,
    ) -> bool:
        adjacency: dict[uuid.UUID, list[uuid.UUID]] = {}
        for source_id, destination_id in self.session.execute(
            select(
                ProcessingTransition.from_stage_id,
                ProcessingTransition.to_stage_id,
            ).where(ProcessingTransition.plan_id == plan_id)
        ):
            adjacency.setdefault(source_id, []).append(destination_id)
        pending = [start_stage_id]
        visited: set[uuid.UUID] = set()
        while pending:
            current = pending.pop()
            if current == target_stage_id:
                return True
            if current in visited:
                continue
            visited.add(current)
            pending.extend(adjacency.get(current, ()))
        return False

    def _processing_scope_entity_exists(
        self, entity_type: str, entity_id: uuid.UUID
    ) -> bool:
        model = {
            "RoutingContext": RoutingContext,
            "NetworkInterface": NetworkInterface,
            "L3Binding": L3Binding,
        }[entity_type]
        return self.session.get(model, entity_id) is not None

    @staticmethod
    def _parse_interface_address(
        address: object,
        prefix_length: object,
        *,
        model_error: bool,
        interface_address_id: uuid.UUID | None,
    ) -> IPAddressValue:
        error_type = ModelError if model_error else ValidationError
        details = (
            {"interface_address_id": str(interface_address_id)}
            if interface_address_id
            else {}
        )
        try:
            normalized = ip_address(str(address))
        except ValueError as exc:
            raise error_type("InterfaceAddress address is invalid", details) from exc
        if model_error and str(address) != str(normalized):
            raise ModelError(
                "InterfaceAddress address is not canonical",
                {
                    **details,
                    "address": str(address),
                    "canonical_address": str(normalized),
                },
            )
        maximum = 32 if normalized.version == 4 else 128
        if (
            not isinstance(prefix_length, int)
            or isinstance(prefix_length, bool)
            or not 0 <= prefix_length <= maximum
        ):
            raise error_type(
                "InterfaceAddress prefix_length is invalid for address family",
                {
                    **details,
                    "address_family": "IPv4" if normalized.version == 4 else "IPv6",
                    "prefix_length": prefix_length,
                },
            )
        return normalized

    @staticmethod
    def _parse_prefix(
        prefix: object, *, model_error: bool, entity_id: uuid.UUID | None
    ) -> IPNetworkValue:
        error_type = ModelError if model_error else ValidationError
        try:
            normalized = ip_network(str(prefix), strict=False)
        except ValueError as exc:
            raise error_type(
                "Route destination_prefix is invalid",
                {"route_id": str(entity_id)} if entity_id else {},
            ) from exc
        if model_error and str(prefix) != str(normalized):
            raise ModelError(
                "Route destination_prefix is not canonical",
                {
                    "route_id": str(entity_id),
                    "destination_prefix": str(prefix),
                    "canonical_prefix": str(normalized),
                },
            )
        return normalized

    @staticmethod
    def _validate_family(
        table_family: str,
        value_version: int,
        *,
        model_error: bool,
        details: dict[str, str],
    ) -> None:
        expected = "IPv4" if value_version == 4 else "IPv6"
        if table_family != expected:
            error_type = ModelError if model_error else ValidationError
            raise error_type(
                "Address family does not match RoutingTable",
                {**details, "table_address_family": table_family, "value_family": expected},
            )

    @staticmethod
    def _validate_stored_binding(
        binding: InterfacePhysicalBinding, cardinality: int
    ) -> None:
        if binding.point_member < 1 or binding.point_member > cardinality:
            raise ModelError(
                "InterfacePhysicalBinding refers to a member outside ConnectionPoint cardinality",
                {
                    "binding_id": str(binding.id),
                    "point_id": str(binding.point_id),
                    "point_member": binding.point_member,
                    "cardinality": cardinality,
                },
            )

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
