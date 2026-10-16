"""Persisted authoring and advisory review. No canonical writes or publication."""
import copy
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app import models as m
from app.errors import ModelError, ValidationError
from app.device_catalog import DISPLAY_ALIAS_KEY
from app.hardware_catalog import HardwareCatalog
from app.schemas import CreateBaseTemplateRequest


def validate_definition(value):
    definition = CreateBaseTemplateRequest.model_validate(value).model_dump(mode="json")
    keys = {s["key"] for s in definition["slots"]}
    pairs = set()
    for link in definition["internal_links"]:
        pair = tuple(sorted((link["from_slot_key"], link["to_slot_key"])))
        if pair[0] == pair[1] or not set(pair) <= keys or pair in pairs:
            raise ValidationError("Invalid or duplicate internal link")
        pairs.add(pair)
    return definition


def published_definition(session, template_id, revision_id):
    detail = HardwareCatalog(session).get_version_detail(template_id, revision_id)
    return validate_definition({
        "name": detail.name, "default_physical_object_class": detail.default_physical_object_class,
        "body": {"kind": detail.body_kind, "width": detail.width, "height": detail.height, "fill_color": detail.fill_color},
        "panels": [{k: getattr(p, k) for k in ("panel_key", "panel_number", "display_name", "x", "y", "width", "height")} for p in detail.panels],
        "slots": [{"key": s.slot_key, "display_name": s.display_name, "kind": s.kind, "panel_key": s.panel_key,
                   "rendered_position": {"x": s.position_x, "y": s.position_y}} for s in detail.slots],
        "bays": [{k: getattr(b, k) for k in ("bay_key", "display_name", "compatibility", "panel_key", "x", "y", "width", "height")} for b in detail.bays],
        "internal_links": [{"from_slot_key": a, "to_slot_key": b} for a, b in detail.internal_links],
    })


def structural_changes(before, after):
    changes = []
    for section, key in (("panels", "panel_key"), ("slots", "key"), ("bays", "bay_key")):
        old, new = ({item[key]: item for item in d[section]} for d in (before, after))
        for identity in sorted(old.keys() | new.keys()):
            if old.get(identity) != new.get(identity):
                changes.append({"section": section, "key": identity,
                                "operation": "added" if identity not in old else "removed" if identity not in new else "changed",
                                "before": old.get(identity), "after": new.get(identity)})
    def links(d):
        return {tuple(sorted((l["from_slot_key"], l["to_slot_key"]))) for l in d["internal_links"]}
    for pair in sorted(links(before) ^ links(after)):
        changes.append({"section": "internal_links", "key": list(pair), "operation": "added" if pair in links(after) else "removed"})
    for key in ("name", "default_physical_object_class", "body"):
        if before[key] != after[key]:
            changes.append({"section": "properties", "key": key, "operation": "changed", "before": before[key], "after": after[key]})
    return changes


def _contains_reference(value, ids):
    if isinstance(value, str):
        return value in ids
    if isinstance(value, dict):
        return any(_contains_reference(v, ids) for v in value.values())
    if isinstance(value, list):
        return any(_contains_reference(v, ids) for v in value)
    return False


def endpoint_dependencies(session, config, mapping, definition):
    """Inspect every persisted direct endpoint reference, including JSON policies.

    Only the expected materialization rows and unchanged generated aliases may
    disappear with an unused endpoint. Unknown/new FK dependencies fail closed.
    """
    reasons = set()
    point = session.get(m.ConnectionPoint, mapping.connection_point_id)
    if point is None or point.physical_object_id != config.physical_object_id or point.cardinality != 1:
        reasons.add("CONNECTION_POINT_DATA")
    if (definition["kind"] == "NETWORK_PORT") != (mapping.network_interface_id is not None):
        reasons.add("ENDPOINT_MAPPING_SHAPE")
    ids = {str(mapping.connection_point_id)}
    if mapping.network_interface_id:
        ids.add(str(mapping.network_interface_id))
    for table in m.Base.metadata.sorted_tables:
        for column in table.columns:
            targets = {fk.column.table.name for fk in column.foreign_keys}
            target_id = mapping.connection_point_id if "connection_points" in targets else mapping.network_interface_id if "network_interfaces" in targets else None
            if target_id is None:
                continue
            for row in session.execute(select(table).where(column == target_id)).mappings():
                if table.name == "built_in_endpoint_mappings" and row["id"] == mapping.id:
                    continue
                if table.name == "interface_physical_bindings" and row["interface_id"] == mapping.network_interface_id and row["point_id"] == mapping.connection_point_id and row["point_member"] == 1:
                    continue
                if table.name == "network_interface_physical_owners" and row["physical_object_id"] == config.physical_object_id:
                    continue
                if table.name == "entity_metadata" and row["key"] == DISPLAY_ALIAS_KEY and row["value"] == definition["display_name"]:
                    continue
                reasons.add(table.name.upper())
    # JSON has no FK. Inspect all canonical JSON fields, not only cable presence.
    from app.workspace_portability import _specs
    from sqlalchemy.sql.sqltypes import JSON
    for section, _, model, _ in _specs():
        if section != "canonical":
            continue
        for column in model.__table__.columns:
            if isinstance(column.type, JSON):
                if any(_contains_reference(value, ids) for value in session.scalars(select(column))):
                    reasons.add(model.__tablename__.upper())
    return sorted(reasons)


