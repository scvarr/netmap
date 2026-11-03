"""Module drafts, atomic publication and advisory installation diagnostics."""
import copy

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from app import models as m
from app.base_template_review import BaseTemplateReview, endpoint_dependencies
from app.device_catalog import DISPLAY_ALIAS_KEY
from app.errors import ModelError, ValidationError
from app.hardware_catalog import HardwareCatalog
from app.schemas import CreateModuleTemplateRequest


def validate_definition(value):
    return CreateModuleTemplateRequest.model_validate(value).model_dump(mode="json")


def published_definition(session, template_id, revision_id):
    document = HardwareCatalog(session).module_document(
        session.get(m.ModuleTemplate, template_id), session.get(m.ModuleTemplateRevision, revision_id))
    return validate_definition({k: document[k] for k in ("name", "compatibility", "endpoints", "geometry")})


def structural_changes(before, after):
    changes = []
    old, new = ({e["key"]: {**e, "order_index": i} for i, e in enumerate(d["endpoints"])} for d in (before, after))
    for key in sorted(old.keys() | new.keys()):
        if old.get(key) != new.get(key):
            changes.append({"section": "endpoints", "key": key,
                            "operation": "added" if key not in old else "removed" if key not in new else "changed",
                            "before": old.get(key), "after": new.get(key)})
    for key in ("name", "compatibility"):
        if before[key] != after[key]:
            changes.append({"section": "properties", "key": key, "operation": "changed", "before": before[key], "after": after[key]})
    if before["geometry"] != after["geometry"]:
        changes.append({"section": "geometry", "key": "geometry", "operation": "changed", "before": before["geometry"], "after": after["geometry"]})
    return changes


def analyze_installation(session, installation, candidate):
    config = session.get(m.ObjectConfiguration, installation.configuration_id)
    revision = session.get(m.ModuleTemplateRevision, installation.module_revision_id)
    before = published_definition(session, revision.template_id, revision.id)
    old, new = ({e["key"]: e for e in d["endpoints"]} for d in (before, candidate))
    definitions = {d.id: d.definition_key for d in session.scalars(select(m.ModuleEndpointDefinition).where(m.ModuleEndpointDefinition.module_revision_id == revision.id))}
    rows = list(session.scalars(select(m.ModuleEndpointMapping).where(m.ModuleEndpointMapping.installation_id == installation.id)))
    mappings = {definitions[row.definition_id]: row for row in rows if row.definition_id in definitions}
    reasons = []
    if any(row.definition_id not in definitions for row in rows):
        reasons.append({"code": "INVALID_ENDPOINT_MAPPING"})
    bay = session.scalar(select(m.ModuleBay).where(m.ModuleBay.base_revision_id == config.base_revision_id, m.ModuleBay.bay_key == installation.bay_key))
    if bay is None or bay.compatibility != candidate["compatibility"]:
        reasons.append({"code": "BAY_COMPATIBILITY_MISMATCH", "compatibility": candidate["compatibility"]})
    for key, definition in old.items():
        mapping = mappings.get(key)
        if mapping is None:
            reasons.append({"code": "MISSING_ENDPOINT_MAPPING", "key": key, "endpoint_name": definition["display_name"]})
            continue
        point = session.get(m.ConnectionPoint, mapping.connection_point_id)
        valid = (point is not None and point.cardinality == 1 and point.physical_object_id == config.physical_object_id
                 and (definition["kind"] == "NETWORK_PORT") == (mapping.network_interface_id is not None))
        if mapping.network_interface_id is not None:
            valid = valid and session.scalar(select(m.NetworkInterfacePhysicalOwner.id).where(
                m.NetworkInterfacePhysicalOwner.interface_id == mapping.network_interface_id,
                m.NetworkInterfacePhysicalOwner.physical_object_id == config.physical_object_id)) is not None
            valid = valid and session.scalar(select(m.InterfacePhysicalBinding.id).where(
                m.InterfacePhysicalBinding.interface_id == mapping.network_interface_id,
                m.InterfacePhysicalBinding.point_id == mapping.connection_point_id,
                m.InterfacePhysicalBinding.point_member == 1)) is not None
        if mapping.network_interface_id is not None:
            valid = valid and session.get(m.NetworkInterface, mapping.network_interface_id) is not None
            owners = list(session.scalars(select(m.NetworkInterfacePhysicalOwner).where(
                m.NetworkInterfacePhysicalOwner.interface_id == mapping.network_interface_id)))
            bindings = list(session.scalars(select(m.InterfacePhysicalBinding).where(
                (m.InterfacePhysicalBinding.interface_id == mapping.network_interface_id) |
                (m.InterfacePhysicalBinding.point_id == mapping.connection_point_id))))
            valid = valid and len(owners) == 1 and len(bindings) == 1
        if not valid:
            reasons.append({"code": "INVALID_ENDPOINT_MAPPING", "key": key, "endpoint_name": definition["display_name"]})
        if key not in new:
            blockers = endpoint_dependencies(session, config, mapping, definition)
            if blockers:
                reasons.append({"code": "ENDPOINT_DEPENDENCIES", "key": key, "endpoint_name": definition["display_name"], "dependencies": blockers})
        elif definition["kind"] != new[key]["kind"]:
            reasons.append({"code": "ENDPOINT_KIND_CHANGE", "key": key, "endpoint_name": definition["display_name"]})
    label = session.scalar(select(m.EntityMetadata.value).where(m.EntityMetadata.physical_object_id == config.physical_object_id, m.EntityMetadata.key == DISPLAY_ALIAS_KEY))
    return {"installation_id": str(installation.id), "physical_object_id": str(config.physical_object_id),
            "display_name": label or str(config.physical_object_id), "source_revision_id": str(revision.id),
            "bay_key": installation.bay_key,
            "classification": "requires_intervention" if reasons else "potentially_safe",
            "reasons": reasons or [{"code": "IDENTITY_AND_DATA_PRESERVED"}], "changes": structural_changes(before, candidate)}


