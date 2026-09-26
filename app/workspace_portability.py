"""Version 2 exchange contract for the current implicit workspace dataset.

The public names and fields below are deliberately fixed independently of table
names. A storage change must adapt this mapping or introduce a new format version.
"""

import json
import math
import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import delete, insert, select, text
from sqlalchemy.orm import Session
from sqlalchemy.sql.sqltypes import JSON

from app.database import Base
from app import models


FORMAT = "netmap-workspace"
FORMAT_VERSION = 2

# Section, public entity name, storage model, public attributes. The sections
# keep canonical facts distinct from authoring provenance and map presentation.
ENTITIES = (
    ("canonical", "Location", "Location", "id name type parent_location_id"),
    ("canonical", "PhysicalObject", "PhysicalObject", "id location_id"),
    ("canonical", "ConnectionPoint", "ConnectionPoint", "id physical_object_id cardinality"),
    ("canonical", "NetworkInterface", "NetworkInterface", "id"),
    ("canonical", "NetworkInterfacePhysicalOwner", "NetworkInterfacePhysicalOwner", "id interface_id physical_object_id"),
    ("canonical", "NetworkInterfaceRealization", "NetworkInterfaceRealization", "id upper_interface_id lower_interface_id"),
    ("canonical", "InterfacePhysicalBinding", "InterfacePhysicalBinding", "id interface_id point_id point_member"),
    ("canonical", "Connection", "Connection", "id point_a_id point_b_id cardinality"),
    ("canonical", "ConnectionMember", "ConnectionMember", "id connection_id index point_a_member point_b_member"),
    ("canonical", "Cable", "Cable", "id connection_id label"),
    ("canonical", "EntityMetadata", "EntityMetadata", "id physical_object_id network_interface_id connection_point_id key value"),
    ("canonical", "L2ForwardingContext", "L2ForwardingContext", "id"),
    ("canonical", "L2Binding", "L2Binding", "id interface_id forwarding_context_id"),
    ("canonical", "L2IngressRule", "L2IngressRule", "id binding_id exact_stack"),
    ("canonical", "L2EgressRule", "L2EgressRule", "id binding_id emit_stack"),
    ("canonical", "RoutingContext", "RoutingContext", "id"),
    ("canonical", "L3Binding", "L3Binding", "id interface_id routing_context_id"),
    ("canonical", "InterfaceAddress", "InterfaceAddress", "id l3_binding_id address prefix_length"),
    ("canonical", "RoutingTable", "RoutingTable", "id routing_context_id address_family configured_completeness"),
    ("canonical", "Route", "Route", "id routing_table_id destination_prefix disposition"),
    ("canonical", "RouteNextHop", "RouteNextHop", "id route_id gateway_address egress_l3_binding_id"),
    ("canonical", "RoutingPolicy", "RoutingPolicy", "id default_selection configured_completeness"),
    ("canonical", "RoutingPolicyRule", "RoutingPolicyRule", "id policy_id order_key predicate action"),
    ("canonical", "SecurityPolicy", "SecurityPolicy", "id default_action configured_completeness"),
    ("canonical", "SecurityRule", "SecurityRule", "id policy_id order_key predicate action"),
    ("canonical", "SecurityPolicyAttachment", "SecurityPolicyAttachment", "id policy_id stage_order scope"),
    ("canonical", "NATPolicy", "NATPolicy", "id default_transform configured_completeness"),
    ("canonical", "NATPool", "NATPool", "id address_ranges port_ranges"),
    ("canonical", "NATRule", "NATRule", "id policy_id order_key predicate transform"),
    ("canonical", "NATPolicyAttachment", "NATPolicyAttachment", "id policy_id local_stage_order scope"),
    ("canonical", "PacketProcessingPlan", "PacketProcessingPlan", "id configured_completeness"),
    ("canonical", "ProcessingStage", "ProcessingStage", "id plan_id kind payload"),
    ("canonical", "ProcessingTransition", "ProcessingTransition", "id plan_id from_stage_id outcome to_stage_id"),
    ("canonical", "ProcessingEntryPoint", "ProcessingEntryPoint", "id plan_id traffic_class stage_id"),
    ("canonical", "PacketProcessingPlanAttachmentSet", "PacketProcessingPlanAttachmentSet", "id routing_context_id traffic_class configured_completeness"),
    ("canonical", "PacketProcessingPlanAttachment", "PacketProcessingPlanAttachment", "id attachment_set_id plan_id scope"),
    ("authoring", "PortBlock", "PortBlock", "id name"),
    ("authoring", "PortBlockVersion", "PortBlockVersion", "id port_block_id version_number"),
    ("authoring", "PortBlockPort", "PortBlockPort", "id port_block_version_id local_id kind row layout_column layout_order"),
    ("authoring", "ObjectBlueprint", "ObjectBlueprint", "id name"),
    ("authoring", "ObjectBlueprintVersion", "ObjectBlueprintVersion", "id blueprint_id version_number default_physical_object_class body_kind width height fill_color authoring_recipe composition_kind"),
    ("authoring", "BlueprintPortBlockInstance", "BlueprintPortBlockInstance", "id blueprint_version_id port_block_version_id instance_key naming_prefix naming_starting_number naming_mode naming_overrides face placement_x placement_y placement_width placement_height"),
    ("authoring", "BlueprintEndpointSlot", "BlueprintEndpointSlot", "id blueprint_version_id slot_key display_name kind port_block_instance_id port_block_local_id"),
    ("authoring", "BlueprintInternalLink", "BlueprintInternalLink", "id blueprint_version_id slot_a_id slot_b_id"),
    ("authoring", "BlueprintInstance", "BlueprintInstance", "id blueprint_version_id physical_object_id"),
    ("authoring", "BlueprintInstanceSlot", "BlueprintInstanceSlot", "id blueprint_instance_id blueprint_slot_id connection_point_id network_interface_id"),
    ("presentation", "SavedMap", "SavedMap", "id name created_at updated_at"),
    ("presentation", "MapPresentationVariant", "MapPresentationVariant", "id map_id name"),
    ("presentation", "MapPlacement", "MapPlacement", "id map_id physical_object_id"),
    ("presentation", "MapViewPosition", "MapViewPosition", "id placement_id variant_id view_key x y locked display_width"),
    ("presentation", "MapLocationState", "MapLocationState", "id variant_id location_id collapsed visible_direct_elements"),
    ("presentation", "MapCableRoute", "MapCableRoute", "id map_id variant_id cable_id view_key waypoints"),
    ("presentation", "MapTextAnnotation", "MapTextAnnotation", "id map_id text position text_color font_size"),
    ("settings", "CableLabelSettings", "CableLabelSettings", "id unique_labels"),
    ("settings", "CableLabelTemplate", "CableLabelTemplate", "id name description pattern start_at"),
    ("settings", "CableLabelHistory", "CableLabelHistory", "id label cable_id assigned_at released_at"),
)


