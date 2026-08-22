import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.device_catalog import DISPLAY_ALIAS_KEY
from app.errors import ValidationError
from app.models import ConnectionPoint, EntityMetadata, NetworkInterface
from app.repository import CanonicalRepository, ConnectionMemberInput


@dataclass(frozen=True)
class CreatedPhysicalConnection:
    source_interface_id: uuid.UUID
    target_interface_id: uuid.UUID
    cable_id: uuid.UUID
    source_binding_id: uuid.UUID
    target_binding_id: uuid.UUID
    connection_ids: tuple[uuid.UUID, uuid.UUID, uuid.UUID]


@dataclass(frozen=True)
class NetworkInterfaceEndpoint:
    interface_id: uuid.UUID


@dataclass(frozen=True)
class ConnectionPointEndpoint:
    connection_point_id: uuid.UUID
    member_index: int = 1


PhysicalEndpoint = NetworkInterfaceEndpoint | ConnectionPointEndpoint


@dataclass(frozen=True)
class MaterializedPhysicalEndpoint:
    endpoint: PhysicalEndpoint
    connection_point_id: uuid.UUID
    binding_id: uuid.UUID | None


@dataclass(frozen=True)
class CreatedEndpointPhysicalConnection:
    source: MaterializedPhysicalEndpoint
    target: MaterializedPhysicalEndpoint
    cable_id: uuid.UUID
    connection_ids: tuple[uuid.UUID, uuid.UUID, uuid.UUID]


