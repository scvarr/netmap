import uuid
import hashlib
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.device_catalog import DISPLAY_ALIAS_KEY, PHYSICAL_OBJECT_CLASS_KEY
from app.errors import ModelError, ValidationError
from app.models import (
    BlueprintEndpointSlot,
    BlueprintInstance,
    BlueprintInstanceSlot,
    BlueprintInternalLink,
    BlueprintPortBlockInstance,
    ConnectionPoint,
    EntityMetadata,
    ObjectBlueprint,
    ObjectBlueprintVersion,
    PortBlockPort,
    PortBlockVersion,
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
    internal_connection_ids: tuple[uuid.UUID, ...]


@dataclass(frozen=True)
class BlueprintListItem:
    blueprint_id: uuid.UUID
    name: str
    version_id: uuid.UUID
    version_number: int
    default_physical_object_class: str | None
    body_kind: str
    width: float
    height: float
    fill_color: str | None
    slot_count: int
    internal_link_count: int
    version_count: int


@dataclass(frozen=True)
class BlueprintVersionDetail:
    blueprint_id: uuid.UUID
    name: str
    version_id: uuid.UUID
    version_number: int
    default_physical_object_class: str | None
    body_kind: str
    width: float
    height: float
    fill_color: str | None
    slots: tuple[BlueprintEndpointSlot, ...]
    internal_links: tuple[tuple[str, str], ...]
    composition: tuple[BlueprintPortBlockInstance, ...] | None


class ObjectBlueprintCatalog:
    """Authoring records that materialize, but never alter, L1 semantics."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_initial_version(self, query: object) -> CreatedBlueprint:
        blueprint = ObjectBlueprint(name=query.name)
        self.session.add(blueprint)
        self.session.flush()
        version = self._create_version(blueprint.id, 1, query)
        return CreatedBlueprint(blueprint.id, version.id)

    def create_next_version(self, blueprint_id: uuid.UUID, query: object) -> CreatedBlueprint:
        blueprint = self.session.scalar(
            select(ObjectBlueprint).where(ObjectBlueprint.id == blueprint_id).with_for_update()
        )
        if blueprint is None:
            raise ValidationError("ObjectBlueprint was not found", {"blueprint_id": str(blueprint_id)})
        if query.blueprint_name is not None:
            blueprint.name = query.blueprint_name
        current = self.session.scalar(
            select(func.max(ObjectBlueprintVersion.version_number)).where(
                ObjectBlueprintVersion.blueprint_id == blueprint_id
            )
        )
        version = self._create_version(blueprint_id, (current or 0) + 1, query)
        return CreatedBlueprint(blueprint_id, version.id)

    def _create_version(self, blueprint_id: uuid.UUID, version_number: int, query: object) -> ObjectBlueprintVersion:
        version = ObjectBlueprintVersion(
            blueprint_id=blueprint_id,
            version_number=version_number,
            default_physical_object_class=query.default_physical_object_class,
            body_kind=query.body.kind,
            width=query.body.width,
            height=query.body.height,
            fill_color=query.body.fill_color,
            authoring_recipe=None,
        )
        self.session.add(version)
        self.session.flush()
        slots_by_key: dict[str, BlueprintEndpointSlot] = {}
        instances: list[BlueprintPortBlockInstance] = []
        for item in query.composition.instances:
            port_block_version_id = item.port_block_version_ref.entity_id
            exact_version = self.session.get(PortBlockVersion, port_block_version_id)
            if exact_version is None:
                raise ValidationError("PortBlockVersion was not found", {"port_block_version_id": str(port_block_version_id)})
            instance = BlueprintPortBlockInstance(
                blueprint_version_id=version.id,
                port_block_version_id=exact_version.id,
                instance_key=item.instance_key,
            )
            self.session.add(instance)
            instances.append(instance)
        self.session.flush()
        # Presentation-only fallback: deterministic right-edge distribution by request instance order
        # and immutable PortBlock layout_order. It never participates in slot identity.
        expanded: list[tuple[BlueprintPortBlockInstance, PortBlockPort]] = []
        for instance in instances:
            expanded.extend((instance, port) for port in self.session.scalars(
                select(PortBlockPort).where(PortBlockPort.port_block_version_id == instance.port_block_version_id).order_by(PortBlockPort.layout_order)
            ))
        for index, (instance, port) in enumerate(expanded):
            slot_key = self.composed_slot_key(instance.instance_key, port.local_id)
            if slot_key in slots_by_key:
                raise ValidationError("Composed Blueprint slot identity collision")
            slot = BlueprintEndpointSlot(
                blueprint_version_id=version.id,
                slot_key=slot_key,
                display_name=port.display_label,
                kind=port.kind,
                anchor_side="RIGHT",
                anchor_offset=(index + .5) / len(expanded) if expanded else .5,
                port_block_instance_id=instance.id,
                port_block_local_id=port.local_id,
            )
            self.session.add(slot)
            slots_by_key[slot.slot_key] = slot
        self.session.flush()
        link_pairs: set[tuple[str, str]] = set()
        for link_query in query.internal_links:
            if link_query.from_slot_key not in slots_by_key or link_query.to_slot_key not in slots_by_key:
                raise ValidationError("Blueprint internal link refers to an unknown slot key")
            if link_query.from_slot_key == link_query.to_slot_key:
                raise ValidationError("Blueprint internal link cannot refer to the same slot")
            pair = tuple(sorted((link_query.from_slot_key, link_query.to_slot_key)))
            if pair in link_pairs:
                raise ValidationError("Blueprint internal links must be unique as unordered pairs")
            link_pairs.add(pair)
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
        return version

    @staticmethod
    def composed_slot_key(instance_key: str, local_id: str) -> str:
        """Bounded identity key: SHA-256 of length-prefixed UTF-8 pair bytes.

        Labels, exact version, layout and fallback anchors deliberately do not participate.
        The caller detects the cryptographically-unlikely digest collision before persistence.
        """
        instance = instance_key.encode("utf-8")
        local = local_id.encode("utf-8")
        canonical = len(instance).to_bytes(4, "big") + instance + len(local).to_bytes(4, "big") + local
        return "pb_" + hashlib.sha256(canonical).hexdigest()

    def list_blueprints(self) -> tuple[BlueprintListItem, ...]:
        blueprints = tuple(self.session.scalars(select(ObjectBlueprint).order_by(ObjectBlueprint.name, ObjectBlueprint.id)))
        return tuple(
            BlueprintListItem(
                blueprint_id=blueprint.id,
                name=blueprint.name,
                version_id=version.id,
                version_number=version.version_number,
                default_physical_object_class=version.default_physical_object_class,
                body_kind=version.body_kind,
                width=version.width,
                height=version.height,
                fill_color=version.fill_color,
                slot_count=len(tuple(self.session.scalars(
                    select(BlueprintEndpointSlot.id).where(
                        BlueprintEndpointSlot.blueprint_version_id == version.id
                    )
                ))),
                internal_link_count=len(tuple(self.session.scalars(
                    select(BlueprintInternalLink.id).where(
                        BlueprintInternalLink.blueprint_version_id == version.id
                    )
                ))),
                version_count=self.session.scalar(select(func.count()).select_from(ObjectBlueprintVersion).where(
                    ObjectBlueprintVersion.blueprint_id == blueprint.id
                )) or 0,
            )
            for blueprint in blueprints
            for version in [self.session.scalar(
                select(ObjectBlueprintVersion).where(ObjectBlueprintVersion.blueprint_id == blueprint.id)
                .order_by(ObjectBlueprintVersion.version_number.desc()).limit(1)
            )]
            if version is not None
        )

    def get_version_detail(
        self, blueprint_id: uuid.UUID, version_id: uuid.UUID,
    ) -> BlueprintVersionDetail:
        version = self.session.get(ObjectBlueprintVersion, version_id)
        blueprint = self.session.get(ObjectBlueprint, blueprint_id)
        if blueprint is None:
            raise ValidationError("ObjectBlueprint was not found", {"blueprint_id": str(blueprint_id)})
        if version is None or version.blueprint_id != blueprint_id:
            raise ValidationError(
                "ObjectBlueprintVersion does not belong to ObjectBlueprint",
                {"blueprint_id": str(blueprint_id), "version_id": str(version_id)},
            )
        slots = tuple(self.session.scalars(
            select(BlueprintEndpointSlot)
            .where(BlueprintEndpointSlot.blueprint_version_id == version.id)
            .order_by(BlueprintEndpointSlot.slot_key)
        ))
        keys_by_id = {slot.id: slot.slot_key for slot in slots}
        links = tuple(
            (keys_by_id[link.slot_a_id], keys_by_id[link.slot_b_id])
            for link in self.session.scalars(
                select(BlueprintInternalLink)
                .where(BlueprintInternalLink.blueprint_version_id == version.id)
                .order_by(BlueprintInternalLink.id)
            )
        )
        composition = tuple(self.session.scalars(select(BlueprintPortBlockInstance).where(
            BlueprintPortBlockInstance.blueprint_version_id == version.id
        ).order_by(BlueprintPortBlockInstance.instance_key)))
        return BlueprintVersionDetail(
            blueprint_id=blueprint.id,
            name=blueprint.name,
            version_id=version.id,
            version_number=version.version_number,
            default_physical_object_class=version.default_physical_object_class,
            body_kind=version.body_kind,
            width=version.width,
            height=version.height,
            fill_color=version.fill_color,
            slots=slots,
            internal_links=links,
            composition=composition or None,
        )

    def delete_blueprint(self, blueprint_id: uuid.UUID) -> None:
        blueprint = self.session.scalar(
            select(ObjectBlueprint).where(ObjectBlueprint.id == blueprint_id).with_for_update()
        )
        if blueprint is None:
            raise ValidationError("ObjectBlueprint was not found", {"blueprint_id": str(blueprint_id)})
        version_ids = tuple(self.session.scalars(select(ObjectBlueprintVersion.id).where(
            ObjectBlueprintVersion.blueprint_id == blueprint_id
        )))
        instance_id = self.session.scalar(select(BlueprintInstance.id).where(
            BlueprintInstance.blueprint_version_id.in_(version_ids)
        ).limit(1)) if version_ids else None
        if instance_id is not None:
            from app.errors import ModelError
            raise ModelError("ObjectBlueprint cannot be deleted because it has materialized instances", {"blueprint_id": str(blueprint_id)})
        slot_ids = tuple(self.session.scalars(select(BlueprintEndpointSlot.id).where(
            BlueprintEndpointSlot.blueprint_version_id.in_(version_ids)
        ))) if version_ids else ()
        if slot_ids:
            self.session.execute(delete(BlueprintInternalLink).where(
                BlueprintInternalLink.blueprint_version_id.in_(version_ids)
            ))
            self.session.execute(delete(BlueprintEndpointSlot).where(BlueprintEndpointSlot.id.in_(slot_ids)))
        self.session.execute(delete(BlueprintPortBlockInstance).where(
            BlueprintPortBlockInstance.blueprint_version_id.in_(version_ids)
        ))
        self.session.execute(delete(ObjectBlueprintVersion).where(ObjectBlueprintVersion.id.in_(version_ids)))
        self.session.delete(blueprint)


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
        internal_connection_ids: list[uuid.UUID] = []
        for link in links:
            connection, _ = repository.add_connection(
                materialized[link.slot_a_id].connection_point_id,
                materialized[link.slot_b_id].connection_point_id,
                cardinality=1,
                members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
            )
            internal_connection_ids.append(connection.id)
        self.session.flush()
        return MaterializedBlueprintInstance(
            blueprint_id=blueprint_id,
            version_id=version_id,
            physical_object_id=physical_object.id,
            slots=tuple(materialized[slot.id] for slot in slots),
            internal_connection_ids=tuple(internal_connection_ids),
        )

    def apply_upgrade(
        self, physical_object_id: uuid.UUID, target_version_id: uuid.UUID,
    ) -> MaterializedBlueprintInstance:
        """Atomically materialize only a reviewed, additive Blueprint upgrade."""
        from app.blueprint_upgrade_analysis import BlueprintUpgradeAnalyzer

        instance = self.session.scalar(select(BlueprintInstance).where(
            BlueprintInstance.physical_object_id == physical_object_id
        ).with_for_update())
        if instance is None:
            raise ModelError("Blueprint upgrade requires a Blueprint instance", {"reason": "NOT_APPLICABLE"})
        current = self.session.get(ObjectBlueprintVersion, instance.blueprint_version_id)
        target = self.session.get(ObjectBlueprintVersion, target_version_id)
        latest = self.session.scalar(select(ObjectBlueprintVersion).where(
            ObjectBlueprintVersion.blueprint_id == (current.blueprint_id if current else None)
        ).order_by(ObjectBlueprintVersion.version_number.desc()).limit(1))
        if current is None or target is None or target.blueprint_id != current.blueprint_id or latest is None or latest.id != target.id:
            raise ModelError("Blueprint upgrade review is stale", {"reason": "STALE_OR_WRONG_TARGET"})
        analysis = BlueprintUpgradeAnalyzer(self.session).analyze(physical_object_id)
        if analysis.status != "OUTDATED" or analysis.target_version_id != target_version_id or analysis.blockers:
            raise ModelError("Blueprint upgrade review is stale or blocked", {
                "reason": "UPGRADE_CONFLICT", "status": analysis.status,
                "blockers": list(analysis.blockers),
            })

        current_slots = {slot.slot_key: slot for slot in self.session.scalars(select(BlueprintEndpointSlot).where(
            BlueprintEndpointSlot.blueprint_version_id == current.id
        ))}
        target_slots = {slot.slot_key: slot for slot in self.session.scalars(select(BlueprintEndpointSlot).where(
            BlueprintEndpointSlot.blueprint_version_id == target.id
        ))}
        mappings = {row.blueprint_slot_id: row for row in self.session.scalars(select(BlueprintInstanceSlot).where(
            BlueprintInstanceSlot.blueprint_instance_id == instance.id
        ).with_for_update())}
        materialized: dict[str, MaterializedSlot] = {}
        for key, old_slot in current_slots.items():
            row = mappings[old_slot.id]
            row.blueprint_slot_id = target_slots[key].id
            materialized[key] = MaterializedSlot(key, row.connection_point_id, row.network_interface_id)

        repository = CanonicalRepository(self.session)
        for key in sorted(set(target_slots) - set(current_slots)):
            slot = target_slots[key]
            point = repository.add_connection_point(physical_object_id, cardinality=1)
            self._metadata(connection_point_id=point.id, key=DISPLAY_ALIAS_KEY, value=slot.display_name)
            interface_id: uuid.UUID | None = None
            if slot.kind == "NETWORK_PORT":
                interface = repository.add_network_interface()
                repository.add_network_interface_physical_owner(interface.id, physical_object_id)
                self._metadata(network_interface_id=interface.id, key=DISPLAY_ALIAS_KEY, value=slot.display_name)
                repository.add_interface_physical_binding(interface.id, point.id, point_member=1)
                interface_id = interface.id
            self.session.add(BlueprintInstanceSlot(
                blueprint_instance_id=instance.id, blueprint_slot_id=slot.id,
                connection_point_id=point.id, network_interface_id=interface_id,
            ))
            materialized[key] = MaterializedSlot(key, point.id, interface_id)
        self.session.flush()

        target_by_id = {slot.id: key for key, slot in target_slots.items()}
        current_by_id = {slot.id: key for key, slot in current_slots.items()}
        current_links = {
            tuple(sorted((current_by_id[link.slot_a_id], current_by_id[link.slot_b_id])))
            for link in self.session.scalars(select(BlueprintInternalLink).where(
                BlueprintInternalLink.blueprint_version_id == current.id
            ))
        }
        target_links = {
            tuple(sorted((target_by_id[link.slot_a_id], target_by_id[link.slot_b_id])))
            for link in self.session.scalars(select(BlueprintInternalLink).where(
                BlueprintInternalLink.blueprint_version_id == target.id
            ))
        }
        new_links = tuple(sorted(target_links - current_links))
        participating_point_ids = tuple(sorted({
            point_id
            for left_key, right_key in new_links
            for point_id in (
                materialized[left_key].connection_point_id,
                materialized[right_key].connection_point_id,
            )
        }, key=str))
        if participating_point_ids:
            locked_point_ids = set(self.session.scalars(
                select(ConnectionPoint.id)
                .where(ConnectionPoint.id.in_(participating_point_ids))
                .order_by(ConnectionPoint.id)
                .with_for_update()
            ))
            if locked_point_ids != set(participating_point_ids):
                raise ModelError("Blueprint upgrade connection point is missing")

        created_connections: list[uuid.UUID] = []
        for left_key, right_key in new_links:
            left, right = materialized[left_key], materialized[right_key]
            state = BlueprintUpgradeAnalyzer(self.session)._canonical_link_state(left.connection_point_id, right.connection_point_id)
            if state == "MISSING":
                connection, _ = repository.add_connection(left.connection_point_id, right.connection_point_id, 1, [
                    ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1),
                ])
                created_connections.append(connection.id)
            elif state != "SATISFIED":
                raise ModelError("Canonical internal link is conflicting", {"reason": "INTERNAL_LINK_RUNTIME_CONFLICT"})
        instance.blueprint_version_id = target.id
        self.session.flush()
        return MaterializedBlueprintInstance(
            blueprint_id=current.blueprint_id, version_id=target.id, physical_object_id=physical_object_id,
            slots=tuple(materialized[key] for key in sorted(materialized)), internal_connection_ids=tuple(created_connections),
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
