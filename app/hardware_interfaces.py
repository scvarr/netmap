"""Stable declarations and the canonical interfaces they materialize."""
import uuid

from sqlalchemy import select

from app.models import HardwareInterfaceAssociation
from app.module_port_types import mount_identity


def declared_interfaces(places, *, place_key):
    return {place[place_key]: uuid.UUID(str(place["hardware_interface_key"]))
            for place in places if place.get("hardware_interface_key") is not None}


def associations(session, configuration_id, parent_installation_id):
    return list(session.scalars(select(HardwareInterfaceAssociation).where(
        HardwareInterfaceAssociation.configuration_id == configuration_id,
        HardwareInterfaceAssociation.parent_installation_id == parent_installation_id,
    )))


def preserves_associations(session, config_id, parent_id, before, after, *, place_key):
    expected = declared_interfaces(before, place_key=place_key)
    if expected != declared_interfaces(after, place_key=place_key):
        return False
    if ({p[place_key]: mount_identity(p) for p in before if p[place_key] in expected}
            != {p[place_key]: mount_identity(p) for p in after if p[place_key] in expected}):
        return False
    return expected == {row.bay_key: row.hardware_interface_key
                        for row in associations(session, config_id, parent_id)}
