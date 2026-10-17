"""Safe, per-object application of the current immutable base revision.

No candidate or cached analysis authorizes a write. READ COMMITTED reads after
the locks below are the preflight; the caller owns one transaction per object.
"""
import logging
import uuid

from sqlalchemy import delete, or_, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.sql.sqltypes import JSON

from app import models as m
from app.base_template_review import analyze_object, endpoint_dependencies, published_definition
from app.device_catalog import DISPLAY_ALIAS_KEY
from app.errors import ModelError, ValidationError
from app.hardware_catalog import HardwareCatalog
from app.repository import CanonicalRepository, ConnectionMemberInput

logger = logging.getLogger(__name__)


def _latest(session, template_id):
    return session.scalar(select(m.BaseTemplateRevision).where(
        m.BaseTemplateRevision.template_id == template_id
    ).order_by(m.BaseTemplateRevision.version_number.desc()).limit(1))


def _lock_json_references(session):
    # JSON cannot take endpoint FK locks. Only deletion needs these table locks;
    # cover every canonical JSON field (including unknown future references),
    # in the same dependency order as workspace exchange/publication.
    from app.workspace_portability import _specs, _tables_in_dependency_order
    tables = {model.__tablename__ for section, _, model, _ in _specs()
              if section == "canonical" and any(isinstance(c.type, JSON) for c in model.__table__.columns)}
    preparer = session.bind.dialect.identifier_preparer
    names = ", ".join(preparer.format_table(t) for t in _tables_in_dependency_order() if t.name in tables)
    if names:
        session.execute(text(f"LOCK TABLE {names} IN SHARE MODE"))


