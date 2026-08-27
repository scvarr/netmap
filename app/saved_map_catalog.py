from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.device_catalog import DeviceCatalog
from app.errors import ModelError, ValidationError, classify_integrity_error
from app.models import MapCableRoute, MapPlacement, MapViewKey, MapViewPosition, PhysicalObject, SavedMap


@dataclass(frozen=True)
class SavedMapDetail:
    saved_map: SavedMap
    placements: tuple[MapPlacement, ...]
    cable_routes: tuple[MapCableRoute, ...]


class SavedMapCatalog:
    """Presentation-only SavedMap storage; it never participates in topology resolution."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, name: str) -> SavedMap:
        if self.session.scalar(select(SavedMap.id).where(SavedMap.name == name)) is not None:
            raise ModelError("SavedMap name already exists", {"reason": "SAVED_MAP_NAME_CONFLICT", "name": name})
        saved_map = SavedMap(name=name)
        self.session.add(saved_map)
        self._flush()
        return saved_map

    def list(self) -> tuple[SavedMap, ...]:
        return tuple(self.session.scalars(select(SavedMap).order_by(SavedMap.name, SavedMap.id)))

    def detail(self, map_id: uuid.UUID) -> SavedMapDetail:
        saved_map = self._require_map(map_id)
        return SavedMapDetail(saved_map, self._placements(map_id), self._cable_routes(map_id))

    def delete(self, map_id: uuid.UUID) -> None:
        self.session.delete(self._require_map(map_id))
        self._flush()

    def add_placement(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, x: float, y: float) -> MapPlacement:
        self._require_map(map_id)
        if self.session.get(PhysicalObject, physical_object_id) is None:
            raise ValidationError("PhysicalObject does not exist", {"physical_object_id": str(physical_object_id)})
        if self.session.scalar(select(MapPlacement.id).where(
            MapPlacement.map_id == map_id, MapPlacement.physical_object_id == physical_object_id
        )) is not None:
            raise ModelError("PhysicalObject is already placed on SavedMap", {
                "reason": "MAP_PLACEMENT_CONFLICT", "map_id": str(map_id), "physical_object_id": str(physical_object_id),
            })
        placement = MapPlacement(map_id=map_id, physical_object_id=physical_object_id)
        placement.view_positions.append(MapViewPosition(view_key=MapViewKey.PHYSICAL, x=x, y=y))
        self.session.add(placement)
        self._flush()
        return placement

    def move_placement(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, x: float, y: float, display_width: float | None = None) -> MapPlacement:
        """Compatibility operation: update the physical presentation position only."""
        return self.set_view_position(map_id, physical_object_id, MapViewKey.PHYSICAL, x, y, display_width)

    def set_view_position(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, view_key: MapViewKey, x: float, y: float, display_width: float | None = None) -> MapPlacement:
        if display_width is not None and view_key != MapViewKey.PHYSICAL:
            raise ValidationError("display_width is supported only by the physical map view", {"view_key": str(view_key)})
        self._require_map(map_id)
        placement = self.session.scalar(select(MapPlacement).where(
            MapPlacement.map_id == map_id, MapPlacement.physical_object_id == physical_object_id
        ).with_for_update())
        if placement is None:
            raise ValidationError("MapPlacement does not exist", {
                "map_id": str(map_id), "physical_object_id": str(physical_object_id),
            })
        position = next((item for item in placement.view_positions if item.view_key == view_key), None)
        if position is None:
            placement.view_positions.append(MapViewPosition(view_key=view_key, x=x, y=y, display_width=display_width))
        else:
            position.x, position.y = x, y
            if display_width is not None:
                position.display_width = display_width
        self._flush()
        return placement

    def set_view_lock(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, view_key: MapViewKey, locked: bool) -> MapPlacement:
        self._require_map(map_id)
        placement = self.session.scalar(select(MapPlacement).where(
            MapPlacement.map_id == map_id, MapPlacement.physical_object_id == physical_object_id
        ).with_for_update())
        if placement is None:
            raise ValidationError("MapPlacement does not exist", {
                "map_id": str(map_id), "physical_object_id": str(physical_object_id),
            })
        position = next((item for item in placement.view_positions if item.view_key == view_key), None)
        if position is None:
            raise ValidationError("MapViewPosition does not exist", {
                "map_id": str(map_id), "physical_object_id": str(physical_object_id), "view_key": str(view_key),
            })
        position.locked = locked
        self._flush()
        return placement

    def remove_placement(self, map_id: uuid.UUID, physical_object_id: uuid.UUID) -> None:
        self._require_map(map_id)
        placement = self.session.scalar(select(MapPlacement).where(
            MapPlacement.map_id == map_id, MapPlacement.physical_object_id == physical_object_id
        ).with_for_update())
        if placement is None:
            raise ValidationError("MapPlacement does not exist", {
                "map_id": str(map_id), "physical_object_id": str(physical_object_id),
            })
        self.session.delete(placement)
        self._flush()

    def set_cable_route(
        self,
        map_id: uuid.UUID,
        cable_physical_object_id: uuid.UUID,
        waypoints: list[dict[str, float]],
    ) -> MapCableRoute:
        self._require_map(map_id)
        self._require_cable(cable_physical_object_id)
        route = self.session.scalar(
            select(MapCableRoute)
            .where(
                MapCableRoute.map_id == map_id,
                MapCableRoute.cable_physical_object_id == cable_physical_object_id,
                MapCableRoute.view_key == MapViewKey.PHYSICAL,
            )
            .with_for_update()
        )
        if route is None:
            route = MapCableRoute(
                map_id=map_id,
                cable_physical_object_id=cable_physical_object_id,
                view_key=MapViewKey.PHYSICAL,
            )
            self.session.add(route)
        route.waypoints = [{"x": point["x"], "y": point["y"]} for point in waypoints]
        self._flush()
        return route

    def delete_cable_route(self, map_id: uuid.UUID, cable_physical_object_id: uuid.UUID) -> None:
        self._require_map(map_id)
        route = self.session.scalar(
            select(MapCableRoute)
            .where(
                MapCableRoute.map_id == map_id,
                MapCableRoute.cable_physical_object_id == cable_physical_object_id,
                MapCableRoute.view_key == MapViewKey.PHYSICAL,
            )
            .with_for_update()
        )
        if route is None:
            raise ValidationError("MapCableRoute does not exist", {
                "map_id": str(map_id), "cable_physical_object_id": str(cable_physical_object_id),
            })
        self.session.delete(route)
        self.session.flush()

    def placements(self, map_id: uuid.UUID) -> SavedMapDetail:
        return self.detail(map_id)

    def _require_map(self, map_id: uuid.UUID) -> SavedMap:
        saved_map = self.session.get(SavedMap, map_id)
        if saved_map is None:
            raise ValidationError("SavedMap does not exist", {"map_id": str(map_id)})
        return saved_map

    def _placements(self, map_id: uuid.UUID) -> tuple[MapPlacement, ...]:
        return tuple(self.session.scalars(select(MapPlacement).options(selectinload(MapPlacement.view_positions)).where(
            MapPlacement.map_id == map_id
        ).order_by(MapPlacement.physical_object_id)))

    def _cable_routes(self, map_id: uuid.UUID) -> tuple[MapCableRoute, ...]:
        return tuple(self.session.scalars(
            select(MapCableRoute)
            .where(MapCableRoute.map_id == map_id)
            .order_by(MapCableRoute.cable_physical_object_id, MapCableRoute.view_key)
        ))

    def _require_cable(self, physical_object_id: uuid.UUID) -> None:
        if self.session.get(PhysicalObject, physical_object_id) is None:
            raise ValidationError("PhysicalObject does not exist", {"physical_object_id": str(physical_object_id)})
        object_class = DeviceCatalog(self.session).physical_object_classes([physical_object_id]).get(physical_object_id)
        if object_class is None or object_class.value != "cable":
            raise ValidationError("PhysicalObject is not a cable", {
                "reason": "MAP_CABLE_ROUTE_OBJECT_NOT_CABLE", "physical_object_id": str(physical_object_id),
            })

    def _flush(self) -> None:
        try:
            self.session.flush()
        except IntegrityError as error:
            conflict = classify_integrity_error(error)
            if conflict is not None:
                raise conflict from error
            raise
