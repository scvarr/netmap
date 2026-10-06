import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.device_catalog import DISPLAY_ALIAS_KEY, PHYSICAL_OBJECT_CLASS_KEY
from app.errors import ModelError, ValidationError
from app.models import (
    BuiltInEndpointDefinition,
    ObjectConfiguration,
    BuiltInEndpointMapping,
    BaseInternalLink,
    ConnectionPoint,
    EntityMetadata,
    BaseTemplate,
    BaseTemplateRevision,
    PresentationPanel,
    ModuleBay, ModuleTemplate, ModuleTemplateRevision, ModuleEndpointDefinition,
    ModuleInstallation, ModuleEndpointMapping, PhysicalObject,
)
from app.repository import CanonicalRepository, ConnectionMemberInput
from app.module_endpoint_names import module_endpoint_contexts


@dataclass(frozen=True)
class CreatedBlueprint:
    template_id: uuid.UUID
    version_id: uuid.UUID


@dataclass(frozen=True)
class MaterializedSlot:
    slot_key: str
    connection_point_id: uuid.UUID
    network_interface_id: uuid.UUID | None


@dataclass(frozen=True)
class MaterializedObjectConfiguration:
    template_id: uuid.UUID
    version_id: uuid.UUID
    physical_object_id: uuid.UUID
    slots: tuple[MaterializedSlot, ...]
    internal_connection_ids: tuple[uuid.UUID, ...]


@dataclass(frozen=True)
class BlueprintListItem:
    template_id: uuid.UUID
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
    template_id: uuid.UUID
    name: str
    version_id: uuid.UUID
    version_number: int
    default_physical_object_class: str | None
    body_kind: str
    width: float
    height: float
    fill_color: str | None
    next_panel_number: int
    panels: tuple[PresentationPanel, ...]
    slots: tuple[BuiltInEndpointDefinition, ...]
    internal_links: tuple[tuple[str, str], ...]
    bays: tuple[ModuleBay, ...]


