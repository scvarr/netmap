import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ValidationError
from app.models import ConnectionPoint, EntityMetadata, NetworkInterface, PhysicalObject
from app.repository import CanonicalRepository


DISPLAY_ALIAS_KEY = "alias.display"
PHYSICAL_OBJECT_CLASS_KEY = "class"


@dataclass(frozen=True)
class DisplayAliasRecord:
    metadata_id: uuid.UUID
    entity_id: uuid.UUID
    value: str


@dataclass(frozen=True)
class PhysicalObjectClassRecord:
    metadata_id: uuid.UUID
    physical_object_id: uuid.UUID
    value: str


@dataclass(frozen=True)
class CreatedNetworkDevice:
    physical_object_id: uuid.UUID
    network_interface_id: uuid.UUID
    owner_relation_id: uuid.UUID
    physical_object_alias_id: uuid.UUID
    network_interface_alias_id: uuid.UUID


@dataclass(frozen=True)
class CreatedDeviceInterface:
    network_interface_id: uuid.UUID
    owner_relation_id: uuid.UUID
    network_interface_alias_id: uuid.UUID


@dataclass(frozen=True)
class CreatedPhysicalObject:
    physical_object_id: uuid.UUID
    connection_point_id: uuid.UUID
    physical_object_alias_id: uuid.UUID
    connection_point_alias_id: uuid.UUID
    physical_object_class_id: uuid.UUID | None = None


@dataclass(frozen=True)
class CreatedConnectionPoint:
    connection_point_id: uuid.UUID
    connection_point_alias_id: uuid.UUID


