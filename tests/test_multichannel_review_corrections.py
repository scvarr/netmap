import copy
import uuid
import pytest
from sqlalchemy import select
from app import models as m
from app.database import SessionLocal
from app.base_template_review import BaseTemplateReview
from app.workspace_portability import export_package, import_package, reset_dataset, PackageError
from tests.test_multichannel_definitions import payload
from tests.test_hardware_configuration import create_base, create_object, client
from tests.test_base_template_review import open_draft, save, check
from tests.test_base_template_publication import publish


@pytest.mark.parametrize('with_object', [False, True])
def test_check_rejects_structure_without_creating_candidate_and_publish_still_guards(with_object):
    tid,_=create_base(payload())
    if with_object: create_object(tid)
    draft=open_draft(tid)
    definition=copy.deepcopy(draft['definition']);definition['slots'][0]['cardinality']+=1
    saved=save(tid,draft,definition)
    before=client.get('/v1/workspace/package').json()
    response=client.post(f'/v1/library/base-templates/{tid}/draft/check',params={'expected_generation': saved['generation']})
    assert response.status_code==409,response.text
    assert response.json()['error']['details']['reason']=='PHYSICAL_STRUCTURE_IMMUTABLE'
    assert client.get('/v1/workspace/package').json()==before
    # Simulate a frozen candidate issued before the preflight existed. Publish
    # must independently reject it even with a fresh generation/fingerprint.
    with SessionLocal.begin() as session:
        row=session.scalar(select(m.BaseTemplateDraft).where(m.BaseTemplateDraft.template_id==uuid.UUID(tid)))
        candidate=m.BaseTemplateCandidate(template_id=row.template_id,source_revision_id=row.source_revision_id,draft_generation=row.generation,definition=row.definition,input_fingerprint=BaseTemplateReview(session)._inputs(),result={'changes':[],'objects':[]})
        session.add(candidate);session.flush();cid=str(candidate.id)
    response=publish(tid,cid)
    assert response.status_code==409,response.text
    assert response.json()['error']['details']['reason']=='PHYSICAL_STRUCTURE_IMMUTABLE'


def legacy_shared_definition(saved_draft=False):
    tid,_=create_base(payload())
    obj=create_object(tid)
    if saved_draft: open_draft(tid)
    # Reproduce persisted historical definitions, without the authoring validator.
    with SessionLocal.begin() as session:
        revision=session.scalar(select(m.BaseTemplateRevision).where(m.BaseTemplateRevision.template_id==uuid.UUID(tid)))
        links=list(session.scalars(select(m.BaseInternalLink).where(m.BaseInternalLink.base_revision_id==revision.id)))
        slots={s.id:s for s in session.scalars(select(m.BuiltInEndpointDefinition).where(m.BuiltInEndpointDefinition.base_revision_id==revision.id))}
        rear=next(s for s in slots.values() if s.cardinality==4)
        rear.cardinality=1
        for link in links: link.member_mappings=[{'from_member_index':1,'to_member_index':1}]
        if saved_draft:
            draft=session.scalar(select(m.BaseTemplateDraft).where(m.BaseTemplateDraft.template_id==uuid.UUID(tid)))
            definition=copy.deepcopy(draft.definition)
            for slot in definition['slots']: slot['cardinality']=1
            for link in definition['internal_links']: link['member_mappings']=[{'from_member_index':1,'to_member_index':1}]
            draft.definition=definition
        rid=str(revision.id)
    return tid,rid,obj


@pytest.mark.parametrize("saved_draft", [False, True])
def test_legacy_shared_member_read_review_reconcile_are_controlled_and_unchanged(saved_draft):
    tid,rid,obj=legacy_shared_definition(saved_draft)
    before=client.get('/v1/workspace/package').json()
    for path in [f'/v1/library/base-templates/{tid}/versions/{rid}',f'/v1/library/base-templates/{tid}/draft']:
        response=client.get(path)
        assert response.status_code==409,response.text
        assert response.json()['error']['details']['reason']=='INTERNAL_MEMBER_OCCUPANCY'
    response=client.post(f'/v1/library/base-templates/{tid}/draft/check',params={'expected_generation':1})
    assert response.status_code==409,response.text
    assert response.json()['error']['details']['reason']=='INTERNAL_MEMBER_OCCUPANCY'
    response=client.post(f'/v1/library/base-templates/{tid}/reconcile')
    assert response.status_code==200,response.text
    assert response.json()['objects'][0]['reasons']==[{'code':'INTERNAL_MEMBER_OCCUPANCY'}]
    assert client.get('/v1/workspace/package').json()==before


@pytest.mark.parametrize("saved_draft", [False, True])
def test_historical_incompatible_archive_is_rejected_before_any_writes(saved_draft):
    legacy_shared_definition(saved_draft)
    historical=client.get('/v1/workspace/package').json()
    for slot in historical['authoring']['BuiltInEndpointDefinition']: slot.pop('cardinality')
    for link in historical['authoring']['BaseInternalLink']: link.pop('member_mappings')
    with SessionLocal.begin() as session:
        reset_dataset(session)
    with SessionLocal.begin() as session:
        before=export_package(session)
        with pytest.raises(PackageError,match='INTERNAL_MEMBER_OCCUPANCY'):
            import_package(session,historical)
        assert export_package(session)==before
