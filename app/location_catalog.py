from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ModelError, ValidationError
from app.models import Location, PhysicalObject


class LocationCatalog:
    """Canonical Location writes, deliberately separate from SavedMap presentation."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self) -> tuple[Location, ...]:
        return tuple(self.session.scalars(select(Location).order_by(Location.id)))

    def get(self, location_id: uuid.UUID) -> Location:
        return self._require_location(location_id)

    def create(
        self,
        name: str,
        type_: str | None,
        parent_location_id: uuid.UUID | None,
    ) -> Location:
        if parent_location_id is not None:
            self._require_location(parent_location_id, lock=True)
        location = Location(
            name=self._trim_required(name, "Location name"),
            type=self._trim_optional(type_, "Location type"),
            parent_location_id=parent_location_id,
        )
        self.session.add(location)
        self.session.flush()
        return location

    @staticmethod
    def series_names(pattern: str, from_: int, to: int, step: int) -> tuple[str, ...]:
        if len(pattern) > 255:
            raise ValidationError("Location pattern is too long")
        groups = list(re.finditer(r"#+", pattern))
        if len(groups) != 1:
            raise ValidationError("Pattern must contain exactly one continuous # group")
        if step == 0 or (to - from_) * step < 0:
            raise ValidationError("Step must move from From toward To and cannot be zero")
        group = groups[0]
        count = abs(to - from_) // abs(step) + 1
        # A preview is returned in one HTTP response; bound pathological allocations.
        if count > 10_000:
            raise ValidationError("Location series exceeds 10000 names")
        prefix, suffix = pattern[:group.start()], pattern[group.end():]
        width = len(group.group())
        maximum = 10 ** width
        names: list[str] = []
        seen: set[str] = set()
        for value in range(from_, to + (1 if step > 0 else -1), step):
            if abs(value) >= maximum:
                raise ValidationError("Number exceeds pattern width", {"value": value, "width": width})
            digits = str(abs(value))
            name = LocationCatalog._trim_required(
                f"{prefix}{'-' if value < 0 else ''}{digits.zfill(width)}{suffix}", "Location name"
            )
            if name in seen:
                raise ValidationError("Location series contains duplicate names", {"name": name})
            seen.add(name)
            names.append(name)
        return tuple(names)

    def preview_series(
        self, parent_location_id: uuid.UUID, pattern: str, from_: int, to: int, step: int,
        type_: str | None = None, *, lock: bool = False,
    ) -> tuple[tuple[str, ...], tuple[str, ...]]:
        self._require_location(parent_location_id, lock=lock)
        self._trim_optional(type_, "Location type")
        names = self.series_names(pattern, from_, to, step)
        query = select(Location).where(Location.parent_location_id == parent_location_id)
        if lock:
            query = query.with_for_update()
        existing = {child.name for child in self.session.scalars(query)}
        return names, tuple(name for name in names if name in existing)

    def create_series(
        self, parent_location_id: uuid.UUID, pattern: str, from_: int, to: int,
        step: int, type_: str | None,
    ) -> tuple[Location, ...]:
        names, conflicts = self.preview_series(parent_location_id, pattern, from_, to, step, type_, lock=True)
        if conflicts:
            raise ValidationError("Location series conflicts with existing children", {"conflicts": conflicts})
        normalized_type = self._trim_optional(type_, "Location type")
        locations = tuple(Location(name=name, type=normalized_type, parent_location_id=parent_location_id) for name in names)
        self.session.add_all(locations)
        self.session.flush()
        return locations

    def update(self, location_id: uuid.UUID, name: str, type_: str | None) -> Location:
        location = self._require_location(location_id, lock=True)
        location.name = self._trim_required(name, "Location name")
        location.type = self._trim_optional(type_, "Location type")
        self.session.flush()
        return location

    def reparent(self, location_id: uuid.UUID, parent_location_id: uuid.UUID | None) -> Location:
        # Locking the small hierarchy serializes concurrent reparent operations,
        # so two valid independent writes cannot commit an indirect cycle.
        locations = {
            location.id: location
            for location in self.session.scalars(select(Location).with_for_update())
        }
        location = locations.get(location_id)
        if location is None:
            raise ValidationError("Location does not exist", {"location_id": str(location_id)})
        if parent_location_id is None:
            location.parent_location_id = None
        else:
            parent = locations.get(parent_location_id)
            if parent is None:
                raise ValidationError(
                    "Parent Location does not exist",
                    {"parent_location_id": str(parent_location_id)},
                )
            if parent.id == location.id:
                raise ValidationError(
                    "Location cannot be its own parent",
                    {"location_id": str(location_id)},
                )
            ancestor = parent
            while ancestor.parent_location_id is not None:
                if ancestor.parent_location_id == location.id:
                    raise ValidationError(
                        "Location parent would create a cycle",
                        {
                            "reason": "LOCATION_HIERARCHY_CYCLE",
                            "location_id": str(location_id),
                            "parent_location_id": str(parent_location_id),
                        },
                    )
                ancestor = locations[ancestor.parent_location_id]
            location.parent_location_id = parent.id
        self.session.flush()
        return location

    def delete(self, location_id: uuid.UUID) -> None:
        location = self._require_location(location_id, lock=True)
        child_id = self.session.scalar(
            select(Location.id)
            .where(Location.parent_location_id == location.id)
            .with_for_update()
            .limit(1)
        )
        if child_id is not None:
            raise ModelError(
                "Location has child Locations",
                {
                    "reason": "LOCATION_HAS_CHILDREN",
                    "location_id": str(location.id),
                    "child_location_id": str(child_id),
                },
            )
        object_id = self.session.scalar(
            select(PhysicalObject.id)
            .where(PhysicalObject.location_id == location.id)
            .with_for_update()
            .limit(1)
        )
        if object_id is not None:
            raise ModelError(
                "Location has assigned PhysicalObjects",
                {
                    "reason": "LOCATION_HAS_ASSIGNED_PHYSICAL_OBJECTS",
                    "location_id": str(location.id),
                    "physical_object_id": str(object_id),
                },
            )
        self.session.delete(location)
        self.session.flush()

    def get_physical_object_location(self, physical_object_id: uuid.UUID) -> PhysicalObject:
        return self._require_physical_object(physical_object_id)

    def set_physical_object_location(
        self, physical_object_id: uuid.UUID, location_id: uuid.UUID | None
    ) -> PhysicalObject:
        # Lock the Location before the object so delete and assignment cannot
        # silently pass each other and rely on an FK failure for correctness.
        if location_id is not None:
            self._require_location(location_id, lock=True)
        physical_object = self._require_physical_object(physical_object_id, lock=True)
        physical_object.location_id = location_id
        self.session.flush()
        return physical_object

    def _require_location(self, location_id: uuid.UUID, *, lock: bool = False) -> Location:
        query = select(Location).where(Location.id == location_id)
        if lock:
            query = query.with_for_update()
        location = self.session.scalar(query)
        if location is None:
            raise ValidationError("Location does not exist", {"location_id": str(location_id)})
        return location

    def _require_physical_object(
        self, physical_object_id: uuid.UUID, *, lock: bool = False
    ) -> PhysicalObject:
        query = select(PhysicalObject).where(PhysicalObject.id == physical_object_id)
        if lock:
            query = query.with_for_update()
        physical_object = self.session.scalar(query)
        if physical_object is None:
            raise ValidationError(
                "PhysicalObject does not exist", {"physical_object_id": str(physical_object_id)}
            )
        return physical_object

    @staticmethod
    def _trim_required(value: str, field: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValidationError(f"{field} must not be blank")
        if len(normalized) > 255:
            raise ValidationError(f"{field} is too long")
        return normalized

    @staticmethod
    def _trim_optional(value: str | None, field: str) -> str | None:
        if value is None:
            return None
        return LocationCatalog._trim_required(value, field)
