"""F1 immutable template geometry and the boundary with installed modules."""
import copy
import pytest
from app.module_geometry import initial_geometry
from app.workspace_portability import validate_package, PackageError
from tests.test_hardware_configuration import client
from tests.test_module_template_review import setup_installations, open_draft, save, check
from tests.test_module_template_publication import publish


def test_geometry_publication_history_retry_and_explicit_e3():
    _, module, _ = setup_installations(1)
    tid = module['template_id']
    before = client.get('/v1/workspace/package').json()
    draft = open_draft(tid)
    definition = copy.deepcopy(draft['definition'])
    definition['geometry']['width'] = 500
    definition['geometry']['fill_color'] = '#123456'
    key = definition['endpoints'][0]['key']
    definition['geometry']['endpoints'][key] = {'x': .9, 'y': .1}
    saved = save(tid, draft, definition)
    assert open_draft(tid)['definition'] == definition
    checked = check(tid, saved)
    assert [c['section'] for c in checked['review']['result']['changes']] == ['geometry']
    assert checked['review']['result']['installations'][0]['classification'] == 'potentially_safe'
    result = publish(tid, checked['review']['candidate_id']).json()
    assert publish(tid, checked['review']['candidate_id']).json() == result
    after = client.get('/v1/workspace/package').json()
    assert after['canonical'] == before['canonical']
    for name in ('ModuleInstallation', 'ModuleEndpointMapping'):
        assert after['authoring'][name] == before['authoring'][name]
    revisions = after['authoring']['ModuleTemplateRevision']
    assert next(r for r in revisions if r['id'] == module['revision_id'])['geometry'] == module['geometry']
    assert next(r for r in revisions if r['id'] == result['revision_id'])['geometry'] == definition['geometry']
    validate_package(after)
    response = client.post(f'/v1/library/module-templates/{tid}/reconcile')
    assert response.status_code == 200, response.text
    assert response.json()['installations'][0]['status'] == 'updated'
    final = client.get('/v1/workspace/package').json()
    assert final['canonical'] == before['canonical']
    assert {r['connection_point_id'] for r in final['authoring']['ModuleEndpointMapping']} == {r['connection_point_id'] for r in before['authoring']['ModuleEndpointMapping']}


def test_historical_v5_extension_and_mixed_profile_rejection():
    _, module, _ = setup_installations(1)
    checked = check(module['template_id'], open_draft(module['template_id']))
    assert publish(module['template_id'], checked['review']['candidate_id']).status_code == 200
    package = client.get('/v1/workspace/package').json()
    historical = copy.deepcopy(package)
    del historical["module_geometry_version"]
    for r in historical['authoring']['ModuleTemplateRevision']: del r['geometry']
    for name in ('ModuleTemplateDraft', 'ModuleTemplateCandidate'):
        for r in historical['authoring'][name]: del r['definition']['geometry']
    with pytest.raises(PackageError): validate_package({**historical, "module_geometry_version": 1})
    parsed = validate_package(historical)
    assert all(r['geometry'] == module['geometry'] for r in parsed['module_template_revisions'])
    mixed = copy.deepcopy(package)
    del mixed['authoring']['ModuleTemplateRevision'][0]['geometry']
    with pytest.raises(PackageError): validate_package(mixed)
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=historical).status_code == 204
    assert client.get('/v1/workspace/package').json() == package


@pytest.mark.parametrize('change', [lambda g: g.update(width=0), lambda g: g.update(height=-1), lambda g: g.update(fill_color='red'), lambda g: g['endpoints'].clear(), lambda g: next(iter(g['endpoints'].values())).update(x=1.1)])
def test_invalid_published_geometry_rejected(change):
    setup_installations(0)
    package = client.get('/v1/workspace/package').json()
    change(package['authoring']['ModuleTemplateRevision'][0]['geometry'])
    with pytest.raises(PackageError): validate_package(package)


def test_0006_extends_persisted_revision_draft_and_candidate():
    import os
    import subprocess
    import uuid
    import sqlalchemy as sa
    from app.database import engine
    database = 'f1_migration_' + uuid.uuid4().hex
    admin = sa.create_engine(engine.url, isolation_level='AUTOCOMMIT')
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE {database}')
    url = engine.url.set(database=database)
    env = {**os.environ, 'DATABASE_URL': url.render_as_string(hide_password=False)}
    isolated = sa.create_engine(url)
    try:
        subprocess.run(['alembic','upgrade','0005'], env=env, check=True, capture_output=True)
        tid, rid, eid, did, cid = [uuid.uuid4() for _ in range(5)]
        definition = {'name':'Edited draft','compatibility':'X','endpoints':[{'key':'stable','display_name':'Renamed','kind':'NETWORK_PORT'}]}
        import json
        with isolated.begin() as c:
            c.execute(sa.text('INSERT INTO module_templates(id,name) VALUES (:id, :name)'), {'id':tid,'name':'Initial'})
            c.execute(sa.text("INSERT INTO module_template_revisions(id,template_id,version_number,name,compatibility) VALUES (:id,:tid,1,'Initial','X')"), {'id':rid,'tid':tid})
            c.execute(sa.text("INSERT INTO module_endpoint_definitions(id,module_revision_id,definition_key,order_index,display_name,kind) VALUES (:id,:rid,'stable',0,'Original','NETWORK_PORT')"), {'id':eid,'rid':rid})
            c.execute(sa.text('INSERT INTO module_template_drafts(id,template_id,source_revision_id,generation,definition) VALUES (:id,:tid,:rid,7,CAST(:definition AS jsonb))'), {'id':did,'tid':tid,'rid':rid,'definition':json.dumps(definition)})
            c.execute(sa.text("""INSERT INTO module_template_candidates(id,template_id,source_revision_id,draft_generation,definition,result,input_fingerprint) VALUES (:id,:tid,:rid,7,CAST(:definition AS jsonb),'{"changes":[],"installations":[]}',:fingerprint)"""), {'id':cid,'tid':tid,'rid':rid,'definition':json.dumps(definition),'fingerprint':'a'*64})
        subprocess.run(['alembic','upgrade','head'], env=env, check=True, capture_output=True)
        with isolated.connect() as c:
            assert c.scalar(sa.text('SELECT geometry FROM module_template_revisions')) == initial_geometry(['stable'])
            for table in ('module_template_drafts','module_template_candidates'):
                actual = c.scalar(sa.text(f'SELECT definition FROM {table}'))
                assert actual == {**definition, 'geometry': initial_geometry(['stable'])}
            assert c.scalar(sa.text('SELECT id FROM module_endpoint_definitions')) == eid
    finally:
        isolated.dispose()
        with admin.connect() as c: c.exec_driver_sql(f'DROP DATABASE {database} WITH (FORCE)')
        admin.dispose()


def test_geometry_edit_invalidates_frozen_review():
    _, module, _ = setup_installations(0)
    tid = module['template_id']
    checked = check(tid, open_draft(tid))
    definition = copy.deepcopy(checked['definition'])
    definition['geometry']['height'] = 160
    save(tid, checked, definition)
    assert not open_draft(tid)['review']['current']
    assert publish(tid, checked['review']['candidate_id']).status_code == 409
    assert open_draft(tid)['review']['definition']['geometry']['height'] == 80
