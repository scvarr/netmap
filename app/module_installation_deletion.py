"""Explicit materialized installation boundary; every other dependency blocks."""
import uuid
from collections import Counter

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.orm import Session

from app.device_catalog import DISPLAY_ALIAS_KEY
from app.errors import ModelError, ValidationError
from app.models import (
    BuiltInEndpointMapping, Connection, ConnectionPoint, EntityMetadata,
    InterfacePhysicalBinding, L2Binding, L3Binding, ModuleEndpointDefinition,
    ModuleEndpointMapping, ModuleInstallation, NATPolicyAttachment, NetworkInterface,
    NetworkInterfacePhysicalOwner, NetworkInterfaceRealization, ObjectConfiguration,
    PacketProcessingPlanAttachment, PhysicalObject, RoutingPolicyRule, SecurityPolicyAttachment,
)


class ModuleInstallationDeletionCatalog:
    def __init__(self, session: Session):
        self.session = session

    def delete(self, object_id: uuid.UUID, installation_id: uuid.UUID) -> None:
        # Same lock order as install_module: object, configuration, installation.
        object_ = self.session.scalar(select(PhysicalObject).where(PhysicalObject.id == object_id).with_for_update())
        if object_ is None:
            raise ValidationError("PhysicalObject was not found")
        config = self.session.scalar(select(ObjectConfiguration).where(ObjectConfiguration.physical_object_id == object_id).with_for_update())
        if config is None:
            raise ValidationError("Object has no base template configuration")
        installation = self.session.scalar(select(ModuleInstallation).where(
            ModuleInstallation.id == installation_id, ModuleInstallation.configuration_id == config.id,
        ).with_for_update())
        if installation is None:
            raise ValidationError("ModuleInstallation does not belong to this object's configuration", {"installation_id": str(installation_id)})
        mappings = tuple(self.session.scalars(select(ModuleEndpointMapping).where(
            ModuleEndpointMapping.installation_id == installation_id,
        ).order_by(ModuleEndpointMapping.id).with_for_update()))
        point_ids = tuple(sorted({m.connection_point_id for m in mappings}, key=str))
        interface_ids = tuple(sorted({m.network_interface_id for m in mappings if m.network_interface_id}, key=str))
        if interface_ids:
            # JSON references have no FK/key-share locks. Block scope/predicate writes
            # (including new rows) until this transaction completes its preflight/delete.
            self.session.execute(text("LOCK TABLE security_policy_attachments, nat_policy_attachments, packet_processing_plan_attachments, routing_policy_rules IN SHARE MODE"))
        # FK insertions acquire key-share locks on endpoints. Holding UPDATE locks
        # through preflight/deletion prevents a concurrent dependent row appearing.
        points = tuple(self.session.scalars(select(ConnectionPoint).where(ConnectionPoint.id.in_(point_ids)).order_by(ConnectionPoint.id).with_for_update()))
        tuple(self.session.scalars(select(NetworkInterface.id).where(NetworkInterface.id.in_(interface_ids)).order_by(NetworkInterface.id).with_for_update()))
        blockers = self._blockers(object_id, installation, mappings, points, point_ids, interface_ids)
        if blockers:
            raise ModelError("ModuleInstallation cannot be removed because its endpoints are in use", {
                "reason": "MODULE_INSTALLATION_IN_USE", "installation_id": str(installation_id),
                "blockers": blockers,
            })
        # All DELETEs are after the complete preflight, in RESTRICT FK order.
        self.session.execute(delete(ModuleEndpointMapping).where(ModuleEndpointMapping.installation_id == installation_id))
        self.session.execute(delete(InterfacePhysicalBinding).where(or_(InterfacePhysicalBinding.point_id.in_(point_ids), InterfacePhysicalBinding.interface_id.in_(interface_ids))))
        self.session.execute(delete(NetworkInterfacePhysicalOwner).where(NetworkInterfacePhysicalOwner.interface_id.in_(interface_ids)))
        self.session.execute(delete(EntityMetadata).where(or_(EntityMetadata.connection_point_id.in_(point_ids), EntityMetadata.network_interface_id.in_(interface_ids))))
        self.session.execute(delete(NetworkInterface).where(NetworkInterface.id.in_(interface_ids)))
        self.session.execute(delete(ConnectionPoint).where(ConnectionPoint.id.in_(point_ids)))
        self.session.delete(installation)
        self.session.flush()

    def _blockers(self, object_id, installation, mappings, points, point_ids, interface_ids):
        blockers = Counter()
        queries = {
            "CONNECTION": (Connection, or_(Connection.point_a_id.in_(point_ids), Connection.point_b_id.in_(point_ids))),
            "L2_BINDING": (L2Binding, L2Binding.interface_id.in_(interface_ids)),
            "L3_BINDING": (L3Binding, L3Binding.interface_id.in_(interface_ids)),
            "NETWORK_INTERFACE_REALIZATION": (NetworkInterfaceRealization, or_(NetworkInterfaceRealization.upper_interface_id.in_(interface_ids), NetworkInterfaceRealization.lower_interface_id.in_(interface_ids))),
            "BUILT_IN_ENDPOINT_MAPPING": (BuiltInEndpointMapping, or_(BuiltInEndpointMapping.connection_point_id.in_(point_ids), BuiltInEndpointMapping.network_interface_id.in_(interface_ids))),
            "OTHER_MODULE_ENDPOINT_MAPPING": (ModuleEndpointMapping, (ModuleEndpointMapping.installation_id != installation.id) & or_(ModuleEndpointMapping.connection_point_id.in_(point_ids), ModuleEndpointMapping.network_interface_id.in_(interface_ids))),
            "NETWORK_INTERFACE_PHYSICAL_OWNER": (NetworkInterfacePhysicalOwner, NetworkInterfacePhysicalOwner.interface_id.in_(interface_ids) & (NetworkInterfacePhysicalOwner.physical_object_id != object_id)),
            "ENDPOINT_METADATA": (EntityMetadata, or_(EntityMetadata.connection_point_id.in_(point_ids), EntityMetadata.network_interface_id.in_(interface_ids)) & (EntityMetadata.key != DISPLAY_ALIAS_KEY)),
        }
        for reason, (model, condition) in queries.items():
            count = self.session.scalar(select(func.count()).select_from(model).where(condition))
            if count:
                blockers[reason] += count
        for point in points:
            if point.physical_object_id != object_id:
                blockers["CONNECTION_POINT_OWNER"] += 1
        definitions = {d.id: d for d in self.session.scalars(select(ModuleEndpointDefinition).where(ModuleEndpointDefinition.id.in_([m.definition_id for m in mappings])))}
        for mapping in mappings:
            definition = definitions[mapping.definition_id]
            if definition.module_revision_id != installation.module_revision_id or (definition.kind == "NETWORK_PORT") != (mapping.network_interface_id is not None):
                blockers["INVALID_ENDPOINT_MAPPING"] += 1
        expected = {(m.network_interface_id, m.connection_point_id, 1) for m in mappings if m.network_interface_id}
        for binding in self.session.scalars(select(InterfacePhysicalBinding).where(or_(InterfacePhysicalBinding.point_id.in_(point_ids), InterfacePhysicalBinding.interface_id.in_(interface_ids)))):
            if (binding.interface_id, binding.point_id, binding.point_member) not in expected:
                blockers["INTERFACE_PHYSICAL_BINDING"] += 1
        # These supported configuration references live in JSON, without FK protection.
        # Their tables remain SHARE-locked through the transaction.
        ids = {str(value) for value in interface_ids}
        if ids:
            for model, reason in ((SecurityPolicyAttachment, "SECURITY_POLICY_ATTACHMENT"), (NATPolicyAttachment, "NAT_POLICY_ATTACHMENT"), (PacketProcessingPlanAttachment, "PROCESSING_PLAN_ATTACHMENT")):
                for row in self.session.scalars(select(model)):
                    if any(ids.intersection(row.scope.get(key, [])) for key in ("ingress_network_interface_ids", "egress_network_interface_ids")):
                        blockers[reason] += 1
            for rule in self.session.scalars(select(RoutingPolicyRule)):
                if _predicate_uses_interfaces(rule.predicate, ids):
                    blockers["ROUTING_POLICY_RULE"] += 1
        return dict(sorted(blockers.items()))


def _predicate_uses_interfaces(predicate, ids):
    if predicate.get("op") == "INGRESS_NETWORK_INTERFACE_IN":
        return bool(ids.intersection(predicate.get("ids", [])))
    if predicate.get("op") in {"ALL", "ANY"}:
        return any(_predicate_uses_interfaces(child, ids) for child in predicate.get("children", []))
    if predicate.get("op") == "NOT":
        return _predicate_uses_interfaces(predicate["child"], ids)
    return False