class ObjectReconciliation:
    def __init__(self, session):
        self.session = session

    def apply(self, template_id, object_id, target_revision_id):
        session = self.session
        # Same object/configuration/installation order as install and uninstall.
        # SHARE on this root also serializes current-revision selection with D1.
        template = session.scalar(select(m.BaseTemplate).where(
            m.BaseTemplate.id == template_id).with_for_update(read=True))
        if template is None:
            raise ValidationError("BaseTemplate was not found")
        object_ = session.scalar(select(m.PhysicalObject).where(
            m.PhysicalObject.id == object_id).with_for_update())
        if object_ is None:
            raise ModelError("PhysicalObject no longer exists", {"reason": "OBJECT_CHANGED"})
        config = session.scalar(select(m.ObjectConfiguration).where(
            m.ObjectConfiguration.physical_object_id == object_id).with_for_update())
        latest = _latest(session, template_id)
        if config is None or session.get(m.BaseTemplateRevision, config.base_revision_id).template_id != template_id:
            raise ModelError("Object configuration changed", {"reason": "OBJECT_CHANGED"})
        if latest.id != target_revision_id:
            raise ModelError("Published revision changed; retry", {"reason": "TARGET_REVISION_CHANGED"})
        label = session.scalar(select(m.EntityMetadata.value).where(
            m.EntityMetadata.physical_object_id == object_id, m.EntityMetadata.key == DISPLAY_ALIAS_KEY))
        result = {"physical_object_id": str(object_id), "display_name": label or str(object_id),
                  "source_revision_id": str(config.base_revision_id), "target_revision_id": str(latest.id)}
        if config.base_revision_id == latest.id:
            return {**result, "status": "already_current", "reasons": []}

        installations = list(session.scalars(select(m.ModuleInstallation).where(
            m.ModuleInstallation.configuration_id == config.id).order_by(m.ModuleInstallation.id).with_for_update()))
        mappings = list(session.scalars(select(m.BuiltInEndpointMapping).where(
            m.BuiltInEndpointMapping.configuration_id == config.id).order_by(m.BuiltInEndpointMapping.id).with_for_update()))
        before = published_definition(session, template_id, config.base_revision_id)
        after = published_definition(session, template_id, latest.id)
        old = {s["key"]: s for s in before["slots"]}
        new = {s["key"]: s for s in after["slots"]}
        definitions = {d.id: d.slot_key for d in session.scalars(select(m.BuiltInEndpointDefinition).where(
            m.BuiltInEndpointDefinition.base_revision_id == config.base_revision_id))}
        by_key = {definitions[e.definition_id]: e for e in mappings if e.definition_id in definitions}
        removed = sorted(old.keys() - new.keys())
        if removed:
            _lock_json_references(session)
        # Endpoint UPDATE locks block new FK dependents, including raw repository
        # writes. Interface-before-point matches physical connection creation.
        list(session.scalars(select(m.NetworkInterface).where(m.NetworkInterface.id.in_(
            [e.network_interface_id for e in mappings if e.network_interface_id]
        )).order_by(m.NetworkInterface.id).with_for_update()))
        list(session.scalars(select(m.ConnectionPoint).where(m.ConnectionPoint.id.in_(
            [e.connection_point_id for e in mappings]
        )).order_by(m.ConnectionPoint.id).with_for_update()))
        # Retained NETWORK_PORT tuples must stay valid through the revision write.
        # Endpoint FK locks protect absent rows/new references, but an existing
        # owner/binding can be deleted or edited without changing its endpoint FK.
        retained_interfaces = [e.network_interface_id for key, e in by_key.items()
                               if key in new and old[key]["kind"] == "NETWORK_PORT" and e.network_interface_id]
        if retained_interfaces:
            list(session.scalars(select(m.NetworkInterfacePhysicalOwner.id).where(
                m.NetworkInterfacePhysicalOwner.interface_id.in_(retained_interfaces)
            ).order_by(m.NetworkInterfacePhysicalOwner.id).with_for_update(read=True)))
            list(session.scalars(select(m.InterfacePhysicalBinding.id).where(
                m.InterfacePhysicalBinding.interface_id.in_(retained_interfaces)
            ).order_by(m.InterfacePhysicalBinding.id).with_for_update(read=True)))
        # FK locks alone do not serialize an existing alias/binding/owner UPDATE
        # that leaves its FK unchanged. Lock all current direct dependency rows
        # before the fresh analysis, not just endpoints or rows to be deleted.
        for key in removed:
            if key in by_key:
                endpoint_dependencies(session, config, by_key[key], old[key], lock_rows=True)
        analysis = analyze_object(session, config, after)
        if analysis["classification"] == "requires_intervention":
            return {**result, "status": "requires_intervention", "reasons": analysis["reasons"]}

        target_definitions = {d.slot_key: d for d in session.scalars(select(m.BuiltInEndpointDefinition).where(
            m.BuiltInEndpointDefinition.base_revision_id == latest.id))}
        for key in removed:
            self._remove_endpoint(by_key.pop(key))
        for key in sorted(new):
            if key in by_key:
                # Never infer alias provenance from equality to a definition name.
                # Retain mapping identity as well as every canonical/user row.
                by_key[key].definition_id = target_definitions[key].id
            else:
                by_key[key] = self._add_endpoint(config, target_definitions[key])

        moving = [i for i in installations if i.bay_key != analysis["proposed_placements"][str(i.id)]]
        # Immediate unique(configuration,bay) also applies during swaps. Private
        # temporary keys exist only inside this transaction, never in a result.
        occupied = {i.bay_key for i in installations} | {b["bay_key"] for b in after["bays"]}
        for installation in moving:
            temporary = str(uuid.uuid4())
            while temporary in occupied:
                temporary = str(uuid.uuid4())
            occupied.add(temporary)
            installation.bay_key = temporary
        session.flush()
        for installation in moving:
            installation.bay_key = analysis["proposed_placements"][str(installation.id)]
        # Without canonical provenance, existing Connections are never removed.
        # Analysis allows new links only at unoccupied cardinality=1 points.
        repository = CanonicalRepository(session)
        for change in analysis["changes"]:
            if change["section"] == "internal_links" and change["operation"] == "added":
                left, right = change["key"]
                repository.add_connection(by_key[left].connection_point_id, by_key[right].connection_point_id, 1,
                                          [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
        config.base_revision_id = latest.id
        session.flush()
        return {**result, "status": "updated", "reasons": []}

    def _add_endpoint(self, config, definition):
        session = self.session
        repository = CanonicalRepository(session)
        catalog = HardwareCatalog(session)
        point = repository.add_connection_point(config.physical_object_id, cardinality=1)
        catalog._metadata(connection_point_id=point.id, key=DISPLAY_ALIAS_KEY, value=definition.display_name)
        interface_id = None
        if definition.kind == "NETWORK_PORT":
            interface = repository.add_network_interface()
            repository.add_network_interface_physical_owner(interface.id, config.physical_object_id)
            repository.add_interface_physical_binding(interface.id, point.id, point_member=1)
            catalog._metadata(network_interface_id=interface.id, key=DISPLAY_ALIAS_KEY, value=definition.display_name)
            interface_id = interface.id
        mapping = m.BuiltInEndpointMapping(configuration_id=config.id, definition_id=definition.id,
                                        connection_point_id=point.id, network_interface_id=interface_id)
        session.add(mapping)
        session.flush()
        return mapping

    def _remove_endpoint(self, mapping):
        session = self.session
        point_id, interface_id = mapping.connection_point_id, mapping.network_interface_id
        session.delete(mapping)
        session.flush()
        # Preflight proved these are only expected materialization rows.
        session.execute(delete(m.InterfacePhysicalBinding).where(m.InterfacePhysicalBinding.point_id == point_id))
        if interface_id:
            session.execute(delete(m.NetworkInterfacePhysicalOwner).where(m.NetworkInterfacePhysicalOwner.interface_id == interface_id))
        session.execute(delete(m.EntityMetadata).where(or_(
            m.EntityMetadata.connection_point_id == point_id,
            m.EntityMetadata.network_interface_id == interface_id if interface_id else False)))
        if interface_id:
            session.execute(delete(m.NetworkInterface).where(m.NetworkInterface.id == interface_id))
        session.execute(delete(m.ConnectionPoint).where(m.ConnectionPoint.id == point_id))


def reconcile_objects(session, template_id):
    """Independent commits: a busy/problematic object cannot block its peers."""
    with session.begin():
        latest = _latest(session, template_id)
        if latest is None:
            raise ValidationError("BaseTemplate was not found")
        target_id, version_number = latest.id, latest.version_number
        object_ids = list(session.scalars(select(m.ObjectConfiguration.physical_object_id).join(
            m.BaseTemplateRevision, m.BaseTemplateRevision.id == m.ObjectConfiguration.base_revision_id
        ).where(m.BaseTemplateRevision.template_id == template_id).order_by(m.ObjectConfiguration.physical_object_id)))
    results = []
    for object_id in object_ids:
        # SessionLocal deliberately retains objects after commits. A previous
        # transaction's identity map must never supply this object's preflight.
        session.expunge_all()
        try:
            with session.begin():
                session.execute(text("SET LOCAL lock_timeout = '1500ms'"))
                result = ObjectReconciliation(session).apply(template_id, object_id, target_id)
            results.append(result)  # Report success only AFTER a successful commit.
        except Exception as error:
            # The transaction context has rolled back every materialization row.
            # Unexpected failures are logged and isolated at this object boundary.
            code = "APPLY_FAILED"
            if isinstance(error, (ModelError, ValidationError)):
                code = (error.details or {}).get("reason", "OBJECT_CHANGED")
            elif isinstance(error, OperationalError) and getattr(error.orig, "sqlstate", None) in ("40001", "40P01", "55P03"):
                code = "CONCURRENT_CHANGE"
            else:
                logger.exception("Object reconciliation failed for %s", object_id)
            results.append({"physical_object_id": str(object_id), "target_revision_id": str(target_id),
                            "status": "requires_intervention", "reasons": [{"code": code}]})
    return {"revision_id": str(target_id), "version_number": version_number, "objects": results}
