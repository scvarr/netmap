import re
import uuid

from sqlalchemy import select

from app.device_catalog import DeviceCatalog, DisplayAliasRecord
from app.models import BlueprintEndpointSlot, BlueprintInstance, BlueprintInstanceSlot, InterfacePhysicalBinding, ObjectBlueprint, ObjectBlueprintVersion
from app.repository import CanonicalRepository, PhysicalBindingRecord
from app.schemas import BlueprintInstanceProvenance, BlueprintLibraryRef, BlueprintSlotMetadata, ConnectionPointDetails, DirectInterfaceBindingDetails, ExternalPhysicalAttachmentDetails, InternalPhysicalCounterpartDetails, PhysicalObjectDetails, PhysicalObjectDetailsDocument, ProjectionSourceRef
from app.simple_cable_semantics import simple_cable_members


class ConfiguredPhysicalObjectDetailsResolver:
    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(self, physical_object_id: uuid.UUID) -> PhysicalObjectDetailsDocument:
        self.repository.require_physical_objects([physical_object_id])
        catalog = DeviceCatalog(self.repository.session)
        all_points = self.repository.get_all_connection_point_records()
        points = tuple(point for point in all_points if point.physical_object_id == physical_object_id)
        point_ids = {point.point_id for point in points}
        members = self.repository.get_physical_connection_member_records()
        incident = tuple(member for member in members if point_ids & {member.point_a_id, member.point_b_id})
        point_by_id = {point.point_id: point for point in all_points}
        endpoint_ids = {endpoint for member in incident for endpoint in (member.point_a_id, member.point_b_id)}
        candidate_objects = {point_by_id[endpoint].physical_object_id for endpoint in endpoint_ids}
        simple = simple_cable_members(catalog, candidate_objects, all_points, members)
        cable_object_ids = {object_id for object_id, value in catalog.physical_object_classes(list(candidate_objects)).items() if value.value == "cable"}
        for cable_members in simple.values():
            endpoint_ids.update(endpoint for member in cable_members for endpoint in (member.point_a_id, member.point_b_id))
        point_aliases = catalog.connection_point_display_aliases(list(endpoint_ids | point_ids))
        object_ids = {point_by_id[endpoint].physical_object_id for endpoint in endpoint_ids}
        object_aliases = catalog.physical_object_display_aliases(list(object_ids | {physical_object_id}))
        object_class = catalog.physical_object_classes([physical_object_id]).get(physical_object_id)
        bindings_by_point: dict[uuid.UUID, list[PhysicalBindingRecord]] = {point_id: [] for point_id in point_ids}
        for binding in self.repository.session.scalars(select(InterfacePhysicalBinding).where(InterfacePhysicalBinding.point_id.in_(point_ids)).order_by(InterfacePhysicalBinding.point_id, InterfacePhysicalBinding.id)):
            bindings_by_point[binding.point_id].append(PhysicalBindingRecord(binding.id, binding.interface_id, binding.point_id, binding.point_member))
        interface_ids = {binding.interface_id for values in bindings_by_point.values() for binding in values}
        interface_aliases = catalog.network_interface_display_aliases(list(interface_ids))
        provenance, slots = self._blueprint_instance(physical_object_id)
        details = [self._point_details(point, point_aliases.get(point.point_id), incident, point_by_id, point_aliases, object_aliases, bindings_by_point[point.point_id], interface_aliases, slots.get(point.point_id), simple, cable_object_ids) for point in points]
        details.sort(key=lambda value: self._natural_key(value.ordering_key))
        owners = tuple(owner for owner in self.repository.get_network_interface_physical_owners() if owner.physical_object_id == physical_object_id)
        object_alias = object_aliases.get(physical_object_id)
        return PhysicalObjectDetailsDocument(physical_object=PhysicalObjectDetails(source_ref=self._ref("PhysicalObject", physical_object_id), label=self._label(object_alias, "PhysicalObject", physical_object_id), label_source=None if object_alias else "TECHNICAL_FALLBACK", class_=(object_class.value if object_class else None)), blueprint_provenance=provenance, connection_points=details, owned_interface_count=len(owners), gaps=[], warnings=[])

    def _point_details(self, point, alias, incident, point_by_id, point_aliases, object_aliases, bindings, interface_aliases, slot, simple, cable_object_ids):
        point_members = [member for member in incident if point.point_id in (member.point_a_id, member.point_b_id)]
        refs = [self._ref("ConnectionPoint", point.point_id)]
        if alias: refs.append(self._ref("EntityMetadata", alias.metadata_id))
        direct_bindings = []
        for binding in bindings:
            interface_alias = interface_aliases.get(binding.interface_id)
            evidence = [self._ref("InterfacePhysicalBinding", binding.binding_id), self._ref("NetworkInterface", binding.interface_id)]
            refs.extend(evidence)
            direct_bindings.append(DirectInterfaceBindingDetails(interface_ref=self._ref("NetworkInterface", binding.interface_id), label=self._label(interface_alias, "NetworkInterface", binding.interface_id), label_source=None if interface_alias else "TECHNICAL_FALLBACK", evidence_refs=evidence))
        internal, external, external_connections = [], [], set()
        for member in point_members:
            peer_point_id = member.point_b_id if member.point_a_id == point.point_id else member.point_a_id
            peer_object_id = point_by_id[peer_point_id].physical_object_id
            evidence = [self._ref("Connection", member.connection_id), self._ref("ConnectionMember", member.connection_member_id)]
            refs.extend(evidence)
            if peer_object_id == point.physical_object_id:
                peer_alias = point_aliases.get(peer_point_id)
                internal.append(InternalPhysicalCounterpartDetails(connection_point_ref=self._ref("ConnectionPoint", peer_point_id), label=self._label(peer_alias, "ConnectionPoint", peer_point_id), label_source=None if peer_alias else "TECHNICAL_FALLBACK", connection_ref=self._ref("Connection", member.connection_id), evidence_refs=evidence))
                continue
            external_connections.add(member.connection_id)
            cable_members = simple.get(peer_object_id)
            if cable_members:
                other = next((candidate for candidate in cable_members if candidate.connection_id != member.connection_id), None)
                if other:
                    remote_point_id = other.point_b_id if other.object_a_id == peer_object_id else other.point_a_id
                    remote_object_id = point_by_id[remote_point_id].physical_object_id
                    cable_evidence = evidence + [self._ref("Connection", other.connection_id), self._ref("ConnectionMember", other.connection_member_id)]
                    external.append(ExternalPhysicalAttachmentDetails(kind="SIMPLE_CABLE", connection_ref=self._ref("Connection", member.connection_id), evidence_refs=cable_evidence, cable_ref=self._ref("PhysicalObject", peer_object_id), cable_label=self._label(object_aliases.get(peer_object_id), "PhysicalObject", peer_object_id), remote_physical_object_ref=self._ref("PhysicalObject", remote_object_id), remote_physical_object_label=self._label(object_aliases.get(remote_object_id), "PhysicalObject", remote_object_id), remote_connection_point_ref=self._ref("ConnectionPoint", remote_point_id), remote_connection_point_label=self._label(point_aliases.get(remote_point_id), "ConnectionPoint", remote_point_id)))
                    continue
            # A non-simple cable remains an explicit unresolved adjacency, never a guessed far peer.
            kind = "UNRESOLVED" if peer_object_id in cable_object_ids else "DIRECT_CONNECTION"
            external.append(ExternalPhysicalAttachmentDetails(kind=kind, connection_ref=self._ref("Connection", member.connection_id), evidence_refs=evidence, remote_physical_object_ref=self._ref("PhysicalObject", peer_object_id), remote_physical_object_label=self._label(object_aliases.get(peer_object_id), "PhysicalObject", peer_object_id), remote_connection_point_ref=self._ref("ConnectionPoint", peer_point_id), remote_connection_point_label=self._label(point_aliases.get(peer_point_id), "ConnectionPoint", peer_point_id)))
        return ConnectionPointDetails(connection_point_ref=self._ref("ConnectionPoint", point.point_id), label=self._label(alias, "ConnectionPoint", point.point_id), label_source=None if alias else "TECHNICAL_FALLBACK", cardinality=point.cardinality, incident_connection_count=len({member.connection_id for member in point_members}), external_connection_count=len(external_connections), direct_interface_binding_count=len(bindings), ordering_key=slot.slot_key if slot else self._label(alias, "ConnectionPoint", point.point_id), blueprint_slot=slot, direct_interface_bindings=direct_bindings, internal_physical_counterparts=internal, external_physical_attachments=external, source_refs=self._dedupe_refs(refs))

    def _blueprint_instance(self, object_id):
        row = self.repository.session.execute(select(BlueprintInstance, ObjectBlueprintVersion, ObjectBlueprint).join(ObjectBlueprintVersion, ObjectBlueprintVersion.id == BlueprintInstance.blueprint_version_id).join(ObjectBlueprint, ObjectBlueprint.id == ObjectBlueprintVersion.blueprint_id).where(BlueprintInstance.physical_object_id == object_id)).one_or_none()
        if row is None: return None, {}
        instance, version, blueprint = row
        mappings = self.repository.session.execute(select(BlueprintInstanceSlot, BlueprintEndpointSlot).join(BlueprintEndpointSlot, BlueprintEndpointSlot.id == BlueprintInstanceSlot.blueprint_slot_id).where(BlueprintInstanceSlot.blueprint_instance_id == instance.id)).all()
        slots = {mapping.connection_point_id: BlueprintSlotMetadata(slot_key=slot.slot_key, kind=slot.kind, anchor_side=slot.anchor_side, anchor_offset=slot.anchor_offset) for mapping, slot in mappings}
        return BlueprintInstanceProvenance(blueprint_ref=BlueprintLibraryRef(entity_type="ObjectBlueprint", entity_id=blueprint.id), version_ref=BlueprintLibraryRef(entity_type="ObjectBlueprintVersion", entity_id=version.id), version_number=version.version_number), slots

    @staticmethod
    def _label(alias: DisplayAliasRecord | None, entity_type: str, entity_id: uuid.UUID) -> str: return alias.value if alias else f"{entity_type} {str(entity_id)[:8]}"
    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> ProjectionSourceRef: return ProjectionSourceRef(ref_type="CANONICAL_FACT", entity_type=entity_type, entity_id=entity_id)
    @staticmethod
    def _dedupe_refs(refs):
        by_key = {(ref.entity_type, str(ref.entity_id)): ref for ref in refs}
        return [by_key[key] for key in sorted(by_key)]
    @staticmethod
    def _natural_key(value: str): return tuple(int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value))
