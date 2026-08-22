import uuid

from sqlalchemy import or_, select

from app.device_catalog import DeviceCatalog, DisplayAliasRecord
from app.models import Connection, ConnectionMember, InterfacePhysicalBinding
from app.repository import CanonicalRepository
from app.schemas import (
    ConnectionPointDetails,
    PhysicalObjectDetails,
    PhysicalObjectDetailsDocument,
    ProjectionSourceRef,
)


class ConfiguredPhysicalObjectDetailsResolver:
    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(self, physical_object_id: uuid.UUID) -> PhysicalObjectDetailsDocument:
        self.repository.require_physical_objects([physical_object_id])
        catalog = DeviceCatalog(self.repository.session)
        object_alias = catalog.physical_object_display_aliases([physical_object_id]).get(
            physical_object_id
        )
        object_class = catalog.physical_object_classes([physical_object_id]).get(
            physical_object_id
        )
        points = tuple(
            point
            for point in self.repository.get_all_connection_point_records()
            if point.physical_object_id == physical_object_id
        )
        point_ids = [point.point_id for point in points]
        point_aliases = catalog.connection_point_display_aliases(point_ids)
        connections_by_point: dict[uuid.UUID, dict[uuid.UUID, set[uuid.UUID]]] = {
            point_id: {} for point_id in point_ids
        }
        bindings_by_point: dict[uuid.UUID, list[tuple[uuid.UUID, uuid.UUID]]] = {
            point_id: [] for point_id in point_ids
        }
        if point_ids:
            connections = tuple(
                self.repository.session.scalars(
                    select(Connection)
                    .where(
                        or_(
                            Connection.point_a_id.in_(point_ids),
                            Connection.point_b_id.in_(point_ids),
                        )
                    )
                    .order_by(Connection.id)
                )
            )
            connection_ids = [connection.id for connection in connections]
            member_ids_by_connection: dict[uuid.UUID, set[uuid.UUID]] = {
                connection_id: set() for connection_id in connection_ids
            }
            if connection_ids:
                for member in self.repository.session.scalars(
                    select(ConnectionMember)
                    .where(ConnectionMember.connection_id.in_(connection_ids))
                    .order_by(ConnectionMember.connection_id, ConnectionMember.id)
                ):
                    member_ids_by_connection[member.connection_id].add(member.id)
            for connection in connections:
                if connection.point_a_id in connections_by_point:
                    connections_by_point[connection.point_a_id][connection.id] = (
                        member_ids_by_connection[connection.id]
                    )
                if connection.point_b_id in connections_by_point:
                    connections_by_point[connection.point_b_id][connection.id] = (
                        member_ids_by_connection[connection.id]
                    )
            bindings = tuple(
                self.repository.session.scalars(
                    select(InterfacePhysicalBinding)
                    .where(InterfacePhysicalBinding.point_id.in_(point_ids))
                    .order_by(InterfacePhysicalBinding.point_id, InterfacePhysicalBinding.id)
                )
            )
            for binding in bindings:
                bindings_by_point[binding.point_id].append(
                    (binding.id, binding.interface_id)
                )

        owners = tuple(
            owner
            for owner in self.repository.get_network_interface_physical_owners()
            if owner.physical_object_id == physical_object_id
        )
        return PhysicalObjectDetailsDocument(
            physical_object=PhysicalObjectDetails(
                source_ref=self._ref("PhysicalObject", physical_object_id),
                label=(
                    object_alias.value
                    if object_alias is not None
                    else f"PhysicalObject {str(physical_object_id)[:8]}"
                ),
                label_source=(
                    None if object_alias is not None else "TECHNICAL_FALLBACK"
                ),
                class_=(object_class.value if object_class is not None else None),
            ),
            connection_points=[
                self._point_details(
                    point.point_id,
                    point.cardinality,
                    point_aliases.get(point.point_id),
                    connections_by_point[point.point_id],
                    bindings_by_point[point.point_id],
                )
                for point in sorted(points, key=lambda value: str(value.point_id))
            ],
            owned_interface_count=len(owners),
            gaps=[],
            warnings=[],
        )

    def _point_details(
        self,
        point_id: uuid.UUID,
        cardinality: int,
        alias: DisplayAliasRecord | None,
        connections: dict[uuid.UUID, set[uuid.UUID]],
        bindings: list[tuple[uuid.UUID, uuid.UUID]],
    ) -> ConnectionPointDetails:
        refs = [self._ref("ConnectionPoint", point_id)]
        if alias is not None:
            refs.append(self._ref("EntityMetadata", alias.metadata_id))
        for connection_id, member_ids in connections.items():
            refs.append(self._ref("Connection", connection_id))
            refs.extend(self._ref("ConnectionMember", value) for value in member_ids)
        for binding_id, interface_id in bindings:
            refs.extend(
                [
                    self._ref("InterfacePhysicalBinding", binding_id),
                    self._ref("NetworkInterface", interface_id),
                ]
            )
        return ConnectionPointDetails(
            connection_point_ref=self._ref("ConnectionPoint", point_id),
            label=(
                alias.value
                if alias is not None
                else f"ConnectionPoint {str(point_id)[:8]}"
            ),
            label_source=None if alias is not None else "TECHNICAL_FALLBACK",
            cardinality=cardinality,
            incident_connection_count=len(connections),
            direct_interface_binding_count=len(bindings),
            source_refs=self._dedupe_refs(refs),
        )

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> ProjectionSourceRef:
        return ProjectionSourceRef(
            ref_type="CANONICAL_FACT",
            entity_type=entity_type,
            entity_id=entity_id,
        )

    @staticmethod
    def _dedupe_refs(refs: list[ProjectionSourceRef]) -> list[ProjectionSourceRef]:
        by_key = {(ref.entity_type, str(ref.entity_id)): ref for ref in refs}
        return [by_key[key] for key in sorted(by_key)]
