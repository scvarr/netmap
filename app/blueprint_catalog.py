import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select
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
    authoring_recipe: dict | None


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
        self._validate_recipe_snapshot(query)
        version = ObjectBlueprintVersion(
            blueprint_id=blueprint_id,
            version_number=version_number,
            default_physical_object_class=query.default_physical_object_class,
            body_kind=query.body.kind,
            width=query.body.width,
            height=query.body.height,
            fill_color=query.body.fill_color,
            authoring_recipe=(query.authoring_recipe.model_dump(mode="json") if query.authoring_recipe else None),
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
        return version

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
            authoring_recipe=version.authoring_recipe,
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
        self.session.execute(delete(ObjectBlueprintVersion).where(ObjectBlueprintVersion.id.in_(version_ids)))
        self.session.delete(blueprint)

    @staticmethod
    def _validate_recipe_snapshot(query: object) -> None:
        recipe = query.authoring_recipe
        if recipe is None:
            return
        expected_slots: dict[str, tuple[str, str, str, float]] = {}
        sides = ("LEFT", "RIGHT", "TOP", "BOTTOM")
        for side in sides:
            groups = [group for group in recipe.endpoint_groups if group.side == side]
            expanded = [(group, index) for group in groups for index in range(group.count)]
            for position, (group, index) in enumerate(expanded):
                width = max(2, len(str(group.starting_number + group.count - 1)))
                suffix = str(group.starting_number + index).zfill(width)
                expected_slots[f"{group.key_prefix}{suffix}"] = (
                    f"{group.display_prefix}{suffix}", group.kind, side,
                    .5 if len(expanded) == 1 else position / (len(expanded) - 1),
                )
        actual_slots = {slot.key: (slot.display_name, slot.kind, slot.anchor.side, slot.anchor.offset) for slot in query.slots}
        if set(expected_slots) != set(actual_slots) or any(
            actual[:3] != expected[:3] or abs(actual[3] - expected[3]) > 1e-9
            for key, expected in expected_slots.items() for actual in [actual_slots[key]]
        ):
            raise ValidationError("Authoring recipe does not match explicit blueprint slots")
        groups_by_id = {group.group_id: group for group in recipe.endpoint_groups}
        expected_links: set[tuple[str, str]] = set()
        for pair in recipe.pair_recipes:
            left, right = groups_by_id[pair.group_a_id], groups_by_id[pair.group_b_id]
            if left.count != right.count:
                raise ValidationError("Authoring pair groups must have equal counts")
            left_width = max(2, len(str(left.starting_number + left.count - 1)))
            right_width = max(2, len(str(right.starting_number + right.count - 1)))
            for index in range(left.count):
                expected_links.add(tuple(sorted((
                    f"{left.key_prefix}{str(left.starting_number + index).zfill(left_width)}",
                    f"{right.key_prefix}{str(right.starting_number + index).zfill(right_width)}",
                ))))
        actual_links = {tuple(sorted((link.from_slot_key, link.to_slot_key))) for link in query.internal_links}
        if actual_links != expected_links:
            raise ValidationError("Authoring recipe does not match explicit blueprint internal links")

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
