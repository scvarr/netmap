import uuid
from collections import defaultdict

from sqlalchemy import select

from app.device_catalog import DeviceCatalog, DisplayAliasRecord
from app.models import MapPlacement, SavedMap
from app.repository import CanonicalRepository, ConnectionPointRecord
from app.schemas import (
    CatalogInventoryCableEndpoint,
    CatalogInventoryCableItem,
    CatalogInventoryDocument,
    CatalogInventoryEquipmentItem,
    CatalogInventoryMapMembership,
    CatalogInventoryOccupancy,
    ProjectionSourceRef,
    SavedMapRef,
)
from app.simple_cable_semantics import simple_cable_members


class CatalogInventoryResolver:
    """Bulk public read model for catalog inventory; it does not use projections."""

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(self) -> CatalogInventoryDocument:
        object_ids = self.repository.get_physical_object_ids()
        catalog = DeviceCatalog(self.repository.session)
        aliases = catalog.physical_object_display_aliases(list(object_ids))
        classes = catalog.physical_object_classes(list(object_ids))
        points = self.repository.get_all_connection_point_records()
        members = self.repository.get_physical_connection_member_records()
        point_aliases = catalog.connection_point_display_aliases([point.point_id for point in points])
        points_by_object = self._points_by_object(points)
        memberships = self._map_memberships()
        simple = simple_cable_members(catalog, set(object_ids), points, members)

        equipment, cables = [], []
        for object_id in object_ids:
            alias = aliases.get(object_id)
            object_class = classes.get(object_id)
            if object_class is not None and object_class.value == "cable":
                cables.append(self._cable(object_id, alias, simple, points, point_aliases, aliases))
                continue
            equipment.append(CatalogInventoryEquipmentItem(
                physical_object_ref=self._ref("PhysicalObject", object_id),
                label=self._label(alias, "PhysicalObject", object_id),
                label_source=None if alias else "TECHNICAL_FALLBACK",
                class_=object_class.value if object_class else None,
                occupancy=self._occupancy(object_id, points_by_object, members),
                map_memberships=memberships[object_id],
            ))
        return CatalogInventoryDocument(equipment=equipment, cables=cables, gaps=[], warnings=[])

    def _map_memberships(self) -> dict[uuid.UUID, list[CatalogInventoryMapMembership]]:
        values: dict[uuid.UUID, list[CatalogInventoryMapMembership]] = defaultdict(list)
        rows = self.repository.session.execute(
            select(MapPlacement.physical_object_id, SavedMap.id, SavedMap.name)
            .join(SavedMap, SavedMap.id == MapPlacement.map_id)
            .order_by(MapPlacement.physical_object_id, SavedMap.name, SavedMap.id)
        )
        for object_id, map_id, name in rows:
            values[object_id].append(CatalogInventoryMapMembership(map_ref=SavedMapRef(entity_id=map_id), name=name))
        return values

    @staticmethod
    def _points_by_object(points: tuple[ConnectionPointRecord, ...]) -> dict[uuid.UUID, tuple[ConnectionPointRecord, ...]]:
        values: dict[uuid.UUID, list[ConnectionPointRecord]] = defaultdict(list)
        for point in points:
            values[point.physical_object_id].append(point)
        return {object_id: tuple(items) for object_id, items in values.items()}

    @staticmethod
    def _occupancy(object_id, points_by_object, members) -> CatalogInventoryOccupancy | None:
        points = points_by_object.get(object_id, ())
        if any(point.cardinality != 1 for point in points):
            return None
        externally_connected = {
            point_id
            for member in members
            for point_id, peer_object_id in ((member.point_a_id, member.object_b_id), (member.point_b_id, member.object_a_id))
            if peer_object_id != object_id
        }
        total = len(points)
        connected = sum(point.point_id in externally_connected for point in points)
        return CatalogInventoryOccupancy(total_ports=total, connected_ports=connected, free_ports=total - connected)

    def _cable(self, cable_id, alias, simple, points, point_aliases, object_aliases) -> CatalogInventoryCableItem:
        common = dict(cable_ref=self._ref("PhysicalObject", cable_id), label=self._label(alias, "PhysicalObject", cable_id), label_source=None if alias else "TECHNICAL_FALLBACK")
        cable_members = simple.get(cable_id)
        if cable_members is None:
            return CatalogInventoryCableItem(**common, resolution="UNRESOLVED", gaps=[], warnings=[])
        point_by_id = {point.point_id: point for point in points}
        endpoints = []
        for member in cable_members:
            remote_point_id = member.point_b_id if member.object_a_id == cable_id else member.point_a_id
            remote_object_id = point_by_id[remote_point_id].physical_object_id
            endpoints.append(CatalogInventoryCableEndpoint(
                remote_physical_object_ref=self._ref("PhysicalObject", remote_object_id),
                remote_physical_object_label=self._label(object_aliases.get(remote_object_id), "PhysicalObject", remote_object_id),
                remote_connection_point_ref=self._ref("ConnectionPoint", remote_point_id),
                remote_connection_point_label=self._label(point_aliases.get(remote_point_id), "ConnectionPoint", remote_point_id),
                evidence_refs=[self._ref("Connection", member.connection_id), self._ref("ConnectionMember", member.connection_member_id)],
            ))
        endpoints.sort(key=lambda item: (str(item.remote_physical_object_ref.entity_id), str(item.remote_connection_point_ref.entity_id)))
        return CatalogInventoryCableItem(**common, resolution="SIMPLE_CABLE", endpoint_a=endpoints[0], endpoint_b=endpoints[1], gaps=[], warnings=[])

    @staticmethod
    def _label(alias: DisplayAliasRecord | None, entity_type: str, entity_id: uuid.UUID) -> str:
        return alias.value if alias else f"{entity_type} {str(entity_id)[:8]}"

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> ProjectionSourceRef:
        return ProjectionSourceRef(ref_type="CANONICAL_FACT", entity_type=entity_type, entity_id=entity_id)
