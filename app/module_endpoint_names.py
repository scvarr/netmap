"""Derived module endpoint read context; never writes canonical metadata."""
import uuid
from dataclasses import dataclass

from sqlalchemy import and_, select

from app.device_catalog import DeviceCatalog, DisplayAliasRecord
from app.models import (ModuleEndpointMapping, ModuleEndpointDefinition,
                        ModuleInstallation, ObjectConfiguration, ModuleBay,
                        PresentationPanel)


def module_endpoint_contexts(session, *, connection_point_ids=None,
                             network_interface_ids=None, configuration_ids=None):
    query = (select(ModuleEndpointMapping, ModuleEndpointDefinition, ModuleInstallation,
                    ModuleBay, PresentationPanel)
             .join(ModuleEndpointDefinition, ModuleEndpointDefinition.id == ModuleEndpointMapping.definition_id)
             .join(ModuleInstallation, ModuleInstallation.id == ModuleEndpointMapping.installation_id)
             .join(ObjectConfiguration, ObjectConfiguration.id == ModuleInstallation.configuration_id)
             .join(ModuleBay, and_(ModuleBay.base_revision_id == ObjectConfiguration.base_revision_id,
                                   ModuleBay.bay_key == ModuleInstallation.bay_key))
             .join(PresentationPanel, and_(PresentationPanel.base_revision_id == ObjectConfiguration.base_revision_id,
                                           PresentationPanel.panel_key == ModuleBay.panel_key)))
    if connection_point_ids is not None:
        query = query.where(ModuleEndpointMapping.connection_point_id.in_(connection_point_ids))
    elif network_interface_ids is not None:
        query = query.where(ModuleEndpointMapping.network_interface_id.in_(network_interface_ids))
    elif configuration_ids is not None:
        query = query.where(ModuleInstallation.configuration_id.in_(configuration_ids))
    else:
        raise ValueError("Module endpoint context requires a bounded scope")
    return [{
        "installation_id": str(installation.id),
        "panel_key": panel.panel_key, "panel_display_name": panel.display_name,
        "bay_key": bay.bay_key, "bay_display_name": bay.display_name,
        "local_display_name": definition.display_name,
        "contextual_display_name": f"{panel.display_name} / {bay.display_name} / {definition.display_name}",
        "connection_point_id": str(mapping.connection_point_id),
        "network_interface_id": str(mapping.network_interface_id) if mapping.network_interface_id else None,
    } for mapping, definition, installation, bay, panel in session.execute(query)]


@dataclass(frozen=True)
class EndpointDisplayName:
    value: str
    context: dict
    # A derived name is not evidence of an EntityMetadata alias.
    metadata_id: None = None


class EndpointNames:
    """Detached names: module context takes precedence; built-in aliases stay intact."""
    def __init__(self, session):
        self.session = session

    def connection_points(self, ids) -> dict[uuid.UUID, DisplayAliasRecord | EndpointDisplayName]:
        names = DeviceCatalog(self.session).connection_point_display_aliases(ids)
        for context in module_endpoint_contexts(self.session, connection_point_ids=ids):
            names[uuid.UUID(context["connection_point_id"])] = EndpointDisplayName(context["contextual_display_name"], context)
        return names

    def network_interfaces(self, ids) -> dict[uuid.UUID, DisplayAliasRecord | EndpointDisplayName]:
        names = DeviceCatalog(self.session).network_interface_display_aliases(ids)
        for context in module_endpoint_contexts(self.session, network_interface_ids=ids):
            names[uuid.UUID(context["network_interface_id"])] = EndpointDisplayName(context["contextual_display_name"], context)
        return names
