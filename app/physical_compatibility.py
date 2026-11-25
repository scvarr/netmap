"""Compatibility of physical endings and the line between them."""

import hmac
import json
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app import models as m
from app.errors import NetMapError
from app.schemas import (
    PhysicalCompatibilityConfirmation, PhysicalCompatibilityPair,
    PhysicalCompatibilityPreview, PhysicalCompatibilityReason, PhysicalCompatibilityVerdict,
)


# Tokens are ephemeral. A backend restart requires a fresh preview.
_TOKEN_KEY = secrets.token_bytes(32)
_PRIORITY = {"ALLOW": 0, "UNKNOWN": 1, "DENY": 2}


def check_pair(
    index: int, a: m.PortType | None, b: m.PortType | None, marked: bool,
) -> PhysicalCompatibilityPair:
    contradictions: list[PhysicalCompatibilityReason] = []
    unknowns: list[PhysicalCompatibilityReason] = []
    if a is None:
        unknowns.append("PORT_A_TYPE_UNRESOLVED")
    if b is None:
        unknowns.append("PORT_B_TYPE_UNRESOLVED")
    if a is not None and b is not None:
        if a.medium != b.medium:
            contradictions.append("MEDIUM_MISMATCH")
        modes = {a.compatibility_mode, b.compatibility_mode}
        if (a.id != b.id and "SAME_TYPE" in modes) or ("MATRIX" in modes and (modes != {"MATRIX"} or not marked)):
            contradictions.append("PORT_TYPES_NOT_ALLOWED")
        elif "UNDEFINED" in modes:
            unknowns.append("PORT_COMPATIBILITY_UNDEFINED")

    return PhysicalCompatibilityPair(
        pair=index, verdict="DENY" if contradictions else "UNKNOWN" if unknowns else "ALLOW",
        reasons=contradictions + unknowns or ["COMPATIBLE"],
    )


def _locked_types(session: Session, model, ids):
    return {item.id: item for item in session.scalars(
        select(model).where(model.id.in_(ids)).order_by(model.id)
        .with_for_update(read=True, nowait=True).execution_options(populate_existing=True)
    )}


def _port_provenance(session: Session, points: dict[uuid.UUID, m.ConnectionPoint], *, lock: bool):
    if not points:
        return {}
    # Existing point locks exclude new FK references. Lock configuration rows
    # before reading mappings to serialize with base/module reconciliation.
    if lock:
        owners = {point.physical_object_id for point in points.values()}
        list(session.execute(
            select(m.ObjectConfiguration.id).where(m.ObjectConfiguration.physical_object_id.in_(owners))
            .order_by(m.ObjectConfiguration.id).with_for_update(read=True, nowait=True)
        ))
    built_in = (
        select(m.BuiltInEndpointMapping.connection_point_id, m.ObjectConfiguration.physical_object_id,
               m.BuiltInEndpointMapping.id, m.BuiltInEndpointDefinition.id,
               m.BuiltInEndpointDefinition.port_type_id, m.BuiltInEndpointDefinition.cardinality)
        .join(m.BuiltInEndpointDefinition, m.BuiltInEndpointDefinition.id == m.BuiltInEndpointMapping.definition_id)
        .join(m.ObjectConfiguration, m.ObjectConfiguration.id == m.BuiltInEndpointMapping.configuration_id)
        .where(m.BuiltInEndpointMapping.connection_point_id.in_(points),
               m.ObjectConfiguration.base_revision_id == m.BuiltInEndpointDefinition.base_revision_id)
    )
    module = (
        select(m.ModuleEndpointMapping.connection_point_id, m.ObjectConfiguration.physical_object_id,
               m.ModuleEndpointMapping.id, m.ModuleEndpointDefinition.id, m.ModuleEndpointDefinition.port_type_id)
        .join(m.ModuleEndpointDefinition, m.ModuleEndpointDefinition.id == m.ModuleEndpointMapping.definition_id)
        .join(m.ModuleInstallation, m.ModuleInstallation.id == m.ModuleEndpointMapping.installation_id)
        .join(m.ObjectConfiguration, m.ObjectConfiguration.id == m.ModuleInstallation.configuration_id)
        .where(m.ModuleEndpointMapping.connection_point_id.in_(points),
               m.ModuleInstallation.module_revision_id == m.ModuleEndpointDefinition.module_revision_id)
    )
    if lock:
        built_in = built_in.with_for_update(read=True, nowait=True, of=m.BuiltInEndpointMapping)
        module = module.with_for_update(read=True, nowait=True, of=(m.ModuleEndpointMapping, m.ModuleInstallation))
    candidates = {}
    for point_id, owner_id, mapping_id, definition_id, type_id, *capacity in [*session.execute(built_in), *session.execute(module)]:
        point = points[point_id]
        if point.physical_object_id == owner_id and (not capacity or capacity[0] == point.cardinality):
            candidates.setdefault(point_id, []).append((mapping_id, definition_id, type_id))
    return {point_id: rows[0] for point_id, rows in candidates.items() if len(rows) == 1}


