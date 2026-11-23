import uuid
from collections import deque
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.port_types import validate_port_type_assignments
from app.module_port_types import (
    MOUNT_FIELDS, base_assignments, module_assignments, mount_identity, row_mount,
    validate_module_authoring, validate_mount_types, validate_nested_installation,
    validate_transceiver_authoring,
)
from app.module_layout import compose_layout, initial_layout, nested_place, validate_layout
from app.hardware_interfaces import declared_interfaces, associations
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
    HardwareInterfaceAssociation, InterfacePhysicalBinding, ModuleInstallation, ModuleEndpointMapping,
    NetworkInterface, PhysicalObject, PortType,
)
from app.repository import CanonicalRepository, ConnectionMemberInput
from app.module_endpoint_names import endpoint_context


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
    internal_links: tuple[tuple[str, str, list], ...]
    bays: tuple[ModuleBay, ...]


class HardwareCatalog:
    """Authoring records that materialize, but never alter, L1 semantics."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_initial_version(self, query: object) -> CreatedBlueprint:
        from app.schemas import CreateBaseTemplateRequest
        query = CreateBaseTemplateRequest.model_validate(query.model_dump())
        if any(bay.mount_kind == "MODULE_BAY" and bay.kind != "LOGICAL" for bay in query.bays):
            raise ValidationError("Создавайте отсеки для плат как логические места без координат",
                                  {"reason": "MODULE_BAY_MUST_BE_LOGICAL"})
        definition = query.model_dump(mode="json")
        validate_port_type_assignments(self.session, definition["slots"])
        validate_mount_types(self.session, base_assignments(definition))
        blueprint = BaseTemplate(name=query.name)
        self.session.add(blueprint)
        self.session.flush()
        version = self._create_version(blueprint.id, 1, query)
        return CreatedBlueprint(blueprint.id, version.id)

    def _create_version(self, template_id: uuid.UUID, version_number: int, query: object) -> BaseTemplateRevision:
        version = BaseTemplateRevision(
            template_id=template_id,
            name=query.name,
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
                face=panel.face,
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
                cardinality=item.cardinality,
                port_type_id=item.port_type_id,
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
                member_mappings=[dict(from_member_index=m.from_member_index, to_member_index=m.to_member_index) if slot_a.slot_key == link_query.from_slot_key else dict(from_member_index=m.to_member_index, to_member_index=m.from_member_index) for m in link_query.member_mappings],
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
                name=version.name,
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
            (keys_by_id[link.slot_a_id], keys_by_id[link.slot_b_id], link.member_mappings)
            for link in self.session.scalars(
                select(BaseInternalLink)
                .where(BaseInternalLink.base_revision_id == version.id)
                .order_by(BaseInternalLink.id)
            )
        )
        occupied = set()
        for a, b, mappings in links:
            for mapping in mappings:
                for member in ((a, mapping["from_member_index"]), (b, mapping["to_member_index"])):
                    if member in occupied:
                        raise ModelError(
                            "Сохранённая внутренняя разводка повторно использует один member и несовместима с O3. Автоматическая коррекция не выполняется.",
                            {"reason": "INTERNAL_MEMBER_OCCUPANCY", "slot_key": member[0], "member_index": member[1]},
                        )
                    occupied.add(member)
        return BlueprintVersionDetail(
            template_id=blueprint.id,
            name=version.name,
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


    def create_object(self, template_id, display_name, class_=None):
        with self.session.begin_nested():
            return self._create_object(template_id, display_name, class_)

    def _create_object(
        self, template_id: uuid.UUID, display_name: str, class_: str | None = None,
    ) -> MaterializedObjectConfiguration:
        version = self.session.scalar(select(BaseTemplateRevision).where(BaseTemplateRevision.template_id == template_id).order_by(BaseTemplateRevision.version_number.desc()).limit(1))
        if version is None:
            raise ValidationError("Base template was not found")
        self.get_version_detail(template_id, version.id)
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
        self._materialize_hardware_interfaces(instance, None, [
            _base_place(bay) for bay in self.session.scalars(select(ModuleBay).where(
                ModuleBay.base_revision_id == version.id, ModuleBay.hardware_interface_key.is_not(None)))
        ], place_key="bay_key")
        materialized: dict[uuid.UUID, MaterializedSlot] = {}
        for slot in slots:
            point = repository.add_connection_point(physical_object.id, cardinality=slot.cardinality)
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
                cardinality=len(link.member_mappings),
                members=[ConnectionMemberInput(index=i, point_a_member=m["from_member_index"], point_b_member=m["to_member_index"]) for i, m in enumerate(link.member_mappings, 1)],
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
        definition = query.model_dump(mode="json")
        validate_module_authoring(definition)
        validate_transceiver_authoring(definition)
        validate_port_type_assignments(self.session, definition["endpoints"],
                                       require_connector=query.transceiver is not None)
        validate_mount_types(self.session, module_assignments(definition))
        template = ModuleTemplate(name=query.name)
        self.session.add(template)
        self.session.flush()
        revision = self._create_module_revision(template.id, 1, query)
        return self.module_document(template, revision)

    def _create_module_revision(self, template_id, version_number, query):
        revision = ModuleTemplateRevision(template_id=template_id, name=query.name, version_number=version_number, geometry=query.geometry.model_dump(mode="json"),
            transceiver=query.transceiver.model_dump(mode="json", exclude_defaults=True) if query.transceiver is not None else None,
            **{key: getattr(query, key) for key in MOUNT_FIELDS})
        revision.module_places = [port.model_dump(mode="json", exclude_none=True) for port in query.module_places]
        self.session.add(revision)
        self.session.flush()
        for index, endpoint in enumerate(query.endpoints):
            self.session.add(ModuleEndpointDefinition(
                module_revision_id=revision.id, definition_key=endpoint.key,
                display_name=endpoint.display_name, kind=endpoint.kind,
                port_type_id=endpoint.port_type_id, order_index=index,
            ))
        self.session.flush()
        return revision

    def module_document(self, template, revision):
        document = {"template_id": str(template.id), "revision_id": str(revision.id), "name": revision.name, **row_mount(revision), "geometry": revision.geometry, "module_places": revision.module_places, "endpoints": [{"key": e.definition_key, "display_name": e.display_name, "kind": e.kind, "port_type_id": str(e.port_type_id)} for e in self.session.scalars(select(ModuleEndpointDefinition).where(ModuleEndpointDefinition.module_revision_id == revision.id).order_by(ModuleEndpointDefinition.order_index))]}
        if revision.transceiver is not None:
            document["transceiver"] = revision.transceiver
        return document

    def list_modules(self):
        latest = select(ModuleTemplateRevision.id).where(ModuleTemplateRevision.template_id == ModuleTemplate.id).order_by(ModuleTemplateRevision.version_number.desc()).limit(1).correlate(ModuleTemplate).scalar_subquery()
        return {"modules": [self.module_document(t, r) for t, r in self.session.execute(select(ModuleTemplate, ModuleTemplateRevision).join(ModuleTemplateRevision, ModuleTemplateRevision.id == latest).order_by(ModuleTemplate.name, ModuleTemplate.id)).all()]}

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
        parent_id = query.parent_installation_id
        if parent_id is None:
            bay_rows = self.session.scalars(select(ModuleBay).where(ModuleBay.base_revision_id == config.base_revision_id))
            places = [_base_place(row) for row in bay_rows]
            place = next((item for item in places if item["bay_key"] == query.bay_key), None)
            if place is None:
                raise ValidationError("Место отсутствует в закреплённой ревизии оборудования")
            panel = self.session.scalar(select(PresentationPanel).where(
                PresentationPanel.base_revision_id == config.base_revision_id,
                PresentationPanel.panel_key == place["panel_key"]))
            frame = {"width": panel.width, "height": panel.height}
        else:
            parent = self.session.get(ModuleInstallation, parent_id)
            if parent is None or parent.configuration_id != config.id:
                raise ValidationError("Родительская установка не принадлежит конфигурации этого объекта",
                                      {"reason": "INVALID_MODULE_PARENT"})
            parent_revision = self.session.get(ModuleTemplateRevision, parent.module_revision_id)
            places = [nested_place(item, parent.layout["panel_key"]) for item in parent_revision.module_places]
            place = next((item for item in places if item["bay_key"] == query.bay_key), None)
            if place is None:
                raise ValidationError("Место отсутствует в закреплённой ревизии родительского модуля",
                                      {"reason": "INVALID_MODULE_PLACE"})
            validate_nested_installation(parent_revision.mount_kind, place["mount_kind"],
                                         parent_is_root=parent.parent_installation_id is None)
            frame = parent_revision.geometry
        if self.session.scalar(select(ModuleInstallation.id).where(
            ModuleInstallation.configuration_id == config.id,
            ModuleInstallation.parent_installation_id == parent_id,
            ModuleInstallation.bay_key == query.bay_key,
        )) is not None:
            raise ModelError("Место уже занято", {"reason": "MODULE_PLACE_OCCUPIED"})
        revision = self.session.scalar(select(ModuleTemplateRevision).where(
            ModuleTemplateRevision.template_id == query.module_template_id
        ).order_by(ModuleTemplateRevision.version_number.desc()).limit(1))
        if revision is None:
            raise ValidationError("Module template was not found")
        if mount_identity(row_mount(revision)) != mount_identity(place):
            raise ModelError("Вид и тип модуля должны точно совпадать с посадочным местом",
                             {"reason": "MODULE_MOUNT_MISMATCH"})
        definitions = list(self.session.scalars(select(ModuleEndpointDefinition).where(
            ModuleEndpointDefinition.module_revision_id == revision.id
        ).order_by(ModuleEndpointDefinition.order_index)))
        transceiver_interface = None
        if revision.mount_kind == "MODULE_PORT" and definitions:
            key = declared_interfaces([place], place_key="bay_key").get(query.bay_key)
            association = next((row for row in associations(self.session, config.id, parent_id)
                                if row.bay_key == query.bay_key and row.hardware_interface_key == key
                                and row.physical_object_id == obj.id), None)
            if association is None:
                raise ModelError("Для гнезда требуется аппаратный интерфейс",
                                 {"reason": "TRANSCEIVER_BINDING_REQUIRED"})
            if (len(definitions) != 1 or definitions[0].kind != "CONNECTION_POINT"
                    or self.session.get(PortType, definitions[0].port_type_id).cardinality != 1):
                raise ModelError("Трансивер должен иметь одно физическое окончание с одним каналом",
                                 {"reason": "UNSUPPORTED_TRANSCEIVER_TERMINATION"})
            transceiver_interface = self.session.scalar(select(NetworkInterface.id).where(
                NetworkInterface.id == association.interface_id).with_for_update())
            if transceiver_interface is None or self.session.scalar(select(InterfacePhysicalBinding.id).where(
                InterfacePhysicalBinding.interface_id == transceiver_interface).limit(1)) is not None:
                raise ModelError("Аппаратный интерфейс уже имеет физическую привязку",
                                 {"reason": "HARDWARE_INTERFACE_ALREADY_BOUND"})
        layout = initial_layout(place, revision.geometry, query.orientation, frame, places)
        validate_layout(layout, place["panel_key"])
        installation = ModuleInstallation(layout=layout, configuration_id=config.id,
            parent_installation_id=parent_id, module_revision_id=revision.id,
            bay_key=query.bay_key, orientation=query.orientation)
        self.session.add(installation)
        self.session.flush()
        self._materialize_hardware_interfaces(config, installation.id, revision.module_places, place_key="key")
        repository = CanonicalRepository(self.session)
        for definition in definitions:
            capacity = self.session.get(PortType, definition.port_type_id).cardinality
            point = repository.add_connection_point(object_id, cardinality=capacity)
            self._metadata(connection_point_id=point.id, key=DISPLAY_ALIAS_KEY, value=definition.display_name)
            interface_id = None
            if definition.kind == "NETWORK_PORT":
                interface = repository.add_network_interface()
                repository.add_network_interface_physical_owner(interface.id, object_id)
                repository.add_interface_physical_binding(interface.id, point.id, point_member=1)
                self._metadata(network_interface_id=interface.id, key=DISPLAY_ALIAS_KEY, value=definition.display_name)
                interface_id = interface.id
            elif transceiver_interface is not None:
                repository.add_interface_physical_binding(transceiver_interface, point.id, point_member=1)
            self.session.add(ModuleEndpointMapping(installation_id=installation.id, definition_id=definition.id, connection_point_id=point.id, network_interface_id=interface_id))
        self.session.flush()
        return self.configuration_document(object_id)

    def _materialize_hardware_interfaces(self, config, parent_id, places, *, place_key):
        repository = CanonicalRepository(self.session)
        keys = declared_interfaces(places, place_key=place_key)
        for place in places:
            bay_key = place[place_key]
            if bay_key not in keys:
                continue
            interface = repository.add_network_interface()
            repository.add_network_interface_physical_owner(interface.id, config.physical_object_id)
            self._metadata(network_interface_id=interface.id, key=DISPLAY_ALIAS_KEY, value=place["display_name"])
            self.session.add(HardwareInterfaceAssociation(
                configuration_id=config.id, physical_object_id=config.physical_object_id,
                parent_installation_id=parent_id, bay_key=bay_key,
                hardware_interface_key=keys[bay_key], interface_id=interface.id,
            ))

    def configuration_document(self, object_id):
        CanonicalRepository(self.session).require_physical_objects([object_id])
        config = self.session.scalar(select(ObjectConfiguration).where(ObjectConfiguration.physical_object_id == object_id))
        if config is None:
            return {"configuration_id": None, "bays": []}
        installations = list(self.session.scalars(select(ModuleInstallation).where(
            ModuleInstallation.configuration_id == config.id).order_by(ModuleInstallation.id)))
        occupied = {(i.parent_installation_id, i.bay_key): i for i in installations}
        hardware_interfaces = {(row.parent_installation_id, row.bay_key): row.interface_id
                               for row in self.session.scalars(select(HardwareInterfaceAssociation).where(
                                   HardwareInterfaceAssociation.configuration_id == config.id))}
        modules = {r.id: (r, t) for r, t in self.session.execute(
            select(ModuleTemplateRevision, ModuleTemplate)
            .join(ModuleTemplate, ModuleTemplate.id == ModuleTemplateRevision.template_id)
            .where(ModuleTemplateRevision.id.in_({i.module_revision_id for i in installations})))}
        endpoints_by_installation = {}
        for mapping, definition in self.session.execute(
            select(ModuleEndpointMapping, ModuleEndpointDefinition)
            .join(ModuleEndpointDefinition, ModuleEndpointDefinition.id == ModuleEndpointMapping.definition_id)
            .where(ModuleEndpointMapping.installation_id.in_([i.id for i in installations]))
            .order_by(ModuleEndpointDefinition.order_index)
        ):
            endpoints_by_installation.setdefault(mapping.installation_id, []).append((mapping, definition))
        panels = [{k: getattr(p, k) for k in ("panel_key", "display_name", "width", "height")}
                  for p in self.session.scalars(select(PresentationPanel).where(
                      PresentationPanel.base_revision_id == config.base_revision_id))]
        panel_by_key = {p["panel_key"]: p for p in panels}
        bays = [_base_place(row) for row in self.session.scalars(select(ModuleBay).where(
            ModuleBay.base_revision_id == config.base_revision_id).order_by(ModuleBay.bay_key))]
        pending = deque((bay, None, panel_by_key[bay["panel_key"]], bays, None, 0, ()) for bay in bays)
        nested_installations = []
        while pending:
            place, parent_id, frame, siblings, parent_layout, parent_turns, parent_path = pending.popleft()
            interface_id = hardware_interfaces.get((parent_id, place["bay_key"]))
            if interface_id is not None:
                place["network_interface_id"] = str(interface_id)
            installation = occupied.get((parent_id, place["bay_key"]))
            if parent_id is None:
                place["installation"] = None
            else:
                place["installation_id"] = str(installation.id) if installation else None
                global_place = compose_layout(parent_layout, parent_turns, {
                    **place, "width": place["width"] or 0, "height": place["height"] or 0,
                })
                if place["width"] is None:
                    global_place.update(width=None, height=None)
                place["global_position"] = global_place
            if installation is None:
                continue
            revision, template = modules[installation.module_revision_id]
            validate_layout(installation.layout, place["panel_key"])
            global_layout = (compose_layout(parent_layout, parent_turns, installation.layout)
                             if parent_layout is not None else installation.layout)
            turns = (parent_turns + (installation.orientation == "VERTICAL")) % 4
            endpoints = []
            place_path = (place["display_name"], *parent_path)
            for mapping, definition in endpoints_by_installation.get(installation.id, []):
                position = revision.geometry["endpoints"][definition.definition_key]
                point_position = compose_layout(global_layout, turns, {**position, "width": 0, "height": 0})
                endpoints.append({"key": definition.definition_key, "kind": definition.kind,
                                  "port_type_id": str(definition.port_type_id),
                                  **endpoint_context(mapping, definition, installation, place["panel_key"],
                                                     panel_by_key[place["panel_key"]]["display_name"], place_path),
                                  "x": point_position["x"], "y": point_position["y"]})
            children = [nested_place(child, place["panel_key"]) for child in revision.module_places]
            installed = {"id": str(installation.id), "parent_installation_id": str(parent_id) if parent_id else None,
                         "bay_key": installation.bay_key, "module_template_id": str(template.id),
                         "module_revision_id": str(revision.id), "name": revision.name,
                         "orientation": installation.orientation, "layout": installation.layout,
                         "global_layout": global_layout, "fill_color": revision.geometry["fill_color"],
                         "initial_layout": initial_layout(place, revision.geometry, installation.orientation, frame, siblings),
                         "endpoints": endpoints, "module_places": children}
            if parent_id is None:
                place["installation"] = installed
            else:
                nested_installations.append(installed)
            pending.extend((child, installation.id, revision.geometry, children, global_layout, turns, place_path)
                           for child in children)
        return {"configuration_id": str(config.id), "base_revision_id": str(config.base_revision_id),
                "panels": panels, "bays": bays, "nested_installations": nested_installations}

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


def _base_place(bay):
    place = {**row_mount(bay), **{key: getattr(bay, key) for key in
             ("bay_key", "display_name", "panel_key", "kind", "x", "y", "width", "height")}}
    if bay.hardware_interface_key is not None:
        place["hardware_interface_key"] = str(bay.hardware_interface_key)
    return place
