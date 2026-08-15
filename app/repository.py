import uuid
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.errors import ModelError, ValidationError
from app.models import (
    Connection,
    ConnectionMember,
    ConnectionPoint,
    InterfacePhysicalBinding,
    NetworkInterface,
    NetworkInterfaceRealization,
    PhysicalObject,
    L2Binding,
    L2EgressRule,
    L2ForwardingContext,
    L2IngressRule,
)


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
