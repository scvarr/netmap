import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.device_catalog import DISPLAY_ALIAS_KEY, PHYSICAL_OBJECT_CLASS_KEY
from app.errors import ValidationError
from app.models import (
    BlueprintEndpointSlot,
    BlueprintInstance,
    BlueprintInstanceSlot,
    BlueprintInternalLink,
    EntityMetadata,
    ObjectBlueprint,
    ObjectBlueprintVersion,
)
from app.repository import CanonicalRepository, ConnectionMemberInput


@dataclass(frozen=True)
class CreatedBlueprint:
    blueprint_id: uuid.UUID
    version_id: uuid.UUID


@dataclass(frozen=True)
class MaterializedSlot:
    slot_key: str
    connection_point_id: uuid.UUID
    network_interface_id: uuid.UUID | None


@dataclass(frozen=True)
class MaterializedBlueprintInstance:
    blueprint_id: uuid.UUID
    version_id: uuid.UUID
    physical_object_id: uuid.UUID
    slots: tuple[MaterializedSlot, ...]


class ObjectBlueprintCatalog:
    """Authoring records that materialize, but never alter, L1 semantics."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_initial_version(self, query: object) -> CreatedBlueprint:
        blueprint = ObjectBlueprint(name=query.name)
        self.session.add(blueprint)
        self.session.flush()
        version = ObjectBlueprintVersion(
            blueprint_id=blueprint.id,
            version_number=1,
            default_physical_object_class=query.default_physical_object_class,
            body_kind=query.body.kind,
            width=query.body.width,
            height=query.body.height,
            fill_color=query.body.fill_color,
        )
        self.session.add(version)
        self.session.flush()
        slots_by_key: dict[str, BlueprintEndpointSlot] = {}
        for slot_query in query.slots:
            slot = BlueprintEndpointSlot(
                blueprint_version_id=version.id,
                slot_key=slot_query.key,
                display_name=slot_query.display_name,
                kind=slot_query.kind,
                anchor_side=slot_query.anchor.side,
                anchor_offset=slot_query.anchor.offset,
            )
            self.session.add(slot)
            self.session.flush()
            slots_by_key[slot.slot_key] = slot
        for link_query in query.internal_links:
            slot_a, slot_b = sorted(
                (slots_by_key[link_query.from_slot_key], slots_by_key[link_query.to_slot_key]),
                key=lambda slot: slot.slot_key,
            )
            self.session.add(BlueprintInternalLink(
                blueprint_version_id=version.id,
                slot_a_id=slot_a.id,
                slot_b_id=slot_b.id,
            ))
        self.session.flush()
        return CreatedBlueprint(blueprint.id, version.id)

    def instantiate(
        self, blueprint_id: uuid.UUID, version_id: uuid.UUID, display_name: str,
    ) -> MaterializedBlueprintInstance:
        version = self.session.get(ObjectBlueprintVersion, version_id)
        if version is None or version.blueprint_id != blueprint_id:
            raise ValidationError("ObjectBlueprintVersion does not belong to ObjectBlueprint")
        slots = tuple(self.session.scalars(
            select(BlueprintEndpointSlot)
            .where(BlueprintEndpointSlot.blueprint_version_id == version_id)
            .order_by(BlueprintEndpointSlot.slot_key)
        ))
        links = tuple(self.session.scalars(
            select(BlueprintInternalLink)
            .where(BlueprintInternalLink.blueprint_version_id == version_id)
            .order_by(BlueprintInternalLink.id)
        ))
        repository = CanonicalRepository(self.session)
        physical_object = repository.add_physical_object()
        self._metadata(physical_object_id=physical_object.id, key=DISPLAY_ALIAS_KEY, value=display_name)
        if version.default_physical_object_class is not None:
            self._metadata(
                physical_object_id=physical_object.id,
                key=PHYSICAL_OBJECT_CLASS_KEY,
                value=version.default_physical_object_class,
            )
        instance = BlueprintInstance(blueprint_version_id=version.id, physical_object_id=physical_object.id)
        self.session.add(instance)
        self.session.flush()
        materialized: dict[uuid.UUID, MaterializedSlot] = {}
        for slot in slots:
            point = repository.add_connection_point(physical_object.id, cardinality=1)
            self._metadata(connection_point_id=point.id, key=DISPLAY_ALIAS_KEY, value=slot.display_name)
            interface_id: uuid.UUID | None = None
            if slot.kind == "NETWORK_PORT":
                interface = repository.add_network_interface()
                repository.add_network_interface_physical_owner(interface.id, physical_object.id)
                self._metadata(network_interface_id=interface.id, key=DISPLAY_ALIAS_KEY, value=slot.display_name)
                repository.add_interface_physical_binding(interface.id, point.id, point_member=1)
                interface_id = interface.id
            self.session.add(BlueprintInstanceSlot(
                blueprint_instance_id=instance.id,
                blueprint_slot_id=slot.id,
                connection_point_id=point.id,
                network_interface_id=interface_id,
            ))
            materialized[slot.id] = MaterializedSlot(slot.slot_key, point.id, interface_id)
        for link in links:
            repository.add_connection(
                materialized[link.slot_a_id].connection_point_id,
                materialized[link.slot_b_id].connection_point_id,
                cardinality=1,
                members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
            )
        self.session.flush()
        return MaterializedBlueprintInstance(
            blueprint_id=blueprint_id,
            version_id=version_id,
            physical_object_id=physical_object.id,
            slots=tuple(materialized[slot.id] for slot in slots),
        )

    def _metadata(
        self,
        *,
        key: str,
        value: str,
        physical_object_id: uuid.UUID | None = None,
        network_interface_id: uuid.UUID | None = None,
        connection_point_id: uuid.UUID | None = None,
    ) -> None:
        self.session.add(EntityMetadata(
            physical_object_id=physical_object_id,
            network_interface_id=network_interface_id,
            connection_point_id=connection_point_id,
            key=key,
            value=value,
        ))
        self.session.flush()
