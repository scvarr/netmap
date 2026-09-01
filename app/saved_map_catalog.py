from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.errors import ModelError, ValidationError, classify_integrity_error
from app.map_region_geometry import MapRegionSpatialRelation, classify_map_region_polygons
from app.models import Cable, Location, MapCableRoute, MapComposite, MapCompositeMember, MapCompositePresentation, MapPlacement, MapPresentationVariant, MapRegion, MapTextAnnotation, MapViewKey, MapViewPosition, PhysicalObject, SavedMap


@dataclass(frozen=True)
class SavedMapDetail:
    saved_map: SavedMap
    placements: tuple[MapPlacement, ...]
    cable_routes: tuple[MapCableRoute, ...]
    regions: tuple[MapRegion, ...]
    text_annotations: tuple[MapTextAnnotation, ...]
    variant: MapPresentationVariant
    variants: tuple[MapPresentationVariant, ...]
    composites: tuple[MapComposite, ...]


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
        self.session.add(MapPresentationVariant(map_id=saved_map.id, name="Основной"))
        self._flush()
        return saved_map

    def list(self) -> tuple[SavedMap, ...]:
        return tuple(self.session.scalars(select(SavedMap).order_by(SavedMap.name, SavedMap.id)))

    def detail(self, map_id: uuid.UUID, variant_id: uuid.UUID | None = None) -> SavedMapDetail:
        saved_map = self._require_map(map_id)
        variant = self._require_variant(map_id, variant_id)
        return SavedMapDetail(saved_map, self._placements(map_id, variant.id), self._cable_routes(map_id, variant.id), self._regions(map_id), self._text_annotations(map_id), variant, self._variants(map_id), self._composites(map_id, variant.id))

    def create_variant(self, map_id: uuid.UUID, name: str, source_variant_id: uuid.UUID) -> MapPresentationVariant:
        self._require_map(map_id)
        source = self._require_variant(map_id, source_variant_id)
        variant = MapPresentationVariant(map_id=map_id, name=name)
        self.session.add(variant)
        self._flush()
        source_positions = self.session.scalars(select(MapViewPosition).join(MapPlacement).where(
            MapPlacement.map_id == map_id, MapViewPosition.variant_id == source.id
        ))
        self.session.add_all(MapViewPosition(
            placement_id=position.placement_id, variant_id=variant.id, view_key=position.view_key,
            x=position.x, y=position.y, locked=position.locked, display_width=position.display_width,
        ) for position in source_positions)
        source_routes = self.session.scalars(select(MapCableRoute).where(
            MapCableRoute.map_id == map_id, MapCableRoute.variant_id == source.id
        ))
        self.session.add_all(MapCableRoute(
            map_id=route.map_id, variant_id=variant.id, cable_id=route.cable_id, view_key=route.view_key,
            waypoints=[{"x": point["x"], "y": point["y"]} for point in route.waypoints],
        ) for route in source_routes)
        source_presentations = self.session.scalars(select(MapCompositePresentation).join(MapComposite).where(
            MapComposite.map_id == map_id, MapCompositePresentation.variant_id == source.id
        ))
        self.session.add_all(MapCompositePresentation(
            composite_id=presentation.composite_id, variant_id=variant.id, collapsed=presentation.collapsed,
            x=presentation.x, y=presentation.y, width=presentation.width, height=presentation.height,
        ) for presentation in source_presentations)
        self._flush()
        return variant

    def create_composite(self, map_id: uuid.UUID, name: str, physical_object_ids: list[uuid.UUID]) -> MapComposite:
        self._require_map(map_id)
        if len(set(physical_object_ids)) != len(physical_object_ids):
            raise ValidationError("MapComposite members must be distinct", {"reason": "MAP_COMPOSITE_DUPLICATE_MEMBER"})
        placements = list(self.session.scalars(select(MapPlacement).where(MapPlacement.map_id == map_id, MapPlacement.physical_object_id.in_(physical_object_ids)).with_for_update()))
        if len(placements) != len(physical_object_ids):
            raise ValidationError("MapComposite members must be existing placements of this SavedMap", {"reason": "MAP_COMPOSITE_MEMBER_NOT_PLACED"})
        composite = MapComposite(map_id=map_id, name=name)
        composite.members = [MapCompositeMember(placement_id=item.id) for item in placements]
        self.session.add(composite)
        self._flush()
        return composite

    def delete_composite(self, map_id: uuid.UUID, composite_id: uuid.UUID) -> None:
        composite = self.session.scalar(select(MapComposite).where(MapComposite.map_id == map_id, MapComposite.id == composite_id).with_for_update())
        if composite is None: raise ValidationError("MapComposite does not exist", {"composite_id": str(composite_id)})
        self.session.delete(composite); self._flush()

    def set_composite_presentation(self, map_id: uuid.UUID, composite_id: uuid.UUID, variant_id: uuid.UUID, collapsed: bool, x: float, y: float, width: float, height: float) -> MapCompositePresentation:
        self._require_variant(map_id, variant_id)
        composite = self.session.scalar(select(MapComposite).where(MapComposite.map_id == map_id, MapComposite.id == composite_id).with_for_update())
        if composite is None: raise ValidationError("MapComposite does not exist", {"composite_id": str(composite_id)})
        presentation = self.session.scalar(select(MapCompositePresentation).where(MapCompositePresentation.composite_id == composite_id, MapCompositePresentation.variant_id == variant_id).with_for_update())
        if presentation is None:
            presentation = MapCompositePresentation(composite_id=composite_id, variant_id=variant_id, collapsed=collapsed, x=x, y=y, width=width, height=height); self.session.add(presentation)
        else: presentation.collapsed, presentation.x, presentation.y, presentation.width, presentation.height = collapsed, x, y, width, height
        self._flush(); return presentation

    def delete(self, map_id: uuid.UUID) -> None:
        self.session.delete(self._require_map(map_id))
        self._flush()

    def add_placement(
        self,
        map_id: uuid.UUID,
        physical_object_id: uuid.UUID,
        x: float,
        y: float,
        display_width: float | None = None, variant_id: uuid.UUID | None = None,
    ) -> MapPlacement:
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
        placement.view_positions.append(MapViewPosition(
            variant_id=self._require_variant(map_id, variant_id).id, view_key=MapViewKey.PHYSICAL, x=x, y=y, display_width=display_width
        ))
        self.session.add(placement)
        self._flush()
        return placement

    def move_placement(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, x: float, y: float, display_width: float | None = None) -> MapPlacement:
        """Compatibility operation: update the physical presentation position only."""
        return self.set_view_position(map_id, physical_object_id, MapViewKey.PHYSICAL, x, y, display_width)

    def set_view_position(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, view_key: MapViewKey, x: float, y: float, display_width: float | None = None, variant_id: uuid.UUID | None = None) -> MapPlacement:
        if display_width is not None and view_key != MapViewKey.PHYSICAL:
            raise ValidationError("display_width is supported only by the physical map view", {"view_key": str(view_key)})
        variant = self._require_variant(map_id, variant_id)
        placement = self.session.scalar(select(MapPlacement).where(
            MapPlacement.map_id == map_id, MapPlacement.physical_object_id == physical_object_id
        ).with_for_update())
        if placement is None:
            raise ValidationError("MapPlacement does not exist", {
                "map_id": str(map_id), "physical_object_id": str(physical_object_id),
            })
        position = next((item for item in placement.view_positions if item.view_key == view_key and item.variant_id == variant.id), None)
        if position is None:
            placement.view_positions.append(MapViewPosition(variant_id=variant.id, view_key=view_key, x=x, y=y, display_width=display_width))
        else:
            position.x, position.y = x, y
            if display_width is not None:
                position.display_width = display_width
        self._flush()
        return placement

    def set_view_lock(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, view_key: MapViewKey, locked: bool, variant_id: uuid.UUID | None = None) -> MapPlacement:
        variant = self._require_variant(map_id, variant_id)
        placement = self.session.scalar(select(MapPlacement).where(
            MapPlacement.map_id == map_id, MapPlacement.physical_object_id == physical_object_id
        ).with_for_update())
        if placement is None:
            raise ValidationError("MapPlacement does not exist", {
                "map_id": str(map_id), "physical_object_id": str(physical_object_id),
            })
        position = next((item for item in placement.view_positions if item.view_key == view_key and item.variant_id == variant.id), None)
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
        cable_id: uuid.UUID,
        waypoints: list[dict[str, float]], variant_id: uuid.UUID | None = None,
    ) -> MapCableRoute:
        variant = self._require_variant(map_id, variant_id)
        self._require_cable(cable_id)
        route = self.session.scalar(
            select(MapCableRoute)
            .where(
                MapCableRoute.map_id == map_id,
                MapCableRoute.cable_id == cable_id,
                MapCableRoute.view_key == MapViewKey.PHYSICAL, MapCableRoute.variant_id == variant.id,
            )
            .with_for_update()
        )
        if route is None:
            route = MapCableRoute(
                map_id=map_id, variant_id=variant.id,
                cable_id=cable_id,
                view_key=MapViewKey.PHYSICAL,
            )
            self.session.add(route)
        route.waypoints = [{"x": point["x"], "y": point["y"]} for point in waypoints]
        self._flush()
        return route

    def delete_cable_route(self, map_id: uuid.UUID, cable_id: uuid.UUID, variant_id: uuid.UUID | None = None) -> None:
        variant = self._require_variant(map_id, variant_id)
        route = self.session.scalar(
            select(MapCableRoute)
            .where(
                MapCableRoute.map_id == map_id,
                MapCableRoute.cable_id == cable_id,
                MapCableRoute.view_key == MapViewKey.PHYSICAL, MapCableRoute.variant_id == variant.id,
            )
            .with_for_update()
        )
        if route is None:
            raise ValidationError("MapCableRoute does not exist", {
                "map_id": str(map_id), "cable_id": str(cable_id),
            })
        self.session.delete(route)
        self.session.flush()

    def create_region(
        self, map_id: uuid.UUID, label: str, points: list[dict[str, float]], label_position: dict[str, float] | None,
        style: dict[str, object], z_order: int, location_id: uuid.UUID | None,
    ) -> MapRegion:
        self._lock_map_for_region_write(map_id)
        self._validate_region_spatial_relation(map_id, points)
        region = MapRegion(map_id=map_id)
        self._replace_region_state(region, label, points, label_position, style, z_order, location_id)
        self.session.add(region)
        self._flush()
        return region

    def replace_region(
        self, map_id: uuid.UUID, region_id: uuid.UUID, label: str, points: list[dict[str, float]],
        label_position: dict[str, float] | None, style: dict[str, object], z_order: int, location_id: uuid.UUID | None,
    ) -> MapRegion:
        self._lock_map_for_region_write(map_id)
        region = self.session.scalar(select(MapRegion).where(
            MapRegion.map_id == map_id, MapRegion.id == region_id
        ).with_for_update())
        if region is None:
            raise ValidationError("MapRegion does not exist", {"map_id": str(map_id), "region_id": str(region_id)})
        self._validate_region_spatial_relation(map_id, points, excluded_region_id=region.id)
        self._replace_region_state(region, label, points, label_position, style, z_order, location_id)
        self._flush()
        return region

    def delete_region(self, map_id: uuid.UUID, region_id: uuid.UUID) -> None:
        self._require_map(map_id)
        region = self.session.scalar(select(MapRegion).where(
            MapRegion.map_id == map_id, MapRegion.id == region_id
        ).with_for_update())
        if region is None:
            raise ValidationError("MapRegion does not exist", {"map_id": str(map_id), "region_id": str(region_id)})
        self.session.delete(region)
        self._flush()

    def create_text_annotation(self, map_id: uuid.UUID, text: str, position: dict[str, float], text_color: str, font_size: float) -> MapTextAnnotation:
        self._require_map(map_id)
        annotation = MapTextAnnotation(map_id=map_id, text=text, position=position, text_color=text_color, font_size=font_size)
        self.session.add(annotation)
        self._flush()
        return annotation

    def replace_text_annotation(self, map_id: uuid.UUID, annotation_id: uuid.UUID, text: str, position: dict[str, float], text_color: str, font_size: float) -> MapTextAnnotation:
        self._require_map(map_id)
        annotation = self.session.scalar(select(MapTextAnnotation).where(MapTextAnnotation.map_id == map_id, MapTextAnnotation.id == annotation_id).with_for_update())
        if annotation is None:
            raise ValidationError("MapTextAnnotation does not exist", {"map_id": str(map_id), "annotation_id": str(annotation_id)})
        annotation.text, annotation.position, annotation.text_color, annotation.font_size = text, position, text_color, font_size
        self._flush()
        return annotation

    def delete_text_annotation(self, map_id: uuid.UUID, annotation_id: uuid.UUID) -> None:
        self._require_map(map_id)
        annotation = self.session.scalar(select(MapTextAnnotation).where(MapTextAnnotation.map_id == map_id, MapTextAnnotation.id == annotation_id).with_for_update())
        if annotation is None:
            raise ValidationError("MapTextAnnotation does not exist", {"map_id": str(map_id), "annotation_id": str(annotation_id)})
        self.session.delete(annotation)
        self._flush()

    def placements(self, map_id: uuid.UUID) -> SavedMapDetail:
        return self.detail(map_id)

    def _require_map(self, map_id: uuid.UUID) -> SavedMap:
        saved_map = self.session.get(SavedMap, map_id)
        if saved_map is None:
            raise ValidationError("SavedMap does not exist", {"map_id": str(map_id)})
        return saved_map

    def _lock_map_for_region_write(self, map_id: uuid.UUID) -> SavedMap:
        saved_map = self.session.scalar(select(SavedMap).where(SavedMap.id == map_id).with_for_update())
        if saved_map is None:
            raise ValidationError("SavedMap does not exist", {"map_id": str(map_id)})
        return saved_map

    def _placements(self, map_id: uuid.UUID, variant_id: uuid.UUID | None = None) -> tuple[MapPlacement, ...]:
        # The Location ref is live canonical context adjacent to a placement. Loading
        # it here is bounded for the one SavedMap scene, never per-object API reads.
        return tuple(self.session.scalars(select(MapPlacement).options(
            selectinload(MapPlacement.view_positions), selectinload(MapPlacement.physical_object)
        ).where(
            MapPlacement.map_id == map_id
        ).order_by(MapPlacement.physical_object_id)))

    def _cable_routes(self, map_id: uuid.UUID, variant_id: uuid.UUID | None = None) -> tuple[MapCableRoute, ...]:
        return tuple(self.session.scalars(
            select(MapCableRoute)
            .where(MapCableRoute.map_id == map_id, MapCableRoute.variant_id == self._require_variant(map_id, variant_id).id)
            .order_by(MapCableRoute.cable_id, MapCableRoute.view_key)
        ))

    def _regions(self, map_id: uuid.UUID) -> tuple[MapRegion, ...]:
        return tuple(self.session.scalars(
            select(MapRegion).where(MapRegion.map_id == map_id).order_by(MapRegion.z_order, MapRegion.id)
        ))

    def _text_annotations(self, map_id: uuid.UUID) -> tuple[MapTextAnnotation, ...]:
        return tuple(self.session.scalars(
            select(MapTextAnnotation).where(MapTextAnnotation.map_id == map_id).order_by(MapTextAnnotation.id)
        ))

    def _variants(self, map_id: uuid.UUID) -> tuple[MapPresentationVariant, ...]:
        return tuple(self.session.scalars(select(MapPresentationVariant).where(MapPresentationVariant.map_id == map_id).order_by(MapPresentationVariant.name, MapPresentationVariant.id)))

    def _require_variant(self, map_id: uuid.UUID, variant_id: uuid.UUID | None) -> MapPresentationVariant:
        query = select(MapPresentationVariant).where(MapPresentationVariant.map_id == map_id)
        query = query.where(MapPresentationVariant.name == "Основной") if variant_id is None else query.where(MapPresentationVariant.id == variant_id)
        variant = self.session.scalar(query)
        if variant is None: raise ValidationError("MapPresentationVariant does not exist on SavedMap", {"map_id": str(map_id), "variant_id": str(variant_id) if variant_id else None})
        return variant

    def _composites(self, map_id: uuid.UUID, variant_id: uuid.UUID) -> tuple[MapComposite, ...]:
        return tuple(self.session.scalars(select(MapComposite).options(selectinload(MapComposite.members).selectinload(MapCompositeMember.placement), selectinload(MapComposite.presentations)).where(MapComposite.map_id == map_id).order_by(MapComposite.name, MapComposite.id)))

    def _validate_region_spatial_relation(
        self, map_id: uuid.UUID, points: list[dict[str, float]], excluded_region_id: uuid.UUID | None = None,
    ) -> None:
        for existing_region in self._regions(map_id):
            if existing_region.id == excluded_region_id:
                continue
            relation = classify_map_region_polygons(points, existing_region.points)
            if relation == MapRegionSpatialRelation.CONFLICT:
                raise ValidationError("MapRegion spatial relation conflicts with an existing Region", {
                    "reason": "MAP_REGION_SPATIAL_CONFLICT",
                    "conflicting_region_id": str(existing_region.id),
                })

    def _replace_region_state(
        self, region: MapRegion, label: str, points: list[dict[str, float]], label_position: dict[str, float] | None,
        style: dict[str, object], z_order: int, location_id: uuid.UUID | None,
    ) -> None:
        if location_id is not None and region.location_id != location_id:
            # Only validates an explicit canonical reference; geometry never infers it.
            if self.session.get(Location, location_id) is None:
                raise ValidationError("Location does not exist", {"location_id": str(location_id)})
        region.label = label
        region.points = [{"x": point["x"], "y": point["y"]} for point in points]
        region.label_position = None if label_position is None else {
            "x": label_position["x"], "y": label_position["y"],
        }
        region.fill_color = str(style["fill_color"])
        region.fill_opacity = float(style["fill_opacity"])
        region.stroke_color = str(style["stroke_color"])
        region.stroke_width = float(style["stroke_width"])
        region.stroke_style = str(style["stroke_style"])
        region.label_color = None if style["label_color"] is None else str(style["label_color"])
        region.z_order = z_order
        region.location_id = location_id

    def _require_cable(self, cable_id: uuid.UUID) -> None:
        if self.session.get(Cable, cable_id) is None:
            raise ValidationError("Cable does not exist", {"cable_id": str(cable_id)})

    def _flush(self) -> None:
        try:
            self.session.flush()
        except IntegrityError as error:
            conflict = classify_integrity_error(error)
            if conflict is not None:
                raise conflict from error
            raise
