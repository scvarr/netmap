import uuid
from collections import Counter

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.device_catalog import PHYSICAL_OBJECT_CLASS_KEY
from app.errors import ModelError, ValidationError
from app.models import (
    BlueprintInstance, BlueprintInstanceSlot, Connection, ConnectionMember,
    ConnectionPoint, EntityMetadata, InterfacePhysicalBinding, L2Binding,
    L2EgressRule, L2ForwardingContext, L2IngressRule,
    L3Binding, NetworkInterface, NetworkInterfacePhysicalOwner,
    NetworkInterfaceRealization, PhysicalObject,
    MapCableRoute, MapPlacement,
)


class PhysicalObjectDeletionCatalog:
    """Deletes an owned physical aggregate only after proving its boundary."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def delete(self, physical_object_id: uuid.UUID) -> None:
        object_ = self.session.scalar(
            select(PhysicalObject).where(PhysicalObject.id == physical_object_id).with_for_update()
        )
        if object_ is None:
            raise ValidationError("PhysicalObject does not exist", {"physical_object_id": str(physical_object_id)})

        point_ids = self._ids(ConnectionPoint.id, ConnectionPoint.physical_object_id == physical_object_id)
        interface_ids = self._ids(
            NetworkInterfacePhysicalOwner.interface_id,
            NetworkInterfacePhysicalOwner.physical_object_id == physical_object_id,
        )
        is_cable = self.session.scalar(select(EntityMetadata.id).where(
            EntityMetadata.physical_object_id == physical_object_id,
            EntityMetadata.key == PHYSICAL_OBJECT_CLASS_KEY,
            EntityMetadata.value == "cable",
        )) is not None
        if is_cable:
            connection_ids = self._simple_cable_connections(physical_object_id, point_ids)
            self._delete_aggregate(object_, point_ids, interface_ids, connection_ids)
            return

        blockers = self._ordinary_blockers(point_ids, interface_ids)
        if blockers:
            raise ModelError(
                "PhysicalObject is in use",
                {"reason": "PHYSICAL_OBJECT_IN_USE", "blockers": blockers},
            )
        self._delete_owned_l2_configuration(interface_ids)
        internal_connection_ids = self._connection_ids_between(point_ids, point_ids)
        self._delete_aggregate(object_, point_ids, interface_ids, internal_connection_ids)

    def _ordinary_blockers(self, point_ids: tuple[uuid.UUID, ...], interface_ids: tuple[uuid.UUID, ...]) -> dict[str, int]:
        blockers: Counter[str] = Counter()
        for connection in self.session.scalars(select(Connection).where(or_(Connection.point_a_id.in_(point_ids), Connection.point_b_id.in_(point_ids)))):
            if connection.point_a_id not in point_ids or connection.point_b_id not in point_ids:
                blockers["EXTERNAL_PHYSICAL_CONNECTION"] += 1
        if interface_ids:
            l3_count = self._count(L3Binding, L3Binding.interface_id.in_(interface_ids))
            if l3_count:
                blockers["L3_BINDING"] += l3_count
            for realization in self.session.scalars(select(NetworkInterfaceRealization).where(or_(NetworkInterfaceRealization.upper_interface_id.in_(interface_ids), NetworkInterfaceRealization.lower_interface_id.in_(interface_ids)))):
                if realization.upper_interface_id not in interface_ids or realization.lower_interface_id not in interface_ids:
                    blockers["EXTERNAL_NETWORK_INTERFACE_REALIZATION"] += 1
        bindings = self.session.scalars(
            select(InterfacePhysicalBinding).where(
                or_(InterfacePhysicalBinding.interface_id.in_(interface_ids), InterfacePhysicalBinding.point_id.in_(point_ids))
            )
        )
        for binding in bindings:
            if binding.interface_id not in interface_ids or binding.point_id not in point_ids:
                blockers["EXTERNAL_INTERFACE_PHYSICAL_BINDING"] += 1
        for slot in self.session.scalars(select(BlueprintInstanceSlot).join(BlueprintInstance).where(BlueprintInstance.physical_object_id == self._object_id_from_points(point_ids))):
            if slot.connection_point_id not in point_ids or (slot.network_interface_id is not None and slot.network_interface_id not in interface_ids):
                blockers["EXTERNAL_BLUEPRINT_INSTANCE_SLOT"] += 1
        return dict(sorted(blockers.items()))

    def _delete_owned_l2_configuration(self, interface_ids: tuple[uuid.UUID, ...]) -> None:
        if not interface_ids:
            return
        bindings = tuple(self.session.scalars(
            select(L2Binding).where(L2Binding.interface_id.in_(interface_ids)).with_for_update()
        ))
        if not bindings:
            return
        binding_ids = tuple(binding.id for binding in bindings)
        context_ids = tuple({binding.forwarding_context_id for binding in bindings})
        for rule in self.session.scalars(select(L2IngressRule).where(L2IngressRule.binding_id.in_(binding_ids))):
            self.session.delete(rule)
        for rule in self.session.scalars(select(L2EgressRule).where(L2EgressRule.binding_id.in_(binding_ids))):
            self.session.delete(rule)
        for binding in bindings:
            self.session.delete(binding)
        self.session.flush()
        for context in self.session.scalars(
            select(L2ForwardingContext).where(L2ForwardingContext.id.in_(context_ids)).with_for_update()
        ):
            has_bindings = self.session.scalar(
                select(L2Binding.id).where(L2Binding.forwarding_context_id == context.id).limit(1)
            ) is not None
            if not has_bindings:
                self.session.delete(context)

    def _simple_cable_connections(self, object_id: uuid.UUID, point_ids: tuple[uuid.UUID, ...]) -> tuple[uuid.UUID, ...]:
        # Cable shape is canonical topology, never a projection/geometry inference.
        if len(point_ids) != 2:
            self._reject_cable(object_id, "cable must own exactly two ConnectionPoints")
        connections = tuple(self.session.scalars(select(Connection).where(or_(Connection.point_a_id.in_(point_ids), Connection.point_b_id.in_(point_ids))).with_for_update()))
        internal = [c for c in connections if c.point_a_id in point_ids and c.point_b_id in point_ids]
        external = [c for c in connections if (c.point_a_id in point_ids) != (c.point_b_id in point_ids)]
        if len(connections) != 3 or len(internal) != 1 or len(external) != 2:
            self._reject_cable(object_id, "cable must have one internal and two external Connections")
        incident = Counter(point for c in connections for point in (c.point_a_id, c.point_b_id) if point in point_ids)
        if set(incident) != set(point_ids) or any(count != 2 for count in incident.values()):
            self._reject_cable(object_id, "cable ConnectionPoints must each have one internal and one external Connection")
        if any(c.cardinality != 1 or len(c.members) != 1 for c in connections):
            self._reject_cable(object_id, "cable Connections must be simple cardinality-one Connections")
        return tuple(c.id for c in connections)

    def _reject_cable(self, object_id: uuid.UUID, message: str) -> None:
        raise ModelError(message, {"reason": "PHYSICAL_OBJECT_IN_USE", "physical_object_id": str(object_id), "blockers": {"AMBIGUOUS_CABLE_STRUCTURE": 1}})

    def _delete_aggregate(self, object_: PhysicalObject, point_ids: tuple[uuid.UUID, ...], interface_ids: tuple[uuid.UUID, ...], connection_ids: tuple[uuid.UUID, ...]) -> None:
        instance_ids = self._ids(BlueprintInstance.id, BlueprintInstance.physical_object_id == object_.id)
        # Presentation records have no topology meaning, but must not outlive their
        # exact canonical object. They are deleted in this same transaction.
        for route in self.session.scalars(select(MapCableRoute).where(MapCableRoute.cable_physical_object_id == object_.id)):
            self.session.delete(route)
        for placement in self.session.scalars(select(MapPlacement).where(MapPlacement.physical_object_id == object_.id)):
            self.session.delete(placement)
        if connection_ids:
            for member in self.session.scalars(select(ConnectionMember).where(ConnectionMember.connection_id.in_(connection_ids))): self.session.delete(member)
            for connection in self.session.scalars(select(Connection).where(Connection.id.in_(connection_ids))): self.session.delete(connection)
        if instance_ids:
            for slot in self.session.scalars(select(BlueprintInstanceSlot).where(BlueprintInstanceSlot.blueprint_instance_id.in_(instance_ids))): self.session.delete(slot)
            for instance in self.session.scalars(select(BlueprintInstance).where(BlueprintInstance.id.in_(instance_ids))): self.session.delete(instance)
        for binding in self.session.scalars(select(InterfacePhysicalBinding).where(or_(InterfacePhysicalBinding.interface_id.in_(interface_ids), InterfacePhysicalBinding.point_id.in_(point_ids)))): self.session.delete(binding)
        for owner in self.session.scalars(select(NetworkInterfacePhysicalOwner).where(NetworkInterfacePhysicalOwner.physical_object_id == object_.id)): self.session.delete(owner)
        for metadata in self.session.scalars(select(EntityMetadata).where(or_(EntityMetadata.physical_object_id == object_.id, EntityMetadata.connection_point_id.in_(point_ids), EntityMetadata.network_interface_id.in_(interface_ids)))): self.session.delete(metadata)
        for interface in self.session.scalars(select(NetworkInterface).where(NetworkInterface.id.in_(interface_ids))): self.session.delete(interface)
        for point in self.session.scalars(select(ConnectionPoint).where(ConnectionPoint.id.in_(point_ids))): self.session.delete(point)
        self.session.delete(object_)
        self.session.flush()

    def _ids(self, column, condition) -> tuple[uuid.UUID, ...]:
        return tuple(self.session.scalars(select(column).where(condition).order_by(column).with_for_update()))

    def _count(self, model, condition) -> int:
        return len(tuple(self.session.scalars(select(model.id).where(condition))))

    def _connection_ids_between(self, left: tuple[uuid.UUID, ...], right: tuple[uuid.UUID, ...]) -> tuple[uuid.UUID, ...]:
        return tuple(self.session.scalars(select(Connection.id).where(Connection.point_a_id.in_(left), Connection.point_b_id.in_(right))))

    def _object_id_from_points(self, point_ids: tuple[uuid.UUID, ...]) -> uuid.UUID:
        return self.session.scalar(select(ConnectionPoint.physical_object_id).where(ConnectionPoint.id.in_(point_ids)).limit(1))
