import uuid
from collections.abc import Callable

from app.processing_scopes import (
    ALLOWED_SCOPE_KEYS,
    SCOPE_ENTITY_TYPES,
    TRAFFIC_CLASSES,
    ProcessingScope,
    normalize_processing_scope,
)


SecurityScope = ProcessingScope


def normalize_security_scope(
    scope: object,
    *,
    model_error: bool,
    entity_exists: Callable[[str, uuid.UUID], bool],
    details: dict[str, object] | None = None,
) -> SecurityScope:
    return normalize_processing_scope(
        scope,
        model_error=model_error,
        entity_exists=entity_exists,
        attachment_type="SecurityPolicyAttachment",
        details=details,
    )