def analyze_object(session, config, candidate):
    revision = session.get(m.BaseTemplateRevision, config.base_revision_id)
    before = published_definition(session, revision.template_id, revision.id)
    changes = structural_changes(before, candidate)
    reasons, placements = [], {}
    old = {s["key"]: s for s in before["slots"]}
    new = {s["key"]: s for s in candidate["slots"]}
    definitions = {d.id: d.slot_key for d in session.scalars(select(m.BuiltInEndpointDefinition).where(m.BuiltInEndpointDefinition.base_revision_id == revision.id))}
    mappings = {definitions[e.definition_id]: e for e in session.scalars(select(m.BuiltInEndpointMapping).where(m.BuiltInEndpointMapping.configuration_id == config.id))}
    for key in sorted(old):
        if key not in mappings:
            reasons.append({"code": "MISSING_ENDPOINT_MAPPING", "key": key})
        elif key not in new:
            blockers = endpoint_dependencies(session, config, mappings[key], old[key])
            if blockers:
                reasons.append({"code": "ENDPOINT_DEPENDENCIES", "key": key, "endpoint_name": old[key]["display_name"], "dependencies": blockers})
        elif old[key]["kind"] != new[key]["kind"]:
            reasons.append({"code": "ENDPOINT_KIND_CHANGE", "key": key, "endpoint_name": old[key]["display_name"]})
    bays = {b["bay_key"]: b for b in candidate["bays"]}
    installations = list(session.scalars(select(m.ModuleInstallation).where(m.ModuleInstallation.configuration_id == config.id)))
    displaced = []
    for installation in sorted(installations, key=lambda i: str(i.id)):
        compatibility = session.get(m.ModuleTemplateRevision, installation.module_revision_id).compatibility
        bay = bays.get(installation.bay_key)
        if bay and bay["compatibility"] == compatibility:
            placements[str(installation.id)] = installation.bay_key
        else:
            displaced.append((installation, compatibility))
    for installation, compatibility in displaced:
        available = sorted(k for k, b in bays.items() if b["compatibility"] == compatibility and k not in placements.values())
        if available:
            placements[str(installation.id)] = available[0]
        else:
            reasons.append({"code": "INSUFFICIENT_COMPATIBLE_CAPACITY", "installation_id": str(installation.id), "compatibility": compatibility})
    for change in changes:
        if change["section"] == "internal_links":
            # Removing authored continuity must never silently discard a Connection.
            # Additions need free canonical capacity, which authoring alone cannot prove.
            pair = change["key"]
            points = [mappings[k].connection_point_id for k in pair if k in mappings]
            connections = session.scalars(select(m.Connection).where(m.Connection.point_a_id.in_(points) | m.Connection.point_b_id.in_(points))).all() if points else []
            if connections:
                reasons.append({"code": "INTERNAL_LINK_CONNECTIONS", "key": pair, "connection_ids": sorted(str(c.id) for c in connections)})
    label = session.scalar(select(m.EntityMetadata.value).where(m.EntityMetadata.physical_object_id == config.physical_object_id, m.EntityMetadata.key == DISPLAY_ALIAS_KEY))
    return {"physical_object_id": str(config.physical_object_id), "display_name": label or str(config.physical_object_id), "source_revision_id": str(revision.id),
            "classification": "requires_intervention" if reasons else "potentially_safe",
            "reasons": reasons or [{"code": "IDENTITY_AND_DATA_PRESERVED"}],
            "proposed_placements": placements, "changes": changes}


