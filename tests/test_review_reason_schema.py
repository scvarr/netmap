"""Persisted review diagnostics must remain readable in workspace v5."""
import ast
import copy
import inspect
import uuid
from typing import get_args

import pytest

from app.base_template_review import analyze_object
from app.database import SessionLocal
from app.models import ConnectionPoint
from app.schemas import BaseTemplateImpactReason
from tests.test_base_template_review import check, open_draft, save
from tests.test_hardware_configuration import create_base, create_object
from tests.test_object_reconciliation import package


@pytest.mark.no_database
def test_every_generated_review_reason_is_accepted_by_persisted_schema():
    generated = set()
    for node in ast.walk(ast.parse(inspect.getsource(analyze_object))):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value == 'code':
                    # Dynamic reason generation needs explicit contract coverage.
                    assert isinstance(value, ast.Constant) and isinstance(value.value, str)
                    generated.add(value.value)
    assert generated
    assert generated <= set(get_args(BaseTemplateImpactReason.model_fields['code'].annotation))


def test_internal_link_cardinality_candidate_workspace_v5_round_trip():
    from tests.test_hardware_configuration import client
    template_id, _ = create_base()
    obj = create_object(template_id)
    point_id = uuid.UUID(obj['slots'][0]['connection_point_ref']['entity_id'])
    with SessionLocal.begin() as session:
        session.get(ConnectionPoint, point_id).cardinality = 2
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft['definition'])
    existing_key = definition['slots'][0]['key']
    definition['slots'].append({**definition['slots'][0], 'key': 'new-peer', 'kind': 'CONNECTION_POINT', 'display_name': 'Peer'})
    definition['internal_links'] = [{'from_slot_key': existing_key, 'to_slot_key': 'new-peer'}]
    checked = check(template_id, save(template_id, draft, definition))
    reason = {'code': 'INTERNAL_LINK_CARDINALITY', 'key': sorted([existing_key, 'new-peer'])}
    impact = checked['review']['result']['objects'][0]
    assert impact['classification'] == 'requires_intervention'
    assert impact['reasons'] == [reason]
    exported = package()
    assert exported['format_version'] == 5
    candidate = exported['authoring']['BaseTemplateCandidate'][0]
    assert candidate['id'] == checked['review']['candidate_id']
    assert candidate['result'] == checked['review']['result']

    # The autouse fixture permits cleanup only in the isolated netmap_test DB.
    assert client.delete('/v1/workspace/dataset').status_code == 204
    response = client.post('/v1/workspace/package', json=exported)
    assert response.status_code == 204, response.text
    restored = package()
    assert restored == exported  # Candidate, reasons, configuration, all canonical IDs/facts.
    reopened = open_draft(template_id)
    assert reopened['review']['candidate_id'] == candidate['id']
    assert reopened['review']['result'] == checked['review']['result']
    assert reopened['review']['result']['objects'][0]['reasons'] == [reason]
    with SessionLocal() as session:
        assert session.get(ConnectionPoint, point_id).cardinality == 2
