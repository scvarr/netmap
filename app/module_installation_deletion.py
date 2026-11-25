"""Explicit materialized installation boundary; every other dependency blocks."""
import uuid
from collections import Counter

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.orm import Session

from app.device_catalog import DISPLAY_ALIAS_KEY
from app.errors import ModelError, ValidationError
from app.hardware_catalog import HardwareCatalog
from app.hardware_interfaces import associations, declared_interfaces
from app.module_port_types import mount_identity, row_mount
from app.models import (
    BuiltInEndpointMapping, Cable, Connection, ConnectionMember, ConnectionPoint, EntityMetadata, HardwareInterfaceAssociation,
    InterfacePhysicalBinding, L2Binding, L3Binding, ModuleBay, ModuleEndpointDefinition,
    ModuleEndpointMapping, ModuleInstallation, ModuleTemplate, ModuleTemplateRevision, NATPolicyAttachment, NetworkInterface,
    NetworkInterfacePhysicalOwner, NetworkInterfaceRealization, ObjectConfiguration,
    PacketProcessingPlanAttachment, PhysicalObject, PortType, RoutingPolicyRule, SecurityPolicyAttachment,
)
from app.port_types import supports_transceiver_termination
from app.physical_compatibility import verify_compatibility
from app.physical_connections import PhysicalConnectionCatalog
from app.physical_object_details_resolver import cable_endpoint_addresses
from app.schemas import InstallModuleRequest


