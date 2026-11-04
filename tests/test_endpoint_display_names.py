"""Pinned template read names never rewrite canonical facts."""
from tests.test_object_reconciliation import (
    client, create_base, create_object, endpoint, oid, revision, reconcile,
    package, connect, SessionLocal,
)


def test_pinned_names_reconciliation_and_detached_reads():
    template, _ = create_base()
    obj = create_object(template)
    point_id, interface_id = endpoint(obj)
    with SessionLocal.begin() as session:
        connection = connect(session, point_id)
    before = package()['canonical']
    remote_id = next(p['physical_object_id'] for p in before['ConnectionPoint'] if p['id'] != str(point_id))
    revision(template, lambda d: d['slots'][0].update(display_name='Renamed port'))

    def details():
        response = client.get(f'/v1/topology/physical-objects/{oid(obj)}')
        assert response.status_code == 200, response.text
        return response.json()['connection_points'][0]

    assert details()['label'] == 'MGMT'  # Published latest does not change the pin.
    assert reconcile(template)[oid(obj)]['status'] == 'updated'
    for _ in range(2):  # New requests/reopening must resolve afresh.
        point = details()
        assert point['label'] == 'Renamed port'
        assert point['canonical_label'] == 'MGMT'
        assert point['connection_point_ref']['entity_id'] == str(point_id)
        assert point['direct_interface_bindings'][0]['interface_ref']['entity_id'] == str(interface_id)
        assert point['direct_interface_bindings'][0]['label'] == 'Renamed port'
        assert point['external_physical_attachments'][0]['cable_label'] == 'User cable'
        remote = client.get(f'/v1/topology/physical-objects/{remote_id}').json()['connection_points'][0]
        assert remote['external_physical_attachments'][0]['remote_connection_point_label'] == 'Renamed port'
        assert remote['label_source'] == 'TECHNICAL_FALLBACK'
        projection = client.post('/v1/topology/projection', json={
            'layer': 'L1', 'detail_level': 'PHYSICAL_OBJECT',
            'scope': {'include_location_subtrees': [], 'include_entities': []}}).json()
        node = next(n for n in projection['nodes'] if any(r['entity_id'] == oid(obj) for r in n['source_refs']))
        assert node['attributes']['connection_points'][0]['display_name'] == 'Renamed port'
        assert node['attributes']['blueprint_presentation']['slots'][0]['display_name'] == 'Renamed port'
    assert package()['canonical'] == before
