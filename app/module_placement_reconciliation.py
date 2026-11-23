"""Placement preflight shared by advisory review and locked reconciliation."""
from collections import defaultdict

from sqlalchemy import select

from app import models as m
from app.module_layout import initial_layout, nested_place, validate_layout
from app.module_port_types import mount_document, mount_identity, row_mount


def configuration_installations(session, configuration_id, *, lock=False):
    query = select(m.ModuleInstallation).where(
        m.ModuleInstallation.configuration_id == configuration_id
    ).order_by(m.ModuleInstallation.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return list(session.scalars(query))


def placement_reason(code, installation, mount=None):
    reason = {"code": code, "installation_id": str(installation.id), "key": installation.bay_key}
    if mount is not None:
        reason["mount"] = mount_document(*mount)
    return reason


def _occupied_place(installation, parent, parent_revision, mount):
    if parent is None:
        return None, placement_reason("INVALID_NESTED_PLACEMENT", installation)
    place = next((p for p in parent_revision.module_places if p["key"] == installation.bay_key), None)
    if place is None:
        return None, placement_reason("INVALID_NESTED_PLACEMENT", installation)
    if mount_identity(place) != mount:
        return None, placement_reason("NESTED_PLACE_COMPATIBILITY_MISMATCH", installation, mount)
    panel_key = parent.layout.get("panel_key") if isinstance(parent.layout, dict) else None
    try:
        validate_layout(parent.layout, panel_key)
        validate_layout(installation.layout, panel_key)
    except ValueError:
        return None, placement_reason("INVALID_NESTED_PLACEMENT", installation)
    return nested_place(place, panel_key), None


def validate_nested_placements(session, installations, by_id):
    reasons = []
    transceivers = []
    for child in installations:
        if child.parent_installation_id is None:
            continue
        parent = by_id.get(child.parent_installation_id)
        parent_revision = session.get(m.ModuleTemplateRevision, parent.module_revision_id) if parent else None
        revision = session.get(m.ModuleTemplateRevision, child.module_revision_id)
        mount = mount_identity(row_mount(revision))
        _, reason = _occupied_place(child, parent, parent_revision, mount)
        if reason:
            reasons.append(reason)
        if mount[0] == "MODULE_PORT":
            transceivers.append((child, mount))
    if transceivers:
        physical_revisions = set(session.scalars(select(m.ModuleEndpointDefinition.module_revision_id).where(
            m.ModuleEndpointDefinition.module_revision_id.in_({row.module_revision_id for row, _ in transceivers})
        ).distinct()))
        reasons.extend(placement_reason("TRANSCEIVER_BINDING_REQUIRED", row, mount)
                       for row, mount in transceivers if row.module_revision_id in physical_revisions)
    return reasons


def plan_module_placements(session, installation, candidate, installations):
    """Return local layout updates and child moves without modifying any rows."""
    by_id = {row.id: row for row in installations}
    children = defaultdict(list)
    for row in installations:
        children[row.parent_installation_id].append(row)
    direct_children = children[installation.id]
    descendants = list(direct_children)
    for child in descendants:
        descendants.extend(children[child.id])

    reasons = validate_nested_placements(session, [installation, *descendants], by_id)
    updates = {}
    mount = mount_identity(candidate)
    if installation.parent_installation_id is not None:
        parent = by_id.get(installation.parent_installation_id)
        if parent is not None:
            parent_revision = session.get(m.ModuleTemplateRevision, parent.module_revision_id)
            place, reason = _occupied_place(installation, parent, parent_revision, mount)
            if reason and reason not in reasons:
                reasons.append(reason)
            if place is not None:
                updates[installation.id] = (installation.bay_key, initial_layout(
                    place, candidate["geometry"], installation.orientation, parent_revision.geometry))
        if mount[0] == "MODULE_PORT" and candidate["endpoints"]:
            reasons.append(placement_reason("TRANSCEIVER_BINDING_REQUIRED", installation, mount))
    else:
        config = session.get(m.ObjectConfiguration, installation.configuration_id)
        bay = session.scalar(select(m.ModuleBay).where(
            m.ModuleBay.base_revision_id == config.base_revision_id, m.ModuleBay.bay_key == installation.bay_key))
        if bay is None or mount_identity(row_mount(bay)) != mount:
            reasons.append({"code": "BAY_COMPATIBILITY_MISMATCH", "mount": mount_document(*mount)})
        elif mount[0] == "MODULE_PORT" and candidate["endpoints"]:
            reasons.append(placement_reason("TRANSCEIVER_BINDING_REQUIRED", installation, mount))
        else:
            try:
                validate_layout(installation.layout, bay.panel_key)
            except ValueError:
                reasons.append(placement_reason("MODULE_LAYOUT_PANEL_CONFLICT", installation))
    if reasons:
        return {}, reasons

    available = {p["key"]: nested_place(p, installation.layout["panel_key"])
                 for p in candidate.get("module_places", ())}
    assigned = {}
    displaced = defaultdict(list)
    revisions = {row.id: session.get(m.ModuleTemplateRevision, row.module_revision_id) for row in direct_children}
    for child in direct_children:
        child_mount = mount_identity(row_mount(revisions[child.id]))
        place = available.get(child.bay_key)
        if place is not None and mount_identity(place) == child_mount:
            assigned[child.id] = available.pop(child.bay_key)
        else:
            displaced[child_mount].append(child)

    # Exact mount identity partitions the assignment into disjoint groups.
    # After retaining compatible keys, every child in a group can use every
    # free place in that group. The only nonempty unique assignment is 1 to 1.
    for child_mount, rows in displaced.items():
        compatible = [place for place in available.values() if mount_identity(place) == child_mount]
        if len(rows) == len(compatible) == 1:
            assigned[rows[0].id] = compatible[0]
        else:
            code = ("NO_COMPATIBLE_NESTED_PLACEMENT" if len(compatible) < len(rows)
                    else "AMBIGUOUS_NESTED_PLACEMENT")
            reasons.extend(placement_reason(code, row, child_mount) for row in rows)
    if reasons:
        return {}, reasons

    for child in direct_children:
        place = assigned[child.id]
        updates[child.id] = (place["bay_key"], initial_layout(
            place, revisions[child.id].geometry, child.orientation, candidate["geometry"]))
    return updates, []
