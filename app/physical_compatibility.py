"""Compatibility of the two direct matings in an external Cable operation."""

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
    CableSpecification, PhysicalCompatibilityConfirmation, PhysicalCompatibilityEnd,
    PhysicalCompatibilityPreview, PhysicalCompatibilityReason, PhysicalCompatibilityVerdict,
)


# Tokens are ephemeral. A backend restart requires a fresh preview.
_TOKEN_KEY = secrets.token_bytes(32)
_PRIORITY = {"ALLOW": 0, "UNKNOWN": 1, "DENY": 2}


def check_end(
    pair: int, side: str, cable: m.CableType, port: m.PortType | None,
    cable_connector: m.ConnectorType | None, port_connector: m.ConnectorType | None,
) -> PhysicalCompatibilityEnd:
    contradictions: list[PhysicalCompatibilityReason] = []
    unknowns: list[PhysicalCompatibilityReason] = []
    if port is None:
        unknowns.append("PORT_TYPE_UNRESOLVED")
    elif cable.medium != port.medium:
        contradictions.append("MEDIUM_MISMATCH")
    if cable_connector is None:
        unknowns.append("CABLE_CONNECTOR_UNSPECIFIED")
    if port is not None and port_connector is None:
        unknowns.append("PORT_CONNECTOR_UNSPECIFIED")
    if cable_connector is not None and port_connector is not None:
        if cable_connector.mating_profile != port_connector.mating_profile:
            contradictions.append("PROFILE_MISMATCH")
        if cable_connector.termination == port_connector.termination:
            contradictions.append("TERMINATION_MISMATCH")
    if cable.medium == "FIBER" and port is not None and port.medium == "FIBER":
        unknowns.append("FIBER_MODE_UNDOCUMENTED")
    return PhysicalCompatibilityEnd(
        pair=pair, side=side,
        verdict="DENY" if contradictions else "UNKNOWN" if unknowns else "ALLOW",
        reasons=contradictions + unknowns or ["COMPATIBLE"],
    )


def _locked_types(session: Session, model, ids):
    return {item.id: item for item in session.scalars(
        select(model).where(model.id.in_(ids)).order_by(model.id)
        .with_for_update(read=True, nowait=True).execution_options(populate_existing=True)
    )}


def _port_provenance(session: Session, points: dict[uuid.UUID, m.ConnectionPoint]):
    if not points:
        return {}
    # Existing point locks exclude new FK references. Lock configuration rows
    # before reading mappings to serialize with base/module reconciliation.
    owners = {point.physical_object_id for point in points.values()}
    list(session.execute(
        select(m.ObjectConfiguration.id).where(m.ObjectConfiguration.physical_object_id.in_(owners))
        .order_by(m.ObjectConfiguration.id).with_for_update(read=True, nowait=True)
    ))
    built_in = session.execute(
        select(m.BuiltInEndpointMapping.connection_point_id, m.ObjectConfiguration.physical_object_id,
               m.BuiltInEndpointMapping.id, m.BuiltInEndpointDefinition.id,
               m.BuiltInEndpointDefinition.port_type_id, m.BuiltInEndpointDefinition.cardinality)
        .join(m.BuiltInEndpointDefinition, m.BuiltInEndpointDefinition.id == m.BuiltInEndpointMapping.definition_id)
        .join(m.ObjectConfiguration, m.ObjectConfiguration.id == m.BuiltInEndpointMapping.configuration_id)
        .where(m.BuiltInEndpointMapping.connection_point_id.in_(points),
               m.ObjectConfiguration.base_revision_id == m.BuiltInEndpointDefinition.base_revision_id)
        .with_for_update(read=True, nowait=True, of=m.BuiltInEndpointMapping)
    )
    module = session.execute(
        select(m.ModuleEndpointMapping.connection_point_id, m.ObjectConfiguration.physical_object_id,
               m.ModuleEndpointMapping.id, m.ModuleEndpointDefinition.id, m.ModuleEndpointDefinition.port_type_id)
        .join(m.ModuleEndpointDefinition, m.ModuleEndpointDefinition.id == m.ModuleEndpointMapping.definition_id)
        .join(m.ModuleInstallation, m.ModuleInstallation.id == m.ModuleEndpointMapping.installation_id)
        .join(m.ObjectConfiguration, m.ObjectConfiguration.id == m.ModuleInstallation.configuration_id)
        .where(m.ModuleEndpointMapping.connection_point_id.in_(points),
               m.ModuleInstallation.module_revision_id == m.ModuleEndpointDefinition.module_revision_id)
        .with_for_update(read=True, nowait=True, of=(m.ModuleEndpointMapping, m.ModuleInstallation))
    )
    candidates = {}
    for point_id, owner_id, mapping_id, definition_id, type_id, *capacity in [*built_in, *module]:
        point = points[point_id]
        if point.physical_object_id == owner_id and (not capacity or capacity[0] == point.cardinality):
            candidates.setdefault(point_id, []).append((mapping_id, definition_id, type_id))
    return {point_id: rows[0] for point_id, rows in candidates.items() if len(rows) == 1}


