"""F2b compare-and-set and canonical/archive isolation."""
import copy
import pytest
from tests.test_module_layout import setup
from tests.test_hardware_configuration import client
from tests.test_object_reconciliation import package
from app.workspace_portability import validate_package


def request(document):
    bay = document['bays'][0]
    i = bay['installation']
    return {k: document[k] for k in ('configuration_id', 'base_revision_id')} | {
        'module_revision_id': i['module_revision_id'], 'bay_key': bay['bay_key'],
        'orientation': i['orientation'], 'expected_layout': i['layout'],
        'layout': {**i['layout'], 'x': .02, 'y': .02, 'width': .2, 'height': .1}}


def test_save_identity_retry_conflict_archive():
    _, obj, _, document = setup()
    i = document['bays'][0]['installation']
    url = f"/v1/topology/physical-objects/{obj}/module-installations/{i['id']}/layout"
    body = request(document)
    before = package()
    response = client.put(url, json=body)
    assert response.status_code == 200, response.text
    result = response.json()['bays'][0]['installation']
    assert result['id'] == i['id'] and result['layout'] == body['layout']
    after = package()
    assert after['canonical'] == before['canonical']
    assert after['authoring']['ModuleEndpointMapping'] == before['authoring']['ModuleEndpointMapping']
    assert client.put(url, json=body).status_code == 409
    assert package() == after
    body['expected_layout'] = body['layout']
    assert client.put(url, json=body).status_code == 200
    assert package() == after
    validate_package(after)
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=after).status_code == 204
    assert package() == after


@pytest.mark.parametrize('field,value,status', [
    ('bay_key', 'foreign', 409), ('module_revision_id', '00000000-0000-0000-0000-000000000000', 409),
    ('base_revision_id', '00000000-0000-0000-0000-000000000000', 409),
    ('configuration_id', '00000000-0000-0000-0000-000000000000', 409),
    ('orientation', 'VERTICAL', 409),
    ('x', -.1, 422), ('y', 1, 422), ('width', 0, 422), ('height', -1, 422),
    ('width', 2, 422), ('panel_key', 'foreign', 422), ('x', 'NaN', 422),
])
def test_refusal_atomic(field, value, status):
    _, obj, _, document = setup()
    body = request(document)
    if field in body['layout']: body['layout'][field] = value
    else: body[field] = value
    before = package()
    i = document['bays'][0]['installation']
    response = client.put(f"/v1/topology/physical-objects/{obj}/module-installations/{i['id']}/layout", json=body)
    assert response.status_code == status, response.text
    assert package() == before


def test_foreign_installation():
    _, obj, _, document = setup()
    _, other, _, foreign = setup()
    before = package()
    i = foreign['bays'][0]['installation']
    assert client.put(f"/v1/topology/physical-objects/{obj}/module-installations/{i['id']}/layout", json=request(document)).status_code == 422
    assert package() == before


@pytest.mark.parametrize('change', ['layout', 'revision', 'bay'])
def test_locked_concurrent_change_refuses_stale_writer(change):
    import uuid
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy import select
    from app.database import SessionLocal
    from app import models as m
    from app.schemas import SaveModuleLayoutRequest
    from app.module_layout_editing import save_layout
    from app.errors import ModelError
    _, obj, module, document = setup()
    i = document['bays'][0]['installation']
    started = Event()
    query = SaveModuleLayoutRequest(**request(document))
    def writer():
        with SessionLocal.begin() as session:
            started.set()
            save_layout(session, uuid.UUID(obj), uuid.UUID(i['id']), query)
    with ThreadPoolExecutor() as executor:
        with SessionLocal.begin() as session:
            session.scalar(select(m.PhysicalObject).where(m.PhysicalObject.id == uuid.UUID(obj)).with_for_update())
            row = session.get(m.ModuleInstallation, uuid.UUID(i['id']))
            if change == 'layout': row.layout = {**row.layout, 'x': .01}
            elif change == 'bay': row.orientation = 'VERTICAL'
            else:
                old = session.get(m.ModuleTemplateRevision, row.module_revision_id)
                new = m.ModuleTemplateRevision(template_id=old.template_id, version_number=old.version_number+1,
                    name=old.name, compatibility=old.compatibility, geometry=old.geometry)
                session.add(new); session.flush(); row.module_revision_id = new.id
            future = executor.submit(writer)
            assert started.wait(3)
        with pytest.raises(ModelError): future.result(timeout=8)
        with SessionLocal() as session:
            row = session.get(m.ModuleInstallation, uuid.UUID(i['id']))
            assert row.layout != query.layout.model_dump()
