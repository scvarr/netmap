from __future__ import annotations

import uuid
from copy import deepcopy
from dataclasses import dataclass
from math import isclose

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.errors import ModelError, ValidationError, classify_integrity_error
from app.device_catalog import DeviceCatalog
from app.location_frame_geometry import layout_location_frames, contains, overlaps, expand_location_frames
from app.models import BuiltInEndpointDefinition, BuiltInEndpointMapping, ObjectConfiguration, PresentationPanel, Location, MapLocationState, MapPlacement, MapPresentationVariant, MapTextAnnotation, MapViewKey, MapViewPosition, PhysicalObject, SavedMap


@dataclass(frozen=True)
class SavedMapDetail:
    saved_map: SavedMap
    placements: tuple[MapPlacement, ...]
    text_annotations: tuple[MapTextAnnotation, ...]
    variant: MapPresentationVariant
    variants: tuple[MapPresentationVariant, ...]
    location_states: tuple[MapLocationState, ...]
    valid_location_refs: dict[uuid.UUID, list[dict[str, str]]]


class SavedMapCatalog:
    """Presentation-only SavedMap storage; it never participates in topology resolution."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def _lock_location_hierarchy(self):
        # Presentation writers share the hierarchy; canonical tree/assignment
        # writers take FOR UPDATE. Never first acquire this after position DML.
        with self.session.no_autoflush:
            return self.session.scalars(select(Location).order_by(Location.id)
                .with_for_update(read=True).execution_options(populate_existing=True)).all()

    def _lock_physical_layout(self, map_id, variant_id):
        locations = self._lock_location_hierarchy()
        return locations, self._require_variant(map_id, variant_id, lock=True)

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
        states = self._location_states(variant.id)
        return SavedMapDetail(saved_map, self._placements(map_id, variant.id), self._text_annotations(map_id), variant, self._variants(map_id), states, self._valid_location_refs(states))

    def create_variant(self, map_id: uuid.UUID, name: str, source_variant_id: uuid.UUID) -> MapPresentationVariant:
        self._require_map(map_id)
        # Serialize copying with canonical mutations before reading source JSON.
        self._lock_location_hierarchy()
        self._lock_object_layout_maps([map_id])
        source = self._require_variant(map_id, source_variant_id, lock=True)
        variant = MapPresentationVariant(map_id=map_id, name=name, automatic_layout=deepcopy(source.automatic_layout), default_face=source.default_face)
        self.session.add(variant)
        self._flush()
        source_positions = self.session.scalars(select(MapViewPosition).join(MapPlacement).where(
            MapPlacement.map_id == map_id, MapViewPosition.variant_id == source.id
        ))
        self.session.add_all(MapViewPosition(
            placement_id=position.placement_id, variant_id=variant.id, view_key=position.view_key,
            x=position.x, y=position.y, locked=position.locked, display_width=position.display_width,
            face_override=position.face_override,
        ) for position in source_positions)
        self.session.add_all(MapLocationState(
            variant_id=variant.id, location_id=state.location_id, collapsed=state.collapsed,
            face_override=state.face_override,
            geometry=dict(state.geometry), manual_bounds=dict(state.manual_bounds) if state.manual_bounds else None,
            visible_direct_elements=[dict(ref) for ref in state.visible_direct_elements],
        ) for state in self._location_states(source.id))
        self._flush()
        return variant

    def set_face(self, map_id, variant_id, face, kind=None, entity_id=None):
        self._require_map(map_id)
        locations, variant = self._lock_physical_layout(map_id, variant_id)
        override = None if face == "INHERIT" else face
        if kind is None:
            if override is None:
                raise ValidationError("A presentation variant requires FRONT or REAR")
            variant.default_face = override
        elif kind == "locations":
            if not any(location.id == entity_id for location in locations):
                raise ValidationError("Location does not exist")
            state = self.session.scalar(select(MapLocationState).where(
                MapLocationState.variant_id == variant.id, MapLocationState.location_id == entity_id,
            ).with_for_update())
            if state is None:
                if override is None:
                    return
                state = MapLocationState(variant_id=variant.id, location_id=entity_id)
                self.session.add(state)
            state.face_override = override
        else:
            position = self.session.scalar(select(MapViewPosition).join(MapPlacement).where(
                MapPlacement.map_id == map_id, MapPlacement.physical_object_id == entity_id,
                MapViewPosition.variant_id == variant.id, MapViewPosition.view_key == MapViewKey.PHYSICAL,
            ).with_for_update(of=MapViewPosition))
            if position is None:
                raise ValidationError("PhysicalObject has no position in this map variant")
            position.face_override = override
        self._flush()

    def set_automatic_layout(self, map_id, variant_id, settings):
        locations, variant = self._lock_physical_layout(map_id, variant_id)
        if settings is not None:
            parents = {str(location.id): str(location.parent_location_id) if location.parent_location_id else "root" for location in locations}
            assignments = {str(key): str(parent) if parent else "root" for key, parent in self.session.execute(
                select(PhysicalObject.id, PhysicalObject.location_id).join(MapPlacement, MapPlacement.physical_object_id == PhysicalObject.id).where(MapPlacement.map_id == map_id))}
            if settings.get("mode") == "uniform_grid":
                from app.uniform_location_grid import validate_grid, validate_object_sequences
                try:
                    validate_grid(settings, parents)
                    validate_object_sequences(settings, parents, assignments)
                except ValueError as error:
                    raise ValidationError(str(error)) from error
            for container, entry in settings.get("containers", {}).items():
                if container != "root" and container not in parents:
                    raise ValidationError("Unknown layout container")
                order = entry["order"]
                if len(order) != len(set(order)):
                    raise ValidationError("Duplicate layout element")
                for key in order:
                    kind, _, identity = key.partition(":")
                    if (parents if kind == "Location" else assignments if kind == "PhysicalObject" else {}).get(identity) != container:
                        raise ValidationError("Layout element is not a direct child")
        variant.automatic_layout = deepcopy(settings)
        self._flush()

    def set_location_state(self, map_id: uuid.UUID, variant_id: uuid.UUID, location_id: uuid.UUID, collapsed: bool, refs: list[dict[str, str]]) -> MapLocationState:
        self._require_map(map_id)
        self._lock_physical_layout(map_id, variant_id)
        if self.session.get(Location, location_id) is None:
            raise ValidationError("Location does not exist", {"location_id": str(location_id)})
        keys = [(ref["entity_type"], ref["entity_id"]) for ref in refs]
        if len(keys) != len(set(keys)):
            raise ValidationError("Duplicate visible direct element", {"location_id": str(location_id)})
        for kind, entity_id in keys:
            entity = self.session.get(PhysicalObject if kind == "PhysicalObject" else Location, uuid.UUID(entity_id))
            parent_id = (entity.location_id if kind == "PhysicalObject" else entity.parent_location_id) if entity else None
            if entity is None or parent_id != location_id:
                raise ValidationError("Visible element is not a direct canonical element of Location", {"entity_type": kind, "entity_id": entity_id, "location_id": str(location_id)})
        state = self.session.scalar(select(MapLocationState).where(MapLocationState.variant_id == variant_id, MapLocationState.location_id == location_id).with_for_update())
        if state is None:
            state = MapLocationState(variant_id=variant_id, location_id=location_id)
            self.session.add(state)
        state.collapsed = collapsed
        state.visible_direct_elements = refs
        self._flush()
        return state

    def direct_location_elements(self, map_id: uuid.UUID, variant_id: uuid.UUID, location_id: uuid.UUID) -> list[dict[str, object]]:
        self._require_map(map_id)
        self._require_variant(map_id, variant_id)
        if self.session.get(Location, location_id) is None:
            raise ValidationError("Location does not exist", {"location_id": str(location_id)})
        children = self.session.scalars(select(Location).where(Location.parent_location_id == location_id).order_by(Location.name, Location.id)).all()
        object_ids = self.session.scalars(
            select(PhysicalObject.id).join(MapPlacement, MapPlacement.physical_object_id == PhysicalObject.id)
            .where(PhysicalObject.location_id == location_id, MapPlacement.map_id == map_id).order_by(PhysicalObject.id)
        ).all()
        aliases = DeviceCatalog(self.session).physical_object_display_aliases(list(object_ids))
        return [
            *({"ref": {"entity_type": "Location", "entity_id": child.id}, "label": child.name} for child in children),
            *({"ref": {"entity_type": "PhysicalObject", "entity_id": object_id}, "label": aliases[object_id].value if object_id in aliases else f"PhysicalObject {object_id}"} for object_id in object_ids),
        ]

    def set_location_boundary_placement(self, map_id, variant_id, location_id, placement):
        from app.schemas import MapLocationBoundaryPlacement
        placement = MapLocationBoundaryPlacement.model_validate(placement).model_dump()
        self._require_map(map_id)
        locations, _ = self._lock_physical_layout(map_id, variant_id)
        if location_id not in {location.id for location in locations}:
            raise ValidationError("Location does not exist", {"location_id": str(location_id)})
        state = self.session.scalar(select(MapLocationState).where(
            MapLocationState.variant_id == variant_id,
            MapLocationState.location_id == location_id).with_for_update())
        if state is None:
            state = MapLocationState(variant_id=variant_id, location_id=location_id)
            self.session.add(state)
        # Materialize only this state's existing effective geometry if absent;
        # automatic frames remain derived and no bounds are accepted from clients.
        geometry = state.geometry
        if geometry is None:
            geometry = next(item.geometry for item in self._location_states(variant_id) if item.location_id == location_id)
        state.geometry = {**geometry, **placement}
        self._flush()

    def set_location_geometry(self, map_id, variant_id, location_id, geometry):
        from app.schemas import MapLocationGeometry
        geometry = MapLocationGeometry.model_validate(geometry).model_dump()
        self._require_map(map_id)
        locations, variant = self._lock_physical_layout(map_id, variant_id)
        if variant.automatic_layout is not None:
            raise ValidationError("Automatic layout geometry cannot be edited")
        parents = {loc.id: loc.parent_location_id for loc in locations}
        if location_id not in parents:
            raise ValidationError("Location does not exist", {"location_id": str(location_id)})
        states = self._location_states(variant_id)
        frames = {state.location_id: dict(state.geometry) for state in states}
        original = frames[location_id]
        dx, dy = geometry["x"] - original["x"], geometry["y"] - original["y"]
        subtree = {location_id}
        while True:
            expanded = subtree | {key for key, parent in parents.items() if parent in subtree}
            if expanded == subtree:
                break
            subtree = expanded
        for key in subtree - {location_id}:
            frames[key] = {**frames[key], "x": frames[key]["x"] + dx, "y": frames[key]["y"] + dy}
        manual = {state.location_id: dict(state.manual_bounds) for state in states if state.manual_bounds}
        for key in subtree:
            if key in manual:
                manual[key]["x"] += dx
                manual[key]["y"] += dy
        if geometry["width"] != original["width"] or geometry["height"] != original["height"]:
            manual[location_id] = {key: geometry[key] for key in ("x", "y", "width", "height")}
        frames[location_id] = geometry
        records, footprints = self._physical_geometry(map_id, variant_id)
        contents = {}
        for position, object_id, assigned in records:
            contents.setdefault(assigned, []).append({**footprints[object_id], "x": position.x + (dx if assigned in subtree else 0), "y": position.y + (dy if assigned in subtree else 0)})
        translations = {key: (dx, dy) for key in subtree} if dx or dy else {}
        protected = set(subtree)
        parent = parents[location_id]
        while parent is not None:
            protected.add(parent)
            parent = parents[parent]
        frames = expand_location_frames(parents, frames, contents, protected=protected, translations=translations, manual_bounds=manual, names={loc.id: loc.name for loc in locations})
        self._apply_container_translations(map_id, variant_id, parents, states, translations)
        self._store_frames(variant_id, states, frames, manual)
        self._flush()

    def _apply_container_translations(self, map_id, variant_id, parents, states, translations):
        original = {state.location_id: state.geometry for state in states}
        roots = [key for key in translations if translations[key] != (0, 0) and translations.get(parents[key]) != translations[key]]
        for key in sorted(roots, key=lambda key: original[key]["y"], reverse=True):
            records, footprints = self._physical_geometry(map_id, variant_id)
            subtree = {key}
            while True:
                expanded = subtree | {child for child, parent in parents.items() if parent in subtree}
                if expanded == subtree:
                    break
                subtree = expanded
            moving = {object_id for _, object_id, assigned in records if assigned in subtree}
            if moving:
                dx, dy = translations[key]
                self.move_location_group(map_id, variant_id, key, dx, dy, list(footprints.values()))

    def _physical_geometry(self, map_id, variant_id):
        records = self.session.execute(select(MapViewPosition, MapPlacement.physical_object_id, PhysicalObject.location_id)
            .join(MapPlacement, MapPlacement.id == MapViewPosition.placement_id)
            .join(PhysicalObject, PhysicalObject.id == MapPlacement.physical_object_id)
            .where(MapPlacement.map_id == map_id, MapViewPosition.variant_id == variant_id,
                   MapViewPosition.view_key == MapViewKey.PHYSICAL).with_for_update(of=MapViewPosition)).all()
        panels = {}
        for object_id, panel in self.session.execute(select(ObjectConfiguration.physical_object_id, PresentationPanel)
                .join(PresentationPanel, PresentationPanel.base_revision_id == ObjectConfiguration.base_revision_id)
                .where(ObjectConfiguration.physical_object_id.in_([r[1] for r in records]))):
            panels.setdefault(object_id, []).append(panel)
        variant = self._require_variant(map_id, variant_id)
        parents = dict(self.session.execute(select(Location.id, Location.parent_location_id)).all())
        overrides = dict(self.session.execute(select(MapLocationState.location_id, MapLocationState.face_override)
            .where(MapLocationState.variant_id == variant_id, MapLocationState.face_override.is_not(None))).all())

        def effective_face(position, assigned):
            if position.face_override is not None:
                return position.face_override
            while assigned is not None:
                if assigned in overrides:
                    return overrides[assigned]
                assigned = parents.get(assigned)
            return variant.default_face

        footprints = {}
        for position, object_id, assigned in records:
            width, height = 212, 144
            if object_id in panels:
                bounds = panels[object_id]
                if len(bounds) > 1:
                    face = effective_face(position, assigned)
                    bounds = [panel for panel in bounds if panel.face is None or panel.face == face]
                from app.hardware_catalog import HardwareCatalog
                from app.object_frame_geometry import object_frame_dimensions
                slots = self.session.scalars(select(BuiltInEndpointDefinition)
                    .join(BuiltInEndpointMapping, BuiltInEndpointMapping.definition_id == BuiltInEndpointDefinition.id)
                    .join(ObjectConfiguration, ObjectConfiguration.id == BuiltInEndpointMapping.configuration_id)
                    .where(ObjectConfiguration.physical_object_id == object_id)).all()
                by_key = {panel.panel_key: panel for panel in bounds}
                centres = [(by_key[slot.panel_key].x + by_key[slot.panel_key].width * slot.position_x,
                            by_key[slot.panel_key].y + by_key[slot.panel_key].height * slot.position_y) for slot in slots if slot.panel_key in by_key]
                for bay in HardwareCatalog(self.session).configuration_document(object_id)["bays"]:
                    if bay["installation"] and bay["panel_key"] in by_key:
                        panel = by_key[bay["panel_key"]]
                        centres.extend((panel.x + panel.width * endpoint["x"], panel.y + panel.height * endpoint["y"])
                                       for endpoint in bay["installation"]["endpoints"])
                width, height = object_frame_dimensions(bounds, centres, position.display_width)
            footprints[object_id] = {"physical_object_id": object_id, "x": position.x, "y": position.y, "width": width, "height": height}
        return records, footprints

    def _store_frames(self, variant_id, states, frames, manual):
        stored = {state.location_id: state for state in self.session.scalars(
            select(MapLocationState).where(MapLocationState.variant_id == variant_id))}
        for state in states:
            record = stored.get(state.location_id)
            if record is None:
                record = MapLocationState(variant_id=variant_id, location_id=state.location_id,
                                          collapsed=state.collapsed, visible_direct_elements=state.visible_direct_elements)
                self.session.add(record)
            record.geometry = frames[state.location_id]
            record.manual_bounds = manual.get(state.location_id)

    def place_assigned_object(self, object_id, *, map_id=None, variant_id=None, relocate=True):
        locations = self._lock_location_hierarchy()
        assignment = self.session.get(PhysicalObject, object_id).location_id
        if assignment is None:
            return
        query = select(MapPlacement.map_id, MapViewPosition.variant_id).join(MapViewPosition).where(
            MapPlacement.physical_object_id == object_id, MapViewPosition.view_key == MapViewKey.PHYSICAL)
        if map_id is not None:
            query = query.where(MapPlacement.map_id == map_id, MapViewPosition.variant_id == variant_id)
        targets = self.session.execute(query.order_by(MapViewPosition.variant_id)).all()
        # Assignment may affect several variants: acquire all variant locks in
        # UUID order before touching any of their dependent presentation rows.
        for target_map, target_variant in targets:
            self._require_variant(target_map, target_variant, lock=True)
        for target_map, target_variant in targets:
            if self._require_variant(target_map, target_variant).automatic_layout is not None:
                continue
            parents = {location.id: location.parent_location_id for location in locations}
            states = self._location_states(target_variant)
            frames = {state.location_id: dict(state.geometry) for state in states}
            records, footprints = self._physical_geometry(target_map, target_variant)
            position = next(pos for pos, key, _ in records if key == object_id)
            original = footprints[object_id]
            candidate = dict(original)
            ancestors = {assignment}
            parent = parents[assignment]
            while parent is not None:
                ancestors.add(parent)
                parent = parents[parent]
            descendants = {assignment}
            while True:
                expanded = descendants | {key for key, parent in parents.items() if parent in descendants}
                if expanded == descendants:
                    break
                descendants = expanded
            object_locations = {key: assigned for _, key, assigned in records}
            # Sibling containers can be pushed with their contents. They must not
            # force a new object to the far end of the entire map before expansion.
            obstacles = [g for key, g in footprints.items() if key != object_id and
                         (object_locations[key] is None or object_locations[key] in descendants or object_locations[key] in ancestors)]
            obstacles += [g for key, g in frames.items() if key in descendants - {assignment}]
            if relocate and (not contains(frames[assignment], candidate) or any(overlaps(candidate, o) for o in obstacles)):
                candidate["x"], candidate["y"] = frames[assignment]["x"] + 20, frames[assignment]["y"] + 40
                for _ in range(len(obstacles) + 1):
                    conflicts = [o for o in obstacles if overlaps(candidate, o)]
                    if not conflicts:
                        break
                    candidate["y"] = max(o["y"] + o["height"] + 20 for o in conflicts)
            dx, dy = candidate["x"] - original["x"], candidate["y"] - original["y"]
            if position.locked and (dx or dy):
                raise ValidationError("Assigned object has a locked map position", {"physical_object_id": str(object_id)})
            contents = {}
            for pos, key, assigned in records:
                contents.setdefault(assigned, []).append(candidate if key == object_id else footprints[key])
            translations = {}
            manual = {state.location_id: dict(state.manual_bounds) for state in states if state.manual_bounds}
            frames = expand_location_frames(parents, frames, contents, protected=ancestors, translations=translations, manual_bounds=manual, names={loc.id: loc.name for loc in locations})
            self._apply_container_translations(target_map, target_variant, parents, states, translations)
            _, final_footprints = self._physical_geometry(target_map, target_variant)
            if any(overlaps(candidate, other) for key, other in final_footprints.items() if key != object_id):
                raise ValidationError("PhysicalObject placement overlaps another object", {})
            position.x, position.y = candidate["x"], candidate["y"]
            self._store_frames(target_variant, states, frames, manual)
            self._flush()

    def synchronize_uniform_grids(self):
        """Caller holds the canonical hierarchy lock; variants lock in UUID order."""
        from app.uniform_location_grid import reconcile_grid
        locations = self.session.scalars(select(Location).order_by(Location.id)).all()
        parents = {str(loc.id): str(loc.parent_location_id) if loc.parent_location_id else "root" for loc in locations}
        # Lock before reading JSON, including variants without geometry/state rows.
        variants = self.session.scalars(select(MapPresentationVariant)
            .order_by(MapPresentationVariant.id).with_for_update()
            .execution_options(populate_existing=True)).all()
        for variant in variants:
            settings = variant.automatic_layout
            if settings is not None and settings.get("mode") == "uniform_grid":
                reconciled = reconcile_grid(settings, parents)
                if reconciled != settings:
                    variant.automatic_layout = reconciled
        self._flush()

    def _lock_object_layout_maps(self, map_ids):
        # Serialize placement membership with variant copies, even if Location is empty.
        self.session.scalars(select(SavedMap.id).where(SavedMap.id.in_(map_ids))
            .order_by(SavedMap.id).with_for_update(key_share=True)).all()

    def lock_object_layout_variants(self, map_ids):
        self._lock_object_layout_maps(map_ids)
        return self.session.scalars(select(MapPresentationVariant)
            .where(MapPresentationVariant.map_id.in_(map_ids))
            .order_by(MapPresentationVariant.id).with_for_update()
            .execution_options(populate_existing=True)).all()

    def lock_placed_object_layouts(self, object_id):
        map_ids = list(self.session.scalars(select(MapPlacement.map_id)
            .where(MapPlacement.physical_object_id == object_id)))
        return self.lock_object_layout_variants(map_ids) if map_ids else []

    def synchronize_object_layouts(self, variants):
        from app.uniform_location_grid import reconcile_object_sequences
        grids = [variant for variant in variants if (variant.automatic_layout or {}).get("mode") == "uniform_grid"]
        if not grids:
            return
        assignments = {variant.map_id: {} for variant in grids}
        records = self.session.execute(select(MapPlacement.map_id, PhysicalObject.id, PhysicalObject.location_id)
            .join(PhysicalObject, PhysicalObject.id == MapPlacement.physical_object_id)
            .where(MapPlacement.map_id.in_(assignments)))
        for map_id, key, parent in records:
            assignments[map_id][str(key)] = str(parent) if parent else "root"
        for variant in grids:
            settings = variant.automatic_layout
            reconciled = reconcile_object_sequences(settings, assignments[variant.map_id])
            if reconciled != settings:
                variant.automatic_layout = reconciled
        self._flush()

    def synchronize_location_structure(self):
        """Canonical tree edits initialize presentation space, moving saved contents together."""
        locations = self.session.scalars(select(Location).order_by(Location.id).with_for_update()).all()
        self.synchronize_uniform_grids()
        parents = {location.id: location.parent_location_id for location in locations}
        variants = self.session.scalars(select(MapPresentationVariant).join(MapLocationState)
            .where(MapLocationState.geometry.is_not(None)).distinct().order_by(MapPresentationVariant.id)).all()
        for variant in variants:
            self.session.scalar(select(MapPresentationVariant).where(MapPresentationVariant.id == variant.id).with_for_update())
            if variant.automatic_layout is not None:
                continue
            states = self._location_states(variant.id)
            frames = {state.location_id: dict(state.geometry) for state in states}
            saved = {state.location_id: state.geometry for state in self.session.scalars(
                select(MapLocationState).where(MapLocationState.variant_id == variant.id, MapLocationState.geometry.is_not(None)))}
            translations = {key: (g["x"] - saved[key]["x"], g["y"] - saved[key]["y"])
                            for key, g in frames.items() if key in saved and (g["x"], g["y"]) != (saved[key]["x"], saved[key]["y"])}
            records, footprints = self._physical_geometry(variant.map_id, variant.id)
            contents = {}
            for _, object_id, assigned in records:
                dx, dy = translations.get(assigned, (0, 0))
                g = footprints[object_id]
                contents.setdefault(assigned, []).append({**g, "x": g["x"] + dx, "y": g["y"] + dy})
            manual = {state.location_id: dict(state.manual_bounds) for state in states if state.manual_bounds}
            for key, (dx, dy) in translations.items():
                if key in manual:
                    manual[key]["x"] += dx
                    manual[key]["y"] += dy
            frames = expand_location_frames(parents, frames, contents, translations=translations, manual_bounds=manual, names={loc.id: loc.name for loc in locations})
            originals = [MapLocationState(location_id=state.location_id, geometry=saved.get(state.location_id, state.geometry)) for state in states]
            self._apply_container_translations(variant.map_id, variant.id, parents, originals, translations)
            self._store_frames(variant.id, states, frames, manual)
        self._flush()

    def _location_states(self, variant_id: uuid.UUID) -> tuple[MapLocationState, ...]:
        stored = {state.location_id: state for state in self.session.scalars(
            select(MapLocationState).where(MapLocationState.variant_id == variant_id))}
        locations = self.session.scalars(select(Location).order_by(Location.id)).all()
        parents = {location.id: location.parent_location_id for location in locations}
        frames = layout_location_frames(parents, {key: state.geometry for key, state in stored.items() if state.geometry is not None}, {location.id: location.name for location in locations})
        return tuple(MapLocationState(
            variant_id=variant_id, location_id=key,
            collapsed=stored[key].collapsed if key in stored else False,
            visible_direct_elements=stored[key].visible_direct_elements if key in stored else [],
            geometry=frames[key], manual_bounds=stored[key].manual_bounds if key in stored else None,
            face_override=stored[key].face_override if key in stored else None,
        ) for key in parents)

    def _valid_location_refs(self, states: tuple[MapLocationState, ...]) -> dict[uuid.UUID, list[dict[str, str]]]:
        object_ids = {uuid.UUID(ref["entity_id"]) for state in states for ref in state.visible_direct_elements if ref["entity_type"] == "PhysicalObject"}
        location_ids = {uuid.UUID(ref["entity_id"]) for state in states for ref in state.visible_direct_elements if ref["entity_type"] == "Location"}
        objects = dict(self.session.execute(select(PhysicalObject.id, PhysicalObject.location_id).where(PhysicalObject.id.in_(object_ids))).all()) if object_ids else {}
        locations = dict(self.session.execute(select(Location.id, Location.parent_location_id).where(Location.id.in_(location_ids))).all()) if location_ids else {}
        return {state.location_id: [ref for ref in state.visible_direct_elements if (
            objects if ref["entity_type"] == "PhysicalObject" else locations
        ).get(uuid.UUID(ref["entity_id"])) == state.location_id] for state in states}

    def delete_variant(self, map_id: uuid.UUID, variant_id: uuid.UUID) -> None:
        variant = self._require_variant(map_id, variant_id)
        if variant.name == "Основной":
            raise ValidationError("Основной MapPresentationVariant cannot be deleted", {"variant_id": str(variant_id)})
        self.session.delete(variant)
        self._flush()

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
        self._lock_location_hierarchy()
        if self.session.scalar(select(PhysicalObject.id).where(PhysicalObject.id == physical_object_id)
                .with_for_update(read=True, key_share=True)) is None:
            raise ValidationError("PhysicalObject does not exist", {"physical_object_id": str(physical_object_id)})
        variants = self.lock_object_layout_variants([map_id])
        variant = self._require_variant(map_id, variant_id)
        if self.session.scalar(select(MapPlacement.id).where(
            MapPlacement.map_id == map_id, MapPlacement.physical_object_id == physical_object_id
        )) is not None:
            raise ModelError("PhysicalObject is already placed on SavedMap", {
                "reason": "MAP_PLACEMENT_CONFLICT", "map_id": str(map_id), "physical_object_id": str(physical_object_id),
            })
        placement = MapPlacement(map_id=map_id, physical_object_id=physical_object_id)
        placement.view_positions.append(MapViewPosition(
            variant_id=variant.id, view_key=MapViewKey.PHYSICAL, x=x, y=y, display_width=display_width
        ))
        self.session.add(placement)
        self._flush()
        self.place_assigned_object(physical_object_id, map_id=map_id, variant_id=placement.view_positions[0].variant_id)
        self.synchronize_object_layouts(variants)
        return placement

    def move_placement(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, x: float, y: float, display_width: float | None = None) -> MapPlacement:
        """Compatibility operation: update the physical presentation position only."""
        return self.set_view_position(map_id, physical_object_id, MapViewKey.PHYSICAL, x, y, display_width)

    def set_view_position(self, map_id: uuid.UUID, physical_object_id: uuid.UUID, view_key: MapViewKey, x: float, y: float, display_width: float | None = None, variant_id: uuid.UUID | None = None) -> MapPlacement:
        if display_width is not None and view_key != MapViewKey.PHYSICAL:
            raise ValidationError("display_width is supported only by the physical map view", {"view_key": str(view_key)})
        if view_key == MapViewKey.PHYSICAL:
            _, variant = self._lock_physical_layout(map_id, variant_id)
            if variant.automatic_layout is not None:
                raise ValidationError("Automatic layout positions cannot be edited")
        else:
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
            if position.locked and (position.x != x or position.y != y or (display_width is not None and display_width != position.display_width)):
                raise ValidationError("Map position is locked", {})
            position.x, position.y = x, y
            if display_width is not None:
                position.display_width = display_width
        self._flush()
        if view_key == MapViewKey.PHYSICAL:
            self.place_assigned_object(physical_object_id, map_id=map_id, variant_id=variant.id, relocate=False)
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
        self._lock_location_hierarchy()
        variants = self.lock_object_layout_variants([map_id])
        placement = self.session.scalar(select(MapPlacement).where(
            MapPlacement.map_id == map_id, MapPlacement.physical_object_id == physical_object_id
        ).with_for_update())
        if placement is None:
            raise ValidationError("MapPlacement does not exist", {
                "map_id": str(map_id), "physical_object_id": str(physical_object_id),
            })
        self.session.delete(placement)
        self._flush()
        self.synchronize_object_layouts(variants)

    def move_location_group(
        self, map_id: uuid.UUID, variant_id: uuid.UUID, location_id: uuid.UUID,
        delta_x: float, delta_y: float,
        footprints: list[dict[str, object]],
    ) -> None:
        """Move one canonical Location subtree within one physical presentation variant."""
        _, variant = self._lock_physical_layout(map_id, variant_id)
        if variant.automatic_layout is not None:
            raise ValidationError("Automatic layout geometry cannot be edited")
        if self.session.get(Location, location_id) is None:
            raise ValidationError("Location does not exist", {"location_id": str(location_id)})
        subtree = select(Location.id).where(Location.id == location_id).cte("moving_locations", recursive=True)
        subtree = subtree.union_all(select(Location.id).join(subtree, Location.parent_location_id == subtree.c.id))
        location_ids = set(self.session.scalars(select(subtree.c.id)))
        records = self.session.execute(select(MapViewPosition, MapPlacement.physical_object_id, PhysicalObject.location_id)
            .join(MapPlacement, MapPlacement.id == MapViewPosition.placement_id)
            .join(PhysicalObject, PhysicalObject.id == MapPlacement.physical_object_id)
            .where(MapPlacement.map_id == map_id, MapViewPosition.variant_id == variant_id,
                   MapViewPosition.view_key == MapViewKey.PHYSICAL).with_for_update(of=MapViewPosition)).all()
        positions = {object_id: position for position, object_id, _ in records}
        moving_ids = {object_id for _, object_id, canonical_location_id in records if canonical_location_id in location_ids}
        if not moving_ids:
            raise ValidationError("Location has no physical positions in this variant", {})
        if any(positions[object_id].locked for object_id in moving_ids):
            raise ValidationError("Location group contains a locked position", {})
        geometry = {item["physical_object_id"]: item for item in footprints}
        if len(geometry) != len(footprints) or set(geometry) != set(positions):
            raise ValidationError("Location group footprint snapshot is incomplete", {})
        for object_id, item in geometry.items():
            position = positions[object_id]
            if not isclose(item["x"], position.x, abs_tol=1e-7) or not isclose(item["y"], position.y, abs_tol=1e-7):
                raise ValidationError("Location group footprint snapshot is stale", {})
        for moving_id in moving_ids:
            source = geometry[moving_id]
            x, y = source["x"] + delta_x, source["y"] + delta_y
            for external_id in positions.keys() - moving_ids:
                other = geometry[external_id]
                if x < other["x"] + other["width"] and x + source["width"] > other["x"] and y < other["y"] + other["height"] and y + source["height"] > other["y"]:
                    raise ValidationError("Location group collides with an external PhysicalObject", {"physical_object_id": str(external_id)})
        for object_id in moving_ids:
            positions[object_id].x += delta_x
            positions[object_id].y += delta_y
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

    def _placements(self, map_id: uuid.UUID, variant_id: uuid.UUID | None = None) -> tuple[MapPlacement, ...]:
        # The Location ref is live canonical context adjacent to a placement. Loading
        # it here is bounded for the one SavedMap scene, never per-object API reads.
        return tuple(self.session.scalars(select(MapPlacement).options(
            selectinload(MapPlacement.view_positions), selectinload(MapPlacement.physical_object)
        ).where(
            MapPlacement.map_id == map_id
        ).order_by(MapPlacement.physical_object_id)))

    def _text_annotations(self, map_id: uuid.UUID) -> tuple[MapTextAnnotation, ...]:
        return tuple(self.session.scalars(
            select(MapTextAnnotation).where(MapTextAnnotation.map_id == map_id).order_by(MapTextAnnotation.id)
        ))

    def _variants(self, map_id: uuid.UUID) -> tuple[MapPresentationVariant, ...]:
        return tuple(self.session.scalars(select(MapPresentationVariant).where(MapPresentationVariant.map_id == map_id).order_by(MapPresentationVariant.name, MapPresentationVariant.id)))

    def _require_variant(self, map_id: uuid.UUID, variant_id: uuid.UUID | None, *, lock: bool = False) -> MapPresentationVariant:
        query = select(MapPresentationVariant).where(MapPresentationVariant.map_id == map_id)
        query = query.where(MapPresentationVariant.name == "Основной") if variant_id is None else query.where(MapPresentationVariant.id == variant_id)
        if lock:
            query = query.with_for_update()
        variant = self.session.scalar(query)
        if variant is None: raise ValidationError("MapPresentationVariant does not exist on SavedMap", {"map_id": str(map_id), "variant_id": str(variant_id) if variant_id else None})
        return variant

    def _flush(self) -> None:
        try:
            self.session.flush()
        except IntegrityError as error:
            conflict = classify_integrity_error(error)
            if conflict is not None:
                raise conflict from error
            raise
