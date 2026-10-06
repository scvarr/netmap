import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import ModuleTemplate, ModuleTemplateRevision, ModuleEndpointDefinition
from tests.test_hardware_configuration import client, create_base, create_module, create_object, install


def add_revision(template_id):
    with SessionLocal.begin() as session:
        revision = ModuleTemplateRevision(template_id=uuid.UUID(template_id), version_number=2, compatibility='OCP3')
        session.add(revision)
        session.flush()
        session.add(ModuleEndpointDefinition(module_revision_id=revision.id, definition_key='new-port',
                                             display_name='P3', kind='NETWORK_PORT', order_index=0))
        return revision.id


def test_unused_module_deletes_all_revisions_and_definitions():
    module = create_module()
    add_revision(module['template_id'])
    other = create_module()
    with SessionLocal() as session:
        revision_ids = tuple(session.scalars(select(ModuleTemplateRevision.id).where(ModuleTemplateRevision.template_id == uuid.UUID(module['template_id']))))
        definition_ids = tuple(session.scalars(select(ModuleEndpointDefinition.id).where(ModuleEndpointDefinition.module_revision_id.in_(revision_ids))))
    assert len(revision_ids) == 2 and len(definition_ids) == 3
    response = client.delete(f"/v1/library/module-templates/{module['template_id']}")
    assert response.status_code == 204 and response.content == b''
    with SessionLocal() as session:
        assert session.get(ModuleTemplate, uuid.UUID(module['template_id'])) is None
        assert not session.scalars(select(ModuleTemplateRevision).where(ModuleTemplateRevision.id.in_(revision_ids))).all()
        assert not session.scalars(select(ModuleEndpointDefinition).where(ModuleEndpointDefinition.id.in_(definition_ids))).all()
        assert session.get(ModuleTemplate, uuid.UUID(other['template_id'])) is not None
    assert {m['template_id'] for m in client.get('/v1/library/module-templates').json()['modules']} == {other['template_id']}


@pytest.mark.parametrize('installed_revision', [1, 2])
def test_installed_revision_blocks_root_deletion_without_changing_any_data(installed_revision):
    template_id, payload = create_base()
    object_id = create_object(template_id)['physical_object_ref']['entity_id']
    module = create_module()
    if installed_revision == 2:
        add_revision(module['template_id'])
    installed = install(object_id, module['template_id'], payload['bays'][0]['bay_key'])
    assert installed.status_code == 201, installed.text
    if installed_revision == 1:
        add_revision(module['template_id'])  # Used historical revision, unused latest revision.
    configuration = client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json()
    before = client.get('/v1/workspace/package').json()
    response = client.delete(f"/v1/library/module-templates/{module['template_id']}")
    assert response.status_code == 409, response.text
    assert 'installed' in response.json()['error']['message']
    assert response.json()['error']['details']['template_id'] == module['template_id']
    # Exact snapshot includes installations/mappings and canonical CP/NI/bindings/metadata.
    assert client.get('/v1/workspace/package').json() == before
    assert client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json() == configuration


def test_missing_module_returns_existing_validation_error_style():
    response = client.delete(f'/v1/library/module-templates/{uuid.uuid4()}')
    assert response.status_code == 422
    assert response.json()['error']['message'] == 'ModuleTemplate was not found'