def point_member_designations(session: Session, point_ids: set[uuid.UUID]) -> dict[uuid.UUID, dict[int, str]]:
    if not point_ids:
        return {}
    points = {point.id: point for point in session.scalars(
        select(m.ConnectionPoint).where(m.ConnectionPoint.id.in_(point_ids))
    )}
    provenance = _port_provenance(session, points, lock=False)
    ports = {port.id: port for port in session.scalars(
        select(m.PortType).where(m.PortType.id.in_({row[2] for row in provenance.values()}))
    )}
    return {
        point_id: dict(enumerate(ports[type_id].members, 1))
        for point_id, (_, _, type_id) in provenance.items()
        if type_id in ports and ports[type_id].cardinality == points[point_id].cardinality
    }


def verify_compatibility(
    session: Session,
    pairs: list[tuple[m.ConnectionPoint | None, m.ConnectionPoint | None]],
    *, intent: object, preview: bool, confirmation: PhysicalCompatibilityConfirmation | None,
    require_preview: bool = False,
    replacement_point_id: uuid.UUID | None = None,
) -> PhysicalCompatibilityPreview:
    try:
        points = {point.id: point for pair in pairs for point in pair if point is not None}
        provenance = _port_provenance(session, points, lock=True)
        ports = _locked_types(session, m.PortType, {row[2] for row in provenance.values()})
        marked_pairs = set(session.execute(
            select(m.PortTypeCompatibility.port_type_a_id, m.PortTypeCompatibility.port_type_b_id)
            .where(m.PortTypeCompatibility.port_type_a_id.in_(ports),
                   m.PortTypeCompatibility.port_type_b_id.in_(ports))
        ))
    except OperationalError as error:
        if getattr(error.orig, "sqlstate", None) in ("55P03", "40P01", "40001"):
            raise NetMapError("PHYSICAL_COMPATIBILITY_CONFLICT", "Physical data is being updated. Run a new preview.") from error
        raise

    results = []
    state = []
    for index, pair in enumerate(pairs, 1):
        pair_types = []
        for point in pair:
            row = provenance.get(point.id) if point is not None else None
            port = ports.get(row[2]) if row else None
            if port is not None and port.cardinality != point.cardinality:
                port = None
            pair_types.append(port)
            # Replacement preview materializes the same published definition
            # in a rolled-back transaction. The new point and mapping UUIDs
            # are allocated afresh on confirmation.
            replacing = point is not None and point.id == replacement_point_id
            state.append((
                ((None if replacing else point.id), point.physical_object_id, point.cardinality)
                if point is not None else None,
                row[1:] if replacing and row else row,
                (port.medium, port.members, port.compatibility_mode, port.is_active)
                if port is not None else None,
            ))
        a, b = pair_types
        marked = a is not None and b is not None and tuple(sorted((a.id, b.id))) in marked_pairs
        results.append(check_pair(index, a, b, marked))
        state.append(marked)

    verdict: PhysicalCompatibilityVerdict = max((pair.verdict for pair in results), key=_PRIORITY.__getitem__)
    payload = json.dumps(
        [intent, state, verdict],
        default=str, separators=(",", ":"),
    ).encode()
    token = hmac.digest(_TOKEN_KEY, payload, "sha256").hex()
    result = PhysicalCompatibilityPreview(verdict=verdict, pairs=results, token=token if verdict != "DENY" else None)
    if preview:
        return result

    details = {"pairs": [pair.model_dump() for pair in results]}
    if verdict == "DENY":
        raise NetMapError("PHYSICAL_COMPATIBILITY_DENIED", "Physical compatibility check failed", details)
    if confirmation is not None and not hmac.compare_digest(confirmation.token.encode(), token.encode()):
        raise NetMapError("PHYSICAL_COMPATIBILITY_STALE", "Physical data or operation changed. Run a new preview.", details)
    if verdict == "UNKNOWN" and (confirmation is None or not confirmation.accept_unknown):
        raise NetMapError("PHYSICAL_COMPATIBILITY_CONFIRMATION_REQUIRED", "Preview and explicitly confirm unknown physical compatibility", details)
    if require_preview and confirmation is None:
        raise NetMapError("PHYSICAL_COMPATIBILITY_STALE", "Run a preview for the selected endpoint members.", details)
    return result