class BaseTemplateReview:
    def __init__(self, session: Session):
        self.session = session

    def _draft(self, template_id, *, lock=True):
        if not lock:
            draft = self.session.scalar(select(m.BaseTemplateDraft).where(m.BaseTemplateDraft.template_id == template_id))
            if draft is not None:
                return draft
        # Only initialization and saves need to serialize on the template.
        template = self.session.scalar(select(m.BaseTemplate).where(m.BaseTemplate.id == template_id).with_for_update())
        if template is None:
            raise ValidationError("BaseTemplate was not found")
        draft = self.session.scalar(select(m.BaseTemplateDraft).where(m.BaseTemplateDraft.template_id == template_id))
        if draft is None:
            revision = self.session.scalar(select(m.BaseTemplateRevision).where(m.BaseTemplateRevision.template_id == template_id).order_by(m.BaseTemplateRevision.version_number.desc()).limit(1))
            # A concurrent initializer may have committed after our RR snapshot.
            # ON CONFLICT raises 40001 in that case, so the API retries the snapshot.
            self.session.execute(insert(m.BaseTemplateDraft).values(
                template_id=template_id, source_revision_id=revision.id,
                definition=published_definition(self.session, template_id, revision.id),
            ).on_conflict_do_nothing(index_elements=["template_id"]))
            draft = self.session.scalar(select(m.BaseTemplateDraft).where(m.BaseTemplateDraft.template_id == template_id))
        return draft

    def _inputs(self):
        from app.workspace_portability import _specs, _json_value
        # The caller supplies a REPEATABLE READ transaction. Hash the same MVCC
        # snapshot as the analysis/freshness reads, without blocking data writers.
        specs = [s for s in _specs() if s[0] in ("canonical", "authoring") and s[2] not in (m.BaseTemplateDraft, m.BaseTemplateCandidate)]
        data = {name: [{field: _json_value(getattr(row, field)) for field in fields} for row in self.session.scalars(select(model).order_by(model.id))] for _, name, model, fields in specs}
        return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()

    def _latest_candidate(self, draft):
        return self.session.scalar(select(m.BaseTemplateCandidate).where(m.BaseTemplateCandidate.template_id == draft.template_id).order_by(m.BaseTemplateCandidate.created_at.desc(), m.BaseTemplateCandidate.id.desc()).limit(1))

    def document(self, draft, candidate, input_fingerprint=None):
        review = None
        if candidate:
            current = (candidate.draft_generation == draft.generation
                       and candidate.source_revision_id == draft.source_revision_id
                       and candidate.definition == draft.definition
                       and input_fingerprint is not None
                       and candidate.input_fingerprint == input_fingerprint)
            review = {"candidate_id": str(candidate.id), "draft_generation": candidate.draft_generation,
                      "definition": candidate.definition, "result": candidate.result, "current": current,
                      "created_at": candidate.created_at.isoformat()}
        return {"template_id": str(draft.template_id), "source_revision_id": str(draft.source_revision_id),
                "generation": draft.generation, "definition": draft.definition, "review": review}

    def open(self, template_id):
        draft = self._draft(template_id, lock=False)
        candidate = self._latest_candidate(draft)
        fingerprint = self._inputs() if candidate and candidate.draft_generation == draft.generation else None
        return self.document(draft, candidate, fingerprint)

    def save(self, template_id, definition, expected_generation):
        draft = self._draft(template_id)
        if draft.generation != expected_generation:
            raise ModelError("Draft changed in another session; reopen before saving", {"reason": "DRAFT_CONFLICT"})
        draft.definition = validate_definition(definition)
        draft.generation += 1
        self.session.flush()
        return self.document(draft, self._latest_candidate(draft))

    def check(self, template_id, expected_generation):
        draft = self._draft(template_id, lock=False)
        # Serialize only this draft against saves. If it changed since our MVCC
        # snapshot, PostgreSQL raises 40001 and the API retries from a fresh one.
        self.session.refresh(draft, with_for_update=True)
        if draft.generation != expected_generation:
            raise ModelError("Draft changed; reload before checking", {"reason": "DRAFT_CONFLICT"})
        fingerprint = self._inputs()
        configs = self.session.scalars(select(m.ObjectConfiguration).join(m.BaseTemplateRevision, m.ObjectConfiguration.base_revision_id == m.BaseTemplateRevision.id).where(m.BaseTemplateRevision.template_id == template_id).order_by(m.ObjectConfiguration.physical_object_id)).all()
        candidate = m.BaseTemplateCandidate(template_id=template_id, source_revision_id=draft.source_revision_id,
            draft_generation=draft.generation, definition=copy.deepcopy(draft.definition), input_fingerprint=fingerprint,
            result={"changes": structural_changes(published_definition(self.session, template_id, draft.source_revision_id), draft.definition),
                    "objects": [analyze_object(self.session, c, draft.definition) for c in configs]})
        self.session.add(candidate)
        self.session.flush()
        return self.document(draft, candidate, fingerprint)
