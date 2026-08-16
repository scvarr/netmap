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
    NetworkInterfaceRealization,
    NATPolicy,
    NATPolicyAttachment,
    NATRule,
    PhysicalObject,
    L2Binding,
    L2EgressRule,
    L2ForwardingContext,
    L2IngressRule,
    L3Binding,
    Route,
    RouteNextHop,
    RoutingContext,
    RoutingTable,
    SecurityPolicy,
    SecurityPolicyAttachment,
    SecurityRule,
)
from app.nat_transforms import NATTransform, normalize_nat_transform
from app.packet_predicates import Predicate, normalize_predicate
from app.processing_scopes import ProcessingScope, normalize_processing_scope
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
            default_transform, model_error=False
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
            transform, model_error=False
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
        records: list[SecurityPolicyAttachmentRecord] = []
        for attachment in attachments:
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
            records.append(
                SecurityPolicyAttachmentRecord(
                    attachment_id=attachment.id,
                    policy_id=attachment.policy_id,
                    stage_order=attachment.stage_order,
                    scope=scope,
                )
            )
        return tuple(records)

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
        records: list[NATPolicyAttachmentRecord] = []
        for attachment in attachments:
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
            records.append(
                NATPolicyAttachmentRecord(
                    attachment_id=attachment.id,
                    policy_id=attachment.policy_id,
                    local_stage_order=attachment.local_stage_order,
                    scope=scope,
                )
            )
        return tuple(records)

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
