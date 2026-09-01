import uuid
from dataclasses import dataclass

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.errors import (
    HistoricalCableLabelReuseConfirmationStaleError,
    HistoricalCableLabelReuseRequiredError,
    ValidationError,
)
from app.models import Cable, CableLabelHistory, CableLabelSettings, CableLabelTemplate


def resolved_cable_label(cable: Cable) -> tuple[str, str | None]:
    """Return display-only Cable text without ever persisting the fallback."""
    if cable.label is not None:
        return cable.label, None
    return f"Cable {str(cable.id)[:8]}", "TECHNICAL_FALLBACK"


def normalized_cable_label(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        raise ValidationError("Cable label must not be blank")
    if len(normalized) > 255:
        raise ValidationError("Cable label must be at most 255 characters")
    return normalized


def validate_pattern(pattern: str) -> str:
    normalized = pattern.strip()
    if not normalized:
        raise ValidationError("Cable label template pattern must not be blank")
    if len(normalized) > 255:
        raise ValidationError("Cable label template pattern must be at most 255 characters")
    if "#" not in normalized and "@" not in normalized:
        raise ValidationError("Cable label template pattern requires # or @")
    return normalized


def sequence_value(pattern: str, ordinal: int) -> str | None:
    """Expand one finite mixed-radix ordinal, rightmost variable varying fastest."""
    positions = [(index, 10 if char == "#" else 26) for index, char in enumerate(pattern) if char in "#@"]
    capacity = 1
    for _, base in positions:
        capacity *= base
    if ordinal < 0 or ordinal >= capacity:
        return None
    characters = list(pattern)
    remaining = ordinal
    for index, base in reversed(positions):
        digit = remaining % base
        remaining //= base
        characters[index] = str(digit) if base == 10 else chr(ord("A") + digit)
    return "".join(characters)


@dataclass(frozen=True)
class CableLabelTemplateRecord:
    id: uuid.UUID
    name: str
    description: str | None
    pattern: str
    start_at: int


class CableLabelCatalog:
    """Transactional label policy, template library, and assignment boundary."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def settings(self) -> CableLabelSettings:
        settings = self.session.scalar(select(CableLabelSettings).where(CableLabelSettings.id == 1).with_for_update())
        if settings is None:
            settings = CableLabelSettings(id=1, unique_labels=False)
            self.session.add(settings)
            self.session.flush()
        return settings

    def read_settings(self) -> CableLabelSettings:
        settings = self.session.get(CableLabelSettings, 1)
        if settings is None:
            # Migration establishes this row; retaining this guard makes a fresh dev DB safe.
            settings = CableLabelSettings(id=1, unique_labels=False)
            self.session.add(settings)
            self.session.flush()
        return settings

    def set_unique_labels(self, unique_labels: bool) -> CableLabelSettings:
        settings = self.settings()
        if unique_labels:
            labels = list(self.session.scalars(select(Cable.label).where(Cable.label.is_not(None))))
            if len(labels) != len(set(labels)):
                raise ValidationError("Cannot enable unique Cable labels while duplicates exist")
        settings.unique_labels = unique_labels
        self.session.flush()
        return settings

    def set_label(self, cable_id: uuid.UUID, value: str | None, confirmed_historical_label: str | None = None) -> Cable:
        cable = self.session.scalar(select(Cable).where(Cable.id == cable_id).with_for_update())
        if cable is None:
            raise ValidationError("Cable does not exist", {"cable_id": str(cable_id)})
        self._assign(cable, normalized_cable_label(value), confirmed_historical_label)
        return cable

    def generate_label_for_cable(self, cable_id: uuid.UUID, template_id: uuid.UUID, confirmed_historical_label: str | None = None) -> Cable:
        """Atomically assign the first template value available to this Cable."""
        cable = self.session.scalar(select(Cable).where(Cable.id == cable_id).with_for_update())
        if cable is None:
            raise ValidationError("Cable does not exist", {"cable_id": str(cable_id)})
        self.settings()
        candidate = self._generate(template_id, excluding_cable_id=cable.id)
        if confirmed_historical_label is not None and confirmed_historical_label != candidate:
            raise HistoricalCableLabelReuseConfirmationStaleError()
        self._assign(cable, candidate, confirmed_historical_label)
        return cable

    def assign_new_cable(
        self, cable: Cable, *, label: str | None, template_id: uuid.UUID | None, generate: bool,
        confirmed_historical_label: str | None = None,
    ) -> None:
        if generate:
            if template_id is None:
                raise ValidationError("Cable label template is required when generation is enabled")
            candidate = self._generate(template_id)
            if confirmed_historical_label is not None and confirmed_historical_label != candidate:
                raise HistoricalCableLabelReuseConfirmationStaleError()
            self._assign(cable, candidate, confirmed_historical_label)
        else:
            self._assign(cable, normalized_cable_label(label), confirmed_historical_label)

    def release_cable_label(self, cable: Cable) -> None:
        """Release a current label before deleting the canonical Cable."""
        self.settings()
        if cable.label is not None:
            self._release(cable.id, cable.label)
        self.session.flush()

    def _assign(self, cable: Cable, label: str | None, confirmed_historical_label: str | None = None) -> None:
        # Locking the singleton policy record serializes every label writer, including
        # generated create. This makes the check-and-assignment boundary race-safe.
        settings = self.settings()
        conflict = None
        if label is not None:
            conflict = self.session.scalar(
                select(Cable.id).where(Cable.label == label, Cable.id != cable.id).limit(1)
            )
        if label is not None and settings.unique_labels and conflict is not None:
            raise ValidationError("Cable label must be globally unique", {"label": label})
        if label is not None and confirmed_historical_label == label and conflict is not None:
            raise HistoricalCableLabelReuseConfirmationStaleError()
        if label is not None and label != cable.label and conflict is None:
            historical = self.session.scalar(
                select(CableLabelHistory.id).where(CableLabelHistory.label == label).limit(1)
            )
            if historical is not None and confirmed_historical_label != label:
                raise HistoricalCableLabelReuseRequiredError(label)
        if cable.label is not None and cable.label != label:
            self._release(cable.id, cable.label)
        cable.label = label
        if label is not None and not self.session.scalar(
            select(CableLabelHistory.id).where(
                CableLabelHistory.cable_id == cable.id,
                CableLabelHistory.label == label,
                CableLabelHistory.released_at.is_(None),
            ).limit(1)
        ):
            self.session.add(CableLabelHistory(label=label, cable_id=cable.id))
        self.session.flush()

    def _release(self, cable_id: uuid.UUID, label: str) -> None:
        self.session.execute(
            update(CableLabelHistory)
            .where(
                CableLabelHistory.cable_id == cable_id,
                CableLabelHistory.label == label,
                CableLabelHistory.released_at.is_(None),
            )
            .values(released_at=func.now())
        )

    def _generate(self, template_id: uuid.UUID, *, excluding_cable_id: uuid.UUID | None = None) -> str:
        template = self.session.get(CableLabelTemplate, template_id)
        if template is None:
            raise ValidationError("Cable label template does not exist", {"template_id": str(template_id)})
        # The policy lock held by _assign is intentionally acquired before this call
        # in assign_new_cable by passing its result through _assign.  Acquire it here
        # too, because generation must inspect and reserve a free value atomically.
        self.settings()
        statement = select(Cable.label).where(Cable.label.is_not(None))
        if excluding_cable_id is not None:
            statement = statement.where(Cable.id != excluding_cable_id)
        labels = set(self.session.scalars(statement))
        ordinal = template.start_at
        while (candidate := sequence_value(template.pattern, ordinal)) is not None:
            if candidate not in labels:
                return candidate
            ordinal += 1
        raise ValidationError("Cable label template sequence is exhausted", {"template_id": str(template_id)})

    def list_templates(self) -> list[CableLabelTemplate]:
        return list(self.session.scalars(select(CableLabelTemplate).order_by(CableLabelTemplate.name, CableLabelTemplate.id)))

    def create_template(self, *, name: str, description: str | None, pattern: str, start_at: int) -> CableLabelTemplate:
        template = CableLabelTemplate(name=self._name(name), description=self._description(description), pattern=validate_pattern(pattern), start_at=self._start_at(start_at))
        self.session.add(template)
        self.session.flush()
        return template

    def update_template(self, template_id: uuid.UUID, *, name: str, description: str | None, pattern: str, start_at: int) -> CableLabelTemplate:
        template = self.session.get(CableLabelTemplate, template_id)
        if template is None:
            raise ValidationError("Cable label template does not exist", {"template_id": str(template_id)})
        template.name = self._name(name)
        template.description = self._description(description)
        template.pattern = validate_pattern(pattern)
        template.start_at = self._start_at(start_at)
        self.session.flush()
        return template

    def delete_template(self, template_id: uuid.UUID) -> None:
        template = self.session.get(CableLabelTemplate, template_id)
        if template is None:
            raise ValidationError("Cable label template does not exist", {"template_id": str(template_id)})
        self.session.delete(template)
        self.session.flush()

    @staticmethod
    def _name(value: str) -> str:
        normalized = value.strip()
        if not normalized or len(normalized) > 255:
            raise ValidationError("Cable label template name must be 1 to 255 characters")
        return normalized

    @staticmethod
    def _description(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if len(normalized) > 2000:
            raise ValidationError("Cable label template description must be at most 2000 characters")
        return normalized

    @staticmethod
    def _start_at(value: int) -> int:
        if value < 0:
            raise ValidationError("Cable label template start_at must not be negative")
        return value