def _connector_state(connector: m.ConnectorType | None):
    if connector is None:
        return None
    return (connector.id, connector.mating_profile, connector.termination, connector.is_active)


def verify_compatibility(
    session: Session, spec: CableSpecification,
    pairs: list[tuple[m.ConnectionPoint | None, m.ConnectionPoint | None]],
    *, intent: object, preview: bool, confirmation: PhysicalCompatibilityConfirmation | None,
) -> PhysicalCompatibilityPreview:
    try:
        points = {point.id: point for pair in pairs for point in pair if point is not None}
        provenance = _port_provenance(session, points)
        ports = _locked_types(session, m.PortType, {row[2] for row in provenance.values()})
        cable = _locked_types(session, m.CableType, {spec.cable_type_id})[spec.cable_type_id]
        connector_ids = {spec.connector_a_type_id, spec.connector_b_type_id}
        connector_ids.update(port.connector_type_id for port in ports.values())
        connectors = _locked_types(session, m.ConnectorType, connector_ids - {None})
    except OperationalError as error:
        if getattr(error.orig, "sqlstate", None) in ("55P03", "40P01", "40001"):
            raise NetMapError("PHYSICAL_COMPATIBILITY_CONFLICT", "Physical data is being updated. Run a new preview.") from error
        raise

    ends = []
    state = []
    for index, pair in enumerate(pairs, 1):
        for side, point, connector_id in zip(("A", "B"), pair, (spec.connector_a_type_id, spec.connector_b_type_id)):
            row = provenance.get(point.id) if point is not None else None
            port = ports.get(row[2]) if row else None
            if port is not None and port.cardinality != point.cardinality:
                port = None
            cable_connector = connectors.get(connector_id)
            port_connector = connectors.get(port.connector_type_id) if port is not None else None
            ends.append(check_end(index, side, cable, port, cable_connector, port_connector))
            state.append((
                (point.id, point.physical_object_id, point.cardinality) if point is not None else None,
                row, (port.medium, port.members) if port is not None else None,
                _connector_state(cable_connector), _connector_state(port_connector),
            ))

    verdict: PhysicalCompatibilityVerdict = max((end.verdict for end in ends), key=_PRIORITY.__getitem__)
    payload = json.dumps(
        [intent, spec.cable_type_id, spec.connector_a_type_id, spec.connector_b_type_id,
         cable.medium, cable.construction, cable.is_active, state, verdict],
        default=str, separators=(",", ":"),
    ).encode()
    token = hmac.digest(_TOKEN_KEY, payload, "sha256").hex()
    result = PhysicalCompatibilityPreview(verdict=verdict, ends=ends, token=token if verdict != "DENY" else None)
    if preview:
        return result

    details = {"ends": [end.model_dump() for end in ends]}
    if verdict == "DENY":
        raise NetMapError("PHYSICAL_COMPATIBILITY_DENIED", "Physical compatibility check failed", details)
    if confirmation is not None and not hmac.compare_digest(confirmation.token.encode(), token.encode()):
        raise NetMapError("PHYSICAL_COMPATIBILITY_STALE", "Physical data or operation changed. Run a new preview.", details)
    if verdict == "UNKNOWN" and (confirmation is None or not confirmation.accept_unknown):
        raise NetMapError("PHYSICAL_COMPATIBILITY_CONFIRMATION_REQUIRED", "Preview and explicitly confirm unknown physical compatibility", details)
    return result
