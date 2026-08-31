import uuid
from dataclasses import dataclass

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, aliased

from app.errors import ValidationError
from app.cable_labels import CableLabelCatalog
from app.models import Cable, Connection, ConnectionMember, ConnectionPoint, NetworkInterface
from app.repository import CanonicalRepository, ConnectionMemberInput


@dataclass(frozen=True)
class CreatedPhysicalConnection:
    source_interface_id: uuid.UUID
    target_interface_id: uuid.UUID
    cable_id: uuid.UUID
    source_binding_id: uuid.UUID
    target_binding_id: uuid.UUID
    connection_id: uuid.UUID


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
    connection_id: uuid.UUID


class PhysicalConnectionCatalog:
    """Bounded user-intent composition over existing canonical L1 primitives."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_atomic_link(
        self,
        source_interface_id: uuid.UUID,
        target_interface_id: uuid.UUID,
        *,
        cable_label: str | None = None,
        cable_label_template_id: uuid.UUID | None = None,
        generate_cable_label: bool = False,
    ) -> CreatedPhysicalConnection:
        if source_interface_id == target_interface_id:
            raise ValidationError(
                "A physical link requires two different NetworkInterfaces",
                {"interface_id": str(source_interface_id)},
            )
        created = self.create_endpoint_link(
            NetworkInterfaceEndpoint(source_interface_id),
            NetworkInterfaceEndpoint(target_interface_id),
            cable_label=cable_label,
            cable_label_template_id=cable_label_template_id,
            generate_cable_label=generate_cable_label,
        )
        assert created.source.binding_id is not None
        assert created.target.binding_id is not None
        return CreatedPhysicalConnection(
            source_interface_id=source_interface_id,
            target_interface_id=target_interface_id,
            cable_id=created.cable_id,
            source_binding_id=created.source.binding_id,
            target_binding_id=created.target.binding_id,
            connection_id=created.connection_id,
        )

    def create_endpoint_link(
        self,
        source: PhysicalEndpoint,
        target: PhysicalEndpoint,
        *,
        cable_label: str | None = None,
        cable_label_template_id: uuid.UUID | None = None,
        generate_cable_label: bool = False,
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
        requested_members = {
            endpoint.connection_point_id: endpoint.member_index
            for endpoint in (source, target)
            if isinstance(endpoint, ConnectionPointEndpoint)
        }
        occupied_points = [
            point.id for point in locked_points
            if self._has_external_member_connection(
                point, requested_members[point.id]
            )
        ]
        if occupied_points:
            raise ValidationError(
                "ConnectionPoint member is already occupied",
                {"reason": "CONNECTION_POINT_MEMBER_OCCUPIED", "connection_point_ids": [str(value) for value in occupied_points]},
            )

        source_materialized = self._materialize_endpoint(
            source, repository, owners
        )
        target_materialized = self._materialize_endpoint(
            target, repository, owners
        )

        endpoint_points = tuple(
            self.session.scalars(
                select(ConnectionPoint)
                .where(
                    ConnectionPoint.id.in_(
                        (
                            source_materialized.connection_point_id,
                            target_materialized.connection_point_id,
                        )
                    )
                )
                .order_by(ConnectionPoint.id)
            )
        )
        if len(endpoint_points) != 2 or endpoint_points[0].physical_object_id == endpoint_points[1].physical_object_id:
            raise ValidationError("A cable requires endpoints on two different PhysicalObjects")

        member = [
            ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
        ]
        connection, _ = repository.add_connection(
            source_materialized.connection_point_id,
            target_materialized.connection_point_id,
            cardinality=1,
            members=member,
        )
        cable = Cable(connection_id=connection.id)
        self.session.add(cable)
        self.session.flush()
        CableLabelCatalog(self.session).assign_new_cable(
            cable,
            label=cable_label,
            template_id=cable_label_template_id,
            generate=generate_cable_label,
        )

        return CreatedEndpointPhysicalConnection(
            source=source_materialized,
            target=target_materialized,
            cable_id=cable.id,
            connection_id=connection.id,
        )

    def delete_external_connection(self, connection_id: uuid.UUID) -> None:
        """Atomically delete a direct Connection or its attached Cable."""
        connection = self.session.scalar(
            select(Connection).where(Connection.id == connection_id).with_for_update()
        )
        if connection is None:
            raise ValidationError(
                "Connection does not exist", {"connection_id": str(connection_id)}
            )
        points = tuple(
            self.session.scalars(
                select(ConnectionPoint)
                .where(ConnectionPoint.id.in_((connection.point_a_id, connection.point_b_id)))
                .order_by(ConnectionPoint.id)
                .with_for_update()
            )
        )
        if len(points) != 2:
            raise ValidationError(
                "Connection refers to a missing ConnectionPoint",
                {"connection_id": str(connection_id)},
            )
        if points[0].physical_object_id == points[1].physical_object_id:
            raise ValidationError(
                "Only an external physical Connection can be disconnected",
                {"connection_id": str(connection_id)},
            )
        self.session.delete(connection)
        self.session.flush()

    def delete_cable(self, cable_id: uuid.UUID) -> None:
        cable = self.session.scalar(
            select(Cable).where(Cable.id == cable_id).with_for_update()
        )
        if cable is None:
            raise ValidationError("Cable does not exist", {"cable_id": str(cable_id)})
        connection = self.session.scalar(
            select(Connection)
            .where(Connection.id == cable.connection_id)
            .with_for_update()
        )
        if connection is None:
            raise ValidationError(
                "Cable refers to a missing Connection", {"cable_id": str(cable_id)}
            )
        self.session.delete(connection)
        self.session.flush()

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

    def _has_external_member_connection(
        self,
        point: ConnectionPoint,
        member_index: int,
    ) -> bool:
        """Return whether this exact member is attached outside its owner.

        A Connection remains an incident topology fact even when both endpoints
        belong to one PhysicalObject.  Only a member mapping which crosses that
        canonical ownership boundary consumes external endpoint capacity.
        """
        opposite_point = aliased(ConnectionPoint)
        connection_uses_member = or_(
            and_(
                Connection.point_a_id == point.id,
                ConnectionMember.point_a_member == member_index,
            ),
            and_(
                Connection.point_b_id == point.id,
                ConnectionMember.point_b_member == member_index,
            ),
        )
        opposite_endpoint = or_(
            and_(
                Connection.point_a_id == point.id,
                Connection.point_b_id == opposite_point.id,
            ),
            and_(
                Connection.point_b_id == point.id,
                Connection.point_a_id == opposite_point.id,
            ),
        )
        return self.session.scalar(
            select(Connection.id)
            .join(ConnectionMember)
            .join(opposite_point, opposite_endpoint)
            .where(
                connection_uses_member,
                opposite_point.physical_object_id != point.physical_object_id,
            )
            .limit(1)
        ) is not None

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