class PackageError(ValueError):
    pass


def _specs():
    specs = [(section, name, getattr(models, model_name), fields.split()) for section, name, model_name, fields in ENTITIES]
    actual = set(Base.metadata.tables)
    covered = {model.__table__.name for _, _, model, _ in specs}
    if covered != actual:
        raise RuntimeError(f"Portability contract does not cover current persisted state: {actual ^ covered}")
    for _, name, model, fields in specs:
        if set(fields) != {column.key for column in model.__table__.columns}:
            raise RuntimeError(f"Portability fields differ from persisted {name} state")
    return specs


def _json_value(value):
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (uuid.UUID, datetime)):
        return str(value) if isinstance(value, uuid.UUID) else value.isoformat()
    return value


def export_package(session: Session) -> dict:
    package = {"format": FORMAT, "format_version": FORMAT_VERSION,
               "canonical": {}, "authoring": {}, "presentation": {}, "settings": {}}
    for section, name, model, fields in _specs():
        rows = session.scalars(select(model).order_by(model.id)).all()
        package[section][name] = [
            {field: _json_value(getattr(row, field)) for field in fields} for row in rows
        ]
    return package


def _decode(value, column, label):
    if value is None:
        if not column.nullable:
            raise PackageError(f"{label} cannot be null")
        return None
    column_type = column.type
    if isinstance(column_type, JSON):
        try:
            json.dumps(value, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise PackageError(f"{label} is not JSON") from exc
        return value
    enum_class = getattr(column_type, "enum_class", None)
    if enum_class:
        try:
            return enum_class(value)
        except (ValueError, TypeError) as exc:
            raise PackageError(f"{label} has an invalid value") from exc
    python_type = column_type.python_type
    try:
        if python_type is uuid.UUID and isinstance(value, str):
            return uuid.UUID(value)
        if python_type is datetime and isinstance(value, str):
            return datetime.fromisoformat(value)
    except ValueError as exc:
        raise PackageError(f"{label} has an invalid value") from exc
    if python_type is float and type(value) in (int, float):
        if not math.isfinite(value):
            raise PackageError(f"{label} must be finite")
        return float(value)
    if type(value) is not python_type:
        raise PackageError(f"{label} has an invalid type")
    return value


def validate_package(package: object) -> dict:
    if not isinstance(package, dict) or package.get("format") != FORMAT:
        raise PackageError("Not a NetMap workspace package")
    if type(package.get("format_version")) is not int or package["format_version"] != FORMAT_VERSION:
        raise PackageError("Unsupported NetMap workspace format_version")
    if set(package) != {"format", "format_version", "canonical", "authoring", "presentation", "settings"}:
        raise PackageError("Incomplete or unknown package sections")
    specs = _specs()
    result = {}
    for section in ("canonical", "authoring", "presentation", "settings"):
        expected = {name for part, name, _, _ in specs if part == section}
        if not isinstance(package[section], dict) or set(package[section]) != expected:
            raise PackageError(f"Incomplete {section} section")
    for section, name, model, fields in specs:
        records = package[section][name]
        if not isinstance(records, list):
            raise PackageError(f"{name} must be a list")
        columns = {column.key: column for column in model.__table__.columns}
        parsed = []
        ids = set()
        for record in records:
            if not isinstance(record, dict) or set(record) != set(fields):
                raise PackageError(f"{name} has incomplete or unknown fields")
            row = {field: _decode(record[field], columns[field], f"{name}.{field}") for field in fields}
            if row["id"] in ids:
                raise PackageError(f"Duplicate {name} ID")
            ids.add(row["id"])
            parsed.append(row)
        result[model.__table__.name] = parsed
    singleton = result["cable_label_settings"]
    if len(singleton) != 1 or singleton[0]["id"] != 1:
        raise PackageError("CableLabelSettings singleton is missing")
    # Check all references before issuing a single write. FK constraints remain
    # the final authority and the transaction rolls back on any violation.
    ids_by_table = {table: {row["id"] for row in rows} for table, rows in result.items()}
    for _, name, model, _ in specs:
        for row in result[model.__table__.name]:
            for column in model.__table__.columns:
                for fk in column.foreign_keys:
                    if row[column.key] is not None and row[column.key] not in ids_by_table[fk.column.table.name]:
                        raise PackageError(f"{name}.{column.key} refers to a missing entity")
    locations = {row["id"]: row["parent_location_id"] for row in result["locations"]}
    for location_id in locations:
        seen = set()
        current = location_id
        while current is not None:
            if current in seen:
                raise PackageError("Location hierarchy contains a cycle")
            seen.add(current)
            current = locations[current]
    return result


def _tables_in_dependency_order():
    # SQLAlchemy's topological sort is checked against the explicit contract.
    _specs()
    return Base.metadata.sorted_tables


def is_empty(session: Session) -> bool:
    settings = session.scalars(select(models.CableLabelSettings)).all()
    if settings and (len(settings) != 1 or settings[0].id != 1 or settings[0].unique_labels):
        return False
    return all(
        session.scalar(select(table.c.id).limit(1)) is None
        for table in _tables_in_dependency_order() if table.name != "cable_label_settings"
    )


def _lock_dataset(session: Session) -> None:
    # Prevent a concurrent writer/import from passing the empty check or
    # inserting a dependent row while this dataset is replaced.
    preparer = session.bind.dialect.identifier_preparer
    names = ", ".join(preparer.format_table(table) for table in _tables_in_dependency_order())
    session.execute(text(f"LOCK TABLE {names} IN ACCESS EXCLUSIVE MODE"))


def reset_dataset(session: Session) -> None:
    _lock_dataset(session)
    for table in reversed(_tables_in_dependency_order()):
        session.execute(delete(table))
    # The migration-established singleton is part of a fresh empty database.
    session.execute(insert(models.CableLabelSettings), {"id": 1, "unique_labels": False})


def import_package(session: Session, package: object) -> None:
    rows_by_table = validate_package(package)
    _lock_dataset(session)
    if not is_empty(session):
        raise PackageError("Import requires a completely empty dataset")
    session.execute(delete(models.CableLabelSettings))
    for table in _tables_in_dependency_order():
        rows = rows_by_table[table.name]
        if table.name == "locations":
            # Self-referential parent FK requires ancestors first.
            pending = {row["id"]: row for row in rows}
            done = set()
            while pending:
                ready = [row for row in pending.values() if row["parent_location_id"] is None or row["parent_location_id"] in done]
                if not ready:
                    raise PackageError("Location hierarchy contains a cycle")
                for row in sorted(ready, key=lambda item: str(item["id"])):
                    session.execute(insert(table), [row])
                    done.add(row["id"])
                    del pending[row["id"]]
        elif rows:
            session.execute(insert(table), rows)
