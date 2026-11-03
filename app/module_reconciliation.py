"""Safe, per-installation application of the current immutable module revision.

No candidate or cached analysis authorizes a write. READ COMMITTED reads after
the locks below are the preflight; the caller owns one transaction per installation.
"""
import logging

from sqlalchemy import delete, or_, select, text
from sqlalchemy.exc import OperationalError
from app.object_reconciliation import _lock_json_references

from app import models as m
from app.base_template_review import endpoint_dependencies
from app.module_template_review import analyze_installation, published_definition
from app.device_catalog import DISPLAY_ALIAS_KEY
from app.errors import ModelError, ValidationError
from app.hardware_catalog import HardwareCatalog
from app.repository import CanonicalRepository

logger = logging.getLogger(__name__)


def _latest(session, template_id):
    return session.scalar(select(m.ModuleTemplateRevision).where(
        m.ModuleTemplateRevision.template_id == template_id
    ).order_by(m.ModuleTemplateRevision.version_number.desc()).limit(1))


class ModuleReconciliation:
    def __init__(self, session):
        self.session = session

    def apply(self, template_id, installation_id, target_revision_id):
        session = self.session
        template = session.scalar(select(m.ModuleTemplate).where(
            m.ModuleTemplate.id == template_id).with_for_update(read=True))
        if template is None:
            raise ValidationError("ModuleTemplate was not found")
        object_id = session.scalar(select(m.ObjectConfiguration.physical_object_id).join(
            m.ModuleInstallation, m.ModuleInstallation.configuration_id == m.ObjectConfiguration.id
        ).where(m.ModuleInstallation.id == installation_id))
        session.scalar(select(m.PhysicalObject).where(m.PhysicalObject.id == object_id).with_for_update())
        config = session.scalar(select(m.ObjectConfiguration).where(
            m.ObjectConfiguration.physical_object_id == object_id).with_for_update())
        installation = session.scalar(select(m.ModuleInstallation).where(
            m.ModuleInstallation.id == installation_id).with_for_update())
        if installation is None or config is None or installation.configuration_id != config.id:
            raise ModelError("Installation changed", {"reason": "INSTALLATION_CHANGED"})
        latest = _latest(session, template_id)
        if latest.id != target_revision_id:
            raise ModelError("Published revision changed; retry", {"reason": "TARGET_REVISION_CHANGED"})
        if session.get(m.ModuleTemplateRevision, installation.module_revision_id).template_id != template_id:
            raise ModelError("Installation changed", {"reason": "INSTALLATION_CHANGED"})
        result = {"installation_id": str(installation_id), "physical_object_id": str(object_id),
                  "source_revision_id": str(installation.module_revision_id), "target_revision_id": str(latest.id), "bay_key": installation.bay_key,
                  "display_name": session.scalar(select(m.EntityMetadata.value).where(
                      m.EntityMetadata.physical_object_id == object_id, m.EntityMetadata.key == DISPLAY_ALIAS_KEY))}
        if installation.module_revision_id == latest.id:
            return {**result, "status": "already_current", "reasons": []}
        mappings = list(session.scalars(select(m.ModuleEndpointMapping).where(
            m.ModuleEndpointMapping.installation_id == installation.id).order_by(m.ModuleEndpointMapping.id).with_for_update()))
        before = published_definition(session, template_id, installation.module_revision_id)
        after = published_definition(session, template_id, latest.id)
        old = {s["key"]: s for s in before["endpoints"]}
        new = {s["key"]: s for s in after["endpoints"]}
        definitions = {d.id: d.definition_key for d in session.scalars(select(m.ModuleEndpointDefinition).where(
            m.ModuleEndpointDefinition.module_revision_id == installation.module_revision_id))}
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
        analysis = analyze_installation(session, installation, after)
        if analysis["classification"] == "requires_intervention":
            return {**result, "status": "requires_intervention", "reasons": analysis["reasons"]}

        target_definitions = {d.definition_key: d for d in session.scalars(select(m.ModuleEndpointDefinition).where(
            m.ModuleEndpointDefinition.module_revision_id == latest.id))}
        for key in removed:
            self._remove_endpoint(by_key.pop(key))
        for key in sorted(new):
            if key in by_key:
                # Never infer alias provenance from equality to a definition name.
                # Retain mapping identity as well as every canonical/user row.
                by_key[key].definition_id = target_definitions[key].id
            else:
                by_key[key] = self._add_endpoint(config, installation, target_definitions[key])

        installation.module_revision_id = latest.id
        session.flush()
        return {**result, "status": "updated", "reasons": []}

    def _add_endpoint(self, config, installation, definition):
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
        mapping = m.ModuleEndpointMapping(installation_id=installation.id, definition_id=definition.id,
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


def reconcile_installations(session, template_id):
    """Independent commits: a busy/problematic installation cannot block its peers."""
    with session.begin():
        latest = _latest(session, template_id)
        if latest is None:
            raise ValidationError("ModuleTemplate was not found")
        target_id, version_number = latest.id, latest.version_number
        # One statement snapshot: deletion cannot split the ID list from its context.
        rows = session.execute(select(
            m.ModuleInstallation.id, m.ObjectConfiguration.physical_object_id,
            m.ModuleInstallation.module_revision_id, m.ModuleInstallation.bay_key,
            m.EntityMetadata.value,
        ).join(m.ModuleTemplateRevision,
               m.ModuleTemplateRevision.id == m.ModuleInstallation.module_revision_id
        ).join(m.ObjectConfiguration,
               m.ObjectConfiguration.id == m.ModuleInstallation.configuration_id
        ).outerjoin(m.EntityMetadata,
                    (m.EntityMetadata.physical_object_id == m.ObjectConfiguration.physical_object_id) &
                    (m.EntityMetadata.key == DISPLAY_ALIAS_KEY)
        ).where(m.ModuleTemplateRevision.template_id == template_id
        ).order_by(m.ModuleInstallation.id)).all()
        contexts = {row.id: {
            "physical_object_id": str(row.physical_object_id),
            "source_revision_id": str(row.module_revision_id),
            "bay_key": row.bay_key, "display_name": row.value,
        } for row in rows}
    results = []
    for installation_id in contexts:
        # SessionLocal deliberately retains objects after commits. A previous
        # transaction's identity map must never supply this installation's preflight.
        session.expunge_all()
        try:
            with session.begin():
                session.execute(text("SET LOCAL lock_timeout = '1500ms'"))
                result = ModuleReconciliation(session).apply(template_id, installation_id, target_id)
            results.append(result)  # Report success only AFTER a successful commit.
        except Exception as error:
            # The transaction context has rolled back every materialization row.
            # Unexpected failures are logged and isolated at this installation boundary.
            code = "APPLY_FAILED"
            if isinstance(error, (ModelError, ValidationError)):
                code = (error.details or {}).get("reason", "INSTALLATION_CHANGED")
            elif isinstance(error, OperationalError) and getattr(error.orig, "sqlstate", None) in ("40001", "40P01", "55P03"):
                code = "CONCURRENT_CHANGE"
            else:
                logger.exception("Module reconciliation failed for %s", installation_id)
            results.append({**contexts[installation_id], "context_at_batch_start": True, "installation_id": str(installation_id), "target_revision_id": str(target_id),
                            "status": "requires_intervention", "reasons": [{"code": code}]})
    return {"revision_id": str(target_id), "version_number": version_number, "installations": results}
