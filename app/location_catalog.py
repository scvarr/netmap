from __future__ import annotations

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
