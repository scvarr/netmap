import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EntityMetadata, NetworkInterface, PhysicalObject
from app.repository import CanonicalRepository


DISPLAY_ALIAS_KEY = "alias.display"


@dataclass(frozen=True)
class DisplayAliasRecord:
    metadata_id: uuid.UUID
    entity_id: uuid.UUID
    value: str


@dataclass(frozen=True)
class CreatedNetworkDevice:
    physical_object_id: uuid.UUID
    network_interface_id: uuid.UUID
    owner_relation_id: uuid.UUID
    physical_object_alias_id: uuid.UUID
    network_interface_alias_id: uuid.UUID


class DeviceCatalog:
    """Bounded read/write boundary for device and interface display aliases."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_network_device(
        self,
        display_name: str,
        interface_display_name: str,
    ) -> CreatedNetworkDevice:
        repository = CanonicalRepository(self.session)
        physical_object = repository.add_physical_object()
        physical_alias = self._add_display_alias(
            physical_object_id=physical_object.id,
            value=display_name,
        )
        network_interface = repository.add_network_interface()
        interface_alias = self._add_display_alias(
            network_interface_id=network_interface.id,
            value=interface_display_name,
        )
        owner = repository.add_network_interface_physical_owner(
            network_interface.id,
            physical_object.id,
        )
        return CreatedNetworkDevice(
            physical_object_id=physical_object.id,
            network_interface_id=network_interface.id,
            owner_relation_id=owner.id,
            physical_object_alias_id=physical_alias.id,
            network_interface_alias_id=interface_alias.id,
        )

    def physical_object_display_aliases(
        self, entity_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, DisplayAliasRecord]:
        return self._display_aliases(PhysicalObject, entity_ids)

    def network_interface_display_aliases(
        self, entity_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, DisplayAliasRecord]:
        return self._display_aliases(NetworkInterface, entity_ids)

    def _add_display_alias(
        self,
        *,
        value: str,
        physical_object_id: uuid.UUID | None = None,
        network_interface_id: uuid.UUID | None = None,
    ) -> EntityMetadata:
        alias = EntityMetadata(
            physical_object_id=physical_object_id,
            network_interface_id=network_interface_id,
            key=DISPLAY_ALIAS_KEY,
            value=value,
        )
        self.session.add(alias)
        self.session.flush()
        return alias

    def _display_aliases(
        self,
        entity_type: type[PhysicalObject] | type[NetworkInterface],
        entity_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, DisplayAliasRecord]:
        unique_ids = tuple(sorted(set(entity_ids), key=str))
        if not unique_ids:
            return {}
        target_column = (
            EntityMetadata.physical_object_id
            if entity_type is PhysicalObject
            else EntityMetadata.network_interface_id
        )
        rows = tuple(
            self.session.scalars(
                select(EntityMetadata)
                .where(
                    target_column.in_(unique_ids),
                    EntityMetadata.key == DISPLAY_ALIAS_KEY,
                )
                .order_by(target_column, EntityMetadata.id)
            )
        )
        return {
            entity_id: DisplayAliasRecord(row.id, entity_id, row.value)
            for row in rows
            if (entity_id := row.physical_object_id or row.network_interface_id) is not None
        }
