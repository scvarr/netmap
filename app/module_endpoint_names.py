"""Derived module endpoint read context; never writes canonical metadata."""
import uuid
from dataclasses import dataclass

from sqlalchemy import and_, select

from app.device_catalog import DeviceCatalog, DisplayAliasRecord
from app.models import (ModuleEndpointMapping, ModuleEndpointDefinition,
                        ModuleInstallation, ModuleTemplateRevision, ObjectConfiguration, ModuleBay,
                        PresentationPanel, BuiltInEndpointMapping, BuiltInEndpointDefinition)


def module_endpoint_contexts(session, *, connection_point_ids=None, network_interface_ids=None):
    query = (select(ModuleEndpointMapping, ModuleEndpointDefinition, ModuleInstallation)
             .join(ModuleEndpointDefinition, ModuleEndpointDefinition.id == ModuleEndpointMapping.definition_id)
             .join(ModuleInstallation, ModuleInstallation.id == ModuleEndpointMapping.installation_id))
    if connection_point_ids is not None:
        query = query.where(ModuleEndpointMapping.connection_point_id.in_(connection_point_ids))
    elif network_interface_ids is not None:
        query = query.where(ModuleEndpointMapping.network_interface_id.in_(network_interface_ids))
    else:
        raise ValueError("Module endpoint context requires a bounded scope")
    endpoints = session.execute(query).all()
    if not endpoints:
        return []
    config_ids = {installation.configuration_id for _, _, installation in endpoints}
    installations = {installation.id: (installation, places) for installation, places in session.execute(
        select(ModuleInstallation, ModuleTemplateRevision.module_places)
        .join(ModuleTemplateRevision, ModuleTemplateRevision.id == ModuleInstallation.module_revision_id)
        .where(ModuleInstallation.configuration_id.in_(config_ids))
    )}
    root_bays = {(configuration_id, bay.bay_key): (bay, panel) for configuration_id, bay, panel in session.execute(
        select(ObjectConfiguration.id, ModuleBay, PresentationPanel)
        .join(ModuleBay, ModuleBay.base_revision_id == ObjectConfiguration.base_revision_id)
        .join(PresentationPanel, and_(PresentationPanel.base_revision_id == ModuleBay.base_revision_id,
                                      PresentationPanel.panel_key == ModuleBay.panel_key))
        .where(ObjectConfiguration.id.in_(config_ids))
    )}
    places_by_parent = {identifier: {place["key"]: place["display_name"] for place in places}
                        for identifier, (_, places) in installations.items()}
    contexts = []
    for mapping, definition, installation in endpoints:
        ancestor = installation
        path = []
        while ancestor.parent_installation_id is not None:
            parent_id = ancestor.parent_installation_id
            path.append(places_by_parent[parent_id][ancestor.bay_key])
            ancestor = installations[parent_id][0]
        bay, panel = root_bays[ancestor.configuration_id, ancestor.bay_key]
        path.append(bay.display_name)
        contexts.append(endpoint_context(mapping, definition, installation, panel.panel_key, panel.display_name, path))
    return contexts


def endpoint_context(mapping, definition, installation, panel_key, panel_name, place_path):
    return {
        "installation_id": str(installation.id),
        "panel_key": panel_key, "panel_display_name": panel_name,
        "bay_key": installation.bay_key, "bay_display_name": place_path[0],
        "local_display_name": definition.display_name,
        "contextual_display_name": " / ".join([panel_name, *reversed(place_path), definition.display_name]),
        "connection_point_id": str(mapping.connection_point_id),
        "network_interface_id": str(mapping.network_interface_id) if mapping.network_interface_id else None,
    }


@dataclass(frozen=True)
class EndpointDisplayName:
    value: str
    context: dict
    # A derived name is not evidence of an EntityMetadata alias.
    metadata_id: None = None


class EndpointNames:
    """Derived template names with canonical aliases retained as read context."""
    def __init__(self, session):
        self.session = session

    def _built_in_names(self, ids, field):
        mapping_field = getattr(BuiltInEndpointMapping, field)
        query = (select(mapping_field, BuiltInEndpointDefinition.display_name)
                 .join(BuiltInEndpointDefinition, BuiltInEndpointDefinition.id == BuiltInEndpointMapping.definition_id)
                 .join(ObjectConfiguration, and_(ObjectConfiguration.id == BuiltInEndpointMapping.configuration_id,
                       ObjectConfiguration.base_revision_id == BuiltInEndpointDefinition.base_revision_id))
                 .where(mapping_field.in_(ids)))
        return {entity_id: EndpointDisplayName(name, {}) for entity_id, name in self.session.execute(query)}

    def connection_points(self, ids) -> dict[uuid.UUID, DisplayAliasRecord | EndpointDisplayName]:
        names = DeviceCatalog(self.session).connection_point_display_aliases(ids)
        names.update(self._built_in_names(ids, "connection_point_id"))
        for context in module_endpoint_contexts(self.session, connection_point_ids=ids):
            names[uuid.UUID(context["connection_point_id"])] = EndpointDisplayName(context["contextual_display_name"], context)
        return names

    def network_interfaces(self, ids) -> dict[uuid.UUID, DisplayAliasRecord | EndpointDisplayName]:
        names = DeviceCatalog(self.session).network_interface_display_aliases(ids)
        names.update(self._built_in_names(ids, "network_interface_id"))
        for context in module_endpoint_contexts(self.session, network_interface_ids=ids):
            names[uuid.UUID(context["network_interface_id"])] = EndpointDisplayName(context["contextual_display_name"], context)
        return names
