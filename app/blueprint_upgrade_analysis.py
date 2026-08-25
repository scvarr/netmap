import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BlueprintEndpointSlot, BlueprintInstance, BlueprintInstanceSlot, BlueprintInternalLink, ConnectionPoint, InterfacePhysicalBinding, ObjectBlueprintVersion


@dataclass(frozen=True)
class BlueprintUpgradeAnalysis:
    status: str
    blueprint_id: uuid.UUID | None
    current_version_id: uuid.UUID | None
    current_version_number: int | None
    target_version_id: uuid.UUID | None
    target_version_number: int | None
    compatible_changes: tuple[dict[str, object], ...]
    blockers: tuple[dict[str, object], ...]


class BlueprintUpgradeAnalyzer:
    """Read-only comparison of immutable Blueprint snapshots and instance evidence."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def analyze(self, physical_object_id: uuid.UUID) -> BlueprintUpgradeAnalysis:
        with self.session.no_autoflush:
            instance = self.session.scalar(select(BlueprintInstance).where(BlueprintInstance.physical_object_id == physical_object_id))
            if instance is None:
                return BlueprintUpgradeAnalysis("NOT_APPLICABLE", None, None, None, None, None, (), ())
            current = self.session.get(ObjectBlueprintVersion, instance.blueprint_version_id)
            if current is None:
                return BlueprintUpgradeAnalysis("MODEL_INCONSISTENT", None, None, None, None, None, (), ({"code": "INSTANCE_MAPPING_INCONSISTENT"},))
            target = self.session.scalar(select(ObjectBlueprintVersion).where(ObjectBlueprintVersion.blueprint_id == current.blueprint_id).order_by(ObjectBlueprintVersion.version_number.desc()).limit(1))
            base = (current.blueprint_id, current.id, current.version_number, target.id if target else None, target.version_number if target else None)
            if target is None:
                return BlueprintUpgradeAnalysis("MODEL_INCONSISTENT", *base, (), ({"code": "INSTANCE_MAPPING_INCONSISTENT"},))
            inconsistency = self._mapping_inconsistency(instance.id, current.id, physical_object_id)
            if inconsistency:
                return BlueprintUpgradeAnalysis("MODEL_INCONSISTENT", *base, (), ({"code": "INSTANCE_MAPPING_INCONSISTENT", "details": inconsistency},))
            if current.id == target.id:
                return BlueprintUpgradeAnalysis("UP_TO_DATE", *base, (), ())
            current_slots, target_slots = self._slots(current.id), self._slots(target.id)
            current_links, target_links = self._links(current.id, current_slots), self._links(target.id, target_slots)
            compatible: list[dict[str, object]] = []
            blockers: list[dict[str, object]] = []
            for key in sorted(current_slots):
                old, new = current_slots[key], target_slots.get(key)
                if new is None: blockers.append({"code": "SLOT_REMOVED", "slot_key": key})
                elif old.kind != new.kind: blockers.append({"code": "SLOT_KIND_CHANGED", "slot_key": key, "current_kind": old.kind, "target_kind": new.kind})
                else: compatible.append({"code": "SLOT_PRESERVED", "slot_key": key})
            for key in sorted(set(target_slots) - set(current_slots)):
                compatible.append({"code": "SLOT_ADDED", "slot_key": key, "kind": target_slots[key].kind})
            if (current.body_kind, current.width, current.height, current.fill_color) != (target.body_kind, target.width, target.height, target.fill_color) or any((current_slots[key].display_name, current_slots[key].anchor_side, current_slots[key].anchor_offset) != (target_slots[key].display_name, target_slots[key].anchor_side, target_slots[key].anchor_offset) for key in set(current_slots) & set(target_slots)):
                compatible.append({"code": "PRESENTATION_CHANGED"})
            for link in sorted(target_links - current_links): compatible.append({"code": "INTERNAL_LINK_ADDED", "slot_keys": list(link)})
            for link in sorted(current_links - target_links): blockers.append({"code": "INTERNAL_LINK_REMOVED", "slot_keys": list(link)})
            return BlueprintUpgradeAnalysis("OUTDATED", *base, tuple(compatible), tuple(blockers))

    def _slots(self, version_id: uuid.UUID) -> dict[str, BlueprintEndpointSlot]:
        return {slot.slot_key: slot for slot in self.session.scalars(select(BlueprintEndpointSlot).where(BlueprintEndpointSlot.blueprint_version_id == version_id))}

    def _links(self, version_id: uuid.UUID, slots: dict[str, BlueprintEndpointSlot]) -> set[tuple[str, str]]:
        by_id = {slot.id: key for key, slot in slots.items()}
        return {tuple(sorted((by_id[link.slot_a_id], by_id[link.slot_b_id]))) for link in self.session.scalars(select(BlueprintInternalLink).where(BlueprintInternalLink.blueprint_version_id == version_id)) if link.slot_a_id in by_id and link.slot_b_id in by_id}

    def _mapping_inconsistency(self, instance_id: uuid.UUID, version_id: uuid.UUID, object_id: uuid.UUID) -> str | None:
        source_slots = self._slots(version_id)
        mappings = tuple(self.session.scalars(select(BlueprintInstanceSlot).where(BlueprintInstanceSlot.blueprint_instance_id == instance_id)))
        if len(mappings) != len(source_slots) or {item.blueprint_slot_id for item in mappings} != {slot.id for slot in source_slots.values()}: return "SLOT_MAPPING_SET_MISMATCH"
        slots_by_id = {slot.id: slot for slot in source_slots.values()}
        for item in mappings:
            point, slot = self.session.get(ConnectionPoint, item.connection_point_id), slots_by_id[item.blueprint_slot_id]
            if point is None or point.physical_object_id != object_id: return "CONNECTION_POINT_OWNERSHIP_MISMATCH"
            if slot.kind == "NETWORK_PORT":
                if item.network_interface_id is None or self.session.scalar(select(InterfacePhysicalBinding.id).where(InterfacePhysicalBinding.interface_id == item.network_interface_id, InterfacePhysicalBinding.point_id == item.connection_point_id)) is None: return "NETWORK_PORT_BINDING_MISMATCH"
            elif item.network_interface_id is not None: return "CONNECTION_POINT_HAS_INTERFACE_MAPPING"
        return None
