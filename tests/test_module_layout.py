"""F2a presentation persistence, projection and reconciliation guarantees."""
import copy
import uuid
import pytest
from sqlalchemy import select
from app.database import SessionLocal
from app import models as m
from app.module_layout import initial_layout, endpoint_position, validate_layout
from app.workspace_portability import validate_package, PackageError
from tests.test_hardware_configuration import client, create_base, create_object, create_module, install
from tests.test_object_reconciliation import revision, reconcile, package
from tests.test_module_template_review import open_draft, save, check
from tests.test_module_template_publication import publish


def setup(logical=False):
    from tests.test_hardware_configuration import base_payload
    payload = base_payload()
    if logical:
        from tests.test_logical_module_places import logical as logical_bay
        payload['bays'] = [logical_bay(b) for b in payload['bays']]
    base, payload = create_base(payload)
    obj = create_object(base)['physical_object_ref']['entity_id']
    module = create_module()
    response = install(obj, module['template_id'], payload['bays'][0]['bay_key'])
    assert response.status_code == 201
    return base, obj, module, response.json()


@pytest.mark.parametrize('logical', [False, True])
def test_initial_projection_orientation_and_e3_geometry(logical):
    base, obj, module, document = setup(logical)
    installed = document['bays'][0]['installation']
    layout = installed['layout']
    validate_layout(layout, document['bays'][0]['panel_key'])
    before = package()
    draft = open_draft(module['template_id'])
    definition = copy.deepcopy(draft['definition'])
    key = definition['endpoints'][0]['key']
    definition['geometry']['endpoints'][key] = {'x': .9, 'y': .1}
    definition['geometry']['fill_color'] = '#123456'
    checked = check(module['template_id'], save(module['template_id'], draft, definition))
    assert publish(module['template_id'], checked['review']['candidate_id']).status_code == 200
    assert client.post(f"/v1/library/module-templates/{module['template_id']}/reconcile").status_code == 200
    result = client.get(f'/v1/topology/physical-objects/{obj}/configuration').json()['bays'][0]['installation']
    assert result['layout'] == layout
    assert result['fill_color'] == '#123456'
    port = next(e for e in result['endpoints'] if e['key'] == key)
    assert (port['x'], port['y']) == pytest.approx(endpoint_position(layout, {'x': .9, 'y': .1}, 'HORIZONTAL'))
    assert {e['connection_point_id'] for e in result['endpoints']} == {e['connection_point_id'] for e in installed['endpoints']}
    assert package()['canonical'] == before['canonical']


def test_d2_retains_custom_layout_and_blocks_panel_move():
    base, obj, module, document = setup()
    installed = document['bays'][0]['installation']
    custom = {**installed['layout'], 'x': .02, 'y': .03, 'width': .2, 'height': .2}
    with SessionLocal.begin() as session:
        session.get(m.ModuleInstallation, uuid.UUID(installed['id'])).layout = custom
    revision(base, lambda d: d['bays'][0].update(x=.3, width=.4))
    before = package()
    assert reconcile(base)[obj]['status'] == 'updated'
    after = package()
    assert after['canonical'] == before['canonical']
    assert after['authoring']['ModuleInstallation'] == before['authoring']['ModuleInstallation']
    def move(d):
        d['panels'].append({**d['panels'][0], 'panel_key': 'other', 'panel_number': 2})
        d['bays'][0]['panel_key'] = 'other'
    revision(base, move)
    before = package()
    result = reconcile(base)[obj]
    assert result['status'] == 'requires_intervention'
    assert any(r['code'] == 'MODULE_LAYOUT_PANEL_CONFLICT' for r in result['reasons'])
    assert package() == before


def test_archive_roundtrip_and_corruption():
    _, obj, _, document = setup()
    current = package()
    assert current['format_version'] == 7 and current['module_layout_version'] == 1
    parsed = validate_package(current)
    assert parsed['module_installations'][0]['layout'] == document['bays'][0]['installation']['layout']
    for bad in (None, {}, {**parsed['module_installations'][0]['layout'], 'width': 2}):
        corrupt = copy.deepcopy(current)
        corrupt['authoring']['ModuleInstallation'][0]['layout'] = bad
        with pytest.raises(PackageError): validate_package(corrupt)
    corrupt = copy.deepcopy(current)
    del corrupt['authoring']['ModuleInstallation'][0]['layout']
    with pytest.raises(PackageError): validate_package(corrupt)
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=current).status_code == 204
    assert package() == current


def test_aspect_and_rotation():
    bay = {'panel_key': 'p', 'x': .1, 'y': .1, 'width': .8, 'height': .8}
    geometry = {'width': 240, 'height': 80}
    panel = {'width': 600, 'height': 200}
    for orientation in ('HORIZONTAL', 'VERTICAL'):
        layout = initial_layout(bay, geometry, orientation, panel)
        validate_layout(layout, 'p')
        ratio = layout['width'] * panel['width'] / (layout['height'] * panel['height'])
        assert ratio == pytest.approx(3 if orientation == 'HORIZONTAL' else 1/3)
    assert endpoint_position({'x': .1, 'y': .2, 'width': .3, 'height': .4}, {'x': .9, 'y': .1}, 'VERTICAL') == pytest.approx((.37, .56))


@pytest.mark.parametrize('replace_key', [True, False])
@pytest.mark.parametrize('logical', [False, True])
def test_d2_final_assignment_panel_conflict_is_atomic(replace_key, logical):
    base, obj, _, _ = setup(logical)
    def edit(d):
        original = d['bays'][0]
        d['panels'].append({**d['panels'][0], 'panel_key': 'other', 'panel_number': 2})
        if replace_key:
            # Original bay survives but becomes incompatible: D2 must reassign.
            d['bays'].append({**original, 'bay_key': 'replacement', 'panel_key': 'other'})
            original['compatibility'] = 'incompatible'
        else:
            original['panel_key'] = 'other'
    revision(base, edit)
    from tests.test_base_template_review import open_draft as base_draft
    review = base_draft(base)['publication_state']['objects'][0]
    assert review['classification'] == 'requires_intervention'
    assert any(r['code'] == 'MODULE_LAYOUT_PANEL_CONFLICT' for r in review['reasons'])
    before = package()
    result = reconcile(base)[obj]
    assert result['status'] == 'requires_intervention'
    assert any(r['code'] == 'MODULE_LAYOUT_PANEL_CONFLICT' for r in result['reasons'])
    assert package() == before
    assert client.get(f'/v1/topology/physical-objects/{obj}/configuration').status_code == 200
