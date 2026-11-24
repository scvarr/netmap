"""Read-only L1 panel, board, socket and endpoint presentation."""
from collections import defaultdict
from types import SimpleNamespace

from sqlalchemy import select

from app.blueprint_presentation_geometry import derive_port_geometry
from app.hardware_catalog import HardwareCatalog
from app.models import (
    BaseTemplateRevision, BuiltInEndpointDefinition, BuiltInEndpointMapping,
    HardwareInterfaceAssociation, InterfacePhysicalBinding, ObjectConfiguration, PresentationPanel,
)


def _socket_position(place):
    return {axis: place[axis] + (place[size] or 0) / 2
            for axis, size in (("x", "width"), ("y", "height"))}


def _installed_elements(configuration, bindings):
    slots, sockets, boards = [], [], []
    nested = {item["id"]: item for item in configuration["nested_installations"]}

    def add_endpoints(installation, *, socket_key=None, position=None):
        for endpoint in installation["endpoints"]:
            point_id = endpoint["connection_point_id"]
            slots.append({
                "slot_key": socket_key or f"{installation['id']}:{endpoint['key']}",
                "panel_key": endpoint["panel_key"],
                "kind": endpoint["kind"],
                "display_name": endpoint["local_display_name"],
                "port_type_id": endpoint["port_type_id"],
                "connection_point_id": point_id,
                "network_interface_id": bindings.get(point_id) if socket_key else endpoint["network_interface_id"],
                "panel_local_position": position or {"x": endpoint["x"], "y": endpoint["y"]},
                **({"marker": "TRANSCEIVER"} if socket_key else {}),
            })

    def add_socket(place, key, installation, position, *, use_endpoint_position=False):
        if installation and installation["endpoints"]:
            add_endpoints(installation, socket_key=key, position=None if use_endpoint_position else position)
        elif position is not None:
            sockets.append({
                "socket_key": key, "panel_key": place["panel_key"], "display_name": place["display_name"],
                "panel_local_position": position, "installed": installation is not None,
            })

    for bay in configuration["bays"]:
        installation = bay["installation"]
        if bay["mount_kind"] == "MODULE_PORT":
            key = f"{configuration['configuration_id']}:{bay['bay_key']}"
            position = (_socket_position(bay) if bay["kind"] != "LOGICAL"
                        else _socket_position(installation["global_layout"]) if installation else None)
            # Direct transceivers use the projected endpoint, as in the Physics card.
            add_socket(bay, key, installation, position, use_endpoint_position=True)
        elif installation:
            boards.append({"installation_id": installation["id"], "display_name": installation["name"],
                           "fill_color": installation["fill_color"], **installation["global_layout"]})
            add_endpoints(installation)
            for place in installation["module_places"]:
                if place["mount_kind"] == "MODULE_PORT":
                    key = f"{installation['id']}:{place['bay_key']}"
                    add_socket(place, key, nested.get(place["installation_id"]),
                               _socket_position(place["global_position"]))
    return slots, sockets, boards


def physical_map_presentations(session, object_ids):
    if not object_ids:
        return {}
    configurations = session.execute(
        select(ObjectConfiguration, BaseTemplateRevision)
        .join(BaseTemplateRevision, BaseTemplateRevision.id == ObjectConfiguration.base_revision_id)
        .where(ObjectConfiguration.physical_object_id.in_(object_ids))
    ).all()
    if not configurations:
        return {}
    versions = {version.id for _, version in configurations}
    config_ids = {config.id for config, _ in configurations}
    panels = defaultdict(list)
    for panel in session.scalars(select(PresentationPanel)
            .where(PresentationPanel.base_revision_id.in_(versions))
            .order_by(PresentationPanel.panel_number)):
        panels[panel.base_revision_id].append(panel)

    built_in = defaultdict(list)
    for mapping, definition in session.execute(
        select(BuiltInEndpointMapping, BuiltInEndpointDefinition)
        .join(BuiltInEndpointDefinition, BuiltInEndpointDefinition.id == BuiltInEndpointMapping.definition_id)
        .where(BuiltInEndpointMapping.configuration_id.in_(config_ids))
        .order_by(BuiltInEndpointDefinition.slot_key)
    ):
        built_in[mapping.configuration_id].append({
            "slot_key": definition.slot_key, "panel_key": definition.panel_key, "kind": definition.kind,
            "display_name": definition.display_name, "port_type_id": str(definition.port_type_id),
            "connection_point_id": str(mapping.connection_point_id),
            "network_interface_id": str(mapping.network_interface_id) if mapping.network_interface_id else None,
            "panel_local_position": {"x": definition.position_x, "y": definition.position_y},
        })
    bindings = {str(point_id): str(interface_id) for point_id, interface_id in session.execute(
        select(InterfacePhysicalBinding.point_id, InterfacePhysicalBinding.interface_id)
        .join(HardwareInterfaceAssociation,
              HardwareInterfaceAssociation.interface_id == InterfacePhysicalBinding.interface_id)
        .where(HardwareInterfaceAssociation.configuration_id.in_(config_ids),
               InterfacePhysicalBinding.point_member == 1)
    )}
    documents = HardwareCatalog(session).configuration_documents([config for config, _ in configurations])
    result = {}
    for config, version in configurations:
        module_slots, sockets, boards = _installed_elements(documents[config.id], bindings)
        slots = built_in[config.id] + module_slots
        frame = panels[version.id]
        positions = [SimpleNamespace(slot_key=slot["connection_point_id"], panel_key=slot["panel_key"],
                                     position_x=slot["panel_local_position"]["x"],
                                     position_y=slot["panel_local_position"]["y"]) for slot in slots]
        geometry = derive_port_geometry(positions, frame)
        result[config.physical_object_id] = {
            "blueprint_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "BaseTemplate",
                              "entity_id": str(version.template_id)},
            "version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "BaseTemplateRevision",
                             "entity_id": str(version.id)},
            "body": {"kind": version.body_kind, "width": version.width, "height": version.height,
                     "fill_color": version.fill_color},
            "panels": [{key: getattr(panel, key) for key in (
                "panel_key", "panel_number", "face", "display_name", "x", "y", "width", "height",
            )} for panel in frame],
            "slots": [{**slot, **geometry[slot["connection_point_id"]]} for slot in slots],
            **({"module_sockets": sockets} if sockets else {}),
            **({"module_bodies": boards} if boards else {}),
        }
    return result