class ModuleTemplateReview:
    # Use C's exact canonical/authoring MVCC fingerprint, including installations.
    _inputs = BaseTemplateReview._inputs

    def __init__(self, session):
        self.session = session

    def _draft(self, template_id, *, lock=False):
        draft = self.session.scalar(select(m.ModuleTemplateDraft).where(m.ModuleTemplateDraft.template_id == template_id))
        if draft is not None and not lock:
            return draft
        template = self.session.scalar(select(m.ModuleTemplate).where(m.ModuleTemplate.id == template_id).with_for_update())
        if template is None:
            raise ValidationError("ModuleTemplate was not found")
        if draft is None:
            revision = self.session.scalar(select(m.ModuleTemplateRevision).where(m.ModuleTemplateRevision.template_id == template_id).order_by(m.ModuleTemplateRevision.version_number.desc()).limit(1))
            self.session.execute(insert(m.ModuleTemplateDraft).values(template_id=template_id, source_revision_id=revision.id,
                definition=published_definition(self.session, template_id, revision.id), generation=1).on_conflict_do_nothing(index_elements=["template_id"]))
            draft = self.session.scalar(select(m.ModuleTemplateDraft).where(m.ModuleTemplateDraft.template_id == template_id))
        if lock:
            self.session.refresh(draft, with_for_update=True)
        return draft

    def _latest_candidate(self, draft):
        return self.session.scalar(select(m.ModuleTemplateCandidate).where(m.ModuleTemplateCandidate.template_id == draft.template_id).order_by(m.ModuleTemplateCandidate.created_at.desc(), m.ModuleTemplateCandidate.id.desc()).limit(1))

    def document(self, draft, candidate, input_fingerprint=None):
        review = None
        if candidate:
            publication = self.session.get(m.ModuleTemplatePublication, candidate.id)
            current = (candidate.draft_generation == draft.generation and candidate.source_revision_id == draft.source_revision_id
                       and candidate.definition == draft.definition and input_fingerprint is not None
                       and candidate.input_fingerprint == input_fingerprint)
            review = {"candidate_id": str(candidate.id), "draft_generation": candidate.draft_generation,
                      "definition": candidate.definition, "result": candidate.result, "current": current,
                      "published_revision_id": str(publication.revision_id) if publication else None,
                      "created_at": candidate.created_at.isoformat()}
        return {"template_id": str(draft.template_id), "source_revision_id": str(draft.source_revision_id),
                "generation": draft.generation, "definition": draft.definition, "review": review,
                "publication_state": publication_state(self.session, draft.template_id)}

    def open(self, template_id):
        draft = self._draft(template_id)
        candidate = self._latest_candidate(draft)
        return self.document(draft, candidate, self._inputs() if candidate and candidate.draft_generation == draft.generation else None)

    def save(self, template_id, definition, expected_generation):
        draft = self._draft(template_id, lock=True)
        if draft.generation != expected_generation:
            raise ModelError("Draft changed in another session; reopen before saving", {"reason": "DRAFT_CONFLICT"})
        draft.definition = validate_definition(definition)
        draft.generation += 1
        self.session.flush()
        return self.document(draft, self._latest_candidate(draft))

    def check(self, template_id, expected_generation):
        draft = self._draft(template_id)
        self.session.refresh(draft, with_for_update=True)
        if draft.generation != expected_generation:
            raise ModelError("Draft changed; reload before checking", {"reason": "DRAFT_CONFLICT"})
        fingerprint = self._inputs()
        installations = self.session.scalars(select(m.ModuleInstallation).join(m.ModuleTemplateRevision,
            m.ModuleInstallation.module_revision_id == m.ModuleTemplateRevision.id).where(
            m.ModuleTemplateRevision.template_id == template_id).order_by(m.ModuleInstallation.id)).all()
        candidate = m.ModuleTemplateCandidate(template_id=template_id, source_revision_id=draft.source_revision_id,
            draft_generation=draft.generation, definition=copy.deepcopy(draft.definition), input_fingerprint=fingerprint,
            result={"changes": structural_changes(published_definition(self.session, template_id, draft.source_revision_id), draft.definition),
                    "installations": [analyze_installation(self.session, i, draft.definition) for i in installations]})
        self.session.add(candidate)
        self.session.flush()
        return self.document(draft, candidate, fingerprint)

    def publish(self, template_id, candidate_id):
        candidate = self.session.get(m.ModuleTemplateCandidate, candidate_id)
        if candidate is None or candidate.template_id != template_id:
            raise ValidationError("Candidate does not belong to ModuleTemplate")
        receipt = self.session.get(m.ModuleTemplatePublication, candidate_id)
        if receipt is not None:
            return self._published(receipt)

        # The review fingerprint covers the whole canonical/authoring dataset.
        # Lock exactly those inputs before reading a fresh READ COMMITTED view;
        # keep them stable through COMMIT. SHARE ROW EXCLUSIVE also serializes
        # publishers before they insert revisions (no SHARE-to-write upgrade race).
        # GET/check continue using non-blocking MVCC; drafts use row locks only.
        from app.workspace_portability import _specs, _tables_in_dependency_order
        inputs = {model.__tablename__ for section, _, model, _ in _specs()
                  if section in ("canonical", "authoring") and model not in (m.BaseTemplateDraft, m.BaseTemplateCandidate, m.ModuleTemplateDraft, m.ModuleTemplateCandidate)}
        preparer = self.session.bind.dialect.identifier_preparer
        names = ", ".join(preparer.format_table(t) for t in _tables_in_dependency_order() if t.name in inputs)
        self.session.execute(text(f"LOCK TABLE {names} IN SHARE ROW EXCLUSIVE MODE"))
        # A dataset replacement may have completed while locks were awaited.
        candidate = self.session.scalar(select(m.ModuleTemplateCandidate).where(
            m.ModuleTemplateCandidate.id == candidate_id).execution_options(populate_existing=True))
        if candidate is None or candidate.template_id != template_id:
            raise ValidationError("Candidate does not belong to ModuleTemplate")
        draft = self._draft(template_id, lock=True)
        self.session.refresh(draft, with_for_update=True)
        receipt = self.session.get(m.ModuleTemplatePublication, candidate_id)
        if receipt is not None:
            return self._published(receipt)
        latest = self.session.scalar(select(m.ModuleTemplateRevision).where(
            m.ModuleTemplateRevision.template_id == template_id).order_by(m.ModuleTemplateRevision.version_number.desc()).limit(1))

        def stale(reason):
            messages = {
                "SOURCE_REVISION_CHANGED": "Опубликованная ревизия изменилась. Откройте актуальный черновик и повторно проверьте изменения.",
                "DRAFT_CHANGED": "Черновик изменился после проверки. Повторно проверьте сохранённые изменения.",
                "REVIEW_INPUTS_CHANGED": "Данные анализа изменились после проверки. Повторно проверьте изменения.",
            }
            raise ModelError(messages[reason],
                             {"reason": reason, "recheck_required": True})

        if candidate.source_revision_id != latest.id or draft.source_revision_id != latest.id:
            stale("SOURCE_REVISION_CHANGED")
        if candidate.draft_generation != draft.generation or candidate.definition != draft.definition:
            stale("DRAFT_CHANGED")
        if candidate.input_fingerprint != self._inputs():
            stale("REVIEW_INPUTS_CHANGED")
        query = CreateModuleTemplateRequest.model_validate(candidate.definition)
        revision = HardwareCatalog(self.session)._create_module_revision(template_id, latest.version_number + 1, query)
        self.session.get(m.ModuleTemplate, template_id).name = query.name
        receipt = m.ModuleTemplatePublication(id=candidate.id, revision_id=revision.id)
        self.session.add(receipt)
        # Advance the persisted draft in the same transaction. Never mutate the
        # frozen candidate or rewind a later draft on an idempotent retry.
        draft.source_revision_id = revision.id
        draft.generation += 1
        draft.definition = copy.deepcopy(candidate.definition)
        self.session.flush()
        return self._published(receipt)

    def _published(self, receipt):
        revision = self.session.get(m.ModuleTemplateRevision, receipt.revision_id)
        return {"candidate_id": str(receipt.id), "revision_id": str(revision.id), "version_number": revision.version_number}


def publication_state(session, template_id):
    revision = session.scalar(select(m.ModuleTemplateRevision).where(m.ModuleTemplateRevision.template_id == template_id).order_by(m.ModuleTemplateRevision.version_number.desc()).limit(1))
    definition = published_definition(session, template_id, revision.id)
    installations = session.scalars(select(m.ModuleInstallation).join(m.ModuleTemplateRevision, m.ModuleInstallation.module_revision_id == m.ModuleTemplateRevision.id).where(m.ModuleTemplateRevision.template_id == template_id, m.ModuleInstallation.module_revision_id != revision.id).order_by(m.ModuleInstallation.id)).all()
    impacts = [analyze_installation(session, i, definition) for i in installations]
    intervention = sum(i["classification"] == "requires_intervention" for i in impacts)
    return {"revision_id": str(revision.id), "version_number": revision.version_number,
            "outdated_count": len(impacts), "awaiting_update_count": len(impacts) - intervention,
            "requires_intervention_count": intervention, "installations": impacts}
