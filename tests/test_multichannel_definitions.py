import copy
import uuid
import pytest
from sqlalchemy import select, func
from app.database import SessionLocal
from app import models as m
from app.schemas import CreateBaseTemplateRequest
from app.hardware_catalog import HardwareCatalog
from app.repository import CanonicalRepository, PointMember
from app.resolver import L1Resolver
from app.base_template_review import physical_structure
from tests.test_hardware_configuration import base_payload, create_base, create_object, client
from tests.test_base_template_review import open_draft, save, check
from tests.test_base_template_publication import publish


def payload(n=4, fanout=True):
    d = base_payload()
    rear = d['slots'][0]
    rear.update(kind='CONNECTION_POINT', cardinality=n)
    d['slots'] = [rear] + [{**rear, 'key': str(uuid.uuid4()), 'display_name': str(i), 'cardinality': 1 if fanout else n} for i in range(n if fanout else 1)]
    d['internal_links'] = [{'from_slot_key': rear['key'], 'to_slot_key': s['key'], 'member_mappings': [{'from_member_index': i, 'to_member_index': 1}]} for i,s in enumerate(d['slots'][1:],1)] if fanout else [{'from_slot_key': rear['key'], 'to_slot_key': d['slots'][1]['key'], 'member_mappings': [{'from_member_index': i, 'to_member_index': n-i+1} for i in range(1,n)]}]
    return d


@pytest.mark.parametrize('n,fanout', [(1,True),(4,True),(24,True),(7,False)])
def test_exact_materialization_reload_trace_archive(n, fanout):
    d = payload(n,fanout)
    if n == 1:
        for s in d['slots']: s.pop('cardinality')
        for l in d['internal_links']: l.pop('member_mappings')
    tid,_ = create_base(d)
    obj = create_object(tid)
    ids = {s['slot_key']: uuid.UUID(s['connection_point_ref']['entity_id']) for s in obj['slots']}
    with SessionLocal() as session:
        assert session.get(m.ConnectionPoint, ids[d['slots'][0]['key']]).cardinality == n
        resolver = L1Resolver(CanonicalRepository(session))
        for i,s in enumerate(d['slots'][1:],1):
            pairs = [(i,1)] if fanout else [(j,n-j+1) for j in range(1,n)]
            for a,b in pairs:
                target = PointMember(ids[s['key']],b)
                assert target in resolver._traverse(PointMember(ids[d['slots'][0]['key']],a),target)[0]
        if not fanout:
            target = PointMember(ids[d['slots'][1]['key']],1)
            assert target not in resolver._traverse(PointMember(ids[d['slots'][0]['key']],n),target)[0]
    package = client.get('/v1/workspace/package').json()
    from app.workspace_portability import validate_package, import_package, reset_dataset
    validate_package(package)
    archive = copy.deepcopy(package)
    if n == 1:
        for slot in archive['authoring']['BuiltInEndpointDefinition']: slot.pop('cardinality')
        for link in archive['authoring']['BaseInternalLink']: link.pop('member_mappings')
    with SessionLocal.begin() as session:
        reset_dataset(session)
        import_package(session, archive)
    assert client.get('/v1/workspace/package').json() == package


@pytest.mark.parametrize('mutation', ['range','duplicate','cross_link','self','network','zero'])
def test_invalid_members(mutation):
    d=payload()
    if mutation=='range': d['internal_links'][0]['member_mappings'][0]['from_member_index']=5
    if mutation=='duplicate': d['internal_links'][0]['member_mappings']*=2
    if mutation=='cross_link': d['internal_links'][1]['member_mappings'][0]['from_member_index']=1
    if mutation=='self': d['internal_links'][0]['to_slot_key']=d['slots'][0]['key']
    if mutation=='network': d['slots'][0]['kind']='NETWORK_PORT'
    if mutation=='zero': d['slots'][0]['cardinality']=0
    with pytest.raises(ValueError): CreateBaseTemplateRequest.model_validate(d)


def test_atomic_late_failure(monkeypatch):
    tid,_=create_base(payload())
    with SessionLocal.begin() as session:
        before=session.scalar(select(func.count()).select_from(m.PhysicalObject))
        def fail(*args,**kwargs): raise RuntimeError('late failure')
        monkeypatch.setattr(CanonicalRepository,'add_connection',fail)
        with pytest.raises(RuntimeError): HardwareCatalog(session).create_object(uuid.UUID(tid),'failed')
        assert session.scalar(select(func.count()).select_from(m.PhysicalObject))==before


def test_immutable_publication_and_allowed_reconcile():
    tid,_=create_base(payload())
    obj=create_object(tid)
    before=client.get('/v1/workspace/package').json()['canonical']
    draft=open_draft(tid)
    d=copy.deepcopy(draft['definition']);d['slots'][0]['cardinality']+=1
    saved=save(tid,draft,d)
    response=client.post(f'/v1/library/base-templates/{tid}/draft/check', params={'expected_generation': saved['generation']})
    assert response.status_code==409,response.text
    draft=open_draft(tid);d=copy.deepcopy(draft['definition']);d['slots'][0]['cardinality']-=1
    d['name']='Presentation';d['slots'][0]['rendered_position']['x']=.3
    checked=check(tid,save(tid,draft,d))
    result=publish(tid,checked['review']['candidate_id'])
    assert result.status_code==200,result.text
    response = client.post(f"/v1/library/base-templates/{tid}/reconcile")
    assert response.status_code == 200,response.text
    assert client.get('/v1/workspace/package').json()['canonical']==before

@pytest.mark.parametrize('change', ['add','remove','kind','cardinality','mapping','bay'])
def test_physical_changes_rejected_without_instances(change):
    tid,_=create_base(payload())
    draft=open_draft(tid); d=copy.deepcopy(draft['definition'])
    if change=='add': d['slots'].append({**d['slots'][1], 'key':str(uuid.uuid4())})
    if change=='remove':
        removed=d['slots'].pop()['key'];d['internal_links']=[l for l in d['internal_links'] if removed not in (l['from_slot_key'],l['to_slot_key'])]
    if change=='kind': next(s for s in d['slots'] if s['cardinality']==1)['kind']='NETWORK_PORT'
    if change=='cardinality': d['slots'][0]['cardinality']+=1
    if change=='mapping': d['internal_links']=d['internal_links'][:1]; link=d['internal_links'][0]; field='from_member_index' if next(s for s in d['slots'] if s['key']==link['from_slot_key'])['cardinality']>1 else 'to_member_index';link['member_mappings'][0][field]=1 if link['member_mappings'][0][field]!=1 else 2
    if change=='bay': d['bays'][0]['compatibility']='different'
    saved=save(tid,draft,d)
    response=client.post(f'/v1/library/base-templates/{tid}/draft/check', params={'expected_generation': saved['generation']})
    assert response.status_code==409,response.text
    assert response.json()['error']['details']['reason']=='PHYSICAL_STRUCTURE_IMMUTABLE'