class ModuleInstallationDeletionCatalog:
    def __init__(self, session: Session):
        self.session = session

    def _lock_installation(self, object_id, installation_id, *, replacing=False):
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
            if replacing:
                self._replacement_stale("INSTALLATION_CHANGED")
            raise ValidationError("ModuleInstallation does not belong to this object's configuration", {"installation_id": str(installation_id)})
        return config, installation

    def _locked_mappings(self, installation_id):
        if self.session.scalar(select(ModuleInstallation.id).where(
            ModuleInstallation.parent_installation_id == installation_id,
        ).limit(1)) is not None:
            raise ModelError("Сначала удалите дочерние установки",
                             {"reason": "MODULE_INSTALLATION_HAS_CHILDREN", "installation_id": str(installation_id)})
        return tuple(self.session.scalars(select(ModuleEndpointMapping).where(
            ModuleEndpointMapping.installation_id == installation_id,
        ).order_by(ModuleEndpointMapping.id).with_for_update()))

    @staticmethod
    def _replacement_stale(reason):
        raise ModelError("Конфигурация или опубликованная ревизия изменилась. Обновите данные и повторите выбор.",
                         {"reason": reason})

    def replace_transceiver(self, object_id, installation_id, query, *, preview=False):
        # Publication takes SHARE ROW EXCLUSIVE even when the template name
        # stays the same. Reconcile locks the target template before the object.
        self.session.execute(text("LOCK TABLE module_template_revisions IN ROW EXCLUSIVE MODE"))
        template = self.session.scalar(select(ModuleTemplate.id).where(
            ModuleTemplate.id == query.module_template_id).with_for_update(read=True))
        if template is None:
            self._replacement_stale("TARGET_REVISION_CHANGED")
        config, installation = self._lock_installation(object_id, installation_id, replacing=True)
        parent = self.session.get(ModuleInstallation, installation.parent_installation_id) if installation.parent_installation_id else None
        if (config.id != query.configuration_id or config.base_revision_id != query.base_revision_id
                or installation.module_revision_id != query.source_revision_id
                or installation.parent_installation_id != query.parent_installation_id
                or installation.bay_key != query.bay_key
                or (parent.module_revision_id if parent else None) != query.parent_revision_id):
            self._replacement_stale("INSTALLATION_CHANGED")

        target = self.session.scalar(select(ModuleTemplateRevision).where(
            ModuleTemplateRevision.template_id == template,
        ).order_by(ModuleTemplateRevision.version_number.desc()).limit(1))
        if target is None or target.id != query.target_revision_id:
            self._replacement_stale("TARGET_REVISION_CHANGED")
        revision = self.session.get(ModuleTemplateRevision, installation.module_revision_id)
        catalog = HardwareCatalog(self.session)
        orientation = installation.orientation
        point, moves, cables = self._remove_transceiver(
            object_id, config, installation, revision, self._locked_mappings(installation_id),
            associations(self.session, config.id, installation.id), replacement=query,
        )
        if preview and not moves:
            raise ValidationError("Replacement preview requires connected Cable assignments")
        if point is not None:
            # Lock the published target type before materializing its cardinality.
            list(self.session.scalars(select(PortType.id).join(ModuleEndpointDefinition,
                ModuleEndpointDefinition.port_type_id == PortType.id).where(
                ModuleEndpointDefinition.module_revision_id == target.id,
            ).order_by(PortType.id).with_for_update(read=True, nowait=True, of=PortType)))
            catalog.install_in_locked_configuration(config, InstallModuleRequest(
                module_template_id=template, bay_key=query.bay_key,
                parent_installation_id=query.parent_installation_id, orientation=orientation,
            ), transceiver_revision=target)
            if moves:
                new_point = self.session.scalar(select(ConnectionPoint).join(
                    InterfacePhysicalBinding, InterfacePhysicalBinding.point_id == ConnectionPoint.id,
                ).where(InterfacePhysicalBinding.interface_id == query.interface_id,
                        InterfacePhysicalBinding.point_member == 1))
                pairs = []
                state = []
                for snapshot, connection, member, remote, local_is_a, index in moves:
                    if index > new_point.cardinality:
                        raise ValidationError("Select a member within the new ConnectionPoint cardinality")
                    pairs.append((new_point, remote) if local_is_a else (remote, new_point))
                    state.append((snapshot.expected.model_dump(mode="json"), index))
                expectation = query.model_dump(mode="json", exclude={"compatibility", "cable_assignments"})
                result = verify_compatibility(
                    self.session, pairs, intent=["transceiver-replacement", object_id, installation_id,
                        expectation, orientation, revision.transceiver, target.transceiver,
                        sorted((str(item.cable_id), item.member_index) for item in query.cable_assignments), state],
                    preview=preview, confirmation=query.compatibility, require_preview=True,
                    replacement_point_id=new_point.id,
                )
                if preview:
                    return {"compatibility": result, "cables": cables}
                for _, connection, member, _, local_is_a, index in moves:
                    if local_is_a:
                        connection.point_a_id = new_point.id
                        member.point_a_member = index
                    else:
                        connection.point_b_id = new_point.id
                        member.point_b_member = index
                    self.session.flush()
            self.session.delete(point)
            self.session.flush()
        return catalog.configuration_document(object_id)

    def delete(self, object_id: uuid.UUID, installation_id: uuid.UUID) -> None:
        config, installation = self._lock_installation(object_id, installation_id)
        mappings = self._locked_mappings(installation_id)
        point_ids = tuple(sorted({m.connection_point_id for m in mappings}, key=str))
        hardware = associations(self.session, config.id, installation.id)
        revision = self.session.get(ModuleTemplateRevision, installation.module_revision_id)
        if revision.mount_kind == "MODULE_PORT" and (mappings or revision.transceiver is not None
                or self.session.scalar(select(ModuleEndpointDefinition.id).where(
                    ModuleEndpointDefinition.module_revision_id == revision.id,
                ).limit(1)) is not None):
            self._remove_transceiver(object_id, config, installation, revision, mappings, hardware)
            return
        endpoint_interfaces = {m.network_interface_id for m in mappings if m.network_interface_id}
        hardware_interfaces = {row.interface_id for row in hardware}
        if (endpoint_interfaces & hardware_interfaces
                or {row.bay_key: row.hardware_interface_key for row in hardware}
                != declared_interfaces(revision.module_places, place_key="key")):
            raise ModelError("ModuleInstallation has inconsistent hardware interfaces",
                             {"reason": "INVALID_HARDWARE_INTERFACE_ASSOCIATION"})
        interface_ids = tuple(sorted(endpoint_interfaces | hardware_interfaces, key=str))
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
        self.session.execute(delete(HardwareInterfaceAssociation).where(
            HardwareInterfaceAssociation.parent_installation_id == installation_id))
        self.session.execute(delete(InterfacePhysicalBinding).where(or_(InterfacePhysicalBinding.point_id.in_(point_ids), InterfacePhysicalBinding.interface_id.in_(interface_ids))))
        self.session.execute(delete(NetworkInterfacePhysicalOwner).where(NetworkInterfacePhysicalOwner.interface_id.in_(interface_ids)))
        self.session.execute(delete(EntityMetadata).where(or_(EntityMetadata.connection_point_id.in_(point_ids), EntityMetadata.network_interface_id.in_(interface_ids))))
        self.session.execute(delete(NetworkInterface).where(NetworkInterface.id.in_(interface_ids)))
        self.session.execute(delete(ConnectionPoint).where(ConnectionPoint.id.in_(point_ids)))
        self.session.delete(installation)
        self.session.flush()

    def _remove_transceiver(self, object_id, config, installation, revision, mappings, hardware, *, replacement=None):
        parent_id = installation.parent_installation_id
        bay_key = installation.bay_key
        if parent_id is None:
            bay = self.session.scalar(select(ModuleBay).where(
                ModuleBay.base_revision_id == config.base_revision_id, ModuleBay.bay_key == bay_key,
            ))
            place = {**row_mount(bay), "key": bay_key, "hardware_interface_key": bay.hardware_interface_key} if bay else None
        else:
            parent = self.session.get(ModuleInstallation, parent_id)
            parent_revision = self.session.get(ModuleTemplateRevision, parent.module_revision_id)
            place = None
            if (parent.configuration_id == config.id and parent.parent_installation_id is None
                    and parent_revision.mount_kind == "MODULE_BAY"):
                place = next((p for p in parent_revision.module_places if p["key"] == bay_key), None)
        definitions = tuple(self.session.execute(select(ModuleEndpointDefinition, PortType)
            .join(PortType, PortType.id == ModuleEndpointDefinition.port_type_id)
            .where(ModuleEndpointDefinition.module_revision_id == revision.id)))
        if (revision.mount_kind != "MODULE_PORT" or revision.transceiver is None
                or revision.module_places or hardware or place is None
                or mount_identity(place) != mount_identity(row_mount(revision))
                or len(mappings) != 1 or len(definitions) != 1):
            self._refuse(installation, {"INVALID_ENDPOINT_MAPPING": 1})
        mapping, = mappings
        (definition, port_type), = definitions
        if (mapping.definition_id != definition.id or mapping.network_interface_id is not None
                or definition.kind != "CONNECTION_POINT"
                or not supports_transceiver_termination(port_type.medium, port_type.cardinality)):
            self._refuse(installation, {"INVALID_ENDPOINT_MAPPING": 1})

        key = declared_interfaces([place], place_key="key").get(bay_key)
        association = self.session.scalar(select(HardwareInterfaceAssociation).where(
            HardwareInterfaceAssociation.configuration_id == config.id,
            HardwareInterfaceAssociation.parent_installation_id == parent_id,
            HardwareInterfaceAssociation.bay_key == bay_key,
            HardwareInterfaceAssociation.hardware_interface_key == key,
            HardwareInterfaceAssociation.physical_object_id == object_id,
        ).with_for_update())
        if association is None:
            self._refuse(installation, {"INVALID_HARDWARE_INTERFACE_ASSOCIATION": 1})
        interface_id = association.interface_id
        if replacement is not None and (
                interface_id != replacement.interface_id or mapping.connection_point_id != replacement.source_point_id):
            self._replacement_stale("INSTALLATION_CHANGED")
        # Connection creation locks interfaces before points. The interface lock
        # also prevents new bindings on this interface during validation.
        self.session.scalar(select(NetworkInterface.id).where(NetworkInterface.id == interface_id).with_for_update())
        owner = self.session.scalar(select(NetworkInterfacePhysicalOwner).where(
            NetworkInterfacePhysicalOwner.interface_id == interface_id,
            NetworkInterfacePhysicalOwner.physical_object_id == object_id,
        ).with_for_update(read=True))
        if owner is None:
            self._refuse(installation, {"NETWORK_INTERFACE_PHYSICAL_OWNER": 1})

        point_id = mapping.connection_point_id
        # Cable create and reconnect take the same point lock. Check for
        # connections only after acquiring it, in a fresh READ COMMITTED query.
        point = self.session.scalar(select(ConnectionPoint).where(ConnectionPoint.id == point_id).with_for_update())
        if point is None or point.physical_object_id != object_id:
            self._refuse(installation, {"CONNECTION_POINT_OWNER": 1})
        if point.cardinality != port_type.cardinality:
            self._refuse(installation, {"INVALID_ENDPOINT_MAPPING": 1})
        expected = {(interface_id, point_id, member) for member in range(1, point.cardinality + 1)}
        # Passing no interfaces checks point dependencies without treating the
        # preserved interface's logical configuration as a dependency of the optic.
        blockers = self._blockers(object_id, installation, mappings, (point,), (point_id,), (),
                                  transceiver_bindings=expected)
        moves = []
        cables = []
        if replacement is not None and replacement.cable_assignments and set(blockers) <= {"CONNECTION"}:
            if revision.id == replacement.target_revision_id:
                raise ValidationError("Cable assignments require a different transceiver revision")
            moves, cables = self._replacement_moves(installation, point, blockers, replacement.cable_assignments)
            blockers.pop("CONNECTION", None)
        if blockers:
            self._refuse(installation, blockers, self._blocking_cables(point_id))
        if replacement is not None and replacement.compatibility is not None and not moves:
            self._replacement_stale("REPLACEMENT_CABLES_CHANGED")

        if replacement is not None and revision.id == replacement.target_revision_id:
            return None, [], []
        self.session.delete(mapping)
        self.session.execute(delete(InterfacePhysicalBinding).where(InterfacePhysicalBinding.point_id == point_id))
        self.session.execute(delete(EntityMetadata).where(EntityMetadata.connection_point_id == point_id))
        self.session.flush()
        self.session.delete(installation)
        if replacement is None:
            self.session.delete(point)
        self.session.flush()
        return point, moves, cables

    def _replacement_moves(self, installation, point, blockers, assignments):
        by_cable = {item.cable_id: item.member_index for item in assignments}
        if len(by_cable) != len(assignments) or len(set(by_cable.values())) != len(assignments):
            raise ValidationError("Assign each Cable and each new member at most once")
        cables = self._blocking_cables(point.id)
        cable_ids = {uuid.UUID(row["cable_id"]) for row in cables}
        if cable_ids != by_cable.keys():
            raise ModelError("Cable assignments must cover the current Cable set exactly", {
                "reason": "REPLACEMENT_CABLES_CHANGED", "blocking_cables": cables,
            })
        if len(cables) != len(cable_ids) or blockers.get("CONNECTION", 0) != len(cable_ids):
            self._refuse(installation, blockers, cables)

        # The source point excludes new attachments. Reconnect/disconnect may
        # already own Cable/Connection/remote locks, so acquire those NOWAIT.
        # A successful acquisition is followed by a fresh read of both ends.
        catalog = PhysicalConnectionCatalog(self.session)
        moves = []
        local_members = set()
        for cable_id, index in sorted(by_cable.items()):
            snapshot, connection, member, points = catalog.lock_cable_reconnect_snapshot(cable_id)
            local_is_a = connection.point_a_id == point.id
            if not local_is_a and connection.point_b_id != point.id:
                self._replacement_stale("REPLACEMENT_CABLES_CHANGED")
            local_index = member.point_a_member if local_is_a else member.point_b_member
            if local_index in local_members:
                self._refuse(installation, blockers, cables)
            local_members.add(local_index)
            remote = points[connection.point_b_id if local_is_a else connection.point_a_id]
            moves.append((snapshot, connection, member, remote, local_is_a, index))
        return moves, self._blocking_cables(point.id)

    def _blocking_cables(self, point_id):
        rows = self.session.execute(select(Cable, Connection, ConnectionMember)
            .join(Connection, Connection.id == Cable.connection_id)
            .outerjoin(ConnectionMember, ConnectionMember.connection_id == Connection.id)
            .where(or_(Connection.point_a_id == point_id, Connection.point_b_id == point_id))
            .order_by(Cable.id, ConnectionMember.index)).all()
        if not rows:
            return []
        addresses = cable_endpoint_addresses(self.session, {
            endpoint_id for _, connection, _ in rows for endpoint_id in (connection.point_a_id, connection.point_b_id)
        })
        cables = []
        for cable, connection, member in rows:
            local_is_a = connection.point_a_id == point_id
            remote_id = connection.point_b_id if local_is_a else connection.point_a_id
            local_index = (member.point_a_member if local_is_a else member.point_b_member) if member else None
            remote_index = (member.point_b_member if local_is_a else member.point_a_member) if member else None
            cables.append({
                "cable_id": str(cable.id), "label": cable.label, "connection_id": str(connection.id),
                "connection_member_id": str(member.id) if member else None,
                "local": {**addresses[point_id], "member_index": local_index},
                "remote": {**addresses[remote_id], "member_index": remote_index},
            })
        return cables

    @staticmethod
    def _refuse(installation, blockers, cables=()):
        raise ModelError("ModuleInstallation cannot be removed because its endpoints are in use", {
            "reason": "MODULE_INSTALLATION_IN_USE", "installation_id": str(installation.id),
            "blockers": blockers, "blocking_cables": list(cables),
        })

    def _blockers(self, object_id, installation, mappings, points, point_ids, interface_ids, *, transceiver_bindings=None):
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
        expected = transceiver_bindings if transceiver_bindings is not None else {
            (m.network_interface_id, m.connection_point_id, 1) for m in mappings if m.network_interface_id
        }
        binding_interfaces = interface_ids if transceiver_bindings is None else {row[0] for row in expected}
        binding_query = select(InterfacePhysicalBinding).where(or_(
            InterfacePhysicalBinding.point_id.in_(point_ids),
            InterfacePhysicalBinding.interface_id.in_(binding_interfaces),
        ))
        if transceiver_bindings is not None:
            binding_query = binding_query.order_by(InterfacePhysicalBinding.id).with_for_update()
        actual = {(b.interface_id, b.point_id, b.point_member) for b in self.session.scalars(binding_query)}
        unexpected = actual - expected if transceiver_bindings is None else actual ^ expected
        if unexpected:
            blockers["INTERFACE_PHYSICAL_BINDING"] += len(unexpected)
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