class HardwareCatalog:
    """Authoring records that materialize, but never alter, L1 semantics."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_initial_version(self, query: object) -> CreatedBlueprint:
        blueprint = BaseTemplate(name=query.name)
        self.session.add(blueprint)
        self.session.flush()
        version = self._create_version(blueprint.id, 1, query)
        return CreatedBlueprint(blueprint.id, version.id)

    def _create_version(self, template_id: uuid.UUID, version_number: int, query: object) -> BaseTemplateRevision:
        version = BaseTemplateRevision(
            template_id=template_id,
            version_number=version_number,
            default_physical_object_class=query.default_physical_object_class,
            body_kind=query.body.kind,
            width=query.body.width,
            height=query.body.height,
            fill_color=query.body.fill_color,
        )
        self.session.add(version)
        self.session.flush()
        panel_keys: set[str] = set()
        panel_numbers: set[int] = set()
        for panel in query.panels:
            if panel.panel_key in panel_keys or panel.panel_number in panel_numbers:
                raise ValidationError("Blueprint panels must have unique keys and numbers")
            panel_keys.add(panel.panel_key)
            panel_numbers.add(panel.panel_number)
            self.session.add(PresentationPanel(
                base_revision_id=version.id, panel_key=panel.panel_key,
                panel_number=panel.panel_number, display_name=panel.display_name,
                x=panel.x, y=panel.y, width=panel.width, height=panel.height,
            ))
        self.session.flush()
        slots_by_key: dict[str, BuiltInEndpointDefinition] = {}
        for item in query.slots:
            if item.key in slots_by_key:
                raise ValidationError("Blueprint slot keys must be unique")
            if item.panel_key not in panel_keys:
                raise ValidationError("Blueprint slot refers to an unknown panel")
            slot = BuiltInEndpointDefinition(
                base_revision_id=version.id,
                slot_key=item.key,
                display_name=item.display_name,
                kind=item.kind,
                panel_key=item.panel_key,
                position_x=item.rendered_position.x,
                position_y=item.rendered_position.y,
            )
            self.session.add(slot)
            slots_by_key[item.key] = slot
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
            self.session.add(BaseInternalLink(
                base_revision_id=version.id,
                slot_a_id=slot_a.id,
                slot_b_id=slot_b.id,
            ))
        self.session.flush()
        for bay in query.bays:
            self.session.add(ModuleBay(base_revision_id=version.id, **bay.model_dump()))
        self.session.flush()
        return version

    def list_blueprints(self) -> tuple[BlueprintListItem, ...]:
        blueprints = tuple(self.session.scalars(select(BaseTemplate).order_by(BaseTemplate.name, BaseTemplate.id)))
        return tuple(
            BlueprintListItem(
                template_id=blueprint.id,
                name=blueprint.name,
                version_id=version.id,
                version_number=version.version_number,
                default_physical_object_class=version.default_physical_object_class,
                body_kind=version.body_kind,
                width=version.width,
                height=version.height,
                fill_color=version.fill_color,
                slot_count=len(tuple(self.session.scalars(
                    select(BuiltInEndpointDefinition.id).where(
                        BuiltInEndpointDefinition.base_revision_id == version.id
                    )
                ))),
                internal_link_count=len(tuple(self.session.scalars(
                    select(BaseInternalLink.id).where(
                        BaseInternalLink.base_revision_id == version.id
                    )
                ))),
                version_count=self.session.scalar(select(func.count()).select_from(BaseTemplateRevision).where(
                    BaseTemplateRevision.template_id == blueprint.id
                )) or 0,
            )
            for blueprint in blueprints
            for version in [self.session.scalar(
                select(BaseTemplateRevision).where(BaseTemplateRevision.template_id == blueprint.id)
                .order_by(BaseTemplateRevision.version_number.desc()).limit(1)
            )]
            if version is not None
        )

    def get_version_detail(
        self, template_id: uuid.UUID, version_id: uuid.UUID,
    ) -> BlueprintVersionDetail:
        version = self.session.get(BaseTemplateRevision, version_id)
        blueprint = self.session.get(BaseTemplate, template_id)
        if blueprint is None:
            raise ValidationError("BaseTemplate was not found", {"template_id": str(template_id)})
        if version is None or version.template_id != template_id:
            raise ValidationError(
                "BaseTemplateRevision does not belong to BaseTemplate",
                {"template_id": str(template_id), "version_id": str(version_id)},
            )
        slots = tuple(self.session.scalars(
            select(BuiltInEndpointDefinition)
            .where(BuiltInEndpointDefinition.base_revision_id == version.id)
            .order_by(BuiltInEndpointDefinition.slot_key)
        ))
        panels = tuple(self.session.scalars(
            select(PresentationPanel).where(PresentationPanel.base_revision_id == version.id)
            .order_by(PresentationPanel.panel_number)
        ))
        keys_by_id = {slot.id: slot.slot_key for slot in slots}
        links = tuple(
            (keys_by_id[link.slot_a_id], keys_by_id[link.slot_b_id])
            for link in self.session.scalars(
                select(BaseInternalLink)
                .where(BaseInternalLink.base_revision_id == version.id)
                .order_by(BaseInternalLink.id)
            )
        )
        return BlueprintVersionDetail(
            template_id=blueprint.id,
            name=blueprint.name,
            version_id=version.id,
            version_number=version.version_number,
            default_physical_object_class=version.default_physical_object_class,
            body_kind=version.body_kind,
            width=version.width,
            height=version.height,
            fill_color=version.fill_color,
            next_panel_number=(self.session.scalar(
                select(func.max(PresentationPanel.panel_number))
                .join(BaseTemplateRevision, PresentationPanel.base_revision_id == BaseTemplateRevision.id)
                .where(BaseTemplateRevision.template_id == template_id)
            ) or 0) + 1,
            panels=panels,
            slots=slots,
            internal_links=links,
            bays=tuple(self.session.scalars(select(ModuleBay).where(ModuleBay.base_revision_id == version.id).order_by(ModuleBay.bay_key))),
        )

    def delete_blueprint(self, template_id: uuid.UUID) -> None:
        blueprint = self.session.scalar(
            select(BaseTemplate).where(BaseTemplate.id == template_id).with_for_update()
        )
        if blueprint is None:
            raise ValidationError("BaseTemplate was not found", {"template_id": str(template_id)})
        version_ids = tuple(self.session.scalars(select(BaseTemplateRevision.id).where(
            BaseTemplateRevision.template_id == template_id
        )))
        instance_id = self.session.scalar(select(ObjectConfiguration.id).where(
            ObjectConfiguration.base_revision_id.in_(version_ids)
        ).limit(1)) if version_ids else None
        if instance_id is not None:
            from app.errors import ModelError
            raise ModelError("BaseTemplate cannot be deleted because it has materialized instances", {"template_id": str(template_id)})
        slot_ids = tuple(self.session.scalars(select(BuiltInEndpointDefinition.id).where(
            BuiltInEndpointDefinition.base_revision_id.in_(version_ids)
        ))) if version_ids else ()
        if slot_ids:
            self.session.execute(delete(BaseInternalLink).where(
                BaseInternalLink.base_revision_id.in_(version_ids)
            ))
            self.session.execute(delete(BuiltInEndpointDefinition).where(BuiltInEndpointDefinition.id.in_(slot_ids)))
        self.session.execute(delete(ModuleBay).where(ModuleBay.base_revision_id.in_(version_ids)))
        self.session.execute(delete(PresentationPanel).where(PresentationPanel.base_revision_id.in_(version_ids)))
        self.session.execute(delete(BaseTemplateRevision).where(BaseTemplateRevision.id.in_(version_ids)))
        self.session.delete(blueprint)


    def create_object(
        self, template_id: uuid.UUID, display_name: str, class_: str | None = None,
    ) -> MaterializedObjectConfiguration:
        version = self.session.scalar(select(BaseTemplateRevision).where(BaseTemplateRevision.template_id == template_id).order_by(BaseTemplateRevision.version_number.desc()).limit(1))
        if version is None:
            raise ValidationError("Base template was not found")
        version_id = version.id
        slots = tuple(self.session.scalars(
            select(BuiltInEndpointDefinition)
            .where(BuiltInEndpointDefinition.base_revision_id == version_id)
            .order_by(BuiltInEndpointDefinition.slot_key)
        ))
        links = tuple(self.session.scalars(
            select(BaseInternalLink)
            .where(BaseInternalLink.base_revision_id == version_id)
            .order_by(BaseInternalLink.id)
        ))
        repository = CanonicalRepository(self.session)
        physical_object = repository.add_physical_object()
        self._metadata(physical_object_id=physical_object.id, key=DISPLAY_ALIAS_KEY, value=display_name)
        if class_ is not None or version.default_physical_object_class is not None:
            self._metadata(
                physical_object_id=physical_object.id,
                key=PHYSICAL_OBJECT_CLASS_KEY,
                value=class_ if class_ is not None else version.default_physical_object_class,
            )
        instance = ObjectConfiguration(base_revision_id=version.id, physical_object_id=physical_object.id)
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
            self.session.add(BuiltInEndpointMapping(
                configuration_id=instance.id,
                definition_id=slot.id,
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
        return MaterializedObjectConfiguration(
            template_id=template_id,
            version_id=version_id,
            physical_object_id=physical_object.id,
            slots=tuple(materialized[slot.id] for slot in slots),
            internal_connection_ids=tuple(internal_connection_ids),
        )

    def create_module(self, query):
        template = ModuleTemplate(name=query.name)
        self.session.add(template)
        self.session.flush()
        revision = ModuleTemplateRevision(template_id=template.id, version_number=1, compatibility=query.compatibility)
        self.session.add(revision)
        self.session.flush()
        for index, endpoint in enumerate(query.endpoints):
            self.session.add(ModuleEndpointDefinition(module_revision_id=revision.id, definition_key=endpoint.key, display_name=endpoint.display_name, kind=endpoint.kind, order_index=index))
        self.session.flush()
        return self.module_document(template, revision)

    def module_document(self, template, revision):
        return {"template_id": str(template.id), "revision_id": str(revision.id), "name": template.name, "compatibility": revision.compatibility, "endpoints": [{"key": e.definition_key, "display_name": e.display_name, "kind": e.kind} for e in self.session.scalars(select(ModuleEndpointDefinition).where(ModuleEndpointDefinition.module_revision_id == revision.id).order_by(ModuleEndpointDefinition.order_index))]}

    def list_modules(self):
        return {"modules": [self.module_document(t, r) for t, r in self.session.execute(select(ModuleTemplate, ModuleTemplateRevision).join(ModuleTemplateRevision, ModuleTemplateRevision.template_id == ModuleTemplate.id).order_by(ModuleTemplate.name, ModuleTemplate.id)).all()]}

    def delete_module(self, template_id: uuid.UUID) -> None:
        template = self.session.scalar(select(ModuleTemplate).where(
            ModuleTemplate.id == template_id
        ).with_for_update())
        if template is None:
            raise ValidationError("ModuleTemplate was not found", {"template_id": str(template_id)})
        # Lock all revisions before checking usage; concurrent FK references must wait.
        revision_ids = tuple(self.session.scalars(select(ModuleTemplateRevision.id).where(
            ModuleTemplateRevision.template_id == template_id
        ).order_by(ModuleTemplateRevision.id).with_for_update()))
        installation_id = self.session.scalar(select(ModuleInstallation.id).where(
            ModuleInstallation.module_revision_id.in_(revision_ids)
        ).limit(1))
        if installation_id is not None:
            raise ModelError("ModuleTemplate cannot be deleted because one of its revisions is installed", {
                "template_id": str(template_id), "installation_id": str(installation_id),
            })
        self.session.execute(delete(ModuleEndpointDefinition).where(
            ModuleEndpointDefinition.module_revision_id.in_(revision_ids)
        ))
        self.session.execute(delete(ModuleTemplateRevision).where(ModuleTemplateRevision.id.in_(revision_ids)))
        self.session.delete(template)

    def install_module(self, object_id, query):
        # Serializes installations for this object, including the empty-bay case.
        obj = self.session.scalar(select(PhysicalObject).where(PhysicalObject.id == object_id).with_for_update())
        if obj is None:
            raise ValidationError("PhysicalObject was not found")
        config = self.session.scalar(select(ObjectConfiguration).where(ObjectConfiguration.physical_object_id == object_id).with_for_update())
        if config is None:
            raise ValidationError("Object has no base template configuration")
        bay = self.session.scalar(select(ModuleBay).where(ModuleBay.base_revision_id == config.base_revision_id, ModuleBay.bay_key == query.bay_key))
        if bay is None:
            raise ValidationError("Bay does not belong to the object's base revision")
        if self.session.scalar(select(ModuleInstallation.id).where(ModuleInstallation.configuration_id == config.id, ModuleInstallation.bay_key == bay.bay_key)) is not None:
            raise ModelError("Bay is occupied")
        revision = self.session.scalar(select(ModuleTemplateRevision).where(ModuleTemplateRevision.template_id == query.module_template_id).order_by(ModuleTemplateRevision.version_number.desc()).limit(1))
        if revision is None:
            raise ValidationError("Module template was not found")
        if revision.compatibility != bay.compatibility:
            raise ModelError("Module compatibility must exactly match the bay")
        installation = ModuleInstallation(configuration_id=config.id, module_revision_id=revision.id, bay_key=bay.bay_key, orientation=query.orientation)
        self.session.add(installation)
        self.session.flush()
        repository = CanonicalRepository(self.session)
        for definition in self.session.scalars(select(ModuleEndpointDefinition).where(ModuleEndpointDefinition.module_revision_id == revision.id).order_by(ModuleEndpointDefinition.order_index)):
            point = repository.add_connection_point(object_id, cardinality=1)
            self._metadata(connection_point_id=point.id, key=DISPLAY_ALIAS_KEY, value=definition.display_name)
            interface_id = None
            if definition.kind == "NETWORK_PORT":
                interface = repository.add_network_interface()
                repository.add_network_interface_physical_owner(interface.id, object_id)
                repository.add_interface_physical_binding(interface.id, point.id, point_member=1)
                self._metadata(network_interface_id=interface.id, key=DISPLAY_ALIAS_KEY, value=definition.display_name)
                interface_id = interface.id
            self.session.add(ModuleEndpointMapping(installation_id=installation.id, definition_id=definition.id, connection_point_id=point.id, network_interface_id=interface_id))
        self.session.flush()
        return self.configuration_document(object_id)

    def configuration_document(self, object_id):
        CanonicalRepository(self.session).require_physical_objects([object_id])
        config = self.session.scalar(select(ObjectConfiguration).where(ObjectConfiguration.physical_object_id == object_id))
        if config is None:
            return {"configuration_id": None, "bays": []}
        installations = {i.bay_key: i for i in self.session.scalars(select(ModuleInstallation).where(ModuleInstallation.configuration_id == config.id))}
        contexts = {c["connection_point_id"]: c for c in module_endpoint_contexts(self.session, configuration_ids=[config.id])}
        modules = {r.id: (r, t) for r, t in self.session.execute(select(ModuleTemplateRevision, ModuleTemplate).join(ModuleTemplate, ModuleTemplate.id == ModuleTemplateRevision.template_id).where(ModuleTemplateRevision.id.in_([i.module_revision_id for i in installations.values()])))}
        endpoints_by_installation = {}
        for mapping, definition in self.session.execute(select(ModuleEndpointMapping, ModuleEndpointDefinition).join(ModuleEndpointDefinition, ModuleEndpointDefinition.id == ModuleEndpointMapping.definition_id).where(ModuleEndpointMapping.installation_id.in_([i.id for i in installations.values()])).order_by(ModuleEndpointDefinition.order_index)):
            endpoints_by_installation.setdefault(mapping.installation_id, []).append((mapping, definition))
        bays = []
        for bay in self.session.scalars(select(ModuleBay).where(ModuleBay.base_revision_id == config.base_revision_id).order_by(ModuleBay.bay_key)):
            installation = installations.get(bay.bay_key)
            installed = None
            if installation:
                revision, template = modules[installation.module_revision_id]
                endpoints = []
                rows = endpoints_by_installation.get(installation.id, [])
                for index, (mapping, definition) in enumerate(rows):
                    x, y = module_endpoint_position(bay, installation.orientation, index, len(rows))
                    endpoints.append({"key": definition.definition_key, "kind": definition.kind, **contexts[str(mapping.connection_point_id)], "x": x, "y": y})
                installed = {"id": str(installation.id), "module_template_id": str(template.id), "module_revision_id": str(revision.id), "name": template.name, "orientation": installation.orientation, "endpoints": endpoints}
            bays.append({"bay_key": bay.bay_key, "display_name": bay.display_name, "compatibility": bay.compatibility, "panel_key": bay.panel_key, "x": bay.x, "y": bay.y, "width": bay.width, "height": bay.height, "installation": installed})
        return {"configuration_id": str(config.id), "base_revision_id": str(config.base_revision_id), "bays": bays}

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


def module_endpoint_position(bay, orientation, index, count):
    fraction = (index + 1) / (count + 1)
    if orientation == "HORIZONTAL":
        return bay.x + bay.width * fraction, bay.y + bay.height / 2
    return bay.x + bay.width / 2, bay.y + bay.height * fraction