class PhysicalConnectionCatalog:
    """Bounded user-intent composition over existing canonical L1 primitives."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_atomic_link(
        self,
        source_interface_id: uuid.UUID,
        target_interface_id: uuid.UUID,
        cable_display_name: str | None = None,
    ) -> CreatedPhysicalConnection:
        if source_interface_id == target_interface_id:
            raise ValidationError(
                "A physical link requires two different NetworkInterfaces",
                {"interface_id": str(source_interface_id)},
            )
        created = self.create_endpoint_link(
            NetworkInterfaceEndpoint(source_interface_id),
            NetworkInterfaceEndpoint(target_interface_id),
            cable_display_name,
        )
        assert created.source.binding_id is not None
        assert created.target.binding_id is not None
        return CreatedPhysicalConnection(
            source_interface_id=source_interface_id,
            target_interface_id=target_interface_id,
            cable_id=created.cable_id,
            source_binding_id=created.source.binding_id,
            target_binding_id=created.target.binding_id,
            connection_ids=created.connection_ids,
        )

    def create_endpoint_link(
        self,
        source: PhysicalEndpoint,
        target: PhysicalEndpoint,
        cable_display_name: str | None = None,
    ) -> CreatedEndpointPhysicalConnection:
        if source == target:
            raise ValidationError(
                "A physical connection requires two different endpoints",
                {"endpoint": self._endpoint_description(source)},
            )

        interface_ids = tuple(
            sorted(
                {
                    endpoint.interface_id
                    for endpoint in (source, target)
                    if isinstance(endpoint, NetworkInterfaceEndpoint)
                },
                key=str,
            )
        )
        locked_interfaces = tuple(
            self.session.scalars(
                select(NetworkInterface)
                .where(NetworkInterface.id.in_(interface_ids))
                .order_by(NetworkInterface.id)
                .with_for_update()
            )
        )
        found_ids = {interface.id for interface in locked_interfaces}
        missing_ids = [value for value in interface_ids if value not in found_ids]
        if missing_ids:
            raise ValidationError(
                "NetworkInterface does not exist",
                {"interface_ids": [str(value) for value in missing_ids]},
            )

        repository = CanonicalRepository(self.session)
        owners = {
            owner.interface_id: owner
            for owner in repository.get_network_interface_physical_owners(
                list(interface_ids)
            )
        }
        ownerless_ids = [value for value in interface_ids if value not in owners]
        if ownerless_ids:
            raise ValidationError(
                "NetworkInterface has no physical owner",
                {"interface_ids": [str(value) for value in ownerless_ids]},
            )

        bindings = repository.get_physical_bindings_by_interface(list(interface_ids))
        already_bound_ids = [value for value in interface_ids if bindings[value]]
        if already_bound_ids:
            raise ValidationError(
                "NetworkInterface already has a direct physical binding",
                {"interface_ids": [str(value) for value in already_bound_ids]},
            )

        point_ids = tuple(
            sorted(
                {
                    endpoint.connection_point_id
                    for endpoint in (source, target)
                    if isinstance(endpoint, ConnectionPointEndpoint)
                },
                key=str,
            )
        )
        locked_points = tuple(
            self.session.scalars(
                select(ConnectionPoint)
                .where(ConnectionPoint.id.in_(point_ids))
                .order_by(ConnectionPoint.id)
                .with_for_update()
            )
        )
        points_by_id = {point.id: point for point in locked_points}
        missing_point_ids = [value for value in point_ids if value not in points_by_id]
        if missing_point_ids:
            raise ValidationError(
                "ConnectionPoint does not exist",
                {"connection_point_ids": [str(value) for value in missing_point_ids]},
            )
        unsupported_points = [
            point.id for point in locked_points if point.cardinality != 1
        ]
        if unsupported_points:
            raise ValidationError(
                "W.6 supports only cardinality=1 ConnectionPoints",
                {"connection_point_ids": [str(value) for value in unsupported_points]},
            )

        source_materialized = self._materialize_endpoint(
            source, repository, owners
        )

        cable = repository.add_physical_object()
        if cable_display_name is not None:
            self.session.add(
                EntityMetadata(
                    physical_object_id=cable.id,
                    key=DISPLAY_ALIAS_KEY,
                    value=cable_display_name,
                )
            )
            self.session.flush()
        cable_a = repository.add_connection_point(cable.id, cardinality=1)
        cable_b = repository.add_connection_point(cable.id, cardinality=1)

        target_materialized = self._materialize_endpoint(
            target, repository, owners
        )

        member = [
            ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
        ]
        source_connection, _ = repository.add_connection(
            source_materialized.connection_point_id,
            cable_a.id,
            cardinality=1,
            members=member,
        )
        internal_connection, _ = repository.add_connection(
            cable_a.id,
            cable_b.id,
            cardinality=1,
            members=member,
        )
        target_connection, _ = repository.add_connection(
            cable_b.id,
            target_materialized.connection_point_id,
            cardinality=1,
            members=member,
        )

        return CreatedEndpointPhysicalConnection(
            source=source_materialized,
            target=target_materialized,
            cable_id=cable.id,
            connection_ids=(
                source_connection.id,
                internal_connection.id,
                target_connection.id,
            ),
        )

    @staticmethod
    def _endpoint_description(endpoint: PhysicalEndpoint) -> dict[str, str | int]:
        if isinstance(endpoint, NetworkInterfaceEndpoint):
            return {
                "kind": "NETWORK_INTERFACE",
                "network_interface_id": str(endpoint.interface_id),
            }
        return {
            "kind": "CONNECTION_POINT",
            "connection_point_id": str(endpoint.connection_point_id),
            "member_index": endpoint.member_index,
        }

    @staticmethod
    def _materialize_endpoint(
        endpoint: PhysicalEndpoint,
        repository: CanonicalRepository,
        owners: dict[uuid.UUID, object],
    ) -> MaterializedPhysicalEndpoint:
        if isinstance(endpoint, ConnectionPointEndpoint):
            if endpoint.member_index != 1:
                raise ValidationError(
                    "W.6 supports only ConnectionPoint member 1",
                    {"member_index": endpoint.member_index},
                )
            return MaterializedPhysicalEndpoint(
                endpoint=endpoint,
                connection_point_id=endpoint.connection_point_id,
                binding_id=None,
            )

        owner = owners[endpoint.interface_id]
        point = repository.add_connection_point(
            owner.physical_object_id,
            cardinality=1,
        )
        binding = repository.add_interface_physical_binding(
            endpoint.interface_id,
            point.id,
            point_member=1,
        )
        return MaterializedPhysicalEndpoint(
            endpoint=endpoint,
            connection_point_id=point.id,
            binding_id=binding.id,
        )