class DeviceCatalog:
    """Bounded read/write boundary for materialized display aliases."""

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

    def create_device_interface(
        self,
        physical_object_id: uuid.UUID,
        display_name: str,
    ) -> CreatedDeviceInterface:
        repository = CanonicalRepository(self.session)
        if self.session.get(PhysicalObject, physical_object_id) is None:
            raise ValidationError(
                "PhysicalObject does not exist",
                {"physical_object_id": str(physical_object_id)},
            )
        network_interface = repository.add_network_interface()
        interface_alias = self._add_display_alias(
            network_interface_id=network_interface.id,
            value=display_name,
        )
        owner = repository.add_network_interface_physical_owner(
            network_interface.id,
            physical_object_id,
        )
        return CreatedDeviceInterface(
            network_interface_id=network_interface.id,
            owner_relation_id=owner.id,
            network_interface_alias_id=interface_alias.id,
        )

    def create_physical_object(
        self,
        display_name: str,
        connection_point_display_name: str,
        class_value: str | None = None,
    ) -> CreatedPhysicalObject:
        repository = CanonicalRepository(self.session)
        physical_object = repository.add_physical_object()
        physical_alias = self._add_display_alias(
            physical_object_id=physical_object.id,
            value=display_name,
        )
        connection_point = repository.add_connection_point(
            physical_object.id,
            cardinality=1,
        )
        point_alias = self._add_display_alias(
            connection_point_id=connection_point.id,
            value=connection_point_display_name,
        )
        object_class = (
            self._add_physical_object_class(physical_object.id, class_value)
            if class_value is not None
            else None
        )
        return CreatedPhysicalObject(
            physical_object_id=physical_object.id,
            connection_point_id=connection_point.id,
            physical_object_alias_id=physical_alias.id,
            connection_point_alias_id=point_alias.id,
            physical_object_class_id=(object_class.id if object_class is not None else None),
        )

    def create_connection_point(
        self,
        physical_object_id: uuid.UUID,
        display_name: str,
    ) -> CreatedConnectionPoint:
        if self.session.get(PhysicalObject, physical_object_id) is None:
            raise ValidationError(
                "PhysicalObject does not exist",
                {"physical_object_id": str(physical_object_id)},
            )
        point = CanonicalRepository(self.session).add_connection_point(
            physical_object_id,
            cardinality=1,
        )
        alias = self._add_display_alias(
            connection_point_id=point.id,
            value=display_name,
        )
        return CreatedConnectionPoint(
            connection_point_id=point.id,
            connection_point_alias_id=alias.id,
        )

    def physical_object_display_aliases(
        self, entity_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, DisplayAliasRecord]:
        return self._display_aliases(PhysicalObject, entity_ids)

    def network_interface_display_aliases(
        self, entity_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, DisplayAliasRecord]:
        return self._display_aliases(NetworkInterface, entity_ids)

    def connection_point_display_aliases(
        self, entity_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, DisplayAliasRecord]:
        return self._display_aliases(ConnectionPoint, entity_ids)

    def physical_object_classes(
        self, entity_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, PhysicalObjectClassRecord]:
        unique_ids = tuple(sorted(set(entity_ids), key=str))
        if not unique_ids:
            return {}
        rows = tuple(
            self.session.scalars(
                select(EntityMetadata)
                .where(
                    EntityMetadata.physical_object_id.in_(unique_ids),
                    EntityMetadata.key == PHYSICAL_OBJECT_CLASS_KEY,
                )
                .order_by(EntityMetadata.physical_object_id, EntityMetadata.id)
            )
        )
        return {
            row.physical_object_id: PhysicalObjectClassRecord(
                row.id, row.physical_object_id, row.value
            )
            for row in rows
            if row.physical_object_id is not None
        }

    def set_physical_object_class(
        self, physical_object_id: uuid.UUID, value: str
    ) -> PhysicalObjectClassRecord:
        if self.session.get(PhysicalObject, physical_object_id) is None:
            raise ValidationError(
                "PhysicalObject does not exist",
                {"physical_object_id": str(physical_object_id)},
            )
        existing = self.session.scalar(
            select(EntityMetadata).where(
                EntityMetadata.physical_object_id == physical_object_id,
                EntityMetadata.key == PHYSICAL_OBJECT_CLASS_KEY,
            )
        )
        metadata = existing or EntityMetadata(
            physical_object_id=physical_object_id,
            key=PHYSICAL_OBJECT_CLASS_KEY,
            value=value,
        )
        metadata.value = value
        if existing is None:
            self.session.add(metadata)
        self.session.flush()
        return PhysicalObjectClassRecord(metadata.id, physical_object_id, metadata.value)

    def set_physical_object_display_alias(
        self, physical_object_id: uuid.UUID, value: str
    ) -> DisplayAliasRecord:
        if self.session.get(PhysicalObject, physical_object_id) is None:
            raise ValidationError(
                "PhysicalObject does not exist",
                {"physical_object_id": str(physical_object_id)},
            )
        normalized = value.strip()
        if not normalized:
            raise ValidationError("Display name must not be blank")
        if len(normalized) > 255:
            raise ValidationError("Display name must not exceed 255 characters")
        existing = self.session.scalar(
            select(EntityMetadata).where(
                EntityMetadata.physical_object_id == physical_object_id,
                EntityMetadata.key == DISPLAY_ALIAS_KEY,
            )
        )
        metadata = existing or EntityMetadata(
            physical_object_id=physical_object_id,
            key=DISPLAY_ALIAS_KEY,
            value=normalized,
        )
        metadata.value = normalized
        if existing is None:
            self.session.add(metadata)
        self.session.flush()
        return DisplayAliasRecord(metadata.id, physical_object_id, metadata.value)

    def _add_display_alias(
        self,
        *,
        value: str,
        physical_object_id: uuid.UUID | None = None,
        network_interface_id: uuid.UUID | None = None,
        connection_point_id: uuid.UUID | None = None,
    ) -> EntityMetadata:
        alias = EntityMetadata(
            physical_object_id=physical_object_id,
            network_interface_id=network_interface_id,
            connection_point_id=connection_point_id,
            key=DISPLAY_ALIAS_KEY,
            value=value,
        )
        self.session.add(alias)
        self.session.flush()
        return alias

    def _add_physical_object_class(
        self, physical_object_id: uuid.UUID, value: str
    ) -> EntityMetadata:
        metadata = EntityMetadata(
            physical_object_id=physical_object_id,
            key=PHYSICAL_OBJECT_CLASS_KEY,
            value=value,
        )
        self.session.add(metadata)
        self.session.flush()
        return metadata

    def _display_aliases(
        self,
        entity_type: type[PhysicalObject] | type[NetworkInterface] | type[ConnectionPoint],
        entity_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, DisplayAliasRecord]:
        unique_ids = tuple(sorted(set(entity_ids), key=str))
        if not unique_ids:
            return {}
        target_column = {
            PhysicalObject: EntityMetadata.physical_object_id,
            NetworkInterface: EntityMetadata.network_interface_id,
            ConnectionPoint: EntityMetadata.connection_point_id,
        }[entity_type]
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
            if (
                entity_id := row.physical_object_id
                or row.network_interface_id
                or row.connection_point_id
            ) is not None
        }
