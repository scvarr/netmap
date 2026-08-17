import uuid
from collections.abc import Callable
from dataclasses import dataclass

from app.errors import ModelError, ValidationError
from app.processing_scopes import ProcessingScope, normalize_processing_scope


ALLOWED_PLAN_ATTACHMENT_SCOPE_KEYS = {
    "ingress_network_interface_ids",
    "ingress_l3_binding_ids",
}


def normalize_packet_processing_plan_attachment_scope(
    scope: object,
    *,
    model_error: bool,
    entity_exists: Callable[[str, uuid.UUID], bool],
    details: dict[str, object] | None = None,
) -> ProcessingScope:
    error_type = ModelError if model_error else ValidationError
    if not isinstance(scope, dict):
        raise error_type("PacketProcessingPlanAttachment scope must be an object", details or {})
    unsupported = set(scope) - ALLOWED_PLAN_ATTACHMENT_SCOPE_KEYS
    if unsupported:
        raise error_type(
            "PacketProcessingPlanAttachment scope has unsupported dimensions",
            {**(details or {}), "dimensions": sorted(str(item) for item in unsupported)},
        )
    return normalize_processing_scope(
        scope,
        model_error=model_error,
        entity_exists=entity_exists,
        attachment_type="PacketProcessingPlanAttachment",
        details=details,
    )


@dataclass(frozen=True)
class PacketProcessingPlanAttachmentRecord:
    attachment_id: uuid.UUID
    attachment_set_id: uuid.UUID
    plan_id: uuid.UUID
    plan_configured_completeness: str
    scope: ProcessingScope


@dataclass(frozen=True)
class PacketProcessingPlanAttachmentSetRecord:
    attachment_set_id: uuid.UUID
    routing_context_id: uuid.UUID
    traffic_class: str
    configured_completeness: str
    attachments: tuple[PacketProcessingPlanAttachmentRecord, ...]
