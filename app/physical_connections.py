import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.device_catalog import DISPLAY_ALIAS_KEY
from app.errors import ValidationError
from app.models import EntityMetadata, NetworkInterface
from app.repository import CanonicalRepository, ConnectionMemberInput


@dataclass(frozen=True)
class CreatedPhysicalConnection:
    source_interface_id: uuid.UUID
    target_interface_id: uuid.UUID
    cable_id: uuid.UUID
    source_binding_id: uuid.UUID
    target_binding_id: uuid.UUID
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

        interface_ids = tuple(
            sorted((source_interface_id, target_interface_id), key=str)
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

        source_point = repository.add_connection_point(
            owners[source_interface_id].physical_object_id,
            cardinality=1,
        )
        source_binding = repository.add_interface_physical_binding(
            source_interface_id,
            source_point.id,
            point_member=1,
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

        target_point = repository.add_connection_point(
            owners[target_interface_id].physical_object_id,
            cardinality=1,
        )
        target_binding = repository.add_interface_physical_binding(
            target_interface_id,
            target_point.id,
            point_member=1,
        )

        member = [
            ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
        ]
        source_connection, _ = repository.add_connection(
            source_point.id,
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
            target_point.id,
            cardinality=1,
            members=member,
        )

        return CreatedPhysicalConnection(
            source_interface_id=source_interface_id,
            target_interface_id=target_interface_id,
            cable_id=cable.id,
            source_binding_id=source_binding.id,
            target_binding_id=target_binding.id,
            connection_ids=(
                source_connection.id,
                internal_connection.id,
                target_connection.id,
            ),
        )
